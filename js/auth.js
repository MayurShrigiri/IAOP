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
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    
    try {
        const userCredential = await window.auth.createUserWithEmailAndPassword(email, password);
        await userCredential.user.updateProfile({ displayName: name });
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

// Handle redirect results if user logged in via signInWithRedirect on mobile
firebase.auth().getRedirectResult().then((result) => {
    if (result.user) {
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
    window.auth.onAuthStateChanged((user) => {
        if (user) {
            window.location.href = 'dashboard.html';
        }
    });
}
