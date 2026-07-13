import { router } from '/js/router.js';
import { api } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { confirmDialog } from '/js/components/app-confirm.js';
import { emptyStateHTML, emptyRowHTML, skeletonRows, skeletonBlock } from '/js/utils/empty.js';
import { COUNTRIES, flagEmoji } from '/js/utils/countries.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const COUNTRY_NAME = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.name]));

function relTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function ruleSummary(r) {
  const bits = [];
  if (r.iifname) bits.push(`in ${r.iifname}`);
  if (r.protocol && r.protocol !== 'any') bits.push(r.protocol);
  if (r.src_set) bits.push(`src @${r.src_set}`);
  else if (r.saddr) bits.push(`src ${r.saddr}`);
  if (r.daddr) bits.push(`dst ${r.daddr}`);
  if (r.sport) bits.push(`sport ${r.sport}`);
  if (r.dport) bits.push(`dport ${r.dport}`);
  if (r.ct_state) bits.push(`ct ${r.ct_state}`);
  return bits.join(' · ') || 'any';
}

const FW_TABS = ['rules', 'sets', 'apply', 'settings'];

class FirewallView extends HTMLElement {
  connectedCallback() {
    this._tab = this._initialTab();  // honour #/firewall?tab=sets (drill-through)
    this._pendingToken = null;
    this._countdown = null;
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = this._shell();
    this._bind();
    this._load();
  }

  disconnectedCallback() { if (this._countdown) clearInterval(this._countdown); }

  _initialTab() {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const t = q.get('tab');
    return FW_TABS.includes(t) ? t : 'rules';
  }

  _tabCls(t) { return this._tab === t ? 'tab active' : 'tab'; }

  _shell() {
    return `
<style>
  @import '/css/theme.css';
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :host{display:block;padding:1.25rem;font-size:.875rem;color:var(--color-text)}
  h2{font-size:1.05rem;font-weight:600;margin-bottom:.15rem}
  .sub{color:var(--color-muted);font-size:.78rem;margin-bottom:1rem}

  .statusbar{display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:1rem}
  .stat{background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;
    padding:.5rem .85rem;min-width:96px}
  .stat .k{font-size:.68rem;color:var(--color-muted);text-transform:uppercase;letter-spacing:.04em}
  .stat .v{font-size:1.05rem;font-weight:600;margin-top:.1rem}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:.35rem}

  .confirm-banner{background:color-mix(in srgb,var(--color-accent) 14%,transparent);
    border:1px solid var(--color-accent);border-radius:8px;padding:.75rem 1rem;margin-bottom:1rem;
    display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
  .confirm-banner .msg{flex:1;font-size:.85rem}
  .cd{font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:1.1rem;color:var(--color-accent)}

  .tabs{display:flex;border-bottom:1px solid var(--color-border);margin-bottom:1rem;gap:0}
  .tab{padding:.55rem 1rem;cursor:pointer;font-size:.85rem;color:var(--color-muted);
    border-bottom:2px solid transparent}
  .tab.active{color:var(--color-accent);border-bottom-color:var(--color-accent);font-weight:600}

  table{width:100%;border-collapse:collapse;font-size:.82rem}
  th,td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid var(--color-border);vertical-align:middle}
  th{font-size:.7rem;color:var(--color-muted);text-transform:uppercase;letter-spacing:.04em}
  tr.disabled td{opacity:.5}

  .btn{border:none;border-radius:6px;padding:.45rem .85rem;font-size:.8rem;font-weight:500;
    cursor:pointer;font-family:inherit}
  .btn-primary{background:var(--color-accent);color:#fff}
  .btn-secondary{background:var(--color-border);color:var(--color-text)}
  .btn-danger{background:var(--color-danger);color:#fff}
  .btn-sm{padding:.28rem .55rem;font-size:.74rem}
  .btn:disabled{opacity:.45;cursor:not-allowed}
  .btn-row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin-bottom:1rem}
  .spacer{flex:1}

  .badge{border-radius:4px;padding:.08rem .4rem;font-size:.7rem;font-weight:600;text-transform:uppercase}
  .b-accept{background:rgba(34,197,94,.18);color:#4ade80}
  .b-drop,.b-reject{background:rgba(239,68,68,.18);color:#f87171}
  .b-chain{background:var(--color-border);color:var(--color-muted)}

  label{font-size:.75rem;color:var(--color-muted);font-weight:500}
  input,select{background:var(--color-bg);border:1px solid var(--color-border);border-radius:6px;
    color:var(--color-text);padding:.4rem .6rem;font-size:.82rem;font-family:inherit;width:100%}
  input:focus,select:focus{outline:none;border-color:var(--color-accent)}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:.7rem}
  .field{display:flex;flex-direction:column;gap:.25rem}
  .field.span2{grid-column:span 2}

  .code{background:#0f0f0f;color:#d4d4d4;border-radius:8px;padding:.75rem 1rem;
    font-family:'IBM Plex Mono',monospace;font-size:.75rem;line-height:1.5;white-space:pre-wrap;
    overflow:auto;max-height:400px}
  .diff-add{background:rgba(34,197,94,.14);color:#4ade80}
  .diff-del{background:rgba(239,68,68,.14);color:#f87171}
  .diff-hunk{color:#38bdf8}

  .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;
    justify-content:center;z-index:100}
  .modal-bg.hidden{display:none}
  .modal{background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;
    padding:1.5rem;width:560px;max-width:95vw;max-height:90vh;overflow:auto}
  .modal h3{font-size:1rem;margin-bottom:1rem}
  .modal-foot{display:flex;gap:.5rem;justify-content:flex-end;margin-top:1.25rem}
  .empty{padding:2rem;text-align:center;color:var(--color-muted)}
  .warn{color:var(--color-danger);font-size:.78rem}
  .muted{color:var(--color-muted)}
  code{font-family:'IBM Plex Mono',monospace;font-size:.78rem}
</style>

<h2>Firewall <span style="font-weight:400;color:var(--color-muted);font-size:.8rem">— nftables</span></h2>
<div class="sub">MonsterOps manages only its own <code>table inet monsterops</code>; your other nftables tables are never touched.</div>

<div id="nft-warn"></div>
<div class="statusbar" id="statusbar"></div>
<div id="confirm-slot"></div>

<div class="tabs">
  <div class="${this._tabCls('rules')}" data-tab="rules">Rules</div>
  <div class="${this._tabCls('sets')}" data-tab="sets">Sets &amp; Blocklists</div>
  <div class="${this._tabCls('apply')}" data-tab="apply">Preview &amp; Apply</div>
  <div class="${this._tabCls('settings')}" data-tab="settings">Settings</div>
</div>
<div id="panel"></div>

<div class="modal-bg hidden" id="rule-modal">
  <div class="modal">
    <h3 id="rule-modal-title">Add rule</h3>
    <div class="grid">
      <div class="field"><label>Chain</label><select id="f-chain"><option>input</option><option>forward</option><option>output</option></select></div>
      <div class="field"><label>Action</label><select id="f-action"><option>accept</option><option>drop</option><option>reject</option></select></div>
      <div class="field"><label>Protocol</label><select id="f-protocol"><option value="">any</option><option>tcp</option><option>udp</option><option>icmp</option><option>icmpv6</option></select></div>
      <div class="field"><label>Dest port(s) — e.g. 1812,1813 or 1000-2000</label><input id="f-dport" placeholder=""/></div>
      <div class="field"><label>Source addr / CIDR</label><input id="f-saddr" placeholder="e.g. 10.0.0.0/8"/></div>
      <div class="field"><label>Source set (name)</label><input id="f-src_set" placeholder="optional"/></div>
      <div class="field"><label>In-interface</label><input id="f-iifname" placeholder="optional"/></div>
      <div class="field"><label>ct state</label><input id="f-ct_state" placeholder="e.g. new,established"/></div>
      <div class="field span2"><label>Comment</label><input id="f-comment"/></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-secondary" id="rule-cancel">Cancel</button>
      <button class="btn btn-primary" id="rule-save">Save</button>
    </div>
  </div>
</div>
`;
  }

  _bind() {
    const sr = this.shadowRoot;
    sr.querySelectorAll('.tab').forEach((t) =>
      t.addEventListener('click', () => { this._setTab(t.dataset.tab); }));
    sr.getElementById('rule-cancel').addEventListener('click', () => this._closeRuleModal());
    sr.getElementById('rule-save').addEventListener('click', () => this._saveRule());
  }

  _setTab(tab) {
    this._tab = tab;
    this.shadowRoot.querySelectorAll('.tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.tab === tab));
    this._renderPanel();
  }

  async _load() {
    try {
      const [status, config] = await Promise.all([
        api.get('/firewall/status'), api.get('/firewall/config'),
      ]);
      this._status = status;
      this._config = config;
      this._renderStatus();
      this._renderPanel();
    } catch (err) {
      toast('Failed to load firewall: ' + (err.message ?? err), 'error');
    }
  }

  _renderStatus() {
    const s = this._status;
    const warn = this.shadowRoot.getElementById('nft-warn');
    warn.innerHTML = s.nft_available ? '' :
      `<div class="confirm-banner" style="border-color:var(--color-danger);background:rgba(239,68,68,.1)">
         <div class="msg warn">⚠ <strong>nft</strong> is not installed on this host — rules can be edited but not applied. Install <code>nftables</code>.</div></div>`;
    const g = (c) => c ? '#22c55e' : 'var(--color-muted)';
    this.shadowRoot.getElementById('statusbar').innerHTML = `
      <div class="stat"><div class="k">Managed</div><div class="v"><span class="dot" style="background:${g(s.managed)}"></span>${s.managed ? 'Yes' : 'No'}</div></div>
      <div class="stat"><div class="k">Active in kernel</div><div class="v"><span class="dot" style="background:${g(s.active)}"></span>${s.active ? 'Yes' : 'No'}</div></div>
      <div class="stat"><div class="k">Rules</div><div class="v">${s.enabled_rule_count}/${s.rule_count}</div></div>
      <div class="stat"><div class="k">Active bans</div><div class="v">${s.ban_count}</div></div>
      <div class="stat"><div class="k">Dropped pkts</div><div class="v">${s.total_dropped ?? 0}</div></div>
    `;
  }

  _renderPanel() {
    const p = this.shadowRoot.getElementById('panel');
    if (this._tab === 'rules') this._renderRules(p);
    else if (this._tab === 'sets') this._renderSets(p);
    else if (this._tab === 'apply') this._renderApply(p);
    else if (this._tab === 'settings') this._renderSettings(p);
  }

  // ── Rules ──────────────────────────────────────────────────────────────────
  async _renderRules(p) {
    p.innerHTML = `<table><thead><tr><th style="width:70px">Order</th><th>On</th><th>Chain</th><th>Action</th><th>Match</th><th>Comment</th><th></th></tr></thead>
      <tbody>${skeletonRows(this.shadowRoot, 7, 5)}</tbody></table>`;
    let rules, presets;
    try {
      [rules, presets] = await Promise.all([
        api.get('/firewall/rules'), api.get('/firewall/presets'),
      ]);
    } catch (err) {
      p.innerHTML = emptyStateHTML({
        title: 'Couldn’t load rules',
        message: err.message || 'Something went wrong. Try again.',
      });
      return;
    }
    this._rules = rules;
    p.innerHTML = `
      <div class="btn-row">
        <button class="btn btn-primary btn-sm" id="add-rule">+ Add rule</button>
        <span class="muted" style="font-size:.76rem">Presets:</span>
        ${presets.map((pr) => `<button class="btn btn-secondary btn-sm preset" data-name="${pr.name}" title="${esc(pr.description)}">${esc(pr.label)}</button>`).join('')}
        <span class="spacer"></span>
        <span class="muted" style="font-size:.74rem">Rules apply top-to-bottom within each chain.</span>
      </div>
      <table>
        <thead><tr><th style="width:70px">Order</th><th>On</th><th>Chain</th><th>Action</th><th>Match</th><th>Comment</th><th></th></tr></thead>
        <tbody>
          ${rules.length ? rules.map((r, i) => `
            <tr class="${r.enabled ? '' : 'disabled'}" data-id="${r.id}">
              <td>
                <button class="btn btn-secondary btn-sm mv" data-dir="up" data-id="${r.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
                <button class="btn btn-secondary btn-sm mv" data-dir="down" data-id="${r.id}" ${i === rules.length - 1 ? 'disabled' : ''}>↓</button>
              </td>
              <td><input type="checkbox" class="tog" data-id="${r.id}" ${r.enabled ? 'checked' : ''}></td>
              <td><span class="badge b-chain">${esc(r.chain)}</span></td>
              <td><span class="badge b-${r.action}">${esc(r.action)}</span></td>
              <td style="font-family:monospace;font-size:.76rem">${esc(ruleSummary(r))}</td>
              <td class="muted">${esc(r.comment ?? '')}</td>
              <td style="white-space:nowrap;text-align:right">
                <button class="btn btn-secondary btn-sm edit" data-id="${r.id}">Edit</button>
                <button class="btn btn-danger btn-sm del" data-id="${r.id}">Delete</button>
              </td>
            </tr>`).join('') : emptyRowHTML(7, { title: 'No rules yet', message: 'Add a rule or apply a preset to get started.' })}
        </tbody>
      </table>`;
    p.querySelector('#add-rule').addEventListener('click', () => this._openRuleModal());
    p.querySelectorAll('.preset').forEach((b) => b.addEventListener('click', () => this._applyPreset(b.dataset.name)));
    p.querySelectorAll('.edit').forEach((b) => b.addEventListener('click', () => this._openRuleModal(this._rules.find((x) => x.id === +b.dataset.id))));
    p.querySelectorAll('.del').forEach((b) => b.addEventListener('click', () => this._deleteRule(+b.dataset.id)));
    p.querySelectorAll('.tog').forEach((b) => b.addEventListener('change', () => this._toggleRule(+b.dataset.id, b.checked)));
    p.querySelectorAll('.mv').forEach((b) => b.addEventListener('click', () => this._move(+b.dataset.id, b.dataset.dir)));
  }

  _openRuleModal(rule) {
    const sr = this.shadowRoot;
    this._editId = rule ? rule.id : null;
    sr.getElementById('rule-modal-title').textContent = rule ? 'Edit rule' : 'Add rule';
    const g = (id) => sr.getElementById(id);
    g('f-chain').value = rule?.chain ?? 'input';
    g('f-action').value = rule?.action ?? 'accept';
    g('f-protocol').value = rule?.protocol ?? '';
    g('f-dport').value = rule?.dport ?? '';
    g('f-saddr').value = rule?.saddr ?? '';
    g('f-src_set').value = rule?.src_set ?? '';
    g('f-iifname').value = rule?.iifname ?? '';
    g('f-ct_state').value = rule?.ct_state ?? '';
    g('f-comment').value = rule?.comment ?? '';
    sr.getElementById('rule-modal').classList.remove('hidden');
  }
  _closeRuleModal() { this.shadowRoot.getElementById('rule-modal').classList.add('hidden'); }

  async _saveRule() {
    const sr = this.shadowRoot;
    const v = (id) => { const x = sr.getElementById(id).value.trim(); return x || null; };
    const body = {
      chain: sr.getElementById('f-chain').value,
      action: sr.getElementById('f-action').value,
      protocol: v('f-protocol'), dport: v('f-dport'), saddr: v('f-saddr'),
      src_set: v('f-src_set'), iifname: v('f-iifname'), ct_state: v('f-ct_state'),
      comment: v('f-comment'), enabled: true,
    };
    try {
      if (this._editId) await api.put(`/firewall/rules/${this._editId}`, body);
      else await api.post('/firewall/rules', body);
      toast('Rule saved', 'success');
      this._closeRuleModal();
      this._renderPanel();
      this._refreshStatus();
    } catch (err) { toast(err.message ?? 'Save failed', 'error'); }
  }

  async _deleteRule(id) {
    if (!(await confirmDialog('Delete this rule?', { title: 'Delete rule', danger: true }))) return;
    await api.delete(`/firewall/rules/${id}`); this._renderPanel(); this._refreshStatus();
  }
  async _toggleRule(id, on) {
    const r = this._rules.find((x) => x.id === id);
    await api.put(`/firewall/rules/${id}`, { ...r, enabled: on });
    this._renderPanel(); this._refreshStatus();
  }
  async _applyPreset(name) {
    try { const r = await api.post(`/firewall/presets/${name}`, {}); toast(`Added ${r.rules_added} rule(s)`, 'success'); this._renderPanel(); this._refreshStatus(); }
    catch (err) { toast(err.message ?? 'Preset failed', 'error'); }
  }
  async _move(id, dir) {
    const ids = this._rules.map((r) => r.id);
    const i = ids.indexOf(id);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api.post('/firewall/rules/reorder', { order: ids });
    this._renderPanel();
  }

  // ── Sets ───────────────────────────────────────────────────────────────────
  async _renderSets(p) {
    p.innerHTML = skeletonBlock(this.shadowRoot, 5);
    let sets, events;
    try {
      [sets, events] = await Promise.all([
        api.get('/firewall/sets'),
        api.get('/firewall/block-events?limit=25').catch(() => []),
      ]);
    } catch (err) {
      p.innerHTML = emptyStateHTML({
        title: 'Couldn’t load sets',
        message: err.message || 'Something went wrong. Try again.',
      });
      return;
    }
    const ccOf = (s) => (s.managed_source && s.managed_source.startsWith('country:')) ? s.managed_source.slice(8) : null;
    const caOf = (s) => (s.managed_source && s.managed_source.startsWith('country_allow:')) ? s.managed_source.slice(14) : null;
    const isNasGuard = (s) => s.managed_source === 'guard:nas';
    const countryOpts = `<option value="">Select a country…</option>${COUNTRIES.map((c) => `<option value="${c.code}">${flagEmoji(c.code)} ${esc(c.name)} (${c.code})</option>`).join('')}`;
    p.innerHTML = `
      ${this._activityHTML(events)}
      <div class="btn-row">
        <button class="btn btn-primary btn-sm" id="add-set">+ New set</button>
        <span class="muted" style="font-size:.74rem">Block/allow sets auto-generate a rule; entries add/remove live without a full reload.</span>
      </div>
      <div class="btn-row">
        <select id="cc-select" style="width:280px">${countryOpts}</select>
        <button class="btn btn-secondary btn-sm" id="block-country">🌍 Block country</button>
        <span class="muted" style="font-size:.74rem">Blocks every IP range for a country from registry data. Auto-managed; takes effect on Apply.</span>
      </div>
      <div class="btn-row">
        <select id="ca-select" style="width:280px">${countryOpts}</select>
        <button class="btn btn-danger btn-sm" id="allow-only-country">🔒 Allow only this country</button>
        <span class="muted" style="font-size:.74rem">Blocks every <em>other</em> country. Takes effect on Apply.</span>
      </div>
      <div style="border:1px solid var(--color-danger);border-radius:8px;padding:.6rem .85rem;margin-bottom:1rem;background:rgba(239,68,68,.08);font-size:.78rem;line-height:1.5">
        ⚠ <strong>Allow-only sets the input policy to DROP.</strong> Anti-lockout keeps the SSH &amp; web guard ports, your current admin IP, established connections and every known NAS client reachable, and Apply arms a 60s auto-rollback — but if you are ever locked out, recover from the host shell (as root):
        <div style="margin-top:.4rem"><code>sudo ./scripts/mr-firewall-panic.sh</code> &nbsp;<span class="muted">or</span>&nbsp; <code>sudo nft delete table inet monsterops</code></div>
      </div>
      ${sets.length ? sets.map((s) => {
        const cc = ccOf(s), ca = caOf(s), guard = isNasGuard(s), managed = !!s.managed_source;
        return `
        <div style="border:1px solid var(--color-border);border-radius:8px;margin-bottom:.85rem">
          <div style="display:flex;align-items:center;gap:.5rem;padding:.6rem .85rem;border-bottom:1px solid var(--color-border)">
            <strong>@${esc(s.name)}</strong>
            <span class="badge b-chain">${esc(s.kind)}</span>
            <span class="badge b-chain">${esc(s.family)}</span>
            ${s.auto_ban ? '<span class="badge b-drop">auto-ban</span>' : ''}
            ${cc ? `<span class="badge b-drop" title="Auto-managed country block">${flagEmoji(cc)} ${esc(COUNTRY_NAME[cc] || cc)} · block</span>` : ''}
            ${ca ? `<span class="badge b-accept" title="Auto-managed allow-only (block all except this country)">${flagEmoji(ca)} ${esc(COUNTRY_NAME[ca] || ca)} · allow-only</span>` : ''}
            ${guard ? '<span class="badge b-accept" title="Anti-lockout: known NAS clients kept reachable">🛡 NAS guard · auto-managed</span>' : ''}
            <span class="spacer"></span>
            <span class="muted" style="font-size:.74rem">${s.entries.length} entries</span>
            ${cc
              ? `<button class="btn btn-secondary btn-sm refresh-cc" data-cc="${esc(cc)}">Refresh</button>
                 <button class="btn btn-danger btn-sm remove-cc" data-cc="${esc(cc)}">Remove block</button>`
              : ca
              ? `<button class="btn btn-secondary btn-sm refresh-ca" data-cc="${esc(ca)}">Refresh</button>
                 <button class="btn btn-danger btn-sm remove-ca" data-cc="${esc(ca)}">Remove allow-only</button>`
              : guard
              ? '<span class="muted" style="font-size:.72rem">rebuilt automatically with allow-only</span>'
              : `<button class="btn btn-secondary btn-sm add-el" data-id="${s.id}" data-block="${(s.kind === 'block' || s.auto_ban) ? '1' : ''}">+ Add IP</button>
                 <button class="btn btn-danger btn-sm del-set" data-id="${s.id}">Delete set</button>`}
          </div>
          <div style="padding:.5rem .85rem;display:flex;flex-wrap:wrap;gap:.4rem">
            ${s.entries.length ? s.entries.slice(0, 300).map((e) => `
              <span class="badge b-chain" style="text-transform:none;font-family:monospace;padding:.2rem .5rem">
                ${esc(e.element)}${e.expires_at ? ' ⏱' : ''}
                ${managed ? '' : `<span class="del-el" data-set="${s.id}" data-id="${e.id}" style="cursor:pointer;margin-left:.35rem;color:var(--color-danger)">✕</span>`}
              </span>`).join('') : '<span class="muted" style="font-size:.76rem">empty</span>'}
            ${s.entries.length > 300 ? `<span class="muted" style="font-size:.74rem">…and ${s.entries.length - 300} more</span>` : ''}
          </div>
        </div>`; }).join('') : emptyStateHTML({ title: 'No sets yet', message: 'Create a block or allow set to group IPs and auto-generate a rule.' })}`;
    p.querySelector('#add-set').addEventListener('click', () => this._addSet());
    p.querySelector('#block-country').addEventListener('click', () => this._blockCountry());
    p.querySelector('#allow-only-country').addEventListener('click', () => this._allowOnlyCountry());
    p.querySelectorAll('.refresh-cc').forEach((b) => b.addEventListener('click', () => this._blockCountry(b.dataset.cc, true)));
    p.querySelectorAll('.remove-cc').forEach((b) => b.addEventListener('click', () => this._removeCountry(b.dataset.cc)));
    p.querySelectorAll('.refresh-ca').forEach((b) => b.addEventListener('click', () => this._allowOnlyCountry(b.dataset.cc, true)));
    p.querySelectorAll('.remove-ca').forEach((b) => b.addEventListener('click', () => this._removeAllowOnly(b.dataset.cc)));
    p.querySelectorAll('.del-set').forEach((b) => b.addEventListener('click', () => this._deleteSet(+b.dataset.id)));
    p.querySelectorAll('.add-el').forEach((b) => b.addEventListener('click', () => this._addElement(+b.dataset.id, !!b.dataset.block)));
    p.querySelectorAll('.del-el').forEach((b) => b.addEventListener('click', () => this._deleteElement(+b.dataset.set, +b.dataset.id)));
  }

  _activityHTML(events) {
    const now = Date.now();
    const statusOf = (e) => {
      if (e.override_at) return { cls: 'b-accept', text: `overridden by ${esc(e.override_by || 'operator')}` };
      if (e.ban_seconds && e.created_at &&
          new Date(e.created_at).getTime() + e.ban_seconds * 1000 < now) {
        return { cls: 'b-chain', text: 'expired' };
      }
      return { cls: 'b-drop', text: 'active' };
    };
    const rows = (events || []).map((e) => {
      const st = statusOf(e);
      const ttl = e.ban_seconds ? `${Math.round(e.ban_seconds / 60)}m ban` : 'permanent';
      return `<tr>
        <td style="font-family:monospace">${esc(e.element)}</td>
        <td>${esc(e.reason || e.source)}</td>
        <td>@${esc(e.set_name)} · <span class="muted">${ttl}</span></td>
        <td class="muted" title="${esc(e.created_at || '')}">${relTime(e.created_at)}</td>
        <td><span class="badge ${st.cls}" style="text-transform:none">${st.text}</span></td>
      </tr>`;
    }).join('');
    return `
      <div style="border:1px solid var(--color-border);border-radius:8px;margin-bottom:1rem">
        <div style="display:flex;align-items:center;gap:.5rem;padding:.55rem .85rem;border-bottom:1px solid var(--color-border)">
          <strong>🛡 Auto-block activity</strong>
          <span class="muted" style="font-size:.74rem">Automatic blocks from adaptive access control. Remove an IP below to override a false positive.</span>
        </div>
        ${(events && events.length) ? `<table><thead><tr>
            <th>Source</th><th>Reason</th><th>Set</th><th>When</th><th>Status</th>
          </tr></thead><tbody>${rows}</tbody></table>`
          : '<div style="padding:.7rem .85rem" class="muted">No automatic blocks yet — brute-force protection records them here as they happen.</div>'}
      </div>`;
  }

  async _blockCountry(cc, isRefresh) {
    const sr = this.shadowRoot;
    let code = cc;
    if (!code) {
      code = (sr.getElementById('cc-select')?.value || '').trim().toUpperCase();
      if (!/^[A-Za-z]{2}$/.test(code)) { toast('Choose a country to block', 'error'); return; }
    }
    if (isRefresh) {
      if (!(await confirmDialog(`Refresh the ${code} country block from the source?`, { title: 'Refresh country block' }))) return;
    } else if (!(await this._confirmLockout({ country_code: code }, `block ${COUNTRY_NAME[code] || code}`))) {
      return;
    }
    try {
      const r = await api.post('/firewall/country-block', { country_code: code });
      toast(`Blocked ${r.country}: ${r.count} networks. ${r.hint}`, 'success');
      this._renderPanel(); this._refreshStatus();
    } catch (err) { toast(err.message ?? 'Country block failed', 'error'); }
  }

  // Self-lockout guard: before a block takes effect, ask the server which admin
  // IPs it would cover (own IP + IPs that have accessed the app), and make the
  // operator confirm. Blocks can be whole networks, so the check is by CIDR
  // containment server-side. A preflight failure never blocks a real action.
  async _confirmLockout(payload, actionLabel) {
    let res;
    try { res = await api.post('/firewall/block-preflight', payload); }
    catch { return true; }
    const covered = (res && res.covered) || [];
    const nas = (res && res.nas) || [];
    if (!covered.length && !nas.length) return true;

    const sections = [];
    if (covered.length) {
      const mine = covered.find((c) => c.current);
      const others = covered.filter((c) => !c.current);
      const lines = [];
      if (mine) lines.push(`• ${mine.ip}  ← your current IP`);
      others.slice(0, 5).forEach((c) => lines.push(`• ${c.ip}${c.last_seen ? `  (last accessed ${relTime(c.last_seen)})` : ''}`));
      if (others.length > 5) lines.push(`• …and ${others.length - 5} more`);
      const n = covered.length;
      sections.push(`It covers ${n} IP address${n > 1 ? 'es' : ''} that ${n > 1 ? 'have' : 'has'} accessed MonsterOps — you could lock yourself (or another admin) out:\n${lines.join('\n')}`);
    }
    if (nas.length) {
      const lines = nas.slice(0, 5).map((d) => `• ${d.ip}${d.shortname && d.shortname !== d.ip ? ` (${d.shortname})` : ''}`);
      if (nas.length > 5) lines.push(`• …and ${nas.length - 5} more`);
      sections.push(`It covers ${nas.length} configured NAS ${nas.length > 1 ? 'devices' : 'device'} — their RADIUS auth/accounting will be dropped by the firewall:\n${lines.join('\n')}`);
    }

    const title = covered.length ? '⚠ Possible self-lockout' : '⚠ This blocks a NAS device';
    const msg = `You're about to ${actionLabel}.\n\n${sections.join('\n\n')}\n\nContinue anyway?`;
    return await confirmDialog(msg, { title, danger: true, okLabel: 'Block anyway' });
  }

  async _removeCountry(cc) {
    if (!(await confirmDialog(`Remove the ${cc} country block?`, { title: 'Remove country block', danger: true }))) return;
    try { await api.delete(`/firewall/country-block/${cc}`); toast(`Removed ${cc} block`, 'info'); this._renderPanel(); this._refreshStatus(); }
    catch (err) { toast(err.message ?? 'Remove failed', 'error'); }
  }

  async _allowOnlyCountry(cc, isRefresh) {
    const sr = this.shadowRoot;
    let code = cc;
    if (!code) {
      code = (sr.getElementById('ca-select')?.value || '').trim().toUpperCase();
      if (!/^[A-Za-z]{2}$/.test(code)) { toast('Choose a country to allow', 'error'); return; }
    }
    const name = COUNTRY_NAME[code] || code;
    const msg = isRefresh
      ? `Refresh the ${name} allow-only ranges from the source?`
      : `Block every country except ${name}? This sets the input policy to DROP. Management ports, your admin IP, established connections and known NAS clients stay reachable, and Apply arms a 60s auto-rollback. It takes effect only when you Apply.`;
    if (!(await confirmDialog(msg, { title: isRefresh ? 'Refresh allow-only' : 'Allow only this country', danger: !isRefresh }))) return;
    try {
      const r = await api.post('/firewall/country-allow-only', { country_code: code });
      toast(`Allow-only ${r.country}: ${r.count} networks, ${r.nas_guard.count} NAS guarded. ${r.hint}`, 'success');
      this._renderPanel(); this._refreshStatus();
    } catch (err) { toast(err.message ?? 'Allow-only failed', 'error'); }
  }

  async _removeAllowOnly(cc) {
    if (!(await confirmDialog(`Remove the ${cc} allow-only block? This returns the input policy to accept (open) when it's the last allow-only country.`, { title: 'Remove allow-only', danger: true }))) return;
    try { await api.delete(`/firewall/country-allow-only/${cc}`); toast(`Removed ${cc} allow-only`, 'info'); this._renderPanel(); this._refreshStatus(); }
    catch (err) { toast(err.message ?? 'Remove failed', 'error'); }
  }

  async _addSet() {
    const name = prompt('Set name (lowercase letters, digits, underscore):');
    if (!name) return;
    const kind = (prompt('Kind: block / allow / generic', 'block') || 'block').trim();
    try { await api.post('/firewall/sets', { name, kind, family: 'ipv4_addr', auto_ban: kind === 'block' }); this._renderPanel(); this._refreshStatus(); }
    catch (err) { toast(err.message ?? 'Create failed', 'error'); }
  }
  async _deleteSet(id) { if (!(await confirmDialog('Delete this set and all its entries?', { title: 'Delete set', danger: true }))) return; await api.delete(`/firewall/sets/${id}`); this._renderPanel(); this._refreshStatus(); }
  async _addElement(setId, isBlock) {
    const el = (prompt('IP or CIDR to add:') || '').trim();
    if (!el) return;
    if (isBlock && !(await this._confirmLockout({ elements: [el] }, `block ${el}`))) return;
    try { const r = await api.post(`/firewall/sets/${setId}/entries`, { element: el }); if (r.live_error) toast('Saved; live insert deferred: ' + r.live_error, 'info'); this._renderPanel(); this._refreshStatus(); }
    catch (err) { toast(err.message ?? 'Add failed', 'error'); }
  }
  async _deleteElement(setId, id) { await api.delete(`/firewall/sets/${setId}/entries/${id}`); this._renderPanel(); this._refreshStatus(); }

  // ── Preview & Apply ────────────────────────────────────────────────────────
  async _renderApply(p) {
    p.innerHTML = skeletonBlock(this.shadowRoot, 6);
    let pv, snaps;
    try {
      [pv, snaps] = await Promise.all([api.get('/firewall/preview'), api.get('/firewall/snapshots')]);
    } catch (err) {
      p.innerHTML = emptyStateHTML({
        title: 'Couldn’t generate preview',
        message: err.message || 'Something went wrong. Try again.',
      });
      return;
    }
    const diffHtml = pv.diff ? pv.diff.split('\n').map((l) => {
      let c = ''; if (l.startsWith('+') && !l.startsWith('+++')) c = 'diff-add';
      else if (l.startsWith('-') && !l.startsWith('---')) c = 'diff-del';
      else if (l.startsWith('@@')) c = 'diff-hunk';
      return `<div class="${c}">${esc(l) || '&nbsp;'}</div>`;
    }).join('') : '<span class="muted">No differences vs the active ruleset.</span>';

    p.innerHTML = `
      <div class="btn-row">
        <button class="btn btn-primary" id="apply-btn" ${pv.valid ? '' : 'disabled'}>Apply firewall</button>
        <button class="btn btn-danger" id="rollback-btn">Roll back to last snapshot</button>
        <span class="spacer"></span>
        ${pv.valid ? '<span style="color:#22c55e;font-size:.78rem">✓ ruleset valid (nft -c)</span>'
                   : `<span class="warn">✗ ${esc(pv.error)}</span>`}
      </div>
      <p class="muted" style="font-size:.76rem;margin-bottom:1rem">On apply, MonsterOps snapshots the current table, applies the new one, then
        <strong>auto-rolls-back in ${this._config?.confirm_timeout ?? 60}s</strong> unless you confirm — so a mistake can never lock you out.</p>

      <div class="grid" style="grid-template-columns:1fr 1fr;gap:1rem">
        <div><label>Proposed <code>.nft</code></label><div class="code">${esc(pv.ruleset)}</div></div>
        <div><label>Diff vs active</label><div class="code">${diffHtml}</div></div>
      </div>

      <h3 style="font-size:.9rem;margin:1.25rem 0 .5rem">Snapshots</h3>
      <table><thead><tr><th>When</th><th>Note</th><th>By</th><th>Size</th></tr></thead><tbody>
        ${snaps.length ? snaps.map((s) => `<tr><td class="muted" style="font-size:.76rem">${s.created_at ? new Date(s.created_at).toLocaleString() : '—'}</td><td>${esc(s.note ?? '')}</td><td class="muted">${esc(s.actor ?? '')}</td><td class="muted">${s.size} B</td></tr>`).join('') : emptyRowHTML(4, { title: 'No snapshots yet', message: 'Applying the ruleset saves a snapshot you can roll back to.' })}
      </tbody></table>`;
    p.querySelector('#apply-btn').addEventListener('click', () => this._apply());
    p.querySelector('#rollback-btn').addEventListener('click', () => this._rollback());
  }

  async _apply() {
    if (!(await confirmDialog('Apply the firewall ruleset now? It will auto-roll-back unless you confirm within the timeout.', { title: 'Apply ruleset' }))) return;
    try {
      const r = await api.post('/firewall/apply', {});
      this._startConfirm(r.token, r.confirm_timeout);
      this._refreshStatus();
    } catch (err) { toast(err.message ?? 'Apply failed', 'error'); }
  }

  _startConfirm(token, seconds) {
    this._pendingToken = token;
    let left = seconds;
    const slot = this.shadowRoot.getElementById('confirm-slot');
    const render = () => {
      slot.innerHTML = `<div class="confirm-banner">
        <div class="msg"><strong>Firewall applied.</strong> Confirm it still works, or it rolls back automatically.</div>
        <span class="cd">${left}s</span>
        <button class="btn btn-primary btn-sm" id="confirm-btn">Keep it</button>
        <button class="btn btn-secondary btn-sm" id="rollback-now">Roll back now</button>
      </div>`;
      slot.querySelector('#confirm-btn').addEventListener('click', () => this._confirm());
      slot.querySelector('#rollback-now').addEventListener('click', () => this._rollback());
    };
    render();
    if (this._countdown) clearInterval(this._countdown);
    this._countdown = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(this._countdown); this._countdown = null; this._pendingToken = null;
        slot.innerHTML = '';
        toast('Not confirmed — firewall auto-rolled back', 'info');
        this._load();
      } else { render(); }
    }, 1000);
  }

  async _confirm() {
    try {
      await api.post('/firewall/confirm', { token: this._pendingToken });
      clearInterval(this._countdown); this._countdown = null; this._pendingToken = null;
      this.shadowRoot.getElementById('confirm-slot').innerHTML = '';
      toast('Firewall confirmed and kept', 'success');
      this._refreshStatus();
    } catch (err) { toast(err.message ?? 'Confirm failed', 'error'); }
  }

  async _rollback() {
    if (!(await confirmDialog('Roll back to the last snapshot?', { title: 'Roll back' }))) return;
    try {
      await api.post('/firewall/rollback', {});
      if (this._countdown) { clearInterval(this._countdown); this._countdown = null; }
      this._pendingToken = null;
      this.shadowRoot.getElementById('confirm-slot').innerHTML = '';
      toast('Rolled back', 'success');
      this._load();
    } catch (err) { toast(err.message ?? 'Rollback failed', 'error'); }
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  _renderSettings(p) {
    const c = this._config;
    p.innerHTML = `
      <div class="grid" style="max-width:640px">
        <div class="field"><label>Input chain policy</label><select id="c-in"><option value="drop"${c.default_input_policy === 'drop' ? ' selected' : ''}>drop (deny by default)</option><option value="accept"${c.default_input_policy === 'accept' ? ' selected' : ''}>accept (allow by default)</option></select></div>
        <div class="field"><label>Forward chain policy</label><select id="c-fwd"><option value="drop"${c.default_forward_policy === 'drop' ? ' selected' : ''}>drop</option><option value="accept"${c.default_forward_policy === 'accept' ? ' selected' : ''}>accept</option></select></div>
        <div class="field"><label>SSH guard port (never locked out)</label><input id="c-ssh" type="number" value="${c.ssh_guard_port}"/></div>
        <div class="field"><label>Web UI guard port</label><input id="c-web" type="number" value="${c.web_guard_port}"/></div>
        <div class="field"><label>Auto-rollback timeout (s)</label><input id="c-timeout" type="number" min="10" max="600" value="${c.confirm_timeout}"/></div>
        <div class="field"><label>Allow ping (ICMP)</label><select id="c-ping"><option value="true"${c.allow_ping ? ' selected' : ''}>Yes</option><option value="false"${!c.allow_ping ? ' selected' : ''}>No</option></select></div>
      </div>
      <p class="muted" style="font-size:.76rem;margin-top:.75rem">With <strong>input policy = drop</strong>, MonsterOps always injects guard rules first (loopback, established/related, the SSH &amp; web ports above, and your current admin IP) so you can't lock yourself out.</p>

      <h3 style="font-size:.92rem;margin:1.5rem 0 .35rem">Brute-force auto-block</h3>
      <p class="muted" style="font-size:.76rem;margin-bottom:.85rem;max-width:640px">When a single source IP racks up repeated <strong>Access-Reject</strong> authentications, MonsterOps adds it to the auto-ban blocklist. The source is the RADIUS <code>Calling-Station-Id</code>; entries that aren't an IP (e.g. MAC addresses) are skipped. Bans expire on their own after the duration below.</p>
      <div class="grid" style="max-width:640px">
        <div class="field"><label>Auto-block</label><select id="c-ab-enabled"><option value="true"${c.autoblock_enabled ? ' selected' : ''}>On</option><option value="false"${!c.autoblock_enabled ? ' selected' : ''}>Off</option></select></div>
        <div class="field"><label>Reject threshold (bans at N)</label><input id="c-ab-threshold" type="number" min="2" max="10000" value="${c.autoblock_threshold ?? 10}"/></div>
        <div class="field"><label>Window (minutes)</label><input id="c-ab-window" type="number" min="1" max="1440" value="${c.autoblock_window ?? 10}"/></div>
        <div class="field"><label>Ban duration (seconds, 0 = permanent)</label><input id="c-ab-ban" type="number" min="0" max="604800" value="${c.autoblock_ban_seconds ?? 3600}"/></div>
      </div>

      <div class="btn-row" style="margin-top:1.25rem"><button class="btn btn-primary btn-sm" id="save-cfg">Save settings</button></div>`;
    p.querySelector('#save-cfg').addEventListener('click', () => this._saveConfig());
  }

  async _saveConfig() {
    const sr = this.shadowRoot;
    const body = {
      managed: this._config.managed,
      default_input_policy: sr.getElementById('c-in').value,
      default_forward_policy: sr.getElementById('c-fwd').value,
      allow_ping: sr.getElementById('c-ping').value === 'true',
      ssh_guard_port: +sr.getElementById('c-ssh').value,
      web_guard_port: +sr.getElementById('c-web').value,
      confirm_timeout: +sr.getElementById('c-timeout').value,
      autoblock_enabled: sr.getElementById('c-ab-enabled').value === 'true',
      autoblock_threshold: +sr.getElementById('c-ab-threshold').value,
      autoblock_window: +sr.getElementById('c-ab-window').value,
      autoblock_ban_seconds: +sr.getElementById('c-ab-ban').value,
    };
    try { this._config = await api.put('/firewall/config', body); toast('Settings saved', 'success'); this._refreshStatus(); }
    catch (err) { toast(err.message ?? 'Save failed', 'error'); }
  }

  async _refreshStatus() {
    try { this._status = await api.get('/firewall/status'); this._renderStatus(); } catch (_) {}
  }
}

customElements.define('firewall-view', FirewallView);
router.register('/firewall', () => document.createElement('firewall-view'));

export default { tag: 'firewall-view', title: 'Firewall' };
