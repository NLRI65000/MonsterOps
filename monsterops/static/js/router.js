const routes = new Map(); // path -> () => HTMLElement

function register(path, factory) {
  routes.set(path, factory);
}

function navigate(path) {
  location.hash = path;
}

function resolve() {
  const full = location.hash.slice(1) || '/';
  const path = full.split('?')[0];
  const view = document.getElementById('view');
  if (!view) return;

  const factory = routes.get(path);
  if (factory) {
    try {
      view.replaceChildren(factory());
    } catch (err) {
      console.error(`Router: error rendering ${path}`, err);
      const msg = document.createElement('div');
      msg.style.cssText = 'padding:2rem;';
      msg.innerHTML = `
        <p style="color:var(--color-danger);font-weight:600;margin-bottom:0.5rem;">Failed to render page</p>
        <pre style="color:var(--color-muted);font-size:0.75rem;white-space:pre-wrap;font-family:monospace;">${
        String(err)
      }</pre>
      `;
      view.replaceChildren(msg);
    }
  } else {
    // Friendly placeholder for routes without a module page yet
    const msg = document.createElement('div');
    msg.style.cssText = 'padding:2rem;color:var(--color-muted);font-size:0.875rem;';
    msg.textContent = path === '/'
      ? 'Select a section from the sidebar.'
      : `No page yet for ${full} — coming soon.`;
    view.replaceChildren(msg);
  }
}

function start() {
  window.addEventListener('hashchange', resolve);
  resolve();
}

export const router = { register, navigate, start };
