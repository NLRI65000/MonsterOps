import { startLoading, stopLoading } from './loader.js';

const BASE = '/api';
let _refreshing = null; // dedup concurrent refresh attempts

const _MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// The session token lives in an HttpOnly cookie the browser sends automatically;
// JS never sees it. For state-changing requests we echo the readable CSRF cookie
// back in a header (double-submit) so the server can tell a real same-origin call
// from a cross-site forgery.
export function csrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)mr_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function _headers(method, hasBody) {
  const h = {};
  if (hasBody) h['Content-Type'] = 'application/json';
  if (_MUTATING.has(method)) h['X-CSRF-Token'] = csrfToken();
  return h;
}

// Build an Error from a failed response. FastAPI validation errors arrive as
// `detail: [{ loc: ["body", "field"], msg }]` — we flatten them into a single
// message (as before) but ALSO attach a { field: msg } map so callers can show
// each error inline on its field instead of a generic toast (see utils/form.js).
async function _httpError(res) {
  const detail = await res.json().catch(() => ({ detail: res.statusText }));
  let errMsg;
  let fields;
  if (Array.isArray(detail.detail)) {
    errMsg = detail.detail.map((e) => e.msg || JSON.stringify(e)).join('; ');
    fields = {};
    for (const e of detail.detail) {
      const loc = Array.isArray(e.loc) ? e.loc.filter((x) => typeof x === 'string') : [];
      const key = loc[loc.length - 1]; // e.g. ["body","username"] -> "username"
      if (key && e.msg && !(key in fields)) fields[key] = e.msg;
    }
  } else {
    errMsg = String(detail.detail ?? res.statusText);
  }
  return Object.assign(new Error(errMsg), { status: res.status, fields });
}

async function request(method, path, body, { _isRetry = false } = {}) {
  const init = {
    method,
    headers: _headers(method, body !== undefined),
    credentials: 'same-origin', // send the session + CSRF cookies
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  startLoading();
  let res;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch (err) {
    stopLoading();
    throw err;
  }

  stopLoading();

  // Attempt silent session refresh on 401 (but not on auth endpoints themselves)
  if (res.status === 401 && !_isRetry && !path.startsWith('/auth/')) {
    const refreshed = await _tryRefresh();
    if (refreshed) {
      return request(method, path, body, { _isRetry: true });
    }
    // Refresh failed — force logout
    _clearSession();
    location.href = '/';
    throw new Error('Session expired');
  }

  if (!res.ok) throw await _httpError(res);
  return res.status === 204 ? null : res.json();
}

async function _tryRefresh() {
  // Deduplicate: if a refresh is already in-flight, wait for it
  if (_refreshing) return _refreshing;

  _refreshing = fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrfToken() },
  })
    .then((res) => res.ok) // 204 on success — cookies are rotated server-side
    .catch(() => false)
    .finally(() => { _refreshing = null; });

  return _refreshing;
}

function _clearSession() {
  // Tokens live in HttpOnly cookies cleared by /auth/logout; only the non-secret
  // display identity is kept in localStorage, so that's all we drop here.
  localStorage.removeItem('mr_username');
  localStorage.removeItem('mr_role');
}

async function upload(path, formData) {
  startLoading();
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken() },
      credentials: 'same-origin',
      body: formData,
    });
  } finally { stopLoading(); }
  if (!res.ok) throw await _httpError(res);
  return res.status === 204 ? null : res.json();
}

export const api = {
  get:    (path)        => request('GET',    path),
  post:   (path, body)  => request('POST',   path, body),
  put:    (path, body)  => request('PUT',    path, body),
  patch:  (path, body)  => request('PATCH',  path, body),
  delete: (path)        => request('DELETE', path),
  upload,
  clearSession: _clearSession,
};
