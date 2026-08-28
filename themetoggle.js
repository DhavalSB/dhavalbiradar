function toggleTheme() {
  // Site is dark-only
}

function initTheme() {
  document.documentElement.classList.add('dark');
}

window.toggleTheme = toggleTheme;
initTheme();
