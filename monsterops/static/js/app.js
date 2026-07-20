import { router } from './router.js';
import { api, csrfToken } from './api.js';
import { toast } from './components/app-toast.js';
import { LoginView } from './views/login.js';
import { SetupView } from './views/setup.js';
import { initConsole } from './components/server-console.js';
import './views/style_guide.js';
import './components/app-sidebar.js';
import './components/app-statusbar.js';
import './components/mr-card.js';
import './components/signal-pulse.js';

const sidebar = document.querySelector('app-sidebar');
const statusbar = document.querySelector('app-statusbar');
const hamburger = document.getElementById('menu-toggle');
const backdrop = document.getElementById('sidebar-backdrop');

router.register('/login', () => {
  enterUnauthMode();
  return LoginView();
});
router.register('/setup', () => {
  enterUnauthMode();
  return SetupView();
});

router.register('/logout', () => {
  api.clearSession();
  enterUnauthMode();
  // Wait for the server to clear the session cookies *before* reloading.
  // location.replace('/') re-runs boot(), which re-checks the session; if we
  // reload before the logout POST lands, the HttpOnly cookies are still valid
  // and boot() bounces the user straight back into the app.
  (async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': csrfToken() },
      });
    } catch { /* network error — reload anyway, the login page will re-auth */ }
    location.replace('/');
  })();
  const el = document.createElement('div');
  el.style.cssText = 'padding:2rem;color:var(--color-muted,#94a3b8);font-size:0.875rem;';
  el.textContent = 'Logging out…';
  return el;
});

async function boot() {
  // Apply saved theme before anything renders
  const savedTheme = localStorage.getItem('mr_theme') ?? 'dark';
  document.documentElement.dataset.theme = savedTheme;

  // 1. Check first-run before anything else
  try {
    const status = await fetch('/api/auth/status').then((r) => r.json());
    // Remember whether the Server Console is enabled server-side so initConsole()
    // can skip mounting the panel when it's turned off ('0' = disabled).
    localStorage.setItem('mr_console_enabled', status.console_enabled === false ? '0' : '1');
    if (status.first_run) {
      enterUnauthMode();
      router.navigate('/setup');
      router.start();
      return;
    }
  } catch {
    // Server unreachable — fall through and let the login page handle it
  }

  // 2. Not logged in → show login. The token is an HttpOnly cookie JS can't
  //    read, so we ask the server who we are (and try one silent refresh).
  const session = await fetchSession();
  if (!session) {
    api.clearSession();
    enterUnauthMode();
    router.navigate('/login');
    router.start();
    return;
  }
  localStorage.setItem('mr_username', session.username);
  localStorage.setItem('mr_role', session.role);

  // 3. Logged in — load modules and show the app
  exitUnauthMode();
  _initMobileNav();

  try {
    const manifests = await fetchManifests();
    buildNav(manifests);
    await loadModuleScripts(manifests);
  } catch (err) {
    toast('Failed to load modules', 'error');
    console.error(err);
  }

  const { username, role } = getSession();
  sidebar.setUser(username, role);

  // Bring the persistent system status strip online (authed pages only).
  statusbar?.start();

  initConsole();

  // Default landing page is the Dashboard — an empty view is useless. Only
  // override an empty/root hash so deep links and reloads keep their route.
  if (!location.hash || location.hash === '#' || location.hash === '#/') {
    location.hash = '/dashboard';
  }

  router.start();
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function fetchSession() {
  // Resolve the current session to { username, role }, or null if unauthenticated.
  // Retries once through a silent cookie refresh so an expired access cookie
  // (with a still-valid refresh cookie) survives a full page reload.
  const me = async () => {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
    return r.ok ? r.json() : null;
  };
  let u = await me();
  if (!u) {
    const r = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': csrfToken() },
    });
    if (r.ok) u = await me();
  }
  return u ? { username: u.username, role: u.role } : null;
}

function getSession() {
  return {
    username: localStorage.getItem('mr_username') ?? '',
    role: localStorage.getItem('mr_role') ?? 'readonly',
  };
}

function enterUnauthMode() {
  document.body.classList.add('no-sidebar');
  statusbar?.stop();
}

function exitUnauthMode() {
  document.body.classList.remove('no-sidebar');
}

// ── Mobile sidebar ────────────────────────────────────────────────────────────

function _closeMobile() {
  sidebar.close();
  backdrop?.classList.remove('visible');
}

function _initMobileNav() {
  if (!hamburger || !backdrop) return;

  hamburger.addEventListener('click', () => {
    if (sidebar.hasAttribute('sidebar-open')) {
      _closeMobile();
    } else {
      sidebar.open();
      backdrop.classList.add('visible');
    }
  });

  backdrop.addEventListener('click', _closeMobile);

  // Close on navigation
  window.addEventListener('hashchange', () => {
    if (window.innerWidth <= 768) _closeMobile();
  });
}

// ── Manifest helpers ──────────────────────────────────────────────────────────

async function fetchManifests() {
  const res = await fetch('/api/manifests');
  if (!res.ok) throw new Error(`/api/manifests returned ${res.status}`);
  return res.json();
}

function buildNav(manifests) {
  sidebar.setNavEntries(manifests.flatMap((m) => m.nav ?? []));
}

async function loadModuleScripts(manifests) {
  await Promise.all(
    manifests
      .filter((m) => m.js)
      .map((m) => import(m.js).catch((err) => console.warn(`Module ${m.module} failed:`, err))),
  );
}

boot();
