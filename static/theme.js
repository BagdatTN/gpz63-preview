(() => {
  const storageKey = 'p163-theme';
  const system = matchMedia('(prefers-color-scheme: dark)');
  let preference = null;
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === 'dark' || stored === 'light') preference = stored;
  } catch {
    // The system preference is still available when storage is disabled.
  }

  const root = document.documentElement;
  const apply = () => {
    root.dataset.theme = preference || (system.matches ? 'dark' : 'light');
    const toggle = document.querySelector('[data-theme-toggle]');
    if (toggle) toggle.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'));
  };
  apply();
  system.addEventListener('change', apply);

  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.querySelector('[data-theme-toggle]');
    if (!toggle) return;
    apply();
    toggle.hidden = false;
    toggle.addEventListener('click', () => {
      preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
      apply();
      try {
        localStorage.setItem(storageKey, preference);
      } catch {
        // The manual choice applies to this page even without persistence.
      }
    });
  });
})();
