// Run IMMEDIATELY to prevent FOUC (Flash of Unstyled Content)
(function() {
    const saved = localStorage.getItem('iaop-theme') || localStorage.getItem('theme');
    if (saved) {
        document.documentElement.setAttribute('data-theme', saved);
    } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
})();

// Global theme toggle helper used by dashboard and classroom pages
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;

    function updateUI() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        // Support both icon-only and text variants
        const iconEl = btn.querySelector('#theme-icon') || btn;
        const labelEl = btn.querySelector('#theme-label');
        if (labelEl) {
            iconEl.textContent = isDark ? '☀️' : '🌙';
            labelEl.textContent = isDark ? 'Light' : 'Dark';
        } else {
            btn.innerHTML = isDark ? '☀️ Light' : '🌙 Dark';
        }
    }

    updateUI();

    btn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('iaop-theme', next);
        updateUI();
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('iaop-theme') && !localStorage.getItem('theme')) {
            const next = e.matches ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', next);
            updateUI();
        }
    });
});
