// Run immediately to prevent FOUC (Flash of Unstyled Content)
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
}
initTheme();

// Handle DOM interactions once loaded
document.addEventListener('DOMContentLoaded', () => {
    const themeToggleBtn = document.getElementById('theme-toggle');
    
    function updateBtnUI() {
        if (!themeToggleBtn) return;
        const currentTheme = document.documentElement.getAttribute('data-theme');
        themeToggleBtn.innerHTML = currentTheme === 'dark' ? '☀️ Light' : '🌙 Dark';
    }
    
    updateBtnUI();

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            updateBtnUI();
        });
    }

    // Listen for system changes if no manual override
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('theme')) {
            const newTheme = e.matches ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', newTheme);
            updateBtnUI();
        }
    });
});
