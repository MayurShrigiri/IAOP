/* ============================================================
   IAOP — classroom.js  |  Clean rewrite, all bugs fixed
   ============================================================ */

const urlParams = new URLSearchParams(window.location.search);
const classId   = urlParams.get('id');
const userRole  = urlParams.get('role');

if (!classId) window.location.href = 'dashboard.html';

let currentUser = null;

/* ── Auth State ─── */
window.auth.onAuthStateChanged(async (user) => {
    if (!user) {
        window.location.href = 'index.html';
        return;
    }
    currentUser = user;

    // Role chip in navbar
    const roleEl = document.getElementById('user-role');
    if (roleEl) roleEl.textContent = getDisplayRole(userRole);

    // Set avatar initial or image
    const avatarEl = document.getElementById('btn-profile-menu');
    if (avatarEl) {
        if (user.photoURL) {
            avatarEl.innerHTML = `<img src="${user.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="Profile">`;
            avatarEl.style.background = 'transparent';
            avatarEl.style.padding = '0';
        } else {
            const firstName = (user.displayName || user.email || '?').split(' ')[0];
            avatarEl.textContent = (firstName[0] || '?').toUpperCase();
        }
    }

    const isStaff = ['Owner', 'Teacher', 'CR'].includes(userRole);

    // Teacher FAB
    const fab = document.getElementById('teacher-fab');
    if (fab) fab.style.display = isStaff ? 'flex' : 'none';

    // Teacher attendance section
    const teacherAtt = document.getElementById('teacher-att-section');
    if (teacherAtt) teacherAtt.style.display = isStaff ? 'block' : 'none';

    // Student attendance summary
    const studentAtt = document.getElementById('student-att-summary');
    if (userRole === 'Student' && studentAtt) {
        studentAtt.style.display = 'block';
        loadStudentAttendance();
    }

    // Settings dropdown items
    if (userRole === 'Owner') {
        const el = document.getElementById('btn-delete-class');
        if (el) el.style.display = 'block';
    } else {
        const el = document.getElementById('btn-leave-class');
        if (el) el.style.display = 'block';
    }
    if (isStaff) {
        const el1 = document.getElementById('btn-change-wallpaper');
        if (el1) el1.style.display = 'block';
        const el2 = document.getElementById('btn-change-class-logo');
        if (el2) el2.style.display = 'block';
    }

    // Pre-fill attendance date to today
    if (isStaff) {
        const dateInput = document.getElementById('attendance-date');
        if (dateInput && !dateInput.value) {
            dateInput.value = new Date().toISOString().split('T')[0];
            setTimeout(() => loadAttendanceForDate(dateInput.value), 600);
        }
    }

    await loadClassDetails();
    listenForClassUpdates();
    listenForNotices();
    listenForAssignments();
    loadMembers();
    syncUserName();
});

/* ── Profile Dropdown & Logout ─── */
document.getElementById('btn-profile-menu')?.addEventListener('click', (e) => {
    document.getElementById('profile-dropdown')?.classList.toggle('open');
    e.stopPropagation();
});
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('profile-dropdown');
    if (dropdown && !e.target.closest('.dropdown')) dropdown.classList.remove('open');
});
document.getElementById('btn-logout-trigger')?.addEventListener('click', () => {
    document.getElementById('modal-logout-confirm')?.classList.add('active');
    document.getElementById('profile-dropdown')?.classList.remove('open');
});
document.getElementById('btn-confirm-logout')?.addEventListener('click', () => {
    window.auth.signOut();
});

/* ── FAB Toggle Logic ─── */
document.getElementById('btn-toggle-fab')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const menu = document.getElementById('teacher-fab-menu');
    if (btn && menu) {
        btn.classList.toggle('open');
        menu.classList.toggle('open');
    }
    e.stopPropagation();
});
document.addEventListener('click', (e) => {
    const fabMenu = document.getElementById('teacher-fab-menu');
    const fabBtn = document.getElementById('btn-toggle-fab');
    if (fabMenu && fabMenu.classList.contains('open') && !e.target.closest('.fab-container')) {
        fabMenu.classList.remove('open');
        if (fabBtn) fabBtn.classList.remove('open');
    }
});

/* ── Role display ─── */
function getDisplayRole(role) {
    if (role === 'Owner')   return 'Teacher';
    if (role === 'Teacher') return 'Class Rep';
    if (role === 'CR')      return 'Class Rep';
    return role || 'Student';
}

/* ── Sync user display name ─── */
async function syncUserName() {
    try {
        const nameToSave = currentUser.displayName || currentUser.email || 'Unknown';
        const ref = window.db.doc(`classes/${classId}/members/${currentUser.uid}`);
        const snap = await ref.get();
        if (snap.exists) {
            const md = snap.data();
            if (!md.userName || md.photoURL !== currentUser.photoURL) {
                await ref.update({ 
                    userName: nameToSave,
                    photoURL: currentUser.photoURL || null
                });
                loadMembers();
            }
        }
    } catch(e) { console.log(e); }
}

/* ── Load class header details ─── */
async function loadClassDetails() {
    try {
        const snap = await window.db.doc(`classes/${classId}`).get();
        if (snap.exists) {
            const d = snap.data();
            if (d.name)    { const el = document.getElementById('class-name');    if(el) el.textContent = d.name; }
            if (d.subject) { const el = document.getElementById('class-subject'); if(el) el.textContent = d.subject; }
            if (d.code)    { const el = document.getElementById('class-code');    if(el) el.textContent = d.code; }
            if (d.logoUrl) {
                const img = document.getElementById('class-logo-img');
                const fallback = document.getElementById('class-logo-fallback');
                if (img) { img.src = d.logoUrl; img.style.display = 'block'; }
                if (fallback) fallback.style.display = 'none';
            }
            if (d.wallpaperUrl) {
                const banner = document.getElementById('classroom-banner');
                if (banner) { banner.style.display='block'; banner.style.backgroundImage=`url('${d.wallpaperUrl}')`; }
            }
        } else {
            showToast('Class not found.', 'error');
        }
    } catch(e) { showToast(e.message, 'error'); }
}

/* ── Real-time class updates (live class) ─── */
let classUnsub = null;
let jitsiApi   = null;
window.currentLiveRoom = null;

function listenForClassUpdates() {
    if (classUnsub) classUnsub();
    classUnsub = window.db.doc(`classes/${classId}`).onSnapshot(snap => {
        if (!snap.exists) return;
        const d = snap.data();
        const liveCont  = document.getElementById('active-live-container');
        const startBtn  = document.getElementById('btn-start-live');
        const endBtn    = document.getElementById('btn-end-live');
        const isStaff   = ['Owner','Teacher','CR'].includes(userRole);

        if (d.logoUrl) {
            const img = document.getElementById('class-logo-img');
            const fallback = document.getElementById('class-logo-fallback');
            if (img) { img.src = d.logoUrl; img.style.display = 'block'; }
            if (fallback) fallback.style.display = 'none';
        }
        
        if (d.liveClassActive) {
            if (liveCont) liveCont.style.display = 'block';
            if (isStaff) {
                if (startBtn) startBtn.style.display = 'none';
                if (endBtn)   endBtn.style.display   = 'flex';
            }
            window.currentLiveRoom = d.liveClassRoomName;
        } else {
            if (liveCont) liveCont.style.display = 'none';
            if (isStaff) {
                if (startBtn) startBtn.style.display = 'flex';
                if (endBtn)   endBtn.style.display   = 'none';
            }
            if (jitsiApi) {
                jitsiApi.dispose();
                jitsiApi = null;
                const c = document.getElementById('jitsi-container');
                if (c) c.style.display = 'none';
                showToast('The live class has ended.');
            }
            window.currentLiveRoom = null;
        }
    });
}

/* ══════════════════════════════════════════════════════════════
   STREAM — Unified notices + assignments feed
   ══════════════════════════════════════════════════════════════ */
let streamNotices     = [];
let streamAssignments = [];

function renderUnifiedStream() {
    const list = document.getElementById('notices-list');
    if (!list) return;

    const all = [...streamNotices, ...streamAssignments];
    all.sort((a, b) => b.timestamp - a.timestamp);

    if (all.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">
                    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"/></svg>
                </div>
                <h3>No posts yet</h3>
                <p>Announcements and assignments will appear here</p>
            </div>`;
        return;
    }

    if (!window._subCache) window._subCache = {};

    let html = '';
    const now = Date.now();
    const isStaff = ['Owner','Teacher','CR'].includes(userRole);

    all.forEach(item => {

        /* ── NOTICES ─── */
        if (item.type === 'notice') {
            const d    = item.data;
            const date = d.createdAt ? d.createdAt.toDate().toLocaleString() : 'Just now';

            if (d.isDeleted) {
                html += `
                    <div class="feed-card" style="border-left-color:var(--border);opacity:0.65;margin-bottom:0.875rem;">
                        <p style="font-size:0.85rem;color:var(--text-muted);font-style:italic;margin:0;">This message was deleted by ${d.deletedBy}.</p>
                        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.4rem;">${date}</div>
                    </div>`;
                return;
            }

            // Edit/delete — only for author within 15 min
            let actions = '';
            if (currentUser && currentUser.uid === d.authorId) {
                const age = (now - item.timestamp) / 60000;
                if (age <= 15) {
                    const t = d.title.replace(/'/g,"\\'").replace(/"/g,'&quot;');
                    const m = d.message.replace(/'/g,"\\'").replace(/"/g,'&quot;').replace(/\n/g,'\\n');
                    const an = d.attachmentName ? d.attachmentName.replace(/'/g,"\\'").replace(/"/g,'&quot;') : '';
                    actions = `
                        <div class="feed-card-actions">
                            <button class="btn btn-ghost btn-icon-sm" onclick="openEditNotice('${item.id}','${t}','${m}','${an}')" title="Edit (15 min window)">
                                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                            </button>
                            <button class="btn btn-ghost btn-icon-sm" onclick="deleteNotice('${item.id}')" title="Delete" style="color:var(--danger)">
                                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path stroke-linecap="round" stroke-linejoin="round" d="M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>
                            </button>
                        </div>`;
                }
            }

            let attach = '';
            if (d.attachmentUrl) {
                if (d.attachmentType === 'image') {
                    attach = `<img class="feed-image" src="${d.attachmentUrl}" alt="Attachment">`;
                } else {
                    attach = `<div style="margin-top:0.75rem;"><a href="${d.attachmentUrl}" target="_blank" class="attach-chip"><svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg> ${d.attachmentName || 'Attachment'}</a></div>`;
                }
            }

            const edited  = d.isEdited ? `<span style="font-size:0.7rem;color:var(--text-muted)">(edited)</span>` : '';
            const initial = (d.authorName||'T')[0].toUpperCase();
            const avatarHtml = d.authorPhoto ? `<img src="${d.authorPhoto}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" alt="${d.authorName}">` : initial;

            html += `
                <div class="feed-card" style="margin-bottom:0.875rem;">
                    <div class="feed-card-header">
                        <div class="feed-author-avatar" style="${d.authorPhoto ? 'background:transparent;padding:0' : ''}">${avatarHtml}</div>
                        <div>
                            <div class="feed-author-name">${d.authorName} ${edited}</div>
                            <div class="feed-author-time">${date}</div>
                        </div>
                    </div>
                    ${actions}
                    <div class="feed-card-title">${d.title}</div>
                    <div class="feed-card-body">${d.message}</div>
                    ${attach}
                </div>`;

        /* ── ASSIGNMENTS ─── */
        } else if (item.type === 'assignment') {
            const d       = item.data;
            const date    = d.createdAt ? d.createdAt.toDate().toLocaleString() : 'Just now';
            const dueDate = new Date(d.dueDate).toLocaleDateString();
            const overdue = new Date(d.dueDate) < new Date();

            let attach = '';
            if (d.attachmentUrl) {
                attach = `<div style="margin-top:0.75rem;"><a href="${d.attachmentUrl}" target="_blank" class="attach-chip"><svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg> ${d.attachmentName||'Attachment'}</a></div>`;
            }

            if (isStaff) {
                // Teacher — clickable to view submissions
                const safeTitle = d.title.replace(/'/g,"\\'");
                html += `
                    <div class="feed-card assignment" style="margin-bottom:0.875rem;cursor:pointer;" onclick="openViewSubmissionsModal('${item.id}','${safeTitle}')">
                        <div class="feed-card-header">
                            <div class="feed-author-avatar assign-av">
                                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
                            </div>
                            <div>
                                <div class="feed-author-name">Assignment</div>
                                <div class="feed-author-time">${date}</div>
                            </div>
                            <span class="due-label ${overdue?'overdue':''}" style="margin-left:auto">Due: ${dueDate}</span>
                        </div>
                        <div class="feed-card-title">${d.title}</div>
                        <div class="feed-card-body">${d.instructions||''}</div>
                        ${attach}
                        <div class="feed-card-footer">
                            <span style="font-size:0.78rem;color:var(--text-muted)">Click to view submissions</span>
                            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="var(--primary)" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
                        </div>
                    </div>`;
            } else {
                // Student — read-only with status badge
                const cacheKey = `sub_${item.id}_${currentUser?currentUser.uid:''}`;
                const cached   = window._subCache[cacheKey];

                let statusBadge = `<span class="status-pending"><svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>&nbsp;Pending</span>`;
                if (cached === true) {
                    statusBadge = `<span class="status-done"><svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>&nbsp;Completed</span>`;
                }

                // Async fetch if unknown
                if (cached === undefined && currentUser) {
                    window._subCache[cacheKey] = null; // prevent double fetch
                    window.db.doc(`classes/${classId}/assignments/${item.id}/submissions/${currentUser.uid}`)
                        .get().then(snap => {
                            window._subCache[cacheKey] = snap.exists;
                            renderUnifiedStream();
                        }).catch(() => {});
                }

                html += `
                    <div class="feed-card assignment" style="margin-bottom:0.875rem;">
                        <div class="feed-card-header">
                            <div class="feed-author-avatar assign-av">
                                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
                            </div>
                            <div>
                                <div class="feed-author-name">Assignment</div>
                                <div class="feed-author-time">${date}</div>
                            </div>
                            <span class="due-label ${overdue?'overdue':''}" style="margin-left:auto">Due: ${dueDate}</span>
                        </div>
                        <div class="feed-card-title">${d.title}</div>
                        <div class="feed-card-body">${d.instructions||''}</div>
                        ${attach}
                        <div class="feed-card-footer">
                            <span style="font-size:0.78rem;color:var(--text-muted)">Your status</span>
                            ${statusBadge}
                        </div>
                    </div>`;
            }
        }
    });

    list.innerHTML = html;
}

/* ── Realtime listeners ─── */
let isInitialLoad    = true;
let noticesUnsub     = null;

function listenForNotices() {
    if (noticesUnsub) noticesUnsub();
    if (window.Notification && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
    noticesUnsub = window.db.collection(`classes/${classId}/notices`)
        .orderBy('createdAt','desc')
        .onSnapshot(snap => {
            if (!isInitialLoad && window.Notification && Notification.permission === 'granted') {
                snap.docChanges().forEach(change => {
                    if (change.type === 'added') {
                        const d = change.doc.data();
                        if (d.authorId !== currentUser.uid && !d.isDeleted) {
                            new Notification(`New in ${document.getElementById('class-name')?.textContent||'class'}`, { body: d.title });
                        }
                    }
                });
            }
            isInitialLoad = false;
            streamNotices = [];
            snap.forEach(doc => {
                streamNotices.push({ type:'notice', id:doc.id, data:doc.data(), timestamp: doc.data().createdAt ? doc.data().createdAt.toDate().getTime() : Date.now() });
            });
            renderUnifiedStream();
        }, e => console.error(e));
}

let assignUnsub = null;
function listenForAssignments() {
    if (assignUnsub) assignUnsub();
    assignUnsub = window.db.collection(`classes/${classId}/assignments`)
        .orderBy('createdAt','desc')
        .onSnapshot(snap => {
            streamAssignments = [];
            snap.forEach(doc => {
                streamAssignments.push({ type:'assignment', id:doc.id, data:doc.data(), timestamp: doc.data().createdAt ? doc.data().createdAt.toDate().getTime() : Date.now() });
            });
            renderUnifiedStream();
        }, e => console.error(e));
}

/* ══════════════════════════════════════════════════════════════
   MEMBERS
   ══════════════════════════════════════════════════════════════ */
async function loadMembers() {
    const tabList = document.getElementById('members-list');
    if (!tabList) return;

    const setHtml = html => {
        tabList.innerHTML = html;
    };

    try {
        const snap = await window.db.collection(`classes/${classId}/members`).get();
        let teachers = [], students = [];

        snap.forEach(doc => {
            const d    = doc.data();
            const name = d.userName || doc.id.substring(0,8)+'...';
            const role = getDisplayRole(d.role);
            const init = (name[0]||'?').toUpperCase();
            const avatarHtml = d.photoURL ? `<img src="${d.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" alt="${name}">` : init;

            const badgeColor = d.role==='Owner' ? 'badge-green' : d.role==='CR' ? 'badge-warning' : d.role==='Teacher' ? 'badge-blue' : 'badge-neutral';

            let rowAttr = '';
            if (userRole === 'Owner' && doc.id !== currentUser.uid) {
                rowAttr = `onclick="openMemberManagement(event,'${doc.id}','${name}','${d.role}')" title="Click to manage" style="cursor:pointer;"`;
            }

            const row = `
                <div class="member-item" ${rowAttr}>
                    <div class="member-info">
                        <div class="member-avatar" style="${d.photoURL ? 'background:transparent;padding:0' : ''}">${avatarHtml}</div>
                        <div class="member-name">${name}</div>
                    </div>
                    <span class="badge ${badgeColor}">${role}</span>
                </div>`;

            if (['Owner','Teacher','CR'].includes(d.role)) teachers.push(row);
            else students.push(row);
        });

        let html = '';
        if (teachers.length) {
            html += `<div class="section-label">Teachers &amp; Staff</div>${teachers.join('')}`;
        }
        if (students.length) {
            html += `<div class="section-label" style="margin-top:0.5rem;">Students</div>${students.join('')}`;
        }
        setHtml(html || `<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.875rem;">No members found.</div>`);
    } catch(e) {
        setHtml(`<div style="padding:2rem;text-align:center;color:var(--danger);font-size:0.875rem;">Error loading members.</div>`);
    }
}

/* ── Member Management Context Menu ─── */
window.openMemberManagement = function(event, memberId, name, currentRole) {
    event.stopPropagation();
    const existing = document.getElementById('ctx-member-menu');
    if (existing) existing.remove();

    let items = `<div style="padding:0.5rem 0.875rem 0.375rem;font-size:0.75rem;color:var(--text-muted);font-weight:600;">Manage: <strong style="color:var(--text-primary)">${name}</strong></div>`;
    if (currentRole !== 'Student') items += `<button class="dropdown-item" onclick="updateMemberRole('${memberId}','Student')">Make Student</button>`;
    if (currentRole !== 'Teacher') items += `<button class="dropdown-item" onclick="updateMemberRole('${memberId}','Teacher')">Make Class Rep</button>`;
    items += `<div class="dropdown-sep"></div><button class="dropdown-item danger" onclick="updateMemberRole('${memberId}','Owner')">Transfer Teacher Role</button>`;

    const menu = document.createElement('div');
    menu.id = 'ctx-member-menu';
    Object.assign(menu.style, { position:'fixed', top:event.clientY+'px', left:event.clientX+'px', zIndex:'300', minWidth:'190px' });
    menu.className = 'dropdown-menu open';
    menu.innerHTML = items;
    document.body.appendChild(menu);
    window.pendingTransferName = name;

    // Adjust if off-screen
    const r = menu.getBoundingClientRect();
    if (r.bottom > window.innerHeight) menu.style.top = (window.innerHeight - r.height - 10)+'px';
    if (r.right  > window.innerWidth)  menu.style.left = (window.innerWidth - r.width - 10)+'px';
};

window.updateMemberRole = async function(memberId, newRole) {
    const m = document.getElementById('ctx-member-menu');
    if (m) m.remove();

    if (newRole === 'Owner') {
        window.pendingTransferMemberId = memberId;
        document.getElementById('transfer-target-name').textContent = window.pendingTransferName;
        openModal('modal-transfer-ownership');
        return;
    }
    try {
        await window.db.doc(`classes/${classId}/members/${memberId}`).update({ role: newRole });
        showToast('Role updated successfully.');
        loadMembers();
    } catch(e) { showToast(e.message, 'error'); }
};

/* ── Transfer Ownership ─── */
document.getElementById('form-transfer-ownership')?.addEventListener('submit', async e => {
    e.preventDefault();
    const myNewRole = document.getElementById('transfer-my-new-role').value;
    const targetId  = window.pendingTransferMemberId;
    if (!targetId) return;
    try {
        const b = window.db.batch();
        b.update(window.db.doc(`classes/${classId}`), { ownerId: targetId });
        b.update(window.db.doc(`classes/${classId}/members/${targetId}`), { role: 'Owner' });
        b.update(window.db.doc(`classes/${classId}/members/${currentUser.uid}`), { role: myNewRole });
        await b.commit();
        showToast('Ownership transferred!');
        closeModal('modal-transfer-ownership');
        setTimeout(() => window.location.href = 'dashboard.html', 1500);
    } catch(e) { showToast(e.message, 'error'); closeModal('modal-transfer-ownership'); }
});

/* ── Settings dropdown ─── */
document.addEventListener('click', () => {
    document.getElementById('ctx-member-menu')?.remove();
    document.getElementById('class-settings-dropdown')?.classList.remove('open');
});

/* ── Leave / Delete Class ─── */
document.getElementById('btn-leave-class')?.addEventListener('click', () => openModal('modal-leave-class'));
document.getElementById('form-leave-class')?.addEventListener('submit', async e => {
    e.preventDefault();
    try {
        await window.db.doc(`classes/${classId}/members/${currentUser.uid}`).delete();
        window.location.href = 'dashboard.html';
    } catch(e) { showToast(e.message,'error'); closeModal('modal-leave-class'); }
});

document.getElementById('btn-delete-class')?.addEventListener('click', () => openModal('modal-delete-class'));
document.getElementById('form-delete-class')?.addEventListener('submit', async e => {
    e.preventDefault();
    try {
        await window.db.doc(`classes/${classId}`).delete();
        window.location.href = 'dashboard.html';
    } catch(e) { showToast(e.message,'error'); closeModal('modal-delete-class'); }
});

/* ── Wallpaper (Removed per user request) ─── */

/* ── Class Logo (Removed per user request) ─── */

/* ── User Profile DP (Removed per user request) ─── */

/* ══════════════════════════════════════════════════════════════
   MODAL HELPERS
   ══════════════════════════════════════════════════════════════ */
function openModal(id)  { document.getElementById(id)?.classList.add('active'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }

document.getElementById('btn-post-notice')?.addEventListener('click', () => openModal('modal-post-notice'));
document.getElementById('btn-create-assignment')?.addEventListener('click', () => openModal('modal-create-assignment'));

document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', e => {
        const overlay = e.target.closest('.modal-overlay');
        if (overlay) closeModal(overlay.id);
    });
});

/* ══════════════════════════════════════════════════════════════
   ANNOUNCEMENTS
   ══════════════════════════════════════════════════════════════ */

/* File compression helper (images are resized to 1000px, docs capped at 800KB) */
function compressAndConvertFile(file) {
    return new Promise((resolve, reject) => {
        const isImage = file.type.startsWith('image/');
        if (!isImage) {
            if (file.size > 800 * 1024) { reject(new Error('Document too large (max 800 KB)')); return; }
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload  = () => resolve(reader.result);
            reader.onerror = err => reject(err);
            return;
        }
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = e2 => {
            const img = new Image();
            img.src = e2.target.result;
            img.onload = () => {
                const MAX = 1000;
                let w = img.width, h = img.height;
                if (w > h) { if (w > MAX) { h = h*MAX/w; w = MAX; } }
                else        { if (h > MAX) { w = w*MAX/h; h = MAX; } }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                const data = canvas.toDataURL('image/jpeg', 0.60);
                if (data.length > 900000) { reject(new Error('Image too large even after compression.')); return; }
                resolve(data);
            };
            img.onerror = () => reject(new Error('Failed to process image.'));
        };
        reader.onerror = err => reject(err);
    });
}

/* ── Notice attachment handlers ─── */
let curNoticeFile = null;
function handleNoticeFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 800*1024 && !f.type.startsWith('image/')) { showToast('Doc too large (max 800 KB)', 'error'); e.target.value=''; return; }
    curNoticeFile = f;
    document.getElementById('notice-attachment-name').textContent = f.name;
    document.getElementById('notice-attachment-preview').style.display = 'flex';
}
document.getElementById('notice-file-upload')?.addEventListener('change',   handleNoticeFile);
document.getElementById('notice-camera-upload')?.addEventListener('change', handleNoticeFile);
document.getElementById('notice-image-upload')?.addEventListener('change',  handleNoticeFile);
window.removeNoticeAttachment = function() {
    curNoticeFile = null;
    document.getElementById('notice-attachment-preview').style.display = 'none';
    ['notice-file-upload','notice-camera-upload','notice-image-upload'].forEach(id => {
        const el = document.getElementById(id); if(el) el.value='';
    });
};

/* ── Post notice ─── */
document.getElementById('form-post-notice')?.addEventListener('submit', async e => {
    e.preventDefault();
    const title   = document.getElementById('notice-title').value;
    const message = document.getElementById('notice-message').value;
    const btn     = document.getElementById('btn-submit-notice');
    try {
        btn.disabled = true; btn.textContent = 'Posting...';
        let attachmentUrl=null, attachmentType=null, attachmentName=null;
        if (curNoticeFile) {
            btn.textContent = 'Processing...';
            try {
                attachmentUrl  = await compressAndConvertFile(curNoticeFile);
                attachmentType = curNoticeFile.type.startsWith('image/') ? 'image' : 'file';
                attachmentName = curNoticeFile.name;
            } catch(err) { showToast(err.message,'error'); btn.disabled=false; btn.textContent='Post'; return; }
        }
        const data = {
            authorId: currentUser.uid,
            authorName: currentUser.displayName || currentUser.email.split('@')[0],
            authorPhoto: currentUser.photoURL || null,
            title,
            message,
            attachmentUrl, attachmentType, attachmentName,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await window.db.collection(`classes/${classId}/notices`).add(data);
        showToast('Announcement posted!');
        closeModal('modal-post-notice');
        e.target.reset(); removeNoticeAttachment();
    } catch(err) { showToast(err.message,'error'); }
    finally { btn.disabled=false; btn.textContent='Post'; }
});

/* ── Edit notice ─── */
let curEditNoticeFile = null;
function handleEditNoticeFile(e) {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 800*1024 && !f.type.startsWith('image/')) { showToast('Doc too large','error'); e.target.value=''; return; }
    curEditNoticeFile = f;
    document.getElementById('edit-notice-attachment-name').textContent = f.name;
    document.getElementById('edit-notice-attachment-preview').style.display = 'flex';
    document.getElementById('edit-notice-attachment-removed').value = 'false';
}
document.getElementById('edit-notice-file-upload')?.addEventListener('change',   handleEditNoticeFile);
document.getElementById('edit-notice-camera-upload')?.addEventListener('change', handleEditNoticeFile);
document.getElementById('edit-notice-image-upload')?.addEventListener('change',  handleEditNoticeFile);
window.removeEditNoticeAttachment = function() {
    curEditNoticeFile = null;
    document.getElementById('edit-notice-attachment-preview').style.display = 'none';
    document.getElementById('edit-notice-attachment-removed').value = 'true';
    ['edit-notice-file-upload','edit-notice-camera-upload','edit-notice-image-upload'].forEach(id => {
        const el = document.getElementById(id); if(el) el.value='';
    });
};

window.openEditNotice = function(id, title, message, attachmentName) {
    document.getElementById('edit-notice-id').value      = id;
    document.getElementById('edit-notice-title').value   = title;
    document.getElementById('edit-notice-message').value = message;
    curEditNoticeFile = null;
    document.getElementById('edit-notice-attachment-removed').value = 'false';
    if (attachmentName) {
        document.getElementById('edit-notice-attachment-name').textContent = attachmentName;
        document.getElementById('edit-notice-attachment-preview').style.display = 'flex';
    } else {
        document.getElementById('edit-notice-attachment-preview').style.display = 'none';
    }
    openModal('modal-edit-notice');
};

document.getElementById('form-edit-notice')?.addEventListener('submit', async e => {
    e.preventDefault();
    const id      = document.getElementById('edit-notice-id').value;
    const title   = document.getElementById('edit-notice-title').value;
    const message = document.getElementById('edit-notice-message').value;
    const removed = document.getElementById('edit-notice-attachment-removed').value === 'true';
    const btn     = document.getElementById('btn-submit-edit-notice');
    try {
        btn.disabled=true; btn.textContent='Saving...';
        let upd = { title, message, isEdited: true };
        if (curEditNoticeFile) {
            btn.textContent = 'Processing...';
            upd.attachmentUrl  = await compressAndConvertFile(curEditNoticeFile);
            upd.attachmentType = curEditNoticeFile.type.startsWith('image/') ? 'image' : 'file';
            upd.attachmentName = curEditNoticeFile.name;
        } else if (removed) {
            upd.attachmentUrl = null; upd.attachmentType = null; upd.attachmentName = null;
        }
        await window.db.doc(`classes/${classId}/notices/${id}`).update(upd);
        showToast('Announcement updated!');
        closeModal('modal-edit-notice');
    } catch(err) { showToast(err.message,'error'); }
    finally { btn.disabled=false; btn.textContent='Save Changes'; }
});

window.deleteNotice = async function(id) {
    if (!confirm('Delete this announcement?')) return;
    try {
        await window.db.doc(`classes/${classId}/notices/${id}`).update({
            isDeleted:true, deletedBy: currentUser.displayName||currentUser.email||'Unknown',
            title:'', message:'', attachmentUrl:null, attachmentType:null, attachmentName:null
        });
        showToast('Announcement deleted.');
    } catch(e) { showToast(e.message,'error'); }
};

/* ══════════════════════════════════════════════════════════════
   LIVE CLASS (Jitsi)
   ══════════════════════════════════════════════════════════════ */
document.getElementById('btn-start-live')?.addEventListener('click', async () => {
    try {
        const room = `iaop-class-${classId}-${Date.now()}`;
        const b = window.db.batch();
        b.update(window.db.doc(`classes/${classId}`), { liveClassActive:true, liveClassRoomName:room });
        const nRef = window.db.collection(`classes/${classId}/notices`).doc();
        b.set(nRef, {
            title: 'Live Class Started',
            message: 'Your teacher has started a live class session. Join from the alert above.',
            authorId: currentUser.uid, 
            authorName: currentUser.displayName||'Teacher',
            authorPhoto: currentUser.photoURL || null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await b.commit();
        startJitsiMeeting(room);
    } catch(e) { showToast('Error starting class: '+e.message,'error'); }
});

document.getElementById('btn-end-live')?.addEventListener('click', async () => {
    if (!confirm('End live class for everyone?')) return;
    try {
        await window.db.doc(`classes/${classId}`).update({ liveClassActive:false, liveClassRoomName:null });
        if (jitsiApi) { jitsiApi.dispose(); jitsiApi=null; }
        const c = document.getElementById('jitsi-container'); if(c) c.style.display='none';
    } catch(e) { showToast(e.message,'error'); }
});

document.getElementById('btn-join-live')?.addEventListener('click', () => {
    if (window.currentLiveRoom) startJitsiMeeting(window.currentLiveRoom);
});

function startJitsiMeeting(room) {
    const cont = document.getElementById('jitsi-container');
    if (!cont) return;
    cont.style.display = 'block';
    if (jitsiApi) jitsiApi.dispose();
    jitsiApi = new window.JitsiMeetExternalAPI('meet.jit.si', {
        roomName: room,
        width: '100%', height: '100%',
        parentNode: cont,
        userInfo: { displayName: currentUser?.displayName||'Student' },
        configOverwrite: { prejoinPageEnabled:false, startWithAudioMuted:true },
        interfaceConfigOverwrite: { SHOW_JITSI_WATERMARK:false, SHOW_WATERMARK_FOR_GUESTS:false }
    });
}

/* ══════════════════════════════════════════════════════════════
   ASSIGNMENTS
   ══════════════════════════════════════════════════════════════ */
let curAssignFile = null;
document.getElementById('assignment-file-upload')?.addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 800*1024 && !f.type.startsWith('image/')) { showToast('Doc too large','error'); e.target.value=''; return; }
    curAssignFile = f;
    document.getElementById('assignment-attachment-name').textContent = f.name;
    document.getElementById('assignment-attachment-preview').style.display = 'flex';
});
window.removeAssignmentAttachment = function() {
    curAssignFile = null;
    document.getElementById('assignment-attachment-preview').style.display = 'none';
    const el = document.getElementById('assignment-file-upload'); if(el) el.value='';
};

document.getElementById('form-create-assignment')?.addEventListener('submit', async e => {
    e.preventDefault();
    const title        = document.getElementById('assignment-title').value;
    const instructions = document.getElementById('assignment-instructions').value;
    const dueDate      = document.getElementById('assignment-due-date').value;
    const btn          = document.getElementById('btn-submit-assignment');
    try {
        btn.disabled=true; btn.textContent='Creating...';
        let attachmentUrl=null, attachmentType=null, attachmentName=null;
        if (curAssignFile) {
            btn.textContent='Processing...';
            attachmentUrl  = await compressAndConvertFile(curAssignFile);
            attachmentType = curAssignFile.type.startsWith('image/') ? 'image' : 'file';
            attachmentName = curAssignFile.name;
        }
        await window.db.collection(`classes/${classId}/assignments`).add({
            title, instructions, dueDate, attachmentUrl, attachmentType, attachmentName,
            authorId: currentUser.uid, authorName: currentUser.displayName||'Teacher',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast('Assignment created!');
        closeModal('modal-create-assignment');
        e.target.reset(); removeAssignmentAttachment();
    } catch(err) { showToast(err.message,'error'); }
    finally { btn.disabled=false; btn.textContent='Create Assignment'; }
});

/* ── View Submissions (teacher checklist) ─── */
window.openViewSubmissionsModal = async function(assignmentId, title) {
    document.getElementById('view-submissions-title').textContent = `Submissions — ${title}`;
    document.getElementById('checklist-assignment-id').value = assignmentId;
    openModal('modal-view-submissions');

    const list = document.getElementById('submissions-list');
    list.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.875rem;">Loading...</div>`;

    try {
        const mSnap = await window.db.collection(`classes/${classId}/members`).get();
        const students = [];
        mSnap.forEach(doc => {
            if (doc.data().role === 'Student') {
                students.push({ id: doc.id, name: doc.data().userName || doc.id.substring(0,8)+'...' });
            }
        });

        const sSnap = await window.db.collection(`classes/${classId}/assignments/${assignmentId}/submissions`).get();
        const doneIds = sSnap.docs.map(d => d.id);

        if (!students.length) { list.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--text-muted);">No students enrolled.</div>`; return; }

        list.innerHTML = students.map(s => `
            <div class="att-check-item">
                <input type="checkbox" name="sub-check" value="${s.id}" id="cs-${s.id}" ${doneIds.includes(s.id)?'checked':''} style="accent-color:var(--primary)">
                <label for="cs-${s.id}" style="flex:1;cursor:pointer;font-size:0.875rem;font-weight:500;color:var(--text-primary)">${s.name}</label>
            </div>`).join('');
    } catch(e) { list.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--danger);">${e.message}</div>`; }
};

document.getElementById('form-view-submissions')?.addEventListener('submit', async e => {
    e.preventDefault();
    const aId = document.getElementById('checklist-assignment-id').value;
    const btn  = document.getElementById('btn-submit-checklist');
    try {
        btn.disabled=true; btn.textContent='Saving...';
        const b = window.db.batch();
        document.querySelectorAll('input[name="sub-check"]').forEach(chk => {
            const ref = window.db.doc(`classes/${classId}/assignments/${aId}/submissions/${chk.value}`);
            if (chk.checked) b.set(ref, { status:'completed', markedBy:currentUser.uid, markedAt:firebase.firestore.FieldValue.serverTimestamp() });
            else b.delete(ref);
        });
        await b.commit();
        // Invalidate cache for this assignment
        Object.keys(window._subCache||{}).forEach(k => { if(k.startsWith(`sub_${aId}_`)) delete window._subCache[k]; });
        showToast('Records saved!');
        closeModal('modal-view-submissions');
    } catch(e) { showToast(e.message,'error'); }
    finally { btn.disabled=false; btn.textContent='Save Record'; }
});

/* ══════════════════════════════════════════════════════════════
   ATTENDANCE
   ══════════════════════════════════════════════════════════════ */
document.getElementById('attendance-date')?.addEventListener('change', e => loadAttendanceForDate(e.target.value));

async function loadAttendanceForDate(dateStr) {
    if (!dateStr) return;
    const list = document.getElementById('attendance-list');
    if (!list) return;
    list.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.875rem;">Loading...</div>`;

    try {
        const recSnap = await window.db.doc(`classes/${classId}/attendance_records/${dateStr}`).get();
        let existing = null;
        const holEl = document.getElementById('attendance-holiday');
        const btnEl = document.getElementById('btn-submit-attendance');
        if (recSnap.exists) {
            existing = recSnap.data();
            if(holEl) holEl.checked = existing.isHoliday;
            if(btnEl) btnEl.textContent = 'Update Record';
        } else {
            if(holEl) holEl.checked = false;
            if(btnEl) btnEl.textContent = 'Save Record';
        }

        const mSnap = await window.db.collection(`classes/${classId}/members`).get();
        let html = '';
        mSnap.forEach(doc => {
            if (doc.data().role === 'Student') {
                const name = doc.data().userName || doc.id.substring(0,8)+'...';
                const isPresent = existing?.presentStudents?.includes(doc.id) || false;
                html += `
                    <div class="att-check-item">
                        <input type="checkbox" name="att-chk" value="${doc.id}" id="a-${doc.id}" ${isPresent?'checked':''} style="accent-color:var(--primary)">
                        <label for="a-${doc.id}" style="flex:1;cursor:pointer;font-size:0.875rem;font-weight:500;color:var(--text-primary)">${name}</label>
                    </div>`;
            }
        });
        list.innerHTML = html || `<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.875rem;">No students enrolled.</div>`;
    } catch(e) { list.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--danger);font-size:0.875rem;">Error loading students.</div>`; }
}

document.getElementById('form-take-attendance')?.addEventListener('submit', async e => {
    e.preventDefault();
    const dateStr   = document.getElementById('attendance-date').value;
    const isHoliday = document.getElementById('attendance-holiday').checked;
    if (!dateStr) { showToast('Please select a date.','error'); return; }

    const present = [];
    if (!isHoliday) {
        document.querySelectorAll('input[name="att-chk"]').forEach(c => { if(c.checked) present.push(c.value); });
    }
    try {
        await window.db.doc(`classes/${classId}/attendance_records/${dateStr}`).set({
            date:dateStr, isHoliday, presentStudents:present,
            recordedAt: firebase.firestore.FieldValue.serverTimestamp(), recordedBy: currentUser.uid
        });
        showToast('Attendance saved!');
        closeModal('modal-take-attendance');
    } catch(e) { showToast(e.message,'error'); }
});

/* ── Student Attendance Summary ─── */
let attRecords = [];
let calDate    = new Date();

async function loadStudentAttendance() {
    try {
        const snap = await window.db.collection(`classes/${classId}/attendance_records`).get();
        let total=0, present=0;
        attRecords = [];
        snap.forEach(doc => {
            const d = doc.data();
            attRecords.push(d);
            if (!d.isHoliday) {
                total++;
                if (d.presentStudents?.includes(currentUser.uid)) present++;
            }
        });
        const absent = total - present;
        const pct    = total > 0 ? Math.round(present/total*100) : 0;

        const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
        set('student-att-total',   total);
        set('student-att-present', present);
        set('student-att-absent',  absent);
        set('student-att-pct',     pct+'%');

        const bar = document.getElementById('student-att-bar');
        if (bar) { bar.style.width = pct+'%'; bar.className = `progress-fill ${pct>=75?'':'danger'}`; }

        calDate = new Date();
        renderCalendar();
    } catch(e) { console.error(e); }
}

/* ── Calendar ─── */
function renderCalendar() {
    const y = calDate.getFullYear(), m = calDate.getMonth();
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const myEl = document.getElementById('cal-month-year');
    if (myEl) myEl.textContent = `${months[m]} ${y}`;

    const grid = document.getElementById('cal-days-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const firstDay    = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m+1, 0).getDate();
    const todayStr    = new Date().toISOString().split('T')[0];

    for (let i=0; i<firstDay; i++) { const d = document.createElement('div'); d.className='cal-day'; grid.appendChild(d); }

    for (let day=1; day<=daysInMonth; day++) {
        const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const el = document.createElement('div');
        el.className = 'cal-day';
        el.textContent = day;
        if (dateStr === todayStr) el.classList.add('today');
        const rec = attRecords.find(r => r.date === dateStr);
        if (rec) {
            if (rec.isHoliday) el.classList.add('holiday');
            else if (rec.presentStudents?.includes(currentUser?.uid)) el.classList.add('present');
            else el.classList.add('absent');
        }
        grid.appendChild(el);
    }
}

document.getElementById('cal-prev')?.addEventListener('click', () => { calDate.setMonth(calDate.getMonth()-1); renderCalendar(); });
document.getElementById('cal-next')?.addEventListener('click', () => { calDate.setMonth(calDate.getMonth()+1); renderCalendar(); });

/* ══════════════════════════════════════════════════════════════
   PDF REPORT
   ══════════════════════════════════════════════════════════════ */
document.getElementById('form-download-report')?.addEventListener('submit', async e => {
    e.preventDefault();
    const incAtt   = document.getElementById('report-include-attendance').checked;
    const incAssign = document.getElementById('report-include-assignments').checked;
    const btn = document.getElementById('btn-generate-pdf');
    if (!incAtt && !incAssign) { showToast('Select at least one section.','error'); return; }

    try {
        btn.disabled=true; btn.textContent='Generating...';
        showToast('Building report...');

        const classSnap = await window.db.doc(`classes/${classId}`).get();
        const className = classSnap.data().name;

        const mSnap = await window.db.collection(`classes/${classId}/members`).get();
        const students = [];
        mSnap.forEach(doc => {
            if (doc.data().role === 'Student') {
                students.push({ id:doc.id, name:doc.data().userName||'Unknown', present:0, absent:0, attPct:0, done:0, pending:0, assignPct:0 });
            }
        });

        let totalDays=0, totalAssign=0;

        if (incAtt) {
            const aSnap = await window.db.collection(`classes/${classId}/attendance_records`).get();
            aSnap.forEach(doc => {
                const d = doc.data();
                if (!d.isHoliday) {
                    totalDays++;
                    students.forEach(s => { if (d.presentStudents?.includes(s.id)) s.present++; });
                }
            });
            students.forEach(s => { s.absent=totalDays-s.present; s.attPct=totalDays>0?Math.round(s.present/totalDays*100):0; });
        }

        if (incAssign) {
            const assSnap = await window.db.collection(`classes/${classId}/assignments`).get();
            totalAssign = assSnap.size;
            for (const ad of assSnap.docs) {
                const subSnap = await window.db.collection(`classes/${classId}/assignments/${ad.id}/submissions`).get();
                const doneIds = subSnap.docs.map(d=>d.id);
                students.forEach(s => { if (doneIds.includes(s.id)) s.done++; });
            }
            students.forEach(s => { s.pending=totalAssign-s.done; s.assignPct=totalAssign>0?Math.round(s.done/totalAssign*100):0; });
        }

        const head = ['#','Student Name'];
        if (incAtt)    head.push('Present','Absent','Attendance %');
        if (incAssign) head.push('Completed','Pending','Assignment %');

        const body = students.map((s,i) => {
            const row = [i+1, s.name];
            if (incAtt)    row.push(s.present, s.absent, s.attPct+'%');
            if (incAssign) row.push(s.done, s.pending, s.assignPct+'%');
            return row;
        });

        if (!window.jspdf) { showToast('PDF library loading, try again shortly.','error'); return; }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF(head.length > 6 ? 'landscape' : 'portrait');
        doc.setFontSize(18);
        doc.text(`Class Report: ${className}`, 14, 22);
        doc.setFontSize(10);
        let y = 30;
        if (incAtt)    { doc.text(`Working Days: ${totalDays}`, 14, y); y+=6; }
        if (incAssign) { doc.text(`Assignments: ${totalAssign}`, 14, y); y+=6; }
        doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, y);
        doc.autoTable({ startY:y+6, head:[head], body, theme:'grid', headStyles:{ fillColor:[16,185,129] } });
        doc.save(`${className.replace(/\s+/g,'_')}_Report.pdf`);
        showToast('PDF downloaded!');
        closeModal('modal-download-report');
    } catch(e) { showToast('PDF generation failed.','error'); console.error(e); }
    finally { btn.disabled=false; btn.textContent='Generate PDF'; }
});

/* ══════════════════════════════════════════════════════════════
   TOAST
   ══════════════════════════════════════════════════════════════ */
function showToast(msg, type='success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('removing'); setTimeout(() => toast.remove(), 300); }, 3500);
}
