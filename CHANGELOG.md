# Changelog

## Unreleased

## v1.12.2 — 2026-07-20

### Changed

- Project links on PyPI now point at the documentation site: **Homepage** is
  https://monsterops.org, with a new **Documentation** link to
  https://monsterops.org/docs/. The source repository, issue tracker, and
  changelog links are unchanged.

### Fixed

- The banner image now renders on the PyPI project page. It previously used a
  repository-relative path that only resolved on GitHub; it now uses an absolute
  URL, so the logo shows on PyPI as well.

## v1.12.1 — 2026-07-20

### Added

- **`pip install monsterops` now works end to end.** The database migrations ship
  inside the package, and a new `monsterops migrate` command creates or upgrades the
  schema — so you can install from PyPI, run `monsterops migrate`, then
  `monsterops serve` without a source checkout. From a checkout, `alembic upgrade head`
  still works too.

### Changed

- Package description reworded — MonsterOps is a self-hosted network operations
  platform in its own right, not a "GUI to replace daloRADIUS".

### Fixed

- `monsterops.__version__` now reports the installed package version instead of a
  stale hardcoded value.

## v1.12.0 — 2026-07-20

### Added

- **Point a NAS at this RADIUS server in one click.** A new **RADIUS Setup** tab
  in NAS Manager generates the vendor-specific RADIUS-client config for a managed
  device — you tick which services should authenticate (PPP/PPPoE, hotspot, admin
  login, 802.1X), preview the exact commands, then push them over SSH. The running
  config is snapshotted first for rollback. MikroTik (RouterOS v6 and v7) and
  Huawei produce real, pushable config; other vendors get a preview-only reference
  block. The generated MikroTik config also enables CoA/Disconnect so you can drop
  a live session from the UI.
- **Automation can run a command on a NAS.** A new **Run NAS command** rule action
  runs a single CLI command on a managed NAS over SSH when a matching event fires,
  using the credentials NAS Manager already stores. Commands can reference the
  triggering event (`{entity_id}`, `{actor}`, `{type}`, `{data.<key>}`) — for
  example, kicking a user's live session the moment they're disabled.
- **Secret-key rotation.** A new `monsterops rotate-secret-key` command re-encrypts
  every stored credential (NAS Manager SSH secrets and directory bind passwords)
  when you change `MONSTEROPS_SECRET_KEY`, so rotating the key no longer orphans
  them. It is abort-safe and supports a `--dry-run`.
- **Server Console command history.** The console's command palette now keeps a
  "Recent runs" list — each command with its result and a timestamp — that persists
  across page reloads.

### Changed

- **The Server Console is now off by default.** Because its palette restarts
  FreeRADIUS and runs migrations from the browser, it is opt-in: set
  `MONSTEROPS_CONSOLE_ENABLED=true` to enable it. Installs that relied on the
  console will need to set this.

## v1.11.1 — 2026-07-16

### Added

- **NAS reachability monitoring.** A background ICMP probe reports a true
  reachable/unreachable state per NAS on the dashboard, distinct from the existing
  activity-based "idle" — so a quiet device is shown *idle but up*, while one that
  has genuinely dropped off the network is shown *down*. Subnet/wildcard clients
  are marked *skipped*. Configurable via `MONSTEROPS_NAS_PROBE_ENABLED`.

### Fixed

- **Delegated Active Directory logins after wiring the host.** The AD provisioning
  script now restarts FreeRADIUS instead of reloading it, so the newly added
  authentication module is loaded and delegated (live-AD-password) logins succeed.

## v1.11.0 — 2026-07-16

### Added

- **Per-realm authentication with Active Directory.** Authentication is now
  configured per realm as an identity source plus a method: **Local password**
  (MonsterOps owns each subscriber's password; works offline, any protocol) or
  **Directory-delegated** (subscribers sign in with their real Active Directory
  password, verified live against a Domain Controller via winbind/`ntlm_auth`).
  Import all or selected users from AD, map AD groups to MonsterOps groups and
  plans, and see each account's source (its AD realm, or Local) in the Users
  view. Delegated realms show a **host: ready / needs join** indicator with the
  exact one-time setup command. Full walkthrough in the
  [Active Directory guide](docs/active-directory-auth.md).
- **Adaptive firewall access control.** The nftables firewall manager gained
  brute-force auto-blocking with a structured audit trail and a dashboard
  widget; **"allow only this country"** inverse blocking with layered
  anti-lockout guards that keep management (SSH/web) and RADIUS reachable; and
  self-lockout / NAS-impact warnings before a block takes effect, so a
  fat-fingered blocklist entry can't cut off admin access or silently break a
  NAS. A last-resort `scripts/mr-firewall-panic.sh` restores connectivity from
  the shell.

### Changed

- **Faster large-table browsing.** Live sessions, accounting, and auth logs use
  keyset pagination for consistent performance on large datasets.

### Fixed

- **Dashboard:** the header icons (drill-through chevron, refresh, settings
  gear) no longer briefly flash oversized and blue when returning to the
  Dashboard from another page.
- **Sidebar:** collapsing the sidebar to its icon rail now hides labels cleanly
  and keeps the icons centred.

## v1.10.0 — Initial public release

The first public release of MonsterOps — a self-hosted network operations
platform for FreeRADIUS environments. Includes user & group management, NAS
device and NAS SSH/Telnet management, IP pool management, live session
monitoring with CoA, auth logs & analytics, reports, RADIUS proxy & realms,
WireGuard and L2TP/IPsec VPN tunnels, an nftables firewall manager, automation
& scheduling, webhooks & event bus, a scoped REST API, and integrations
(Zabbix, Graylog, MaxMind GeoIP2).
