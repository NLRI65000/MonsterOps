import { api } from '../api.js';

const TEMPLATE = `
  <style>
    @import '/css/theme.css';
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100dvh;
      background: var(--color-bg);
    }
    .card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 2.5rem 2rem;
      width: 100%;
      max-width: 420px;
    }
    .logo { font-size: 1.4rem; font-weight: 700; color: var(--color-accent); margin-bottom: 0.25rem; letter-spacing: -0.02em; }
    .subtitle { font-size: 0.875rem; color: var(--color-muted); margin-bottom: 0.5rem; }
    .notice {
      font-size: 0.8rem;
      color: var(--color-warning);
      background: rgba(245,158,11,0.1);
      border: 1px solid rgba(245,158,11,0.25);
      border-radius: 6px;
      padding: 0.6rem 0.8rem;
      margin-bottom: 1.5rem;
    }
    label { display: block; font-size: 0.8rem; color: var(--color-muted); margin-bottom: 0.35rem; }
    .field { margin-bottom: 1rem; }
    input {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      color: var(--color-text);
      padding: 0.55rem 0.75rem;
      font-size: 0.875rem;
      width: 100%;
      transition: border-color 0.15s;
      font-family: system-ui, sans-serif;
    }
    input:focus { outline: none; border-color: var(--color-accent); }
    input::placeholder { color: var(--color-muted); }
    .hint { font-size: 0.75rem; color: var(--color-muted); margin-top: 0.3rem; }
    .btn {
      display: flex; align-items: center; justify-content: center; gap: 0.4rem;
      width: 100%; padding: 0.6rem; border: none; border-radius: 8px;
      background: var(--color-accent); color: #fff; font-size: 0.875rem;
      font-family: system-ui, sans-serif; cursor: pointer; margin-top: 0.5rem;
      transition: background 0.15s;
    }
    .btn:hover { background: var(--color-accent-hover); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .error { color: var(--color-danger); font-size: 0.8rem; margin-top: 0.75rem; display: none; }
    .spinner {
      width: 14px; height: 14px;
      border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff;
      border-radius: 50%; animation: spin 0.7s linear infinite; display: none;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
  <div class="wrap">
    <div class="card">
      <div class="logo">MonsterOps</div>
      <div class="subtitle">First-run setup</div>
      <div class="notice">No admin accounts exist yet. Create your superadmin account to get started.</div>
      <form id="form">
        <div class="field">
          <label for="username">Username</label>
          <input id="username" type="text" placeholder="admin" autocomplete="username" required />
        </div>
        <div class="field">
          <label for="email">Email <span style="color:var(--color-muted)">(optional)</span></label>
          <input id="email" type="email" placeholder="admin@example.com" autocomplete="email" />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" type="password" placeholder="At least 8 characters" autocomplete="new-password" required minlength="8" />
          <div class="hint">Minimum 8 characters</div>
        </div>
        <div class="field">
          <label for="confirm">Confirm password</label>
          <input id="confirm" type="password" placeholder="Repeat password" autocomplete="new-password" required />
        </div>
        <button class="btn" type="submit">
          <span class="spinner" id="spinner"></span>
          <span id="btn-text">Create superadmin account</span>
        </button>
        <div class="error" id="error"></div>
      </form>
    </div>
  </div>
`;

export function SetupView() {
  const el = document.createElement('div');
  el.style.cssText = 'width:100%;height:100%;';
  el.attachShadow({ mode: 'open' }).innerHTML = TEMPLATE;

  const shadow   = el.shadowRoot;
  const form     = shadow.getElementById('form');
  const spinner  = shadow.getElementById('spinner');
  const btnText  = shadow.getElementById('btn-text');
  const errorEl  = shadow.getElementById('error');
  const btn      = shadow.querySelector('.btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = shadow.getElementById('username').value.trim();
    const email    = shadow.getElementById('email').value.trim() || null;
    const password = shadow.getElementById('password').value;
    const confirm  = shadow.getElementById('confirm').value;

    if (password !== confirm) {
      errorEl.textContent = 'Passwords do not match';
      errorEl.style.display = 'block';
      return;
    }

    spinner.style.display = 'block';
    btn.disabled = true;
    btnText.textContent = 'Creating account…';
    errorEl.style.display = 'none';

    try {
      const data = await api.post('/auth/setup', { username, password, email });
      // Tokens arrive as HttpOnly cookies; only keep non-secret display identity.
      localStorage.setItem('mr_username', data.username);
      localStorage.setItem('mr_role', data.role);
      location.href = '/';
    } catch (err) {
      errorEl.textContent = err.message ?? 'Setup failed';
      errorEl.style.display = 'block';
    } finally {
      spinner.style.display = 'none';
      btn.disabled = false;
      btnText.textContent = 'Create superadmin account';
    }
  });

  return el;
}
