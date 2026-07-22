<p align="center">
  <img src="https://raw.githubusercontent.com/NLRI65000/MonsterOps/main/assets/MonsterOpsDO.png" alt="MonsterOps — Monitor. Manage. Automate." width="460" />
</p>

# MonsterOps

**MonsterOps** is a self-hosted network operations platform for ISPs, enterprise networks, and anyone running a FreeRADIUS environment — RADIUS users & groups, NAS devices, IP pools, sessions & accounting, auth analytics, RADIUS proxy/realms, VPN tunnels, a safe nftables firewall manager, automation, and a REST API, all in one dashboard.

Built with **FastAPI + PostgreSQL** and a **vanilla-JS Web Components** frontend — a single Python package, no Node.js, no build step.

## Highlights

- **RADIUS users & groups** — full `radcheck`/`radreply`/`radusergroup` CRUD, bulk CSV, per-user session & auth history
- **NAS management** — vendor presets and NAS groups, ICMP reachability monitoring, plus an SSH/Telnet **NAS Manager** (pull, version, diff, and push config; one-click "point a NAS at RADIUS" deploy; encrypted credentials)
- **Firewall manager** — a dedicated nftables table with staged apply, snapshot + auto-rollback, and adaptive access control (brute-force / country blocking) built to keep you from locking yourself out
- **TACACS+ device administration** — be the AAA server your routers and switches log into: authenticate engineers (local or AD-delegated), authorize their commands with ordered policies, and account every command — a separate, opt-in, pure-Python service, with one-click NAS enrollment and vendor `aaa` snippets
- **Sessions & analytics** — live sessions with CoA disconnect, accounting history, and auth logs with geo-location + anomaly detection
- **And more** — RADIUS proxy & realms, WireGuard / L2TP-IPsec VPN tunnels, automation & scheduling, webhooks, a scoped REST API, and integrations (Zabbix, Graylog, GeoIP2)

See the full capability list in the **[Reference](docs/reference.md)**.

## Get Started

Requires **Python 3.11+** and a reachable **PostgreSQL 15+** database (the same one FreeRADIUS uses).

### Production (recommended)

```bash
git clone https://github.com/NLRI65000/MonsterOps.git
cd MonsterOps
sudo bash deploy/install.sh
```

The installer sets up the service user, database, FreeRADIUS SQL integration, a systemd unit, and optional tooling (VPN backends, nftables, sudoers rules). Re-run `deploy/upgrade.sh` to update an existing install in place.

### From PyPI

```bash
pip install monsterops
export MONSTEROPS_DATABASE_URL=postgresql+asyncpg://user:pass@localhost/radius
export MONSTEROPS_SECRET_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(32))")
monsterops migrate            # create/upgrade the database schema
monsterops serve --host 0.0.0.0 --port 8000
```

The migrations ship inside the package, so `monsterops migrate` works without a source checkout. (You can also put the settings in a `.env` file in the working directory instead of exporting them.)

### From source (manual)

```bash
git clone https://github.com/NLRI65000/MonsterOps.git
cd MonsterOps
pip install -e .
cp .env.example .env          # set MONSTEROPS_DATABASE_URL and MONSTEROPS_SECRET_KEY
monsterops migrate            # or, from a checkout: alembic upgrade head
monsterops serve --host 0.0.0.0 --port 8000
```

Then open `http://localhost:8000` and complete the first-run wizard to create your superadmin account.

> **Before production:** change `MONSTEROPS_SECRET_KEY` from its default (the app warns until you do) and serve over HTTPS. See the [User Guide](docs/user-guide.md).

## Documentation

- **[User Guide](docs/user-guide.md)** — install, configure, navigate the UI, core features (including firewall safety), and finding logs
- **[Reference](docs/reference.md)** — full feature list, configuration variables, roles, CLI, architecture, plugins, tech stack, and roadmap

## Security

Found a security vulnerability? **Please don't open a public issue.** Report it privately by email to **nlrigithub@hotmail.com** — see [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
