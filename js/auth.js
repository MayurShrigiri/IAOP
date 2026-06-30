// Utility function to show toast
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = message;
    if (type === 'error') {
        toast.innerHTML = '<strong>Error:</strong> ' + message + ' <br><small>(Click to dismiss)</small>';
        toast.style.cursor = 'pointer';
        toast.addEventListener('click', () => {
            toast.style.animation = 'slideIn 0.3s forwards ease-out reverse';
            setTimeout(() => toast.remove(), 300);
        });
    } else {
        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s forwards ease-out reverse';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }
    container.appendChild(toast);
}

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
}

// Handle UI switching between login and signup
function toggleAuthMode() {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const title = document.getElementById('auth-title');
    
    if (loginForm.style.display === 'none') {
        loginForm.style.display = 'block';
        signupForm.style.display = 'none';
        if (title) title.innerText = 'Welcome Back';
    } else {
        loginForm.style.display = 'none';
        signupForm.style.display = 'block';
        if (title) title.innerText = 'Create Account';
    }
}

// Signup handler
async function handleSignup(e) {
    e.preventDefault();
    const name = document.getElementById('signup-name').value;
    const username = document.getElementById('signup-username').value.trim().toLowerCase();
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    
    if (!username || !/^[a-z0-9_]{3,15}$/.test(username)) {
        showToast('Username must be 3-15 characters and contain only letters, numbers, and underscores.', 'error');
        return;
    }

    try {
        // Check uniqueness
        const usernameCheck = await window.db.collection('users').where('username', '==', username).get();
        if (!usernameCheck.empty) {
            showToast('Username is already taken. Please choose another.', 'error');
            return;
        }

        const userCredential = await window.auth.createUserWithEmailAndPassword(email, password);
        await userCredential.user.updateProfile({ displayName: name });
        
        // Save global user profile
        await window.db.collection('users').doc(userCredential.user.uid).set({
            uid: userCredential.user.uid,
            displayName: name,
            email: email,
            username: username,
            photoURL: null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        showToast('Account created successfully!');
        // Redirect will be handled by onAuthStateChanged
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Login handler
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    try {
        await window.auth.signInWithEmailAndPassword(email, password);
        showToast('Logged in successfully!');
        // Redirect will be handled by onAuthStateChanged
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Google Login handler
async function handleGoogleLogin() {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        
        // Check if device is mobile or webview (where popups often fail)
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        if (isMobile) {
            // Mobile devices and WebViews block popups, use redirect
            await window.auth.signInWithRedirect(provider);
            // Result is handled by getRedirectResult() below
        } else {
            // Desktop browsers handle popups gracefully
            await window.auth.signInWithPopup(provider);
            showToast('Logged in with Google successfully!');
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Sync Global User Profile (for Google Auth and existing users)
window.syncGlobalUser = async function(user) {
    if (!user) return;
    try {
        const userDoc = await window.db.collection('users').doc(user.uid).get();
        if (!userDoc.exists) {
            // Auto-generate username from email
            let baseUsername = (user.email ? user.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') : 'user').toLowerCase();
            let username = baseUsername;
            let counter = 1;
            
            // Ensure unique
            while (true) {
                const check = await window.db.collection('users').where('username', '==', username).get();
                if (check.empty) break;
                username = baseUsername + counter;
                counter++;
            }

            await window.db.collection('users').doc(user.uid).set({
                uid: user.uid,
                displayName: user.displayName || user.email || 'User',
                email: user.email,
                username: username,
                photoURL: user.photoURL || null,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
    } catch(e) {
        console.error("Failed to sync global user profile", e);
    }
};

// Handle redirect results if user logged in via signInWithRedirect on mobile
firebase.auth().getRedirectResult().then(async (result) => {
    if (result.user) {
        await window.syncGlobalUser(result.user);
        showToast('Logged in with Google successfully!');
    }
}).catch((error) => {
    console.error("Redirect error", error);
});

// Logout handler
async function handleLogout() {
    try {
        await window.auth.signOut();
        window.location.href = 'index.html';
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Auth State Observer
function requireAuth() {
    window.auth.onAuthStateChanged(async (user) => {
        if (user) {
            await window.syncGlobalUser(user);
            window.location.href = 'dashboard.html';
        }
    });
}

// Edit Profile Logic (Global)
document.addEventListener('DOMContentLoaded', () => {
    // Open Modal
    const btnEditProfile = document.getElementById('btn-edit-profile-trigger');
    if (btnEditProfile) {
        btnEditProfile.addEventListener('click', async () => {
            const user = window.auth.currentUser;
            if (!user) return;
            
            // Populate data
            document.getElementById('edit-profile-name').value = user.displayName || '';
            try {
                const docSnap = await window.db.collection('users').doc(user.uid).get();
                if (docSnap.exists) {
                    document.getElementById('edit-profile-username').value = docSnap.data().username || '';
                }
            } catch(e) {}
            
            // Close dropdown and open modal
            const dropdown = document.getElementById('profile-dropdown');
            if (dropdown) dropdown.classList.remove('open');
            
            const modal = document.getElementById('modal-edit-profile');
            if (modal) modal.classList.add('active');
        });
    }

    // Submit Edit Profile Form
    const editForm = document.getElementById('form-edit-profile');
    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const user = window.auth.currentUser;
            if (!user) return;

            const nameInput = document.getElementById('edit-profile-name').value.trim();
            const usernameInput = document.getElementById('edit-profile-username').value.trim().toLowerCase();
            const btnSubmit = document.getElementById('btn-save-profile');

            if (!usernameInput || !/^[a-z0-9_]{3,15}$/.test(usernameInput)) {
                if(typeof showToast === 'function') showToast('Username must be 3-15 chars (letters, numbers, _).', 'error');
                return;
            }

            btnSubmit.disabled = true;
            btnSubmit.textContent = 'Saving...';

            try {
                // Check if username is taken by someone else
                const usernameCheck = await window.db.collection('users').where('username', '==', usernameInput).get();
                let isTaken = false;
                usernameCheck.forEach(docSnap => {
                    if (docSnap.id !== user.uid) isTaken = true;
                });

                if (isTaken) {
                    if(typeof showToast === 'function') showToast('Username is already taken. Please choose another.', 'error');
                    btnSubmit.disabled = false;
                    btnSubmit.textContent = 'Save Changes';
                    return;
                }

                // Update Auth Profile
                await user.updateProfile({ displayName: nameInput });

                // Update DB Profile
                await window.db.collection('users').doc(user.uid).set({
                    displayName: nameInput,
                    username: usernameInput
                }, { merge: true });

                // Update UI visually
                const nameEl = document.getElementById('user-name');
                if (nameEl) nameEl.textContent = nameInput;
                const unEl = document.getElementById('user-username');
                if (unEl) unEl.textContent = `@${usernameInput}`;

                if(typeof showToast === 'function') showToast('Profile updated successfully!');
                
                // Close modal
                document.getElementById('modal-edit-profile').classList.remove('active');
            } catch (error) {
                if(typeof showToast === 'function') showToast(error.message, 'error');
            } finally {
                btnSubmit.disabled = false;
                btnSubmit.textContent = 'Save Changes';
            }
        });
    }
});
