let currentUser = null;

window.auth.onAuthStateChanged((user) => {
    if (!user) {
        window.location.href = 'index.html';
    } else {
        currentUser = user;
        document.getElementById('user-name').innerText = user.displayName || user.email;
        loadClasses();
    }
});

document.getElementById('btn-logout').addEventListener('click', handleLogout);

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
        
        // Add user as student
        await window.db.doc(`classes/${classDoc.id}/members/${currentUser.uid}`).set({
            role: 'Student',
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
    listEl.innerHTML = '<div class="glass glass-panel" style="grid-column: 1 / -1; text-align: center; color: var(--text-muted);">Loading classes...</div>';
    
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
            listEl.innerHTML = '<div class="glass glass-panel" style="grid-column: 1 / -1; text-align: center; color: var(--text-muted);">You haven\'t joined any classes yet.</div>';
        } else {
            listEl.innerHTML = html;
        }
    } catch (error) {
        console.error(error);
        listEl.innerHTML = `<div class="glass glass-panel" style="grid-column: 1 / -1; text-align: center; color: #ef4444;">Error loading classes: ${error.message}</div>`;
    }
}

function renderClassCard(id, data, role) {
    const roleClass = role === 'Owner' ? 'owner' : '';
    return `
        <div class="glass glass-panel class-card" onclick="window.location.href='classroom.html?id=${id}&role=${role}'">
            <span class="class-role-badge ${roleClass}">${role}</span>
            <h3 style="margin-bottom: 0.5rem; font-size: 1.25rem;">${data.name}</h3>
            <p style="color: var(--text-muted); margin-bottom: 1rem;">${data.subject}</p>
            <div style="font-family: var(--font-mono); background: rgba(0,0,0,0.2); padding: 0.5rem; border-radius: 4px; display: inline-block; font-size: 0.875rem;">
                Code: ${data.code}
            </div>
        </div>
    `;
}
