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
        
        // Sun icon for dark mode (click to go light), Moon icon for light mode (click to go dark)
        const svg = isDark 
            ? `<svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>`
            : `<svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>`;
        
        // Find text span, or create one if it doesn't exist
        let span = btn.querySelector('span');
        const text = isDark ? 'Light Theme' : 'Dark Theme';
        
        if (span) {
            btn.innerHTML = svg + `<span>${text}</span>`;
        } else {
            // For dashboard/classroom dropdown item which might not have a span
            btn.innerHTML = svg + ` ${text}`;
        }
    }

    updateUI();

    btn.addEventListener('click', (e) => {
        e.preventDefault();
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
