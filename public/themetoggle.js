function toggleTheme() {
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('darkMode', document.documentElement.classList.contains('dark'));
}

function initTheme() {
  const savedMode = localStorage.getItem('darkMode');
  if (savedMode === 'true' || (savedMode === null && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
}

window.toggleTheme = toggleTheme;
initTheme();