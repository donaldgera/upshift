// Runs in the head before styles are painted; no comparison data is touched.
(() => {
  const storageKey = 'upsolve-atlas.theme.v1';
  const choices = new Set(['system', 'light', 'dark']);
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  let saved = true;
  try {
    const value = localStorage.getItem(storageKey);
    if (choices.has(value)) preference = value;
  } catch { /* System theme remains available when storage is restricted. */ }

  function apply() {
    const dark = preference === 'dark' || (preference === 'system' && system.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1c1c1f' : '#f7f7f8');
    const select = document.getElementById('theme-select');
    if (select) select.value = preference;
    const help = document.getElementById('theme-help');
    if (help) {
      help.hidden = saved;
      help.textContent = saved ? '' : 'Theme applied; this browser could not save it.';
    }
  }

  apply();
  system.addEventListener('change', () => {
    if (preference === 'system') apply();
  });
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    preference = choices.has(event.newValue) ? event.newValue : 'system';
    saved = true;
    apply();
  });
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.getElementById('theme-select')?.addEventListener('change', event => {
      preference = choices.has(event.target.value) ? event.target.value : 'system';
      saved = true;
      try { localStorage.setItem(storageKey, preference); }
      catch { saved = false; }
      apply();
    });
  }, {once: true});
})();
