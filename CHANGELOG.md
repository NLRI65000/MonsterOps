# Changelog

## Unreleased

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
