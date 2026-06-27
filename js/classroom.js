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
        document.getElementById('user-role').innerText = `Role: ${userRole || 'Student'}`;
        
        // Show Teacher Controls if Owner, Teacher, or CR
        if (['Owner', 'Teacher', 'CR'].includes(userRole)) {
            document.getElementById('teacher-controls').style.display = 'block';
        }

        await loadClassDetails();
        loadNotices();
        loadMembers();
    }
});

async function loadClassDetails() {
    try {
        const classDoc = await window.db.doc(`classes/${classId}`).get();
        if (classDoc.exists) {
            const data = classDoc.data();
            document.getElementById('class-name').innerText = data.name;
            document.getElementById('class-subject').innerText = data.subject;
            document.getElementById('class-code').innerText = data.code;
        } else {
            showToast('Class not found.', 'error');
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function loadNotices() {
    const noticesList = document.getElementById('notices-list');
    try {
        const querySnapshot = await window.db.collection(`classes/${classId}/notices`).orderBy('createdAt', 'desc').get();
        
        if (querySnapshot.empty) {
            noticesList.innerHTML = '<div class="glass notice-card" style="border-left-color: var(--text-muted);"><p style="color: var(--text-muted); text-align: center;">No announcements yet.</p></div>';
            return;
        }

        let html = '';
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const date = data.createdAt ? data.createdAt.toDate().toLocaleString() : 'Just now';
            html += `
                <div class="glass notice-card">
                    <h4>${data.title}</h4>
                    <p>${data.message}</p>
                    <div class="notice-meta">Posted by: ${data.authorName} • ${date}</div>
                </div>
            `;
        });
        noticesList.innerHTML = html;
    } catch (error) {
        noticesList.innerHTML = `<div class="glass notice-card" style="border-left-color: #ef4444;"><p style="color: #ef4444; text-align: center;">Error loading notices.</p></div>`;
    }
}

async function loadMembers() {
    const membersList = document.getElementById('members-list');
    try {
        const querySnapshot = await window.db.collection(`classes/${classId}/members`).get();
        
        let html = '';
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const shortId = doc.id.substring(0, 8) + '...';
            html += `
                <div class="member-item">
                    <span>User: ${shortId}</span>
                    <span style="font-size: 0.75rem; color: var(--primary); background: rgba(59, 130, 246, 0.1); padding: 2px 6px; border-radius: 4px;">${data.role}</span>
                </div>
            `;
        });
        membersList.innerHTML = html;
    } catch (error) {
        membersList.innerHTML = `<div class="member-item" style="color: #ef4444;">Error loading members.</div>`;
    }
}

// Modal Logic
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

document.getElementById('btn-post-notice')?.addEventListener('click', () => openModal('modal-post-notice'));
document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => closeModal(e.target.closest('.modal-overlay').id));
});

// Post Notice
document.getElementById('form-post-notice')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('notice-title').value;
    const message = document.getElementById('notice-message').value;

    try {
        await window.db.collection(`classes/${classId}/notices`).add({
            title,
            message,
            authorId: currentUser.uid,
            authorName: currentUser.displayName || 'Teacher',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        showToast('Notice posted successfully!');
        closeModal('modal-post-notice');
        e.target.reset();
        loadNotices();
    } catch (error) {
        showToast(error.message, 'error');
    }
});

// Open Attendance Modal and Load Students
document.getElementById('btn-take-attendance')?.addEventListener('click', async () => {
    openModal('modal-attendance');
    const listEl = document.getElementById('attendance-list');
    listEl.innerHTML = '<div style="color: var(--text-muted);">Loading students...</div>';
    
    try {
        const querySnapshot = await window.db.collection(`classes/${classId}/members`).get();
        
        let html = '';
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.role === 'Student') {
                const shortId = doc.id.substring(0, 8) + '...';
                html += `
                    <div class="member-item" style="justify-content: flex-start; gap: 1rem;">
                        <input type="checkbox" name="attendance" value="${doc.id}" id="chk-${doc.id}" style="width: 1.25rem; height: 1.25rem;">
                        <label for="chk-${doc.id}" style="cursor: pointer; user-select: none;">User: ${shortId}</label>
                    </div>
                `;
            }
        });
        
        if (html === '') {
            html = '<div style="color: var(--text-muted);">No students enrolled yet.</div>';
        }
        listEl.innerHTML = html;
    } catch (error) {
        listEl.innerHTML = `<div style="color: #ef4444;">Error loading students.</div>`;
    }
});

// Submit Attendance using Batch Write
document.getElementById('form-take-attendance')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const checkboxes = document.querySelectorAll('input[name="attendance"]');
    if (checkboxes.length === 0) {
        showToast('No students to take attendance for.', 'error');
        return;
    }

    try {
        const batch = window.db.batch();
        const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        
        checkboxes.forEach(chk => {
            const studentId = chk.value;
            const isPresent = chk.checked;
            
            const recordRef = window.db.doc(`classes/${classId}/attendance/${dateStr}_${studentId}`);
            batch.set(recordRef, {
                studentId: studentId,
                date: dateStr,
                present: isPresent,
                recordedAt: firebase.firestore.FieldValue.serverTimestamp(),
                recordedBy: currentUser.uid
            });
        });

        await batch.commit();
        showToast('Attendance recorded successfully!');
        closeModal('modal-attendance');
    } catch (error) {
        showToast(error.message, 'error');
    }
});
