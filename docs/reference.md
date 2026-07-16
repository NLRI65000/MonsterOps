# MonsterOps — Reference

Full feature list, configuration, architecture, and project reference. New here? Start with the [README](../README.md) and the [User Guide](user-guide.md).

## Table of Contents

- [What It Does](#what-it-does)
- [Configuration](#configuration)
- [Roles & Permissions](#roles--permissions)
- [Command-Line Interface](#command-line-interface)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Architecture](#architecture)
- [Plugin System](#plugin-system)
- [Tech Stack](#tech-stack)

---

## What It Does

| Area | Capabilities |
|------|-------------|
| **RADIUS Users & Groups** | Full `radcheck`/`radreply`/`radusergroup` CRUD, bulk CSV import/export, enable/disable, expiration, simultaneous-use, per-user session and auth history |
| **NAS Device Management** | Create/edit NAS entries with vendor presets (Cisco, Huawei, MikroTik), NAS groups, link groups to RADIUS groups for access control, auto-reload FreeRADIUS after changes |
| **NAS Manager (SSH/Telnet)** | Connect to NAS devices via Netmiko (SSH or Telnet); pull and store running config; version history with scheduled fetch, retention and diff; edit and push changes back; per-device SSE command console; multi-NAS command dispatch with audit log; AES-256-GCM credential storage |
| **Firewall Manager (nftables)** | Manage a dedicated `table inet monsterops` (operator tables untouched); rule builder with RADIUS presets; named sets/blocklists with live add/remove; preview `.nft` + diff vs active; safe apply with snapshot + auto-rollback so you can't lock yourself out; per-rule counters; `firewall_ban` automation action |
| **IP Pool Management** | CIDR/range allocation, per-pool usage view, stale IP release, occupancy counters |
| **Session Monitoring** | Live active sessions, accounting history, CoA disconnect and change-of-authorization, bandwidth tracking |
| **Auth Logs & Analytics** | Auth timeline, Accept/Reject filtering, latency tracking, geo-location (MaxMind GeoLite2), anomaly detection (concurrent sessions, unusual hours, multi-NAS roam) |
| **Reports** | Bandwidth, login frequency, top-N users by traffic or sessions, failure trends — all exportable to CSV |
| **RADIUS Proxy & Realms** | Home server + pool + realm CRUD, NAS group → realm routing, `proxy.conf` generation and hot-apply, realm health monitoring via Status-Server probes |
| **VPN Tunnel Management** | Create and operate **WireGuard** and **L2TP/IPsec** tunnels from the UI; host dials out to reach remote NAS sites; live status (handshake, rx/tx); keys never leave the server |
| **Automation & Scheduling** | Event-driven rules engine ("when user disabled → do X"), scheduled jobs (stale IP sweep, expired user cleanup, log retention), `monsterops` CLI for scripting |
| **Webhooks & Event Bus** | Subscribe external systems to any event pattern (`user.*`, `nas.created`, `*`); HMAC-signed payloads; SSE live event stream; Graylog GELF forwarding |
| **External REST API** | Full CRUD at `/api/v1/` with scoped API keys; versioned OpenAPI spec |
| **Integrations** | Zabbix sender, Graylog GELF, MaxMind GeoIP2 (local mmdb, no API calls at query time) |
| **Server Console** | Slide-in panel (superadmin only): live app log, live FreeRADIUS log, command palette (reload FreeRADIUS, run migrations) |
| **Health & Operations** | FreeRADIUS service status and controls, database health, log viewer with live SSE streaming |
| **Security** | Argon2id passwords, JWT with refresh rotation, rate limiting, CSP/HSTS/X-Frame-Options, role-based access (`superadmin`/`admin`/`readonly`), full audit log |

---

## Configuration

All settings are environment variables prefixed `MONSTEROPS_`, read from `.env` or the process environment. Only `DATABASE_URL` and `SECRET_KEY` are required in practice; everything else has a sensible default.

### Core

| Variable | Default | Purpose |
|----------|---------|---------|
| `MONSTEROPS_DATABASE_URL` | `postgresql+asyncpg://radius:radius@localhost/radius` | Async SQLAlchemy DSN — must use the `+asyncpg` driver |
| `MONSTEROPS_SECRET_KEY` | `change-me-before-production` | JWT signing key — **change this** |
| `MONSTEROPS_ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | Access-token lifetime; the refresh cookie rotates a new one silently |
| `MONSTEROPS_COOKIE_SECURE` | _(auto)_ | Force the `Secure` flag on session cookies. Unset = derive from the request scheme (`X-Forwarded-Proto` aware) — `Secure` over HTTPS, off over plain http |
| `MONSTEROPS_DEBUG` | `false` | Enables `/api/docs` and verbose errors — never on in production |
| `MONSTEROPS_LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARNING` / `ERROR` |
| `MONSTEROPS_ALLOWED_ORIGINS` | `""` | Comma-separated CORS origins (empty = CORS disabled) |
| `MONSTEROPS_ENABLED_MODULES` | `""` (all) | Comma-separated allow-list; disabled modules are never imported |
| `MONSTEROPS_PLUGINS` | `""` | Comma-separated third-party plugin entry-point names to load |

### Database pool

| Variable | Default | Purpose |
|----------|---------|---------|
| `MONSTEROPS_DB_POOL_SIZE` | `10` | Steady-state connections |
| `MONSTEROPS_DB_MAX_OVERFLOW` | `20` | Burst connections above pool size |
| `MONSTEROPS_DB_POOL_TIMEOUT` | `30` | Seconds to wait for a free connection |
| `MONSTEROPS_DB_POOL_RECYCLE` | `1800` | Recycle connections older than N seconds (guards against silent drops) |

### Paths & integrations

| Variable | Default | Purpose |
|----------|---------|---------|
| `MONSTEROPS_RADIUS_LOG_FILES` | `/var/log/freeradius/radius.log` | Comma-separated log paths exposed to the log viewer |
| `MONSTEROPS_GEOIP_DB` | `""` | Path to a MaxMind `GeoLite2-City.mmdb` (empty = geolocation off) |
| `MONSTEROPS_BACKUP_DIR` | `/var/backups/monsterops` | Where named DB/config snapshots are stored |
| `MONSTEROPS_FREERADIUS_PROXY_CONF` | `/etc/freeradius/3.0/proxy.conf` | Where Realms writes generated proxy config |
| `MONSTEROPS_VPN_CONFIG_DIR` | `/etc/monsterops/vpn` | Where the VPN module writes `wg-quick` configs (0600) |
| `MONSTEROPS_FIREWALL_RULESET_PATH` | `/etc/monsterops/firewall.nft` | Confirmed ruleset re-applied at boot by the firewall unit |

### Log retention

Applied by the scheduled **Log Retention** job. `0` disables pruning for that table (keep forever).

| Variable | Default (days) | Table |
|----------|----------------|-------|
| `MONSTEROPS_RETENTION_AUTH_LOG_DAYS` | `90` | `radpostauth` |
| `MONSTEROPS_RETENTION_AUDIT_LOG_DAYS` | `365` | `audit_log` |
| `MONSTEROPS_RETENTION_NOTIFICATION_DAYS` | `90` | `mr_notification_history` |
| `MONSTEROPS_RETENTION_DISPATCH_LOG_DAYS` | `180` | `mr_nas_dispatch_log` |

### Email (scheduled reports)

`MONSTEROPS_SMTP_HOST`, `MONSTEROPS_SMTP_PORT` (`587`), `MONSTEROPS_SMTP_USER`, `MONSTEROPS_SMTP_PASSWORD`, `MONSTEROPS_SMTP_FROM`, `MONSTEROPS_SMTP_TLS` (`false`).

> System → Settings renders the current effective config and can generate a starter `.env` for you.

---

## Roles & Permissions

Admin accounts are separate from RADIUS users and come in three roles, enforced server-side on every route (not just hidden in the UI):

| Role | Can do |
|------|--------|
| `superadmin` | Everything, including admin management, System settings, backups, and the Server Console |
| `admin` | Day-to-day operations — users, groups, NAS, sessions, firewall, automation, etc. |
| `readonly` | View-only across all pages; every write endpoint is rejected |

The first-run wizard creates the initial `superadmin`. External API access uses **scoped API keys** (e.g. `users.read`, `nas.write`) independent of admin roles.

### Authentication & sessions

The browser session uses **HttpOnly cookies** — the JWT is never handed to JavaScript or stored in `localStorage`, so an XSS bug can't steal it. A short-lived access cookie is rotated silently by a longer-lived refresh cookie. Because auth rides on a cookie, mutating requests carry a **CSRF token** (a readable `mr_csrf` cookie echoed in the `X-CSRF-Token` header; enforced server-side). Programmatic clients (CLI, API keys, scripts) authenticate with `Authorization: Bearer` and are not subject to CSRF.

> **Serve production over HTTPS.** Session cookies become `Secure` automatically when the request is HTTPS (or a proxy sets `X-Forwarded-Proto: https`). Over plain `http://` they are intentionally not `Secure` so local/LAN access still works — but the token then travels unencrypted, so don't run a production instance on bare `http`.

---

## Command-Line Interface

The `monsterops` CLI talks to the REST API, so it works against any running instance (local or remote). Point it with `--url` / `$MONSTEROPS_URL` and authenticate with `--api-key` / `$MONSTEROPS_API_KEY`.

```bash
# Serve
monsterops serve --host 0.0.0.0 --port 8000

# Users
monsterops users list --search acme --size 100
monsterops users create alice --password 's3cret' --group premium --expiration 2026-12-31
monsterops users disable alice
monsterops users delete alice --yes

# Groups
monsterops groups create premium
monsterops groups add-member premium alice

# NAS devices
monsterops nas list
```

Add `--format json` to any read command for machine-readable output.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl` / `Cmd` + `K` | Focus the sidebar Quick Search (filters navigation; `Enter` opens the first match, `Esc` clears) |
| `` ` `` (backtick) | Toggle the Server Console (superadmin only) |

---

## Architecture

```
monsterops/
├── app.py                  # FastAPI application factory
├── config.py               # Settings (env-based, pydantic-settings)
├── database.py             # Async SQLAlchemy engine + session
├── events.py               # In-process event bus
├── cli.py                  # `monsterops` command-line entry point
├── plugins/                # Plugin loader & registry
│   └── loader.py
├── modules/                # Built-in feature modules (each is a mini FastAPI router)
│   ├── auth/               # Admin auth, JWT, RBAC, audit log
│   ├── dashboard/
│   ├── users/  groups/  nas/  nas_manager/  ip_pools/
│   ├── accounting/  auth_logs/  radius_logs/  reports/
│   ├── realms/             # RADIUS proxy & realm management
│   ├── vpn/                # WireGuard + L2TP/IPsec tunnel management
│   ├── firewall/           # nftables firewall manager (safe apply + rollback)
│   ├── automation/  scheduler/  webhooks/  notifications/  integrations/
│   ├── apikeys/  system/  health/
└── static/                 # Vanilla JS frontend (ES Modules + Web Components)
    ├── index.html
    ├── js/
    │   ├── app.js          # Bootstrap, plugin manifest loading
    │   ├── router.js       # Client-side hash router
    │   ├── api.js          # Typed fetch wrapper (auto token refresh)
    │   └── components/     # Web Components (one file per component)
    └── css/
        └── theme.css       # Design tokens — single source of truth
```

**Module contract:** every module exposes a `router` (FastAPI `APIRouter`), `models.py` (SQLAlchemy), `schemas.py` (Pydantic), and `static/manifest.json` (declares the frontend nav entries and JS bundle).

**Request pipeline:** `Request → Security Headers MW → Auth dependency → Permission dependency → Router → Service → Database`.

Enabling or disabling a module is done via `config.py` / env var. Disabled modules are never imported — their routes and nav entries simply don't exist.

**Design tokens:** `static/css/theme.css` is the single source of truth for the visual language. CSS custom properties inherit through Shadow DOM, so changing a token reskins every Web Component at once.

---

## Plugin System

Third-party plugins are Python packages that follow the same module contract. MonsterOps discovers them via a `monsterops.plugins` entry-point group (PEP 517). On startup, the loader imports each plugin's router, mounts it, fetches its `manifest.json`, and sends it to the frontend. The frontend dynamically loads the plugin's JS bundle and registers its nav entries.

Install a plugin like any Python package, then enable it by its entry-point name (names below are illustrative — no plugins are published yet):

```bash
pip install your-monsterops-plugin

# .env
MONSTEROPS_PLUGINS=your_monsterops_plugin
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI (async), Python 3.11+ |
| ORM | SQLAlchemy 2 (async) + asyncpg |
| Migrations | Alembic |
| Database | PostgreSQL 15+ |
| Auth | PyJWT, Argon2id (argon2-cffi), bcrypt fallback |
| Config | pydantic-settings |
| Frontend | Vanilla JS — ES Modules + Web Components (no build step) |
| Design system | "Console" (v5) — Inter + IBM Plex Mono, Cloudflare-inspired neutral canvas + orange accent |
| Charts | Chart.js (ESM) |
| Geolocation | geoip2 + MaxMind GeoLite2-City (local mmdb) |
| NAS SSH/Telnet | Netmiko (synchronous, run in thread-pool executor) |
| Firewall | nftables (`nft`), shell-free subprocess, `table inet monsterops` only |
| Credential encryption | cryptography — AES-256-GCM (hazmat AESGCM) |
| Scheduling | APScheduler |
| Packaging | pyproject.toml (hatchling) |
