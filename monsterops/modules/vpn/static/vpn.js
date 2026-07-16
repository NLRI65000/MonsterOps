import { router } from '/js/router.js';
import { api } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { confirmDialog } from '/js/components/app-confirm.js';
import { applyDensity, densityBarHTML, makeSortable, wireDensityBar } from '/js/utils/table.js';
import { emptyRowHTML } from '/js/utils/empty.js';
import { applyServerErrors, clearFieldErrors, setFieldError } from '/js/utils/form.js';

// Server schema field name → this form's (abbreviated) input id, so a 422 /
// duplicate-name error lands on the right input.
const VPN_FIELD_MAP = {
  name: 'f-name',
  description: 'f-desc',
  routes: 'f-routes',
  wg_address: 'f-wg-addr',
  wg_listen_port: 'f-wg-listen',
  wg_peer_public_key: 'f-wg-peerkey',
  wg_peer_host: 'f-wg-peerhost',
  wg_peer_port: 'f-wg-peerport',
  wg_persistent_keepalive: 'f-wg-keepalive',
  wg_mtu: 'f-wg-mtu',
  wg_dns: 'f-wg-dns',
  l2tp_gateway: 'f-l2-gw',
  l2tp_username: 'f-l2-user',
  l2tp_psk: 'f-l2-psk',
  l2tp_password: 'f-l2-pass',
};

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(
    /"/g,
    '&quot;',
  );
}

function fmtBytes(n) {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

const STATUS_BADGE = {
  up: ['UP', 'badge-up'],
  down: ['DOWN', 'badge-muted'],
  error: ['ERROR', 'badge-down'],
  unknown: ['UNKNOWN', 'badge-muted'],
};

function statusBadge(s) {
  const [label, cls] = STATUS_BADGE[s] || STATUS_BADGE.unknown;
  return `<span class="badge ${cls}">${label}</span>`;
}

const TYPE_LABEL = { 'wireguard': 'WireGuard', 'l2tp-ipsec': 'L2TP/IPsec' };

const STYLE = `
  @import '/css/theme.css';
  :host { display: block; padding: 1.5rem; }
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem; }
  .page-title  { font-size: 1.25rem; font-weight: 600; }
  .subtitle { color: var(--color-muted); font-size: 0.82rem; margin: -0.5rem 0 1rem; }
  .btn { padding: 0.4rem 0.85rem; border: 1px solid var(--color-border); border-radius: var(--radius);
         background: var(--color-surface); color: var(--color-text); font-size: 0.82rem; font-family: var(--font);
         cursor: pointer; white-space: nowrap; }
  .btn:hover { background: var(--color-bg); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }
  .btn-primary:hover { opacity: 0.88; }
  .btn-danger { border-color: var(--color-danger); color: var(--color-danger); }
  .btn-danger:hover { background: color-mix(in srgb, var(--color-danger) 10%, transparent); }
  .btn-sm { padding: 0.2rem 0.55rem; font-size: 0.75rem; }
  .card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); overflow: hidden; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  th { text-align: left; padding: 0.45rem 0.75rem; font-size: 0.7rem; font-weight: 600;
       text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-muted);
       border-bottom: 1px solid var(--color-border); background: var(--color-bg); }
  td { padding: 0.45rem 0.75rem; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  .empty { text-align: center; color: var(--color-muted); padding: 1.5rem; }
  .badge { display: inline-block; padding: 0.12rem 0.5rem; border-radius: 9999px; font-size: 0.68rem; font-weight: 600; }
  .badge-up    { background: var(--mr-accept-tint); color: var(--mr-accept); }
  .badge-down  { background: var(--mr-reject-tint); color: var(--mr-reject); }
  .badge-muted { background: rgba(139,149,165,0.12); color: var(--color-muted); }
  .badge-type  { background: var(--mr-action-tint); color: var(--color-accent); }
  .mono { font-family: var(--mr-font-data, monospace); font-size: 0.78rem; }
  .muted { color: var(--color-muted); }
  .warn-banner { background: color-mix(in srgb, var(--color-warning, #eab308) 12%, transparent);
                 border: 1px solid color-mix(in srgb, var(--color-warning, #eab308) 40%, transparent);
                 color: var(--color-text); border-radius: var(--radius); padding: 0.6rem 0.85rem;
                 font-size: 0.78rem; margin-bottom: 1rem; }
  .err-line { color: var(--mr-reject); font-size: 0.72rem; }
  .tab-toolbar { display: flex; justify-content: flex-end; margin-bottom: 0.75rem; }
  .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 500;
                   align-items: center; justify-content: center; }
  .modal-overlay.open { display: flex; }
  .modal { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius);
           padding: 1.5rem; min-width: 460px; max-width: 680px; width: 92vw; max-height: 92vh; overflow-y: auto; }
  .modal-header { display: flex; align-items: center; margin-bottom: 1.25rem; }
  .modal-title  { font-size: 1rem; font-weight: 600; flex: 1; }
  .modal-close  { background: none; border: none; font-size: 1.1rem; cursor: pointer; color: var(--color-muted); }
  .modal-footer { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.25rem; }
  .field { display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 0.85rem; }
  .field label { font-size: 0.78rem; font-weight: 500; color: var(--color-muted); }
  .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  .input, select.input { width: 100%; padding: 0.4rem 0.65rem; border: 1px solid var(--color-border); border-radius: var(--radius);
           background: var(--color-surface); color: var(--color-text); font-size: 0.85rem; font-family: var(--font);
           box-sizing: border-box; }
  .input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--mr-action-tint); }
  .check-row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.83rem; margin-bottom: 0.85rem; }
  .section-title { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
                   color: var(--color-muted); margin: 0.5rem 0 0.6rem; border-top: 1px solid var(--color-border); padding-top: 0.85rem; }
  .keybox { display: flex; gap: 0.5rem; align-items: center; }
  .keybox .input { font-family: var(--mr-font-data, monospace); font-size: 0.72rem; }
  .hint { font-size: 0.72rem; color: var(--color-muted); }
  pre.conf { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius);
             padding: 1rem; font-size: 0.74rem; overflow: auto; max-height: 55vh; white-space: pre; }
`;

class VpnView extends HTMLElement {
  constructor() {
    super();
    this._tunnels = [];
    this._editing = null;
    this._formType = 'wireguard';
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <div class="page-header">
        <span class="page-title">VPN Tunnels</span>
        <button class="btn btn-primary" id="btn-add">+ Add Tunnel</button>
      </div>
      <div class="subtitle">Tunnels this host dials out to reach a remote site's NAS. Point a home server's VPN interface at a tunnel name to be warned when it drops.</div>
      <div id="banner"></div>
      ${densityBarHTML()}
      <div id="body"></div>

      <div class="modal-overlay" id="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title" id="modal-title"></span>
            <button class="modal-close" id="modal-close">✕</button>
          </div>
          <div id="modal-body"></div>
          <div class="modal-footer" id="modal-footer">
            <button class="btn" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-submit">Save</button>
          </div>
        </div>
      </div>
    `;
    this.shadowRoot.getElementById('btn-add').addEventListener(
      'click',
      () => this._openModal(null),
    );
    this.shadowRoot.getElementById('modal-close').addEventListener(
      'click',
      () => this._closeModal(),
    );
    this.shadowRoot.getElementById('modal-cancel').addEventListener(
      'click',
      () => this._closeModal(),
    );
    this.shadowRoot.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === this.shadowRoot.getElementById('modal-overlay')) this._closeModal();
    });
    wireDensityBar(this.shadowRoot, () => this.shadowRoot.querySelector('#body table'));
    this._load();
  }

  async _load() {
    try {
      this._tunnels = await api.get('/vpn');
    } catch (e) {
      toast(e.message || 'Failed to load VPN tunnels', 'error');
      this._tunnels = [];
    }
    this._render();
  }

  _render() {
    const missing = this._tunnels.filter((t) => !t.tooling_ok);
    const banner = this.shadowRoot.getElementById('banner');
    if (missing.length) {
      const hints = [...new Set(missing.map((t) => t.tooling_hint).filter(Boolean))];
      banner.innerHTML =
        `<div class="warn-banner">⚠ Some tunnels can be defined but not activated on this host:<br>${
          hints.map(esc).join('<br>')
        }</div>`;
    } else {
      banner.innerHTML = '';
    }

    const rows = this._tunnels.map((t) => {
      const peer = t.type === 'wireguard'
        ? (t.wg_peer_host ? `${esc(t.wg_peer_host)}:${t.wg_peer_port ?? 51820}` : '—')
        : (t.l2tp_gateway ? esc(t.l2tp_gateway) : '—');
      const transfer = (t.rx_bytes != null || t.tx_bytes != null)
        ? `↓ ${fmtBytes(t.rx_bytes)} / ↑ ${fmtBytes(t.tx_bytes)}`
        : '—';
      return `
      <tr data-id="${t.id}">
        <td><strong>${esc(t.name)}</strong>${
        t.description ? `<div class="hint">${esc(t.description)}</div>` : ''
      }</td>
        <td><span class="badge badge-type">${esc(TYPE_LABEL[t.type] || t.type)}</span></td>
        <td>${statusBadge(t.oper_state)}${
        t.oper_state === 'error' && t.last_error
          ? `<div class="err-line">${esc(t.last_error)}</div>`
          : ''
      }</td>
        <td class="mono">${t.iface ? esc(t.iface) : '—'}</td>
        <td class="mono muted">${peer}</td>
        <td class="mono muted" data-sort="${
        (Number(t.rx_bytes) || 0) + (Number(t.tx_bytes) || 0)
      }">${transfer}</td>
        <td style="text-align:right;white-space:nowrap">
          ${
        t.oper_state === 'up'
          ? '<button class="btn btn-sm" data-act="down">Bring Down</button>'
          : `<button class="btn btn-sm btn-primary" data-act="up" ${
            t.tooling_ok ? '' : 'disabled title="tooling not installed"'
          }>Bring Up</button>`
      }
          <button class="btn btn-sm" data-act="config">Config</button>
          <button class="btn btn-sm" data-act="edit">Edit</button>
          <button class="btn btn-sm btn-danger" data-act="del">Delete</button>
        </td>
      </tr>`;
    }).join('');

    this.shadowRoot.getElementById('body').innerHTML = `
      <div class="card"><table>
        <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Interface</th><th>Peer / Gateway</th><th>Transfer</th><th></th></tr></thead>
        <tbody>${
      rows ||
      emptyRowHTML(7, {
        title: 'No VPN tunnels yet',
        message: 'Add a tunnel to reach a remote site’s NAS over WireGuard or L2TP/IPsec.',
      })
    }</tbody>
      </table></div>
    `;
    this.shadowRoot.querySelectorAll('tr[data-id]').forEach((tr) => {
      const t = this._tunnels.find((x) => x.id === Number(tr.dataset.id));
      tr.querySelector('[data-act=up]')?.addEventListener('click', () => this._action(t, 'up'));
      tr.querySelector('[data-act=down]')?.addEventListener('click', () => this._action(t, 'down'));
      tr.querySelector('[data-act=config]').addEventListener('click', () => this._preview(t));
      tr.querySelector('[data-act=edit]').addEventListener('click', () => this._openModal(t));
      tr.querySelector('[data-act=del]').addEventListener('click', () => this._delete(t));
    });
    const table = this.shadowRoot.querySelector('#body table');
    applyDensity(table);
    if (this._tunnels.length) makeSortable(table, { default: { col: 0, dir: 'asc' } });
  }

  // ── Modal ─────────────────────────────────────────────────────────────────

  _mval(id) {
    return this.shadowRoot.getElementById(id)?.value?.trim() ?? '';
  }

  _openModal(t) {
    this._editing = t;
    this._formType = t?.type || 'wireguard';
    const overlay = this.shadowRoot.getElementById('modal-overlay');
    this.shadowRoot.getElementById('modal-title').textContent = t
      ? `Edit Tunnel ${t.name}`
      : 'Add VPN Tunnel';
    this.shadowRoot.getElementById('modal-body').innerHTML = this._formHtml(t);
    this.shadowRoot.getElementById('modal-submit').onclick = () => this._save();
    // type toggle
    const typeSel = this.shadowRoot.getElementById('f-type');
    if (typeSel) {
      typeSel.addEventListener('change', () => {
        this._formType = typeSel.value;
        this._toggleTypeFields();
      });
    }
    this._toggleTypeFields();
    const regen = this.shadowRoot.getElementById('f-regen');
    if (regen) regen.addEventListener('click', () => this._regen(t));
    overlay.classList.add('open');
  }

  _closeModal() {
    this.shadowRoot.getElementById('modal-overlay').classList.remove('open');
    this._editing = null;
  }

  _toggleTypeFields() {
    const wg = this.shadowRoot.getElementById('grp-wg');
    const l2 = this.shadowRoot.getElementById('grp-l2tp');
    if (wg) wg.style.display = this._formType === 'wireguard' ? '' : 'none';
    if (l2) l2.style.display = this._formType === 'l2tp-ipsec' ? '' : 'none';
  }

  _formHtml(t) {
    const routes = (t?.routes || []).join(', ');
    const dns = (t?.wg_dns || []).join(', ');
    const typeOpts = Object.entries(TYPE_LABEL).map(([v, l]) =>
      `<option value="${v}" ${this._formType === v ? 'selected' : ''}>${l}</option>`
    ).join('');
    return `
      <div class="field-row">
        <div class="field">
          <label>Name (interface)</label>
          <input class="input" id="f-name" maxlength="15" placeholder="wg-site-a" value="${
      esc(t?.name)
    }" />
        </div>
        <div class="field">
          <label>Type</label>
          <select class="input" id="f-type" ${t ? 'disabled' : ''}>${typeOpts}</select>
        </div>
      </div>
      <div class="field">
        <label>Description (optional)</label>
        <input class="input" id="f-desc" maxlength="120" placeholder="Site A management link" value="${
      esc(t?.description)
    }" />
      </div>
      <div class="field">
        <label>Routes to reach through the tunnel (CIDRs, comma-separated)</label>
        <input class="input" id="f-routes" placeholder="10.20.0.0/24, 10.20.1.5/32" value="${
      esc(routes)
    }" />
        <span class="hint">The remote NAS network(s). For WireGuard these become AllowedIPs.</span>
      </div>

      <div id="grp-wg">
        <div class="section-title">WireGuard</div>
        ${
      t?.wg_public_key
        ? `
        <div class="field">
          <label>Your public key — configure this as the peer on the remote side</label>
          <div class="keybox">
            <input class="input" id="f-pub" readonly value="${esc(t.wg_public_key)}" />
            <button type="button" class="btn btn-sm" id="f-copy">Copy</button>
            <button type="button" class="btn btn-sm" id="f-regen">Regenerate</button>
          </div>
        </div>`
        : `<div class="hint" style="margin-bottom:0.85rem">A keypair is generated automatically; your public key appears here after saving.</div>`
    }
        <div class="field-row">
          <div class="field">
            <label>Tunnel address (local)</label>
            <input class="input" id="f-wg-addr" placeholder="10.99.0.2/32" value="${
      esc(t?.wg_address)
    }" />
          </div>
          <div class="field">
            <label>Listen port (optional)</label>
            <input class="input" id="f-wg-listen" type="number" min="1" max="65535" value="${
      t?.wg_listen_port ?? ''
    }" />
          </div>
        </div>
        <div class="field">
          <label>Peer public key</label>
          <input class="input mono" id="f-wg-peerkey" placeholder="base64 key from the remote side" value="${
      esc(t?.wg_peer_public_key)
    }" />
        </div>
        <div class="field-row">
          <div class="field">
            <label>Peer endpoint host</label>
            <input class="input" id="f-wg-peerhost" placeholder="vpn.site-a.example" value="${
      esc(t?.wg_peer_host)
    }" />
          </div>
          <div class="field">
            <label>Peer endpoint port</label>
            <input class="input" id="f-wg-peerport" type="number" min="1" max="65535" value="${
      t?.wg_peer_port ?? 51820
    }" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Persistent keepalive (s, optional)</label>
            <input class="input" id="f-wg-keepalive" type="number" min="0" max="65535" placeholder="25" value="${
      t?.wg_persistent_keepalive ?? ''
    }" />
          </div>
          <div class="field">
            <label>MTU (optional)</label>
            <input class="input" id="f-wg-mtu" type="number" min="1280" max="9000" value="${
      t?.wg_mtu ?? ''
    }" />
          </div>
        </div>
        <div class="field">
          <label>DNS servers (optional, comma-separated)</label>
          <input class="input" id="f-wg-dns" placeholder="10.99.0.1" value="${esc(dns)}" />
        </div>
      </div>

      <div id="grp-l2tp">
        <div class="section-title">L2TP / IPsec</div>
        <div class="field">
          <label>Remote gateway (LNS)</label>
          <input class="input" id="f-l2-gw" placeholder="vpn.site-a.example" value="${
      esc(t?.l2tp_gateway)
    }" />
        </div>
        <div class="field">
          <label>IPsec pre-shared key ${t ? '(leave blank to keep current)' : ''}</label>
          <input class="input" id="f-l2-psk" type="password" autocomplete="new-password" />
        </div>
        <div class="field-row">
          <div class="field">
            <label>PPP username</label>
            <input class="input" id="f-l2-user" value="${esc(t?.l2tp_username)}" />
          </div>
          <div class="field">
            <label>PPP password ${t ? '(blank = keep)' : ''}</label>
            <input class="input" id="f-l2-pass" type="password" autocomplete="new-password" />
          </div>
        </div>
      </div>

      <div class="check-row">
        <input type="checkbox" id="f-enabled" ${t?.enabled ? 'checked' : ''} />
        <label for="f-enabled">Mark as enabled (auto-bring-up)</label>
      </div>
    `;
  }

  _parseList(id) {
    return this._mval(id).split(',').map((s) => s.trim()).filter(Boolean);
  }

  async _save() {
    const type = this._formType;
    clearFieldErrors(this.shadowRoot);

    // Client-side required checks — mirror the server's per-type model validator
    // so the user gets an inline pointer without a round-trip. Secrets are only
    // required on create (blank on edit = keep the stored value).
    const sr = this.shadowRoot;
    const need = [['f-name', 'A tunnel name is required']];
    if (type === 'wireguard') {
      need.push(
        ['f-wg-addr', 'A WireGuard address is required'],
        ['f-wg-peerkey', 'The remote peer public key is required'],
        ['f-wg-peerhost', 'The remote peer host is required'],
      );
    } else {
      need.push(['f-l2-gw', 'A remote gateway is required'], [
        'f-l2-user',
        'A PPP username is required',
      ]);
      if (!this._editing) {
        need.push(['f-l2-psk', 'The IPsec pre-shared key is required'], [
          'f-l2-pass',
          'A PPP password is required',
        ]);
      }
    }
    let ok = true;
    for (const [id, msg] of need) {
      const input = sr.getElementById(id);
      if (input && !input.value.trim()) {
        setFieldError(input, msg);
        ok = false;
      }
    }
    if (!ok) return;

    const body = {
      name: this._mval('f-name'),
      type,
      description: this._mval('f-desc') || null,
      routes: this._parseList('f-routes'),
      enabled: this.shadowRoot.getElementById('f-enabled').checked,
    };
    if (type === 'wireguard') {
      Object.assign(body, {
        wg_address: this._mval('f-wg-addr') || null,
        wg_listen_port: this._mval('f-wg-listen') ? Number(this._mval('f-wg-listen')) : null,
        wg_peer_public_key: this._mval('f-wg-peerkey') || null,
        wg_peer_host: this._mval('f-wg-peerhost') || null,
        wg_peer_port: this._mval('f-wg-peerport') ? Number(this._mval('f-wg-peerport')) : 51820,
        wg_persistent_keepalive: this._mval('f-wg-keepalive')
          ? Number(this._mval('f-wg-keepalive'))
          : null,
        wg_mtu: this._mval('f-wg-mtu') ? Number(this._mval('f-wg-mtu')) : null,
        wg_dns: this._parseList('f-wg-dns'),
      });
    } else {
      const psk = this.shadowRoot.getElementById('f-l2-psk').value;
      const pass = this.shadowRoot.getElementById('f-l2-pass').value;
      Object.assign(body, {
        l2tp_gateway: this._mval('f-l2-gw') || null,
        l2tp_username: this._mval('f-l2-user') || null,
        l2tp_psk: psk || null,
        l2tp_password: pass || null,
      });
    }
    try {
      if (this._editing) await api.put(`/vpn/${this._editing.id}`, body);
      else await api.post('/vpn', body);
      toast(`Tunnel ${body.name} saved`, 'success');
      this._closeModal();
      this._load();
    } catch (e) {
      // Field-level 422s (invalid CIDR, bad base64 key, out-of-range port, …)
      // map onto their input via the field map; the duplicate-name 409 is a
      // string-detail HTTPException, so map it too.
      if (applyServerErrors(sr, e, (f) => sr.getElementById(VPN_FIELD_MAP[f]))) return;
      const msg = e.message || 'Save failed';
      if (/already exists/i.test(msg)) setFieldError(sr.getElementById('f-name'), msg);
      else toast(msg, 'error');
    }
  }

  async _regen(t) {
    if (
      !await confirmDialog(
        `Regenerate WireGuard keys for "${t.name}"? The remote peer must be updated with the new public key.`,
        { danger: true },
      )
    ) return;
    try {
      const updated = await api.post(`/vpn/${t.id}/regenerate-keys`, {});
      toast('New keypair generated', 'success');
      this._closeModal();
      this._load();
      // reopen so the operator can copy the fresh public key
      setTimeout(() => this._openModal(updated), 50);
    } catch (e) {
      toast(e.message || 'Regeneration failed', 'error');
    }
  }

  async _action(t, dir) {
    try {
      const res = await api.post(`/vpn/${t.id}/${dir}`, {});
      if (res.ok) {
        toast(`Tunnel ${t.name} ${dir === 'up' ? 'brought up' : 'brought down'}`, 'success');
      } else toast(res.detail || `Tunnel did not come ${dir}`, 'error');
      this._load();
    } catch (e) {
      toast(e.message || 'Action failed', 'error');
    }
  }

  async _preview(t) {
    try {
      const res = await api.get(`/vpn/${t.id}/config-preview`);
      const files = res.files.map(esc).join('\n');
      this._openInfo(
        `Config for ${t.name}`,
        `<div class="hint" style="margin-bottom:0.6rem">Secrets are redacted. Target files:</div><pre class="conf">${files}</pre><pre class="conf">${
          esc(res.content)
        }</pre>`,
      );
    } catch (e) {
      toast(e.message || 'Preview failed', 'error');
    }
  }

  _openInfo(title, html) {
    this.shadowRoot.getElementById('modal-title').textContent = title;
    this.shadowRoot.getElementById('modal-body').innerHTML = html;
    this.shadowRoot.getElementById('modal-submit').style.display = 'none';
    this.shadowRoot.getElementById('modal-overlay').classList.add('open');
    // restore submit button when this info modal is dismissed
    const restore = () => {
      this.shadowRoot.getElementById('modal-submit').style.display = '';
    };
    this.shadowRoot.getElementById('modal-cancel').addEventListener('click', restore, {
      once: true,
    });
    this.shadowRoot.getElementById('modal-close').addEventListener('click', restore, {
      once: true,
    });
  }

  async _delete(t) {
    if (
      !await confirmDialog(`Delete VPN tunnel "${t.name}"? It will be brought down first.`, {
        danger: true,
      })
    ) return;
    try {
      await api.delete(`/vpn/${t.id}`);
      toast(`Tunnel ${t.name} deleted`, 'success');
      this._load();
    } catch (e) {
      toast(e.message || 'Delete failed', 'error');
    }
  }
}

customElements.define('vpn-view', VpnView);
router.register('/vpn', () => document.createElement('vpn-view'));

// wire the copy button lazily (delegated) since it lives inside the modal
document.addEventListener('click', (e) => {
  const path = e.composedPath();
  const btn = path.find((el) => el.id === 'f-copy');
  if (!btn) return;
  const input = path[0].getRootNode().getElementById('f-pub');
  if (input) {
    navigator.clipboard?.writeText(input.value);
    toast('Public key copied', 'success');
  }
});
