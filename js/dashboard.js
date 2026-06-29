let currentUser = null;

window.auth.onAuthStateChanged((user) => {
    if (!user) {
        window.location.href = 'index.html';
    } else {
        currentUser = user;
        const displayName = user.displayName || user.email;
        const firstName = displayName ? displayName.split(' ')[0] : '';
        document.getElementById('user-name').innerText = displayName;
        const emailEl = document.getElementById('user-email');
        if (emailEl) emailEl.innerText = user.email;

        // Set avatar initial
        const avatarEl = document.getElementById('btn-profile-menu');
        if (avatarEl) avatarEl.textContent = (firstName[0] || '?').toUpperCase();

        // Set greeting
        const greetEl = document.getElementById('greeting-name');
        if (greetEl && firstName) greetEl.textContent = '';

        loadClasses();
        syncUserNames();
    }
});

document.getElementById('btn-logout-trigger')?.addEventListener('click', () => {
    openModal('modal-logout-confirm');
});
document.getElementById('btn-confirm-logout')?.addEventListener('click', handleLogout);

// Modal Logic
function openModal(id) {
    document.getElementById(id).classList.add('active');
}
function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

document.getElementById('btn-create-class').addEventListener('click', () => openModal('modal-create-class'));
document.getElementById('btn-join-class').addEventListener('click', () => openModal('modal-join-class'));

document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
        closeModal(e.target.closest('.modal-overlay').id);
    });
});

// Generate 6 character code
function generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for(let i=0; i<6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
}

// Create Class
document.getElementById('form-create-class').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('create-class-name').value;
    const subject = document.getElementById('create-class-subject').value;
    const code = generateCode();

    try {
        const classRef = await window.db.collection('classes').add({
            name,
            subject,
            code,
            ownerId: currentUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Add user as owner in members collection
        await window.db.doc(`classes/${classRef.id}/members/${currentUser.uid}`).set({
            role: 'Owner',
            userName: currentUser.displayName || currentUser.email || 'Unknown',
            joinedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        showToast(`Class created! Code: ${code}`);
        closeModal('modal-create-class');
        e.target.reset();
        loadClasses();
    } catch (error) {
        showToast(error.message, 'error');
    }
});

// Join Class
document.getElementById('form-join-class').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('join-class-code').value.toUpperCase();

    try {
        const querySnapshot = await window.db.collection('classes').where('code', '==', code).get();

        if (querySnapshot.empty) {
            showToast('Class not found. Check the code.', 'error');
            return;
        }

        const classDoc = querySnapshot.docs[0];
        
        const memberRef = window.db.doc(`classes/${classDoc.id}/members/${currentUser.uid}`);
        const memberDoc = await memberRef.get();
        if (memberDoc.exists) {
            showToast('You are already a member of this class.', 'error');
            return;
        }
        
        // Add user as student
        await memberRef.set({
            role: 'Student',
            userName: currentUser.displayName || currentUser.email || 'Unknown',
            joinedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        showToast('Successfully joined the class!');
        closeModal('modal-join-class');
        e.target.reset();
        loadClasses();
    } catch (error) {
        showToast(error.message, 'error');
    }
});

async function loadClasses() {
    const listEl = document.getElementById('class-list');
    listEl.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-muted);">Loading classes...</div>';
    
    try {
        // Fetch classes where user is Owner
        const ownerDocs = await window.db.collection('classes').where('ownerId', '==', currentUser.uid).get();
        
        let html = '';
        const classIds = new Set();
        
        ownerDocs.forEach(doc => {
            classIds.add(doc.id);
            html += renderClassCard(doc.id, doc.data(), 'Owner');
        });

        const allClasses = await window.db.collection('classes').get();
        for (const classDoc of allClasses.docs) {
            if (classIds.has(classDoc.id)) continue;
            const memberDoc = await window.db.doc(`classes/${classDoc.id}/members/${currentUser.uid}`).get();
            if (memberDoc.exists) {
                html += renderClassCard(classDoc.id, classDoc.data(), memberDoc.data().role);
            }
        }

        if (html === '') {
            listEl.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">
                <div class="empty-state-icon">🏫</div>
                <h3>No classes yet</h3>
                <p>Join an existing class with a code, or create your own!</p>
            </div>`;
        } else {
            listEl.innerHTML = html;
            // Stagger animation
            listEl.querySelectorAll('.class-card').forEach((card, i) => {
                card.style.animationDelay = (i * 0.06) + 's';
            });
        }
        const countText = document.getElementById('class-count-text');
        if (countText) countText.textContent = html ? `You are enrolled in ${listEl.querySelectorAll('.class-card').length} class(es)` : 'No classes found';
    } catch (error) {
        console.error(error);
        listEl.innerHTML = `<div style="padding: 2rem; text-align: center; color: #ef4444;">Error loading classes: ${error.message}</div>`;
    }
}

function renderClassCard(id, data, role) {
    const roleClass = role === 'Owner' ? 'role-owner' : role === 'Teacher' ? 'role-teacher' : role === 'CR' ? 'role-cr' : 'role-student';
    const displayRole = role === 'Owner' ? 'Teacher' : role === 'CR' ? 'Class Rep' : role;
    const badgeClass = role === 'Owner' ? 'badge-secondary' : role === 'CR' ? 'badge-warning' : role === 'Teacher' ? 'badge-accent' : 'badge-success';
    const subjectInitial = (data.subject || data.name || '?')[0].toUpperCase();
    const cardEmojis = { 'Owner': '🏫', 'Teacher': '👨‍🏫', 'CR': '⭐', 'Student': '🎒' };
    const icon = cardEmojis[role] || '📚';
    return `
        <div class="class-card ${roleClass}" onclick="window.location.href='classroom.html?id=${id}&role=${role}'">
            <div class="class-card-header">
                <div class="class-card-icon">${icon}</div>
            </div>
            <div class="class-card-body">
                <div class="class-card-name">${data.name}</div>
                <div class="class-card-subject">${data.subject || 'No subject'}</div>
                <div class="class-card-footer">
                    <span style="font-size: 0.78rem; color: var(--text-muted);">Code: <strong style="color: var(--text-sub); letter-spacing: 0.05em;">${data.code || '------'}</strong></span>
                    <span class="badge ${badgeClass}">${displayRole}</span>
                </div>
            </div>
        </div>
    `;
}

// Setup Profile Dropdown
document.addEventListener('DOMContentLoaded', () => {
    const btnProfileMenu = document.getElementById('btn-profile-menu');
    if (btnProfileMenu) {
        btnProfileMenu.addEventListener('click', (e) => {
            const dropdown = document.getElementById('profile-dropdown');
            dropdown.classList.toggle('active');
            e.stopPropagation();
        });
    }

    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('profile-dropdown');
        if (dropdown && !e.target.closest('.dropdown')) dropdown.classList.remove('active');
    });
});

// Retroactively update the user's name in any old classes they joined before the fix
async function syncUserNames() {
    try {
        const nameToSave = currentUser.displayName || currentUser.email || 'Unknown';
        const allClasses = await window.db.collection('classes').get();
        const batch = window.db.batch();
        
        for (const classDoc of allClasses.docs) {
            const memberRef = window.db.doc(`classes/${classDoc.id}/members/${currentUser.uid}`);
            const memberDoc = await memberRef.get();
            if (memberDoc.exists && !memberDoc.data().userName) {
                batch.update(memberRef, { userName: nameToSave });
            }
        }
        await batch.commit();
    } catch (error) {
        console.error("Failed to sync user names:", error);
    }
}
