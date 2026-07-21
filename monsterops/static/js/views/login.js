import { api } from '../api.js';

const TEMPLATE = `
  <style>
    @import '/css/theme.css';
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      min-height: 100dvh;
      background: var(--mr-canvas);
      padding: 1.5rem;
    }
    .panel {
      position: relative; z-index: 1;
      background: var(--mr-surface);
      border: 1px solid var(--mr-frame);
      border-radius: var(--mr-radius-lg);
      width: 100%;
      padding: 2rem;
    }
    .login { position: relative; width: 100%; max-width: 400px; }
    /* The mascot perches on the card: his claws (bottom of the art) grip the
       card's top edge, so he looks like he's holding the login panel. */
    .mascot {
      display: block;
      width: 172px; height: auto;
      margin: 0 auto -48px;
      position: relative; z-index: 2;
      pointer-events: none;
      filter: drop-shadow(0 6px 12px rgba(0,0,0,0.5));
      -webkit-user-drag: none;
    }
    .brand {
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      margin-bottom: 1.4rem;
    }
    .brand-name {
      font-size: 1.05rem; font-weight: 600; color: var(--mr-text);
      letter-spacing: -0.01em;
    }
    h1 {
      font-size: 1.15rem; font-weight: 600; color: var(--mr-text);
      letter-spacing: -0.01em; margin-bottom: 0.3rem;
    }
    .subtitle {
      font-size: 0.8rem; color: var(--mr-text-muted); margin-bottom: 1.5rem;
    }
    label {
      display: block;
      font-size: 0.76rem; font-weight: 500;
      color: var(--mr-text); margin-bottom: 0.35rem;
    }
    .field { margin-bottom: 1rem; }
    input {
      background: var(--mr-canvas);
      border: 1px solid var(--mr-frame);
      border-radius: var(--mr-radius);
      color: var(--mr-text);
      padding: 0.55rem 0.75rem;
      font-size: 0.85rem;
      width: 100%;
      transition: border-color 0.15s, box-shadow 0.15s;
      font-family: var(--mr-font-body);
    }
    input:focus { outline: none; border-color: var(--mr-action); box-shadow: 0 0 0 3px var(--mr-action-tint); }
    input::placeholder { color: var(--mr-text-faint); }
    /* The 2FA code reads as a data value — mono, spaced, centred. */
    input.code {
      font-family: var(--mr-font-mono);
      letter-spacing: 0.35em;
      text-align: center;
      font-size: 1.05rem;
    }
    .btn {
      display: flex; align-items: center; justify-content: center; gap: 0.4rem;
      width: 100%; padding: 0.6rem;
      border: 1px solid var(--mr-action); border-radius: var(--mr-radius);
      background: var(--mr-action); color: #FFF;
      font-size: 0.85rem; font-weight: 600; font-family: var(--mr-font-body);
      cursor: pointer; margin-top: 0.5rem; transition: background 0.15s;
    }
    .btn:hover { background: color-mix(in srgb, var(--mr-action) 88%, black); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn:focus-visible { outline: 2px solid var(--mr-action); outline-offset: 2px; }
    .linkbtn {
      display: block; width: 100%; margin-top: 0.9rem;
      background: none; border: none; cursor: pointer;
      color: var(--mr-text-muted); font-size: 0.76rem; font-family: var(--mr-font-body);
      text-decoration: underline; text-underline-offset: 2px;
    }
    .linkbtn:hover { color: var(--mr-text); }
    .error { color: var(--mr-reject); font-size: 0.78rem; margin-top: 0.75rem; display: none; }
    .foot {
      font-size: 0.72rem; color: var(--mr-text-faint);
    }
    .spinner {
      width: 14px; height: 14px;
      border: 2px solid rgba(255,255,255,0.4); border-top-color: #FFF;
      border-radius: 50%; animation: spin 0.7s linear infinite; display: none;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2s; } }
  </style>
  <div class="wrap">
    <div class="login">
      <img class="mascot" src="/img/monsterops-mascot.png" alt="MonsterOps" />
      <div class="panel" id="panel"></div>
    </div>
    <div class="foot" id="node"></div>
  </div>
`;

const PASSWORD_STEP = `
  <div class="brand">
    <span class="brand-name">MonsterOps</span>
  </div>
  <h1>Log in</h1>
  <div class="subtitle">Enter your credentials to access the control panel.</div>
  <form id="form">
    <div class="field">
      <label for="username">Username</label>
      <input id="username" type="text" placeholder="admin" autocomplete="username" required />
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input id="password" type="password" placeholder="••••••••" autocomplete="current-password" required />
    </div>
    <button class="btn" type="submit">
      <span class="spinner" id="spinner"></span>
      <span id="btn-text">Log in</span>
    </button>
    <div class="error" id="error"></div>
  </form>
`;

const MFA_STEP = `
  <div class="brand">
    <span class="brand-name">MonsterOps</span>
  </div>
  <h1>Two-factor authentication</h1>
  <div class="subtitle" id="mfa-subtitle">Enter the 6-digit code from your authenticator app.</div>
  <form id="mfa-form">
    <div class="field">
      <label for="code" id="code-label">Authentication code</label>
      <input id="code" class="code" inputmode="numeric" autocomplete="one-time-code"
             placeholder="123456" required autofocus />
    </div>
    <button class="btn" type="submit">
      <span class="spinner" id="spinner"></span>
      <span id="btn-text">Verify</span>
    </button>
    <div class="error" id="error"></div>
    <button type="button" class="linkbtn" id="use-recovery">Use a recovery code instead</button>
  </form>
`;

export function LoginView() {
  const el = document.createElement('div');
  el.style.cssText = 'width:100%;height:100%;';
  el.attachShadow({ mode: 'open' }).innerHTML = TEMPLATE;

  const shadow = el.shadowRoot;
  const panel = shadow.getElementById('panel');

  const nodeEl = shadow.getElementById('node');
  if (nodeEl) nodeEl.textContent = `MonsterOps · ${(location.hostname || 'local').toLowerCase()}`;

  // Land in the app after a successful sign-in. When 2FA enrollment is required
  // but not yet done, drop the admin straight on the Security panel to set it up.
  function finish(data, username) {
    localStorage.setItem('mr_username', username);
    localStorage.setItem('mr_role', data.role);
    location.href = data.mfa_setup_required ? '/#/system?view=security' : '/';
  }

  function busy(on, verb) {
    const spinner = shadow.getElementById('spinner');
    const btnText = shadow.getElementById('btn-text');
    const btn = panel.querySelector('.btn');
    const errorEl = shadow.getElementById('error');
    spinner.style.display = on ? 'block' : 'none';
    btn.disabled = on;
    if (on) errorEl.style.display = 'none';
    if (verb) btnText.textContent = verb;
  }

  function showError(msg) {
    const errorEl = shadow.getElementById('error');
    errorEl.textContent = msg ?? 'Something went wrong';
    errorEl.style.display = 'block';
  }

  // ── Step 2: enter a TOTP or recovery code ──────────────────────────────────
  function renderMfaStep(pendingToken, username) {
    panel.innerHTML = MFA_STEP;
    const form = shadow.getElementById('mfa-form');
    const codeInput = shadow.getElementById('code');
    let recoveryMode = false;

    shadow.getElementById('use-recovery').addEventListener('click', () => {
      recoveryMode = !recoveryMode;
      shadow.getElementById('mfa-subtitle').textContent = recoveryMode
        ? 'Enter one of your one-time recovery codes.'
        : 'Enter the 6-digit code from your authenticator app.';
      shadow.getElementById('code-label').textContent = recoveryMode
        ? 'Recovery code'
        : 'Authentication code';
      codeInput.classList.toggle('code', !recoveryMode);
      codeInput.placeholder = recoveryMode ? 'ABCDE-FGHJK' : '123456';
      codeInput.inputMode = recoveryMode ? 'text' : 'numeric';
      shadow.getElementById('use-recovery').textContent = recoveryMode
        ? 'Use an authenticator code instead'
        : 'Use a recovery code instead';
      codeInput.value = '';
      codeInput.focus();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      busy(true, 'Verifying…');
      try {
        const data = await api.post('/auth/2fa/verify', {
          pending_token: pendingToken,
          code: codeInput.value.trim(),
        });
        finish(data, username);
      } catch (err) {
        showError(err.message ?? 'Incorrect code');
        busy(false, 'Verify');
        codeInput.select();
      }
    });
  }

  // ── Step 1: username + password ────────────────────────────────────────────
  function renderPasswordStep() {
    panel.innerHTML = PASSWORD_STEP;
    const form = shadow.getElementById('form');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = shadow.getElementById('username').value.trim();
      const password = shadow.getElementById('password').value;
      busy(true, 'Logging in…');
      try {
        const data = await api.post('/auth/login', { username, password });
        if (data.mfa_required) {
          renderMfaStep(data.pending_token, username);
          return;
        }
        finish(data, username);
      } catch (err) {
        showError(err.message ?? 'Login failed');
        busy(false, 'Log in');
      }
    });
  }

  renderPasswordStep();
  return el;
}
