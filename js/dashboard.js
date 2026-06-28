let currentUser = null;

window.auth.onAuthStateChanged((user) => {
    if (!user) {
        window.location.href = 'index.html';
    } else {
        currentUser = user;
        document.getElementById('user-name').innerText = user.displayName || user.email;
        const emailEl = document.getElementById('user-email');
        if (emailEl) emailEl.innerText = user.email;
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
            listEl.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-muted);">You haven\'t joined any classes yet.</div>';
        } else {
            listEl.innerHTML = html;
        }
        if (window.lucide) window.lucide.createIcons();
    } catch (error) {
        console.error(error);
        listEl.innerHTML = `<div style="padding: 2rem; text-align: center; color: #ef4444;">Error loading classes: ${error.message}</div>`;
    }
}

function renderClassCard(id, data, role) {
    const isOwner = role === 'Owner';
    const roleColor = isOwner ? 'color: var(--accent); font-weight: 600;' : 'color: var(--primary); font-weight: 600;';
    return `
        <div class="card" onclick="window.location.href='classroom.html?id=${id}&role=${role}'" style="cursor: pointer; transition: transform 0.2s; padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; position: relative; overflow: hidden;">
            <div style="position: absolute; top: 0; left: 0; width: 100%; height: 6px; background: ${isOwner ? 'var(--accent)' : 'var(--primary)'};"></div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                    <h3 style="margin-bottom: 0.25rem; color: var(--text-main); font-size: 1.25rem;">${data.name}</h3>
                    <div style="color: var(--text-muted); font-size: 0.9rem;">${data.subject}</div>
                </div>
                <div style="background: rgba(0, 168, 132, 0.1); width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                    <i data-lucide="book-open" style="color: var(--primary); width: 24px; height: 24px;"></i>
                </div>
            </div>
            <div style="margin-top: auto; display: flex; justify-content: space-between; align-items: center; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                <span style="font-size: 0.85rem; color: var(--text-muted);">Role</span>
                <span style="font-size: 0.85rem; ${roleColor}">${role}</span>
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
            dropdown.style.display = dropdown.style.display === 'flex' ? 'none' : 'flex';
            e.stopPropagation();
        });
    }

    document.addEventListener('click', () => {
        const dropdown = document.getElementById('profile-dropdown');
        if (dropdown) dropdown.style.display = 'none';
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
