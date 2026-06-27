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
        title.innerText = 'Welcome Back';
    } else {
        loginForm.style.display = 'none';
        signupForm.style.display = 'block';
        title.innerText = 'Create Account';
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
        await window.auth.signInWithPopup(provider);
        showToast('Logged in with Google successfully!');
        // Redirect will be handled by onAuthStateChanged
    } catch (error) {
        showToast(error.message, 'error');
    }
}

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
        if (!user && !window.location.pathname.endsWith('index.html') && window.location.pathname !== '/' && !window.location.pathname.endsWith('iaop-app/')) {
            window.location.href = 'index.html';
        } else if (user && (window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('iaop-app/') || window.location.pathname === '/')) {
            window.location.href = 'dashboard.html';
        }
    });
}
