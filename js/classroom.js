const urlParams = new URLSearchParams(window.location.search);
const classId = urlParams.get('id');
const userRole = urlParams.get('role');

if (!classId) {
    window.location.href = 'dashboard.html';
}

let currentUser = null;

window.auth.onAuthStateChanged(async (user) => {
    if (!user) {
        window.location.href = 'index.html';
    } else {
        currentUser = user;

        // Display role in nav badge
        const roleEl = document.getElementById('user-role');
        if (roleEl) roleEl.textContent = getDisplayRole(userRole);

        // Configure role-based UI
        if (['Owner', 'Teacher', 'CR'].includes(userRole)) {
            document.getElementById('teacher-stream-controls').style.display = 'flex';

            // Show teacher attendance section
            const teacherAttSection = document.getElementById('teacher-att-section');
            if (teacherAttSection) teacherAttSection.style.display = 'block';

            // Auto-load attendance list for today (for modal)
            const dateInput = document.getElementById('attendance-date');
            if (dateInput && !dateInput.value) {
                dateInput.value = new Date().toISOString().split('T')[0];
                setTimeout(() => loadAttendanceForDate(dateInput.value), 500);
            }
        } else if (userRole === 'Student') {
            // Show student attendance summary
            const summaryEl = document.getElementById('student-attendance-summary');
            if (summaryEl) summaryEl.style.display = 'block';
            loadStudentAttendance();
        }

        // Configure Settings Dropdown
        if (userRole === 'Owner') {
            document.getElementById('btn-delete-class').style.display = 'block';
        } else {
            document.getElementById('btn-leave-class').style.display = 'block';
        }

        if (['Owner', 'Teacher', 'CR'].includes(userRole)) {
            document.getElementById('btn-change-wallpaper').style.display = 'block';
        }

        await loadClassDetails();
        listenForClassUpdates();
        listenForNotices();
        listenForAssignments();
        loadMembers();
        syncUserNames();
    }
});

function getDisplayRole(role) {
    if (role === 'Owner') return 'Teacher';
    if (role === 'Teacher') return 'Class Rep';
    if (role === 'CR') return 'Class Rep';
    return role || 'Student';
}

async function syncUserNames() {
    try {
        const nameToSave = currentUser.displayName || currentUser.email || 'Unknown';
        const memberRef = window.db.doc(`classes/${classId}/members/${currentUser.uid}`);
        const memberDoc = await memberRef.get();
        if (memberDoc.exists && !memberDoc.data().userName) {
            await memberRef.update({ userName: nameToSave });
            // Reload members after fixing the name
            loadMembers();
        }
    } catch (error) {
        console.log(error);
    }
}

async function loadClassDetails() {
    try {
        const classDoc = await window.db.doc(`classes/${classId}`).get();
        if (classDoc.exists) {
            const data = classDoc.data();
          if (data.name) document.getElementById('class-name').innerText = data.name;
          if (data.subject) document.getElementById('class-subject').innerText = data.subject;
          if (data.code) document.getElementById('class-code').innerText = data.code;
          
          if (data.wallpaperUrl) {
              const banner = document.getElementById('classroom-banner');
              banner.style.display = 'block';
              banner.style.backgroundImage = `url('${data.wallpaperUrl}')`;
          }
        } else {
            showToast('Class not found.', 'error');
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Real-time Class Updates for Live Class
let classUnsubscribe = null;
let jitsiApi = null;
window.currentLiveRoom = null;

function listenForClassUpdates() {
    if (classUnsubscribe) classUnsubscribe();
    
    classUnsubscribe = window.db.doc(`classes/${classId}`).onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
            
            // Check Live Class status
          if (data.liveClassActive) {
              document.getElementById('active-live-container').style.display = 'block';
              
              if (currentUser && ['Owner', 'Teacher', 'CR'].includes(userRole)) {
                  document.getElementById('btn-start-live').style.display = 'none';
                  document.getElementById('btn-end-live').style.display = 'flex';
              }
              window.currentLiveRoom = data.liveClassRoomName;
          } else {
              document.getElementById('active-live-container').style.display = 'none';
              
              if (currentUser && ['Owner', 'Teacher', 'CR'].includes(userRole)) {
                  document.getElementById('btn-start-live').style.display = 'flex';
                  document.getElementById('btn-end-live').style.display = 'none';
              }
              
              if (jitsiApi) {
                  jitsiApi.dispose();
                  jitsiApi = null;
                  const container = document.getElementById('jitsi-container');
                  if (container) container.style.display = 'none';
                  showToast("The live class has ended.");
              }
              window.currentLiveRoom = null;
          }
        }
    });
}

let streamNotices = [];
let streamAssignments = [];

function renderUnifiedStream() {
    const noticesList = document.getElementById('notices-list');
    if (!noticesList) return;

    // Combine and sort
    const allItems = [...streamNotices, ...streamAssignments];
    allItems.sort((a, b) => b.timestamp - a.timestamp);

    if (allItems.length === 0) {
        noticesList.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><h3>No posts yet</h3><p>Announcements and assignments will appear here.</p></div>`;
        return;
    }

    let html = '';
    const now = Date.now();

    // Initialize submission cache
    if (!window._submissionCache) window._submissionCache = {};

    allItems.forEach(item => {
        if (item.type === 'notice') {
            const data = item.data;
            const date = data.createdAt ? data.createdAt.toDate().toLocaleString() : 'Just now';

            if (data.isDeleted) {
                html += `
                    <div class="notice-card" style="border-left-color:var(--text-muted);">
                        <p style="color:var(--text-muted);font-style:italic;margin:0;">🚫 This message was deleted by ${data.deletedBy}</p>
                        <div class="notice-meta">${date}</div>
                    </div>
                `;
                return;
            }

            let noticeActions = '';
            if (currentUser && currentUser.uid === data.authorId) {
                const ageInMinutes = (now - item.timestamp) / (1000 * 60);
                if (ageInMinutes <= 15) {
                    const safeTitle = data.title.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    const safeMessage = data.message.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '\\n');
                    const safeAttachmentName = data.attachmentName ? data.attachmentName.replace(/'/g, "\\'").replace(/"/g, '&quot;') : '';
                    noticeActions = `
                        <div class="notice-actions">
                            <button class="btn btn-ghost" style="padding:0.3rem;width:28px;height:28px;" onclick="openEditNotice('${item.id}','${safeTitle}','${safeMessage}','${safeAttachmentName}')" title="Edit (15m window)">
                                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                            </button>
                            <button class="btn btn-ghost" style="padding:0.3rem;width:28px;height:28px;color:var(--danger);" onclick="deleteNotice('${item.id}')" title="Delete">
                                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path stroke-linecap="round" stroke-linejoin="round" d="M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>
                            </button>
                        </div>
                    `;
                }
            }

            let attachmentHtml = '';
            if (data.attachmentUrl) {
                if (data.attachmentType === 'image') {
                    attachmentHtml = `<img class="notice-image" src="${data.attachmentUrl}" alt="Attachment">`;
                } else {
                    attachmentHtml = `<div style="margin-top:0.875rem;"><a href="${data.attachmentUrl}" target="_blank" class="btn btn-outline" style="font-size:0.82rem;padding:0.45rem 0.875rem;"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg> ${data.attachmentName || 'Attachment'}</a></div>`;
                }
            }

            const editedTag = data.isEdited ? `<span style="font-size:0.7rem;color:var(--text-muted);">(edited)</span>` : '';
            const initials = (data.authorName || 'T')[0].toUpperCase();

            html += `
                <div class="notice-card" style="position:relative;margin-bottom:1rem;">
                    <div class="author-row">
                        <div class="author-avatar">${initials}</div>
                        <div>
                            <div class="author-name">${data.authorName} ${editedTag}</div>
                            <div class="author-time">${date}</div>
                        </div>
                    </div>
                    ${noticeActions}
                    <h4 style="font-size:1rem;font-weight:700;margin-bottom:0.5rem;padding-right:5rem;color:var(--text-main);">${data.title}</h4>
                    <p style="font-size:0.875rem;color:var(--text-sub);white-space:pre-wrap;">${data.message}</p>
                    ${attachmentHtml}
                </div>
            `;

        } else if (item.type === 'assignment') {
            const data = item.data;
            const date = data.createdAt ? data.createdAt.toDate().toLocaleString() : 'Just now';
            const dueDate = new Date(data.dueDate).toLocaleDateString();
            const isOverdue = new Date(data.dueDate) < new Date();

            let attachmentHtml = '';
            if (data.attachmentUrl) {
                attachmentHtml = `<div style="margin-top:0.875rem;"><a href="${data.attachmentUrl}" target="_blank" class="btn btn-outline" style="font-size:0.82rem;padding:0.45rem 0.875rem;"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg> ${data.attachmentName || 'Attachment'}</a></div>`;
            }

            const isTeacher = ['Owner', 'Teacher', 'CR'].includes(userRole);
                        <div style="background: rgba(139, 92, 246, 0.1); width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                            <i data-lucide="file-text" style="color: var(--accent); width: 16px; height: 16px;"></i>
                        </div>
                        <div>
                            <span style="font-weight: 600; color: var(--text-main); font-size: 0.9rem;">New Assignment</span>
                            <span style="color: var(--text-muted); font-size: 0.75rem; margin-left: 0.5rem;">${date}</span>
                        </div>
                        <span style="font-size: 0.75rem; font-weight: 600; color: #ef4444; background: rgba(239, 68, 68, 0.1); padding: 0.25rem 0.5rem; border-radius: 4px; margin-left: auto;">Due: ${dueDate}</span>
                    </div>
                    <h4 style="margin-bottom: 0.5rem; font-size: 1.1rem; color: var(--text-main);">${data.title}</h4>
                    <p style="white-space: pre-wrap; margin-bottom: 0.5rem; color: var(--text-muted);">${data.instructions || 'No instructions'}</p>
                    ${attachmentHtml}
                    <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-color); font-size: 0.85rem; color: var(--accent); font-weight: 600; display: flex; align-items: center; gap: 0.5rem;"><i data-lucide="${isTeacher ? 'users' : 'upload'}" style="width: 16px; height: 16px;"></i> ${ctaText}</div>
                </div>
            `;
        }
    });

    noticesList.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
}

let isInitialNoticesLoad = true;
let noticesUnsubscribe = null;

function listenForNotices() {
    if (noticesUnsubscribe) noticesUnsubscribe();
    
    // Request notification permissions
    if (window.Notification && Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }

    noticesUnsubscribe = window.db.collection(`classes/${classId}/notices`).orderBy('createdAt', 'desc').onSnapshot((querySnapshot) => {
        
        // Handle Notifications
        if (!isInitialNoticesLoad && window.Notification && Notification.permission === "granted") {
            querySnapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    if (data.authorId !== currentUser.uid && !data.isDeleted) {
                        new Notification(`New Announcement in ${document.getElementById('class-name').innerText}`, {
                            body: data.title
                        });
                    }
                }
            });
        }
        isInitialNoticesLoad = false;

        streamNotices = [];
        querySnapshot.forEach((doc) => {
            streamNotices.push({
                type: 'notice',
                id: doc.id,
                data: doc.data(),
                timestamp: doc.data().createdAt ? doc.data().createdAt.toDate().getTime() : Date.now()
            });
        });

        renderUnifiedStream();
    }, (error) => {
        console.error("Error loading notices:", error);
    });
}

async function loadMembers() {
    const membersList = document.getElementById('members-list');
    const membersModalList = document.getElementById('members-modal-list');

    const setHtml = (html) => {
        if (membersList) membersList.innerHTML = html;
        if (membersModalList) membersModalList.innerHTML = html;
    };

    try {
        const querySnapshot = await window.db.collection(`classes/${classId}/members`).get();

        let teachers = [];
        let students = [];

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const displayName = data.userName || doc.id.substring(0, 8) + '...';
            const displayRoleName = getDisplayRole(data.role);
            const badgeClass = data.role === 'Owner' ? 'badge-secondary' : data.role === 'CR' ? 'badge-warning' : data.role === 'Teacher' ? 'badge-accent' : 'badge-success';

            let rowAttrs = '';
            if (userRole === 'Owner' && doc.id !== currentUser.uid) {
                rowAttrs = `onclick="openMemberManagement(event, '${doc.id}', '${displayName}', '${data.role}')" title="Click to manage role" style="cursor:pointer;"`;
            }

            const initial = (displayName[0] || '?').toUpperCase();
            const rowHtml = `
                <div class="member-item" ${rowAttrs}>
                    <div style="display:flex;align-items:center;gap:0.75rem;">
                        <div style="width:34px;height:34px;border-radius:50%;background:var(--gradient-primary);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:0.85rem;flex-shrink:0;">${initial}</div>
                        <span style="font-size:0.9rem;font-weight:500;color:var(--text-main);">${displayName}</span>
                    </div>
                    <span class="badge ${badgeClass}">${displayRoleName}</span>
                </div>
            `;

            if (['Owner', 'Teacher', 'CR'].includes(data.role)) {
                teachers.push(rowHtml);
            } else {
                students.push(rowHtml);
            }
        });

        let combinedHtml = '';
        if (teachers.length > 0) {
            combinedHtml += `<div style="padding:0.5rem 0.875rem;font-size:0.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;background:var(--bg-elevated);">Teachers &amp; Staff</div>`;
            combinedHtml += teachers.join('');
        }
        if (students.length > 0) {
            combinedHtml += `<div style="padding:0.5rem 0.875rem;font-size:0.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;background:var(--bg-elevated);margin-top:0.5rem;">Students</div>`;
            combinedHtml += students.join('');
        }

        if (!combinedHtml) combinedHtml = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">No members found.</div>';
        setHtml(combinedHtml);
    } catch (error) {
        setHtml(`<div style="padding:2rem;text-align:center;color:var(--danger);">Error loading members.</div>`);
    }
}


// Member Management Context Menu
window.openMemberManagement = function(event, memberId, name, currentRole) {
    event.stopPropagation();
    
    const existing = document.getElementById('context-menu-manage-member');
    if (existing) existing.remove();
    
    let actionsHtml = `<div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.25rem; padding: 0 0.5rem;">Manage <strong>${name}</strong></div>`;
    
    if (currentRole !== 'Student') {
        actionsHtml += `<button class="btn btn-outline" style="width: 100%; border: none; text-align: left; justify-content: flex-start; padding: 0.5rem; font-weight: normal; color: var(--text-main);" onclick="updateMemberRole('${memberId}', 'Student')">Make Student</button>`;
    }
    if (currentRole !== 'Teacher') {
        actionsHtml += `<button class="btn btn-outline" style="width: 100%; border: none; text-align: left; justify-content: flex-start; padding: 0.5rem; font-weight: normal; color: var(--text-main);" onclick="updateMemberRole('${memberId}', 'Teacher')">Make Class Rep</button>`;
    }
    
    actionsHtml += `<hr style="margin: 0.25rem 0; border: none; border-top: 1px solid var(--border-color);">`;
    actionsHtml += `<button class="btn btn-outline" style="width: 100%; border: none; text-align: left; justify-content: flex-start; padding: 0.5rem; font-weight: normal; color: #ef4444;" onclick="updateMemberRole('${memberId}', 'Owner')">Transfer Teacher Role</button>`;

    const menu = document.createElement('div');
    menu.id = 'context-menu-manage-member';
    menu.className = 'glass glass-panel';
    menu.style.position = 'fixed';
    
    let top = event.clientY;
    let left = event.clientX;
    
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
    menu.style.padding = '0.5rem';
    menu.style.minWidth = '160px';
    menu.style.zIndex = '1000';
    menu.style.display = 'flex';
    menu.style.flexDirection = 'column';
    menu.style.boxShadow = 'var(--shadow-glow)';
    
    menu.innerHTML = actionsHtml;
    document.body.appendChild(menu);
    
    const rect = menu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) {
        menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
    }
    if (rect.right > window.innerWidth) {
        menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
    }
    
    window.pendingTransferName = name; 
}

// Global function to update member role
window.updateMemberRole = async function(memberId, newRole) {
    const existing = document.getElementById('context-menu-manage-member');
    if (existing) existing.remove();

    if (newRole === 'Owner') {
        window.pendingTransferMemberId = memberId;
        document.getElementById('transfer-target-name').innerText = window.pendingTransferName;
        openModal('modal-transfer-ownership');
        return;
    }

    try {
        await window.db.doc(`classes/${classId}/members/${memberId}`).update({
            role: newRole
        });
        showToast(`Role successfully updated to ${newRole}!`);
        loadMembers(); // Refresh list
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Close menus on outside click
document.addEventListener('click', () => {
    const existingMenu = document.getElementById('context-menu-manage-member');
    if (existingMenu) existingMenu.remove();
    
    const dropdown = document.getElementById('class-settings-dropdown');
    if(dropdown) dropdown.style.display = 'none';
});

// Handle Transfer Ownership Form
document.getElementById('form-transfer-ownership')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const myNewRole = document.getElementById('transfer-my-new-role').value;
    const targetMemberId = window.pendingTransferMemberId;

    if (!targetMemberId) return;

    try {
        const batch = window.db.batch();
        
        // 1. Update the class ownerId
        batch.update(window.db.doc(`classes/${classId}`), { ownerId: targetMemberId });
        
        // 2. Promote target member to Owner
        batch.update(window.db.doc(`classes/${classId}/members/${targetMemberId}`), { role: 'Owner' });
        
        // 3. Demote self to chosen role
        batch.update(window.db.doc(`classes/${classId}/members/${currentUser.uid}`), { role: myNewRole });
        
        await batch.commit();
        
        showToast('Ownership transferred successfully!');
        closeModal('modal-transfer-ownership');
        
        // Redirect to dashboard since we are no longer the owner
        setTimeout(() => {
            window.location.href = 'dashboard.html';
        }, 1500);

    } catch (error) {
        showToast(error.message, 'error');
        closeModal('modal-transfer-ownership');
    }
});

// Edit Notice Attachment Handling
let currentEditNoticeAttachment = null;
function handleEditNoticeFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 800 * 1024 && !file.type.startsWith('image/')) {
        showToast('Document is too large. Max size is 800KB.', 'error');
        e.target.value = '';
        return;
    }
    currentEditNoticeAttachment = file;
    document.getElementById('edit-notice-attachment-name').innerText = file.name;
    document.getElementById('edit-notice-attachment-preview').style.display = 'flex';
    document.getElementById('edit-notice-attachment-removed').value = 'false';
}
document.getElementById('edit-notice-file-upload')?.addEventListener('change', handleEditNoticeFileSelect);
document.getElementById('edit-notice-camera-upload')?.addEventListener('change', handleEditNoticeFileSelect);
document.getElementById('edit-notice-image-upload')?.addEventListener('change', handleEditNoticeFileSelect);
window.removeEditNoticeAttachment = function() {
    currentEditNoticeAttachment = null;
    document.getElementById('edit-notice-attachment-preview').style.display = 'none';
    document.getElementById('edit-notice-attachment-removed').value = 'true';
    if(document.getElementById('edit-notice-file-upload')) document.getElementById('edit-notice-file-upload').value = '';
    if(document.getElementById('edit-notice-camera-upload')) document.getElementById('edit-notice-camera-upload').value = '';
    if(document.getElementById('edit-notice-image-upload')) document.getElementById('edit-notice-image-upload').value = '';
}

// Handle Edit Notice Submission
document.getElementById('form-edit-notice')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-notice-id').value;
    const title = document.getElementById('edit-notice-title').value;
    const message = document.getElementById('edit-notice-message').value;
    const isRemoved = document.getElementById('edit-notice-attachment-removed').value === 'true';
    const btn = document.getElementById('btn-submit-edit-notice');
    
    try {
        if(btn) {
            btn.disabled = true;
            btn.innerText = 'Updating...';
        }
        
        let updateData = {
            title: title,
            message: message,
            isEdited: true
        };
        
        if (currentEditNoticeAttachment) {
            if(btn) btn.innerText = 'Processing Attachment...';
            updateData.attachmentUrl = await compressAndConvertFile(currentEditNoticeAttachment);
            updateData.attachmentType = currentEditNoticeAttachment.type.startsWith('image/') ? 'image' : 'file';
            updateData.attachmentName = currentEditNoticeAttachment.name;
        } else if (isRemoved) {
            updateData.attachmentUrl = null;
            updateData.attachmentType = null;
            updateData.attachmentName = null;
        }
        
        await window.db.doc(`classes/${classId}/notices/${id}`).update(updateData);
        showToast('Notice updated successfully!');
        closeModal('modal-edit-notice');
        // loadNotices() removed because of real-time listener
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        if(btn) {
            btn.disabled = false;
            btn.innerText = 'Save Changes';
        }
    }
});

// Edit Notice Trigger
window.openEditNotice = function(id, title, message, attachmentName) {
    document.getElementById('edit-notice-id').value = id;
    document.getElementById('edit-notice-title').value = title;
    document.getElementById('edit-notice-message').value = message;
    
    currentEditNoticeAttachment = null;
    document.getElementById('edit-notice-attachment-removed').value = 'false';
    
    if (attachmentName) {
        document.getElementById('edit-notice-attachment-name').innerText = attachmentName;
        document.getElementById('edit-notice-attachment-preview').style.display = 'flex';
    } else {
        document.getElementById('edit-notice-attachment-preview').style.display = 'none';
    }
    
    openModal('modal-edit-notice');
}

// Delete Notice Trigger
window.deleteNotice = async function(id) {
    if (confirm("Are you sure you want to delete this announcement?")) {
        try {
            await window.db.doc(`classes/${classId}/notices/${id}`).update({
                isDeleted: true,
                deletedBy: currentUser.displayName || currentUser.email || 'Unknown',
                title: '',
                message: '🚫 This message was deleted.',
                attachmentUrl: null,
                attachmentType: null,
                attachmentName: null
            });
            showToast('Notice deleted.');
        } catch (error) {
            showToast(error.message, 'error');
        }
    }
}

// Leave Class
document.getElementById('btn-leave-class')?.addEventListener('click', () => openModal('modal-leave-class'));
document.getElementById('form-leave-class')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await window.db.doc(`classes/${classId}/members/${currentUser.uid}`).delete();
        window.location.href = 'dashboard.html';
    } catch (error) {
        showToast(error.message, 'error');
        closeModal('modal-leave-class');
    }
});

// Wallpaper Upload Logic
document.getElementById('btn-change-wallpaper')?.addEventListener('click', () => {
    document.getElementById('wallpaper-upload').click();
    document.getElementById('class-settings-dropdown').style.display = 'none';
});

document.getElementById('wallpaper-upload')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    showToast("Uploading wallpaper...");
    try {
        const storageRef = window.storage.ref();
        const fileRef = storageRef.child(`wallpapers/${classId}/${Date.now()}_${file.name}`);
        await fileRef.put(file);
        const url = await fileRef.getDownloadURL();
        
        await window.db.doc(`classes/${classId}`).update({
            wallpaperUrl: url
        });
        
        const banner = document.getElementById('classroom-banner');
        banner.style.display = 'block';
        banner.style.backgroundImage = `url('${url}')`;
        showToast("Wallpaper updated successfully!");
    } catch (error) {
        showToast("Error uploading wallpaper: " + error.message, 'error');
    }
    
    e.target.value = '';
});

// Delete Class
document.getElementById('btn-delete-class')?.addEventListener('click', () => openModal('modal-delete-class'));
document.getElementById('form-delete-class')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await window.db.doc(`classes/${classId}`).delete();
        window.location.href = 'dashboard.html';
    } catch (error) {
        showToast(error.message, 'error');
        closeModal('modal-delete-class');
    }
});

// Modal Logic
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

document.getElementById('btn-post-notice')?.addEventListener('click', () => openModal('modal-post-notice'));
document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => closeModal(e.target.closest('.modal-overlay').id));
});

// Jitsi Meet Logic
document.getElementById('btn-start-live')?.addEventListener('click', async () => {
    try {
        const roomName = `iaop-class-${classId}-${Date.now()}`;
        
        const batch = window.db.batch();
        batch.update(window.db.doc(`classes/${classId}`), {
            liveClassActive: true,
            liveClassRoomName: roomName
        });
        
        const noticeRef = window.db.collection(`classes/${classId}/notices`).doc();
        batch.set(noticeRef, {
            title: `<i data-lucide="radio" style="color: #ff3b30; width: 24px; height: 24px;"></i> Live Class Started`,
            message: "The teacher has just started a live video class. Join now from the live class alert!",
            authorId: currentUser.uid,
            authorName: currentUser.displayName || 'Teacher',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        await batch.commit();
        startJitsiMeeting(roomName);
    } catch (error) {
        showToast("Error starting class: " + error.message, 'error');
    }
});

document.getElementById('btn-end-live')?.addEventListener('click', async () => {
    if (confirm("Are you sure you want to end the live class for everyone?")) {
        try {
            await window.db.doc(`classes/${classId}`).update({
                liveClassActive: false,
                liveClassRoomName: null
            });
            if (jitsiApi) {
                jitsiApi.dispose();
                jitsiApi = null;
            }
            document.getElementById('jitsi-container').style.display = 'none';
        } catch (error) {
            showToast("Error ending class: " + error.message, 'error');
        }
    }
});

document.getElementById('btn-join-live')?.addEventListener('click', () => {
    document.getElementById('live-student-controls').style.display = 'none';
    if (window.currentLiveRoom) {
        startJitsiMeeting(window.currentLiveRoom);
    }
});

function startJitsiMeeting(roomName) {
    const container = document.getElementById('jitsi-container');
    container.style.display = 'block';
    
    if (jitsiApi) {
        jitsiApi.dispose();
    }

    const domain = 'meet.jit.si';
    const options = {
        roomName: roomName,
        width: '100%',
        height: '100%',
        parentNode: container,
        userInfo: {
            displayName: currentUser ? (currentUser.displayName || 'Student') : 'Student'
        },
        configOverwrite: {
            prejoinPageEnabled: false,
            startWithAudioMuted: true,
            startWithVideoMuted: false
        },
        interfaceConfigOverwrite: {
            DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_BRAND_WATERMARK: false,
            DEFAULT_LOGO_URL: '',
            DEFAULT_WELCOME_PAGE_LOGO_URL: ''
        }
    };
    
    jitsiApi = new window.JitsiMeetExternalAPI(domain, options);
}

// Handle file selections
let currentNoticeAttachment = null;
function handleNoticeFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Size check preview
    if (file.size > 800 * 1024 && !file.type.startsWith('image/')) {
        showToast('Document is too large. Max size is 800KB.', 'error');
        e.target.value = '';
        return;
    }
    
    currentNoticeAttachment = file;
    document.getElementById('notice-attachment-name').innerText = file.name;
    document.getElementById('notice-attachment-preview').style.display = 'flex';
}

document.getElementById('notice-file-upload')?.addEventListener('change', handleNoticeFileSelect);
document.getElementById('notice-camera-upload')?.addEventListener('change', handleNoticeFileSelect);
document.getElementById('notice-image-upload')?.addEventListener('change', handleNoticeFileSelect);

window.removeNoticeAttachment = function() {
    currentNoticeAttachment = null;
    document.getElementById('notice-attachment-preview').style.display = 'none';
    if(document.getElementById('notice-file-upload')) document.getElementById('notice-file-upload').value = '';
    if(document.getElementById('notice-camera-upload')) document.getElementById('notice-camera-upload').value = '';
    if(document.getElementById('notice-image-upload')) document.getElementById('notice-image-upload').value = '';
}

// Helper: Compress and convert file to Base64 to bypass Firebase Storage
function compressAndConvertFile(file) {
    return new Promise((resolve, reject) => {
        const isImage = file.type.startsWith('image/');
        
        if (!isImage) {
            if (file.size > 800 * 1024) { 
                reject(new Error("Document is too large! Maximum size is 800KB."));
                return;
            }
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
            return;
        }
        
        // Compress Image
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image();
            img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const MAX_WIDTH = 1000;
                const MAX_HEIGHT = 1000;
                
                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                const dataUrl = canvas.toDataURL('image/jpeg', 0.6); // 60% quality
                
                if (dataUrl.length > 900000) { 
                    reject(new Error("Image is too large even after compression. Try a smaller image."));
                    return;
                }
                resolve(dataUrl);
            };
            img.onerror = () => reject(new Error("Failed to process image."));
        };
        reader.onerror = error => reject(error);
    });
}

// Post Notice
document.getElementById('form-post-notice')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('notice-title').value;
    const message = document.getElementById('notice-message').value;
    const btn = document.getElementById('btn-submit-notice');

    try {
        if(btn) {
            btn.disabled = true;
            btn.innerText = 'Posting...';
        }
        
        let attachmentUrl = null;
        let attachmentType = null;
        let attachmentName = null;
        
        if (currentNoticeAttachment) {
            if(btn) btn.innerText = 'Processing...';
            try {
                attachmentUrl = await compressAndConvertFile(currentNoticeAttachment);
                attachmentType = currentNoticeAttachment.type.startsWith('image/') ? 'image' : 'file';
                attachmentName = currentNoticeAttachment.name;
            } catch (err) {
                showToast(err.message, 'error');
                if(btn) {
                    btn.disabled = false;
                    btn.innerText = 'Post';
                }
                return;
            }
        }

        await window.db.collection(`classes/${classId}/notices`).add({
            title,
            message,
            attachmentUrl,
            attachmentType,
            attachmentName,
            authorId: currentUser.uid,
            authorName: currentUser.displayName || 'Teacher',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        showToast('Notice posted successfully!');
        closeModal('modal-post-notice');
        e.target.reset();
        removeNoticeAttachment();
        // loadNotices() removed because of real-time listener
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        if(btn) {
            btn.disabled = false;
            btn.innerText = 'Post';
        }
    }
});



// Handle date change
document.getElementById('attendance-date')?.addEventListener('change', async (e) => {
    await loadAttendanceForDate(e.target.value);
});

// Handle holiday toggle
document.getElementById('attendance-holiday')?.addEventListener('change', (e) => {
    document.getElementById('attendance-list-container').style.display = e.target.checked ? 'none' : 'block';
});

async function loadAttendanceForDate(dateStr) {
    if (!dateStr) return;
    const listEl = document.getElementById('attendance-list');
    listEl.innerHTML = '<div style="color: var(--text-muted);">Loading students...</div>';
    
    try {
        // Fetch existing record if any
        const recordDoc = await window.db.doc(`classes/${classId}/attendance_records/${dateStr}`).get();
        let existingRecord = null;
        if (recordDoc.exists) {
            existingRecord = recordDoc.data();
            document.getElementById('attendance-holiday').checked = existingRecord.isHoliday;
            document.getElementById('attendance-list-container').style.display = existingRecord.isHoliday ? 'none' : 'block';
            document.getElementById('btn-submit-attendance').innerText = 'Update Record';
        } else {
            document.getElementById('attendance-holiday').checked = false;
            document.getElementById('attendance-list-container').style.display = 'block';
            document.getElementById('btn-submit-attendance').innerText = 'Save Record';
        }

        const querySnapshot = await window.db.collection(`classes/${classId}/members`).get();
        
        let html = '';
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.role === 'Student') {
                const displayName = data.userName || doc.id.substring(0, 8) + '...';
                const isPresent = existingRecord && existingRecord.presentStudents ? existingRecord.presentStudents.includes(doc.id) : false;
                
                html += `
                    <div class="member-item" style="justify-content: flex-start; gap: 1rem;">
                        <input type="checkbox" name="attendance" value="${doc.id}" id="chk-${doc.id}" style="width: 1.25rem; height: 1.25rem;" ${isPresent ? 'checked' : ''}>
                        <label for="chk-${doc.id}" style="cursor: pointer; user-select: none; width: 100%; display: flex;">${displayName}</label>
                    </div>
                `;
            }
        });
        
        if (html === '') {
            html = '<div style="color: var(--text-muted);">No students enrolled yet.</div>';
        }
        listEl.innerHTML = html;
        if (window.lucide) window.lucide.createIcons();
    } catch (error) {
        listEl.innerHTML = `<div style="color: #ef4444;">Error loading students.</div>`;
    }
}

// Submit Attendance
document.getElementById('form-take-attendance')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dateStr = document.getElementById('attendance-date').value;
    const isHoliday = document.getElementById('attendance-holiday').checked;
    
    if (!dateStr) {
        showToast('Please select a date.', 'error');
        return;
    }

    const checkboxes = document.querySelectorAll('input[name="attendance"]');
    let presentStudents = [];
    
    if (!isHoliday) {
        checkboxes.forEach(chk => {
            if (chk.checked) presentStudents.push(chk.value);
        });
    }

    try {
        await window.db.doc(`classes/${classId}/attendance_records/${dateStr}`).set({
            date: dateStr,
            isHoliday: isHoliday,
            presentStudents: presentStudents,
            recordedAt: firebase.firestore.FieldValue.serverTimestamp(),
            recordedBy: currentUser.uid
        });

        showToast('Attendance recorded successfully!');
    } catch (error) {
        showToast(error.message, 'error');
    }
});

// ==========================================
// ASSIGNMENTS LOGIC
// ==========================================

let assignmentsUnsubscribe = null;

function listenForAssignments() {
    if (assignmentsUnsubscribe) assignmentsUnsubscribe();
    
    assignmentsUnsubscribe = window.db.collection(`classes/${classId}/assignments`).orderBy('createdAt', 'desc').onSnapshot(async (querySnapshot) => {
        streamAssignments = [];
        querySnapshot.forEach((doc) => {
            streamAssignments.push({
                type: 'assignment',
                id: doc.id,
                data: doc.data(),
                timestamp: doc.data().createdAt ? doc.data().createdAt.toDate().getTime() : Date.now()
            });
        });
        renderUnifiedStream();
    }, (error) => {
        console.error("Error loading assignments:", error);
    });
}

// Assignment Attachment Handling (Create)
let currentAssignmentAttachment = null;
function handleAssignmentFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 800 * 1024 && !file.type.startsWith('image/')) {
        showToast('Document is too large. Max size is 800KB.', 'error');
        e.target.value = '';
        return;
    }
    currentAssignmentAttachment = file;
    document.getElementById('assignment-attachment-name').innerText = file.name;
    document.getElementById('assignment-attachment-preview').style.display = 'flex';
}
document.getElementById('assignment-file-upload')?.addEventListener('change', handleAssignmentFileSelect);
window.removeAssignmentAttachment = function() {
    currentAssignmentAttachment = null;
    document.getElementById('assignment-attachment-preview').style.display = 'none';
    if(document.getElementById('assignment-file-upload')) document.getElementById('assignment-file-upload').value = '';
}

// Create Assignment Submit
document.getElementById('btn-create-assignment')?.addEventListener('click', () => {
    openModal('modal-create-assignment');
});
document.getElementById('form-create-assignment')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('assignment-title').value;
    const instructions = document.getElementById('assignment-instructions').value;
    const dueDate = document.getElementById('assignment-due-date').value;
    const btn = document.getElementById('btn-submit-assignment');

    try {
        btn.disabled = true;
        btn.innerText = 'Creating...';
        
        let attachmentUrl = null;
        let attachmentType = null;
        let attachmentName = null;
        
        if (currentAssignmentAttachment) {
            btn.innerText = 'Processing File...';
            attachmentUrl = await compressAndConvertFile(currentAssignmentAttachment);
            attachmentType = currentAssignmentAttachment.type.startsWith('image/') ? 'image' : 'file';
            attachmentName = currentAssignmentAttachment.name;
        }

        await window.db.collection(`classes/${classId}/assignments`).add({
            title,
            instructions,
            dueDate,
            attachmentUrl,
            attachmentType,
            attachmentName,
            authorId: currentUser.uid,
            authorName: currentUser.displayName || 'Teacher',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        showToast('Assignment created successfully!');
        closeModal('modal-create-assignment');
        e.target.reset();
        removeAssignmentAttachment();
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerText = 'Assign';
    }
});

// View Submissions Modal (Teacher Checklist)
window.openViewSubmissionsModal = async function(assignmentId, title) {
    document.getElementById('view-submissions-title').innerText = `Submissions: ${title}`;
    document.getElementById('checklist-assignment-id').value = assignmentId;
    openModal('modal-view-submissions');
    
    const listEl = document.getElementById('submissions-list');
    listEl.innerHTML = '<div style="color: var(--text-muted); text-align: center;">Loading students...</div>';
    
    try {
        const membersSnapshot = await window.db.collection(`classes/${classId}/members`).get();
        let students = [];
        membersSnapshot.forEach(doc => {
            if (doc.data().role === 'Student') {
                students.push({ id: doc.id, name: doc.data().userName || doc.id.substring(0,8) + '...' });
            }
        });

        const submissionsSnapshot = await window.db.collection(`classes/${classId}/assignments/${assignmentId}/submissions`).get();
        let submittedIds = [];
        submissionsSnapshot.forEach(doc => {
            submittedIds.push(doc.id);
        });

        let html = '';
        students.forEach(student => {
            const isCompleted = submittedIds.includes(student.id);
            
            html += `
                <div class="member-item" style="justify-content: flex-start; gap: 1rem;">
                    <input type="checkbox" name="submission-checklist" value="${student.id}" id="chk-sub-${student.id}" style="width: 1.25rem; height: 1.25rem; accent-color: var(--primary);" ${isCompleted ? 'checked' : ''}>
                    <label for="chk-sub-${student.id}" style="cursor: pointer; user-select: none; width: 100%; display: flex; font-weight: 500;">${student.name}</label>
                </div>
            `;
        });

        if (students.length === 0) {
            html = '<div style="color: var(--text-muted); text-align: center;">No students in this class.</div>';
        }
        listEl.innerHTML = html;

    } catch (error) {
        listEl.innerHTML = `<div style="color: #ef4444;">Error loading submissions: ${error.message}</div>`;
    }
};

// Handle Form Submission for Checklist
document.getElementById('form-view-submissions')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const assignmentId = document.getElementById('checklist-assignment-id').value;
    const btn = document.getElementById('btn-submit-checklist');
    
    const checkboxes = document.querySelectorAll('input[name="submission-checklist"]');
    
    try {
        btn.disabled = true;
        btn.innerText = 'Saving...';
        showToast('Saving records...');
        
        const batch = window.db.batch();
        
        checkboxes.forEach(chk => {
            const ref = window.db.doc(`classes/${classId}/assignments/${assignmentId}/submissions/${chk.value}`);
            if (chk.checked) {
                batch.set(ref, {
                    status: 'completed',
                    markedBy: currentUser.uid,
                    markedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                batch.delete(ref);
            }
        });
        
        await batch.commit();
        
        showToast('Records saved successfully!');
        closeModal('modal-view-submissions');
        
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerText = 'Save Record';
    }
});

// Calendar State
let currentCalendarDate = new Date();
let attendanceRecordsForCalendar = [];

function renderCalendar() {
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthYearEl = document.getElementById('cal-month-year');
    if(monthYearEl) monthYearEl.innerText = `${monthNames[month]} ${year}`;
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const grid = document.getElementById('cal-days-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    for (let i = 0; i < firstDay; i++) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'calendar-day empty';
        grid.appendChild(emptyDiv);
    }
    
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month+1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        
        const dayDiv = document.createElement('div');
        dayDiv.className = 'calendar-day';
        dayDiv.innerText = day;
        
        const record = attendanceRecordsForCalendar.find(r => r.date === dateStr);
        if (record) {
            if (record.isHoliday) {
                dayDiv.classList.add('holiday');
            } else if (record.presentStudents && record.presentStudents.includes(currentUser.uid)) {
                dayDiv.classList.add('present');
            } else {
                dayDiv.classList.add('absent');
            }
        }
        
        grid.appendChild(dayDiv);
    }
}

document.getElementById('cal-prev')?.addEventListener('click', () => {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
    renderCalendar();
});
document.getElementById('cal-next')?.addEventListener('click', () => {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
    renderCalendar();
});

// Load Student Attendance
async function loadStudentAttendance() {
    const section = document.getElementById('student-attendance-summary');
    if(section) section.style.display = 'block';

    try {
        const querySnapshot = await window.db.collection(`classes/${classId}/attendance_records`).get();
        let totalWorkingDays = 0;
        let daysPresent = 0;

        attendanceRecordsForCalendar = [];

        querySnapshot.forEach(doc => {
            const data = doc.data();
            attendanceRecordsForCalendar.push(data);
            if (!data.isHoliday) {
                totalWorkingDays++;
                if (data.presentStudents && data.presentStudents.includes(currentUser.uid)) {
                    daysPresent++;
                }
            }
        });

        const daysAbsent = totalWorkingDays - daysPresent;
        const percentage = totalWorkingDays > 0 ? Math.round((daysPresent / totalWorkingDays) * 100) : 0;

        const totalEl = document.getElementById('student-att-total');
        if(totalEl) totalEl.innerText = totalWorkingDays;
        const presentEl = document.getElementById('student-att-present');
        if(presentEl) presentEl.innerText = daysPresent;
        const absentEl = document.getElementById('student-att-absent');
        if(absentEl) absentEl.innerText = daysAbsent;
        const percentEl = document.getElementById('student-att-percentage');
        if(percentEl) percentEl.innerText = percentage + '%';

        // Animate progress bar
        const barEl = document.getElementById('student-att-bar');
        if (barEl) {
            barEl.style.width = percentage + '%';
            barEl.className = `progress-fill ${percentage >= 75 ? 'success' : 'danger'}`;
        }

        currentCalendarDate = new Date();
        renderCalendar();

    } catch (error) {
        console.error("Error loading attendance:", error);

    }
}

// Generate PDF Report Modal Logic
document.getElementById('btn-open-report-modal')?.addEventListener('click', () => {
    openModal('modal-download-report');
});

document.getElementById('form-download-report')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const includeAttendance = document.getElementById('report-include-attendance').checked;
    const includeAssignments = document.getElementById('report-include-assignments').checked;
    const btn = document.getElementById('btn-generate-pdf');
    
    if (!includeAttendance && !includeAssignments) {
        showToast('Please select at least one type of data to include.', 'error');
        return;
    }

    try {
        btn.disabled = true;
        btn.innerText = 'Generating...';
        showToast('Generating PDF...');
        
        const classDoc = await window.db.doc(`classes/${classId}`).get();
        const className = classDoc.data().name;
        
        // 1. Get Students
        const membersSnapshot = await window.db.collection(`classes/${classId}/members`).get();
        let students = [];
        membersSnapshot.forEach(doc => {
            if(doc.data().role === 'Student') {
                students.push({ 
                    id: doc.id, 
                    name: doc.data().userName || 'Unknown', 
                    present: 0, 
                    absent: 0, 
                    attPercentage: 0,
                    assignmentsCompleted: 0,
                    assignmentsPending: 0,
                    assignPercentage: 0
                });
            }
        });
        
        let totalWorkingDays = 0;
        let totalAssignments = 0;

        // 2. Fetch Attendance Data if requested
        if (includeAttendance) {
            const attSnapshot = await window.db.collection(`classes/${classId}/attendance_records`).get();
            attSnapshot.forEach(doc => {
                const data = doc.data();
                if (!data.isHoliday) {
                    totalWorkingDays++;
                    students.forEach(student => {
                        if (data.presentStudents && data.presentStudents.includes(student.id)) {
                            student.present++;
                        }
                    });
                }
            });
            
            students.forEach(student => {
                student.absent = totalWorkingDays - student.present;
                student.attPercentage = totalWorkingDays > 0 ? Math.round((student.present / totalWorkingDays) * 100) : 0;
            });
        }

        // 3. Fetch Assignment Data if requested
        if (includeAssignments) {
            const assignmentsSnapshot = await window.db.collection(`classes/${classId}/assignments`).get();
            totalAssignments = assignmentsSnapshot.size;
            
            // For each assignment, check who submitted
            for (const assignmentDoc of assignmentsSnapshot.docs) {
                const submissionsSnapshot = await window.db.collection(`classes/${classId}/assignments/${assignmentDoc.id}/submissions`).get();
                const submittedStudentIds = submissionsSnapshot.docs.map(d => d.id);
                
                students.forEach(student => {
                    if (submittedStudentIds.includes(student.id)) {
                        student.assignmentsCompleted++;
                    }
                });
            }

            students.forEach(student => {
                student.assignmentsPending = totalAssignments - student.assignmentsCompleted;
                student.assignPercentage = totalAssignments > 0 ? Math.round((student.assignmentsCompleted / totalAssignments) * 100) : 0;
            });
        }
        
        // 4. Build Table
        const headRow = ['#', 'Student Name'];
        if (includeAttendance) {
            headRow.push('Days Present', 'Days Absent', 'Attendance %');
        }
        if (includeAssignments) {
            headRow.push('Completed', 'Pending', 'Assignment %');
        }

        const tableBody = [];
        students.forEach((student, index) => {
            const row = [index + 1, student.name];
            if (includeAttendance) {
                row.push(student.present, student.absent, student.attPercentage + '%');
            }
            if (includeAssignments) {
                row.push(student.assignmentsCompleted, student.assignmentsPending, student.assignPercentage + '%');
            }
            tableBody.push(row);
        });
        
        if (!window.jspdf) {
            showToast('PDF Library still loading, please try again in a second.', 'error');
            return;
        }
        
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF(headRow.length > 6 ? 'landscape' : 'portrait');
        
        doc.setFontSize(18);
        doc.text(`Class Report: ${className}`, 14, 22);
        
        doc.setFontSize(11);
        let yPos = 30;
        if (includeAttendance) {
            doc.text(`Total Working Days: ${totalWorkingDays}`, 14, yPos);
            yPos += 6;
        }
        if (includeAssignments) {
            doc.text(`Total Assignments: ${totalAssignments}`, 14, yPos);
            yPos += 6;
        }
        doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, yPos);
        
        doc.autoTable({
            startY: yPos + 6,
            head: [headRow],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [59, 130, 246] }
        });
        
        let filename = `${className}_Report`;
        if (includeAttendance && !includeAssignments) filename += "_Attendance";
        if (!includeAttendance && includeAssignments) filename += "_Assignments";
        doc.save(`${filename}.pdf`);
        
        showToast('PDF Downloaded successfully!');
        closeModal('modal-download-report');
        
    } catch (error) {
        showToast('Error generating PDF.', 'error');
        console.error(error);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Generate PDF';
    }
});

// Auto-initialize Lucide icons for dynamically added content removed due to infinite loop.
// Instead, call lucide.createIcons() manually after adding dynamic content.
