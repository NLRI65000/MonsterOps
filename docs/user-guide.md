# MonsterOps — User Guide

A practical reference for installing MonsterOps, navigating the interface, and finding the right logs when something goes wrong.

---

## Table of Contents

1. [Requirements](#1-requirements)
2. [Installation](#2-installation)
3. [First-time Setup](#3-first-time-setup)
4. [Upgrading](#4-upgrading)
5. [Environment Variables](#5-environment-variables)
6. [Navigating the UI](#6-navigating-the-ui)
7. [Core Features](#7-core-features)
8. [Finding Logs](#8-finding-logs)
9. [Opening an Issue](#9-opening-an-issue)

---

## 1. Requirements

### Operating System

| Distribution | Versions tested |
|---|---|
| Ubuntu | 22.04 LTS, 24.04 LTS |
| Debian | 12 (Bookworm) |

Other Debian-based distros will likely work. RPM-based systems (RHEL, Rocky, AlmaLinux) are not tested.

### Software prerequisites

| Component | Minimum version | Notes |
|---|---|---|
| Python | 3.11 | Must be available as `python3` |
| PostgreSQL | 15 | Can be on the same host or remote |
| FreeRADIUS | 3.0 | Must be configured to use `rlm_sql` |
| Git | any | For cloning the repository |

**FreeRADIUS SQL module** must be enabled and pointing at the same PostgreSQL database. The installer handles this if you run `deploy/install.sh` on the FreeRADIUS host.

### Optional — VPN tunnel management

Required only if you want to use the **VPN** module to create WireGuard or L2TP/IPsec tunnels:

| Package | For |
|---|---|
| `wireguard-tools` | WireGuard tunnels (`wg`, `wg-quick`) |
| `strongswan` | L2TP/IPsec tunnels (IKEv1/PSK) |
| `xl2tpd` | L2TP daemon |
| `ppp` | PPP/CHAP authentication |
| `acl` | ACL-based write permissions to config dirs |

The production installer (`deploy/install.sh`) installs these automatically. If you are running a development setup you can omit them — tunnels can still be *defined* in the UI; you will see a "tooling not installed" banner when trying to bring one up.

### Optional — Firewall management

Required only if you want to use the **Firewall** module:

| Package | For |
|---|---|
| `nftables` | Applies the managed ruleset (`nft`); on modern Debian/Ubuntu it is usually preinstalled |

The installer adds a minimal `nft` sudoers allow-list and a `monsterops-firewall.service` boot-restore unit. The allow-list grants passwordless sudo for **only** the exact nftables commands the module issues, each scoped to `table inet monsterops` — there is no blanket `nft *`, so the service user can never flush the ruleset or touch your other tables. Without `nft` installed the Firewall page still lets you build and preview rules; you will see an "nftables not installed" banner instead of being able to apply them. The module only ever manages its own `table inet monsterops` — your other nftables tables are never touched.

#### Locked out? Last-resort recovery

The Firewall applies with a snapshot and a 60-second commit-confirm auto-rollback, and aggressive modes like **country allow-only** keep SSH, the web UI, your admin IP, established connections and known NAS clients reachable. If you still end up locked out of the web UI, recover from the host's console or an SSH session as root:

```sh
sudo /opt/monsterops/scripts/mr-firewall-panic.sh
# …or, equivalently, the one-liner it runs:
sudo nft delete table inet monsterops
```

It removes **only** `table inet monsterops` and its boot-restore file, immediately restoring connectivity without touching any other nftables table. MonsterOps input filtering then stays off until you Apply again from the UI — fix the offending rule or allow-only setting first. (Adjust the path to wherever you cloned MonsterOps; set `MONSTEROPS_FIREWALL_RULESET_PATH` if you moved the boot file.)

---

## 2. Installation

### Production (recommended)

Run the installer as root on a fresh Ubuntu or Debian host:

```bash
git clone https://github.com/NLRI65000/MonsterOps.git
cd MonsterOps
sudo bash deploy/install.sh
```

The installer will:

1. Install system packages (`python3`, `python3-pip`, `python3-venv`, `acl`, `postgresql`, FreeRADIUS VPN tools)
2. Create a dedicated system user `monsterops`
3. Create and initialise the PostgreSQL database
4. Set up a Python virtual environment in `/opt/monsterops/.venv`
5. Install the `monsterops` package
6. Generate a `.env` file at `/opt/monsterops/.env` with a random `SECRET_KEY`
7. Run Alembic migrations (`alembic upgrade head`)
8. Provision the sudoers allow-list (`deploy/provision-sudoers.sh`) and VPN tooling (`deploy/provision-vpn.sh`)
9. Write and enable a systemd service unit (`monsterops.service`)

After it completes, the service is running and accessible on port **8000**.

You can customise any of these defaults with environment variables before running the installer:

```bash
MONSTEROPS_PORT=9000 INSTALL_DIR=/srv/monsterops sudo bash deploy/install.sh
```

### Development

```bash
git clone https://github.com/NLRI65000/MonsterOps.git
cd MonsterOps

python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

cp .env.example .env
# Edit .env — set MONSTEROPS_DATABASE_URL and MONSTEROPS_SECRET_KEY

alembic upgrade head

# Run with auto-reload
bash dev.sh
# or directly:
monsterops serve --host 0.0.0.0 --port 8000
```

### Docker Compose

```bash
cp .env.example .env
# Edit .env as needed

docker compose up -d
```

The `docker-compose.yml` starts PostgreSQL and the MonsterOps app. It does **not** start FreeRADIUS — you are expected to point FreeRADIUS at the same database from the host.

---

## 3. First-time Setup

1. Open `http://<server-ip>:8000` in a browser.
2. You will be redirected to the **Setup** page automatically (only shown on first run, when no admin users exist).
3. Enter a username and password for your **superadmin** account.
4. Submit — you are logged in and taken to the Dashboard.

> **Note:** The setup page is only accessible when the database has zero admin users. After setup it is permanently disabled.

### Connecting FreeRADIUS

MonsterOps reads and writes the standard FreeRADIUS SQL schema tables (`radcheck`, `radreply`, `radusergroup`, `radpostauth`, `radacct`, `radippool`, `nas`). It does **not** manage the FreeRADIUS config files directly (except `proxy.conf` when using the Realms module).

If FreeRADIUS is on the same host, the installer configures the SQL module automatically. If it is on a separate host, point its `rlm_sql` at the same PostgreSQL database that MonsterOps uses.

### GeoIP (optional)

The auth log and session views can show flag + city for client IPs. To enable this:

1. Go to **Integrations** → **Data Sources** → **MaxMind GeoIP2**.
2. Follow the link to create a free MaxMind account and download `GeoLite2-City.mmdb`.
3. Upload the file through the guided modal — MonsterOps validates it and hot-reloads the reader without a restart.

---

## 4. Upgrading

```bash
cd MonsterOps
git pull

sudo bash deploy/upgrade.sh
```

The upgrade script:

1. Stops the running service
2. Installs the updated package into the existing virtual environment
3. Re-provisions VPN tooling (idempotent — safe to run again)
4. Runs any pending Alembic migrations
5. Restarts the service

> **Rollback:** the upgrade script does not yet implement automatic rollback. Take a `pg_dump` backup before upgrading a production instance (or use **System → Database Backup** from the UI).

---

## 5. Environment Variables

All variables use the prefix `MONSTEROPS_`. Set them in `/opt/monsterops/.env` (production) or `.env` in the project root (development). The full set of supported variables is in `.env.example`.

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONSTEROPS_DATABASE_URL` | Yes | — | Async SQLAlchemy URL: `postgresql+asyncpg://user:pass@host/dbname` |
| `MONSTEROPS_SECRET_KEY` | Yes | `change-me-before-production` | JWT signing key — **must be changed before exposing to a network** |
| `MONSTEROPS_DEBUG` | No | `false` | Enables OpenAPI docs at `/api/docs` and verbose logging |
| `MONSTEROPS_ALLOWED_ORIGINS` | No | `""` | Comma-separated CORS origins (leave empty to disable CORS) |
| `MONSTEROPS_MODULE_LIST` | No | all modules | Comma-separated list of enabled modules |
| `MONSTEROPS_RADIUS_LOG_FILES` | No | `/var/log/freeradius/radius.log` | Comma-separated FreeRADIUS log file paths shown in Health → Logs |
| `MONSTEROPS_GEOIP_DB` | No | `""` | Path to MaxMind GeoLite2-City `.mmdb` file |
| `MONSTEROPS_VPN_CONFIG_DIR` | No | `/etc/monsterops/vpn` | Directory for WireGuard config files written by the VPN module |
| `MONSTEROPS_CONSOLE_ENABLED` | No | `false` | Show the server console panel (superadmin only) |

Restart the service after changing any variable:

```bash
sudo systemctl restart monsterops
```

---

## 6. Navigating the UI

The sidebar on the left is the main nav. It collapses to rail mode (icons only) using the `←` button at the bottom. The current page is highlighted with a left-border accent. All routes are hash-based (`/#/users`, `/#/nas`, etc.) so the page never does a full reload.

### Sidebar sections

| Nav item | What it does |
|---|---|
| **Dashboard** | Overview widgets: active sessions, auth stats, bandwidth, NAS status, recent auth attempts. Widgets are individually show/hide-able; settings are saved per user account. |
| **Users** | Create, search, edit, enable/disable, expire, and bulk-manage RADIUS users. Click a row to open the user detail panel with Sessions, Auth History, Timeline, and Attributes tabs. |
| **Groups** | Manage RADIUS groups (`radusergroup`/`radgroupcheck`/`radgroupreply`). Assign reply attributes per vendor and link groups to NAS groups for access control. |
| **NAS** | Add and edit NAS clients. Vendor presets auto-fill the type and community fields. NAS Groups tab lets you cluster devices for realm routing and access control. |
| **NAS Manager** | SSH/Telnet into your NAS devices (Netmiko). Pull and store running config, keep version history with scheduled fetch + retention + diff, edit and push config back, run commands from a per-device console, and dispatch to many devices. Credentials are AES-256-GCM encrypted. |
| **IP Pools** | Manage `radippool` allocations. See occupancy per pool, release stuck IPs, add CIDR ranges. |
| **Accounting** | Active sessions (with CoA disconnect) and full session history. |
| **Auth Logs** | `radpostauth` viewer with Accept/Reject filtering, latency, geo, and anomaly banners. |
| **Reports** | Bandwidth, login frequency, top users, failure trends. All exportable to CSV. |
| **Realms** | Home server, pool, and realm CRUD. NAS group → realm routing. Realm health badges. |
| **VPN** | Create and operate WireGuard and L2TP/IPsec tunnels. Bring tunnels up/down, view live handshake and transfer counters, copy public keys. |
| **Firewall** | Manage a dedicated `table inet monsterops` with nftables. Build rules (with RADIUS presets), keep named sets/blocklists, preview the exact `.nft` and a diff vs the live ruleset, then apply with a snapshot + auto-rollback timer so a mistake can't lock you out. Per-rule counters and a `firewall_ban` automation action included. |
| **Notifications** | Configure SMTP and webhook alert rules with thresholds and cooldown periods. |
| **Webhooks** | Outbound webhook subscriptions with HMAC signing and a live SSE event stream tab. |
| **Integrations** | Zabbix, Graylog, and GeoIP2 data source configuration. |
| **Scheduler** | Automated recurring jobs (stale IP sweep, expired user cleanup, scheduled reports). |
| **Automation** | Event-driven rules: "when X happens, do Y." |
| **API Keys** | Issue and manage scoped API keys for external system access. |
| **Health** | FreeRADIUS service controls (reload/restart/start/stop) and live log viewer. |
| **System** | Admin user management, role assignment, application settings, database backup. |

### Server console

Superadmins see a terminal icon in the bottom-left corner (and can press backtick `` ` `` anywhere). This opens a slide-in panel with:

- **App Log** — live-tails the MonsterOps Python process log
- **RADIUS Log** — live-tails FreeRADIUS log files
- **Commands** — reload FreeRADIUS config, restart FreeRADIUS, run pending Alembic migrations

### "What's New" drawer

The `✦` button in the bottom-left opens the changelog drawer, showing release notes parsed from `CHANGELOG.md`.

### Roles

| Role | Capabilities |
|---|---|
| `readonly` | View all data, no writes |
| `admin` | Full CRUD on users, groups, NAS, pools, realms, VPN tunnels; cannot manage admin accounts or activate tunnels |
| `superadmin` | All of the above plus admin user management, database backup, VPN bring-up/down, firewall apply, server console |

---

## 7. Core Features

The sidebar table above lists every module. This section goes deeper on the few that carry the most operational weight — the ones worth understanding *before* you rely on them in production.

### Users, groups & reply attributes

RADIUS users live in `radcheck`/`radreply`; groups in `radgroupcheck`/`radgroupreply`, with membership in `radusergroup`. Put shared reply attributes — rate limits, VLANs, address-pool names — on a **group** and add users to it, rather than repeating attributes on every user. Link **NAS Groups** to RADIUS groups when you need to control *which* devices a given group is allowed to authenticate against.

### NAS entries vs. NAS Manager

These are two different things that are easy to conflate:

- A **NAS** entry (the `nas` table) is what lets a device speak RADIUS to the server: name, IP/subnet, shared secret, vendor. Nothing authenticates without one.
- **NAS Manager** is a separate SSH/Telnet layer that logs into the device to pull, version, diff, and push its running configuration. Its stored credentials are AES-256-GCM encrypted.

You can use either without the other.

### Firewall — read this before you Apply

The Firewall module manages exactly one nftables table, **`table inet monsterops`**, as a **host input filter**. It never reads or writes any other nftables table you may already run. Two things follow from "host input filter" that catch people out:

1. **It filters traffic *to this server*, and that includes RADIUS.** A block drops the matching source in the kernel *before FreeRADIUS ever sees the packet*, and blocks are ordered ahead of the RADIUS-accept rules. So if you block an IP or range that a **NAS** authenticates from, that NAS's authentication **and** accounting simply stop — silently, because the packet never arrives.
2. **A block can lock *you* out.** Blocking the address you administer from, or switching to a deny-by-default posture, can cut off your own SSH and the web UI along with everyone else.

Neither is a reason to avoid the module — they're the reason to use its safeguards, which are built specifically around these two failure modes:

- **Nothing applies until you say so.** Every edit is staged. The page shows the exact `.nft` it will load and a diff against the live ruleset; the rules take effect only when you press **Apply**.
- **Apply is reversible by default.** Apply first snapshots the live ruleset, then arms a **60-second commit-confirm**. If you don't confirm within the window — for instance because the change just cut off your own access and the page can no longer reach the server — it **automatically rolls back** to the snapshot.
- **Anti-lockout guards are always emitted.** Loopback, established/related connections, the SSH and web-UI ports, and your current admin IP are allowed *ahead* of any deny rule. The aggressive modes below also auto-build a **NAS guard set** from your `nas` table so RADIUS keeps flowing.
- **You're warned before a block bites.** Adding to a block set, a one-click country block, or an allow-only switch first runs a preflight that checks the target against your current IP, every IP that has logged into MonsterOps, and every configured NAS — and warns you, with the specific addresses, before proceeding. It's CIDR-aware, so a `/16` or a whole-country range that *contains* one of those addresses is caught, not just an exact match.

**Adaptive access control**, all surfaced in this module:

- **Brute-force auto-block** — after N Access-Rejects from one source within a time window, that source is added to a ban set for a configurable duration. It bans by subscriber (`Calling-Station-Id`), never by a NAS's address.
- **Country block** — one click adds a country's IP ranges to a managed block set.
- **Country allow-only (inverse block)** — "allow only this country, deny everything else." This flips the input policy to **deny-by-default**, which makes it the single easiest way to lock yourself out — which is exactly why it auto-provisions the NAS guard set and keeps SSH, the web UI, your admin IP and established connections reachable, and why removing it puts the policy back to accept.
- **Blocklist audit trail** — every automatic block is recorded (source, reason, rule, and whether an operator later overrode it) and shown in the Auto-block activity panel and the dashboard widget.

**If you do get locked out**, recover from the host's console or an SSH session — see [§1 → Locked out? Last-resort recovery](#locked-out-last-resort-recovery). The short version: `sudo nft delete table inet monsterops` removes only MonsterOps' table and restores connectivity immediately, without touching anything else.

### VPN tunnels

MonsterOps dials **out** to remote sites over **WireGuard** or **L2TP/IPsec** so it can reach NAS devices that aren't directly routable. Keys are generated and kept on the server (mode 0600) and never leave it. Bringing a tunnel up or down, and viewing live handshake/transfer counters, is a superadmin action.

### Automation & scheduling

**Automation** is event-driven ("when a user is disabled → do X"); **Scheduler** is time-driven (stale-IP sweep, expired-user cleanup, log retention, scheduled reports). Both are safe to start small — a single rule or job — and expand once you trust the behaviour.

---

## 8. Finding Logs

When something breaks, there are three log sources. Include at least one in any bug report.

### 8a. MonsterOps application log

The Python process logs to stdout, captured by journald when running under systemd.

```bash
# Live tail
sudo journalctl -u monsterops -f

# Last 200 lines
sudo journalctl -u monsterops -n 200 --no-pager

# Since a specific time
sudo journalctl -u monsterops --since "2026-07-02 10:00:00" --no-pager
```

In development (`bash dev.sh`), logs go straight to your terminal.

You can also tail the app log from inside the UI: open the **Server Console** (`` ` `` or the terminal icon) and switch to the **App Log** tab.

**Log location on disk (if redirected):**

```
<project-root>/logs/server-YYYYMMDD-HHMMSS.log
```

(Only present when running `dev.sh` which redirects stdout to a dated file.)

### 8b. FreeRADIUS log

```bash
# Default path
sudo tail -f /var/log/freeradius/radius.log

# Or via the UI: Health → Logs → radius.log tab
# Or via the Server Console → RADIUS Log tab
```

Set `MONSTEROPS_RADIUS_LOG_FILES` in `.env` if your FreeRADIUS writes to a different path.

### 8c. PostgreSQL log

```bash
# Ubuntu/Debian default
sudo tail -f /var/log/postgresql/postgresql-*.log

# Or query pg_log via psql
sudo -u postgres psql -c "SELECT pg_current_logfile();"
```

Useful when you see a `500 Internal Server Error` that the app log blames on a database query.

### What to collect for a bug report

Copy the following into your issue:

```
OS:          Ubuntu 24.04 / Debian 12 / …
MonsterOps:  v1.7.1  (git log --oneline -1)
Python:      3.11.x  (python3 --version)
PostgreSQL:  15.x    (psql --version)
FreeRADIUS:  3.0.x   (freeradius -v 2>&1 | head -1)

Steps to reproduce:
1. …
2. …

Expected:
…

Actual:
…

App log snippet (journalctl -u monsterops -n 50 --no-pager):
<paste here>
```

If the issue involves a specific API call, add the HTTP method + path + status code from the log (e.g. `POST /api/users 500`).

---

## 9. Opening an Issue

> **Security issue?** Do **not** open a public issue — report vulnerabilities privately to **nlrigithub@hotmail.com** (see [SECURITY.md](../SECURITY.md)).

1. Go to **https://github.com/NLRI65000/MonsterOps/issues**
2. Click **New issue**
3. Use the template fields: **Steps to reproduce**, **Expected**, **Actual**, and paste the log snippet from [Section 8](#8-finding-logs)
4. Add a label if obvious: `bug`, `enhancement`, `question`, `vpn`, `realms`, etc.

### Before opening

- Search existing issues first — it may already be tracked
- Check whether the issue reproduces on the latest commit (`git pull && sudo bash deploy/upgrade.sh`)
- If the server is returning `500`, always include the app log — the HTTP status alone is not enough to diagnose

### Security vulnerabilities

Do **not** open a public issue for security vulnerabilities. Send details directly to the maintainer at **igorholandafilho@gmail.com** with `[MonsterOps Security]` in the subject line.
