#!/usr/bin/env bash
# MonsterOps — fresh server installer
# Tested on: Ubuntu 22.04 / 24.04, Debian 12
# Run as root or with sudo.
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
# Not hardcoded credentials: each default GENERATES a fresh random secret at
# install time (overridable via the environment).
RADIUS_DB_PASSWORD="${RADIUS_DB_PASSWORD:-$(openssl rand -hex 24)}" # skipcq: SCT-1000
MONSTEROPS_SECRET_KEY="${MONSTEROPS_SECRET_KEY:-$(openssl rand -hex 32)}" # skipcq: SCT-1000
MONSTEROPS_PORT="${MONSTEROPS_PORT:-8000}"
INSTALL_DIR="${INSTALL_DIR:-/opt/monsterops}"
VENV_DIR="${INSTALL_DIR}/.venv"
MR_USER="${MR_USER:-monsterops}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="/var/backups/monsterops"
VPN_CONFIG_DIR="${VPN_CONFIG_DIR:-/etc/monsterops/vpn}"

TOTAL_STEPS=11
_STEP=0

# ── Colors (disabled when not a TTY) ─────────────────────────────────────────
if [ -t 1 ]; then
  BOLD=$'\033[1m' DIM=$'\033[2m' RESET=$'\033[0m'
  RED=$'\033[1;31m' GREEN=$'\033[1;32m' YELLOW=$'\033[1;33m'
  BLUE=$'\033[0;34m' CYAN=$'\033[0;36m'
else
  BOLD='' DIM='' RESET='' RED='' GREEN='' YELLOW='' BLUE='' CYAN=''
fi

# ── Output helpers ────────────────────────────────────────────────────────────
_hr()   { printf "${DIM}%s${RESET}\n" \
            "────────────────────────────────────────────────────────────────"; }
step()  { (( ++_STEP )); echo ""; printf "${CYAN}${BOLD}[%d/%d] %s${RESET}\n" \
            "${_STEP}" "${TOTAL_STEPS}" "$*"; _hr; }
info()  { printf "       ${BLUE}→${RESET}  %s\n" "$*"; }
ok()    { printf "       ${GREEN}✓${RESET}  %s\n" "$*"; }
warn()  { printf "       ${YELLOW}⚠${RESET}  %s\n" "$*"; }
die()   { printf "\n${RED}${BOLD}  ✕  %s${RESET}\n\n" "$*" >&2; exit 1; }

_on_err() {
  printf "\n${RED}${BOLD}  ✕  Script aborted (line %s)${RESET}\n" "$1" >&2
  printf "${RED}     Command: %s${RESET}\n\n" "$2" >&2
}
trap '_on_err ${LINENO} "${BASH_COMMAND}"' ERR

# ── Privilege helper ──────────────────────────────────────────────────────────
run_as() {
  local user="$1"; shift
  if [ "$(id -un)" = "${user}" ]; then
    "$@"
  elif command -v runuser &>/dev/null; then
    runuser -u "${user}" -- "$@"
  elif command -v sudo &>/dev/null; then
    sudo -u "${user}" "$@"
  else
    die "Cannot run commands as '${user}': neither 'runuser' nor 'sudo' found."
  fi
}

# ── Header ────────────────────────────────────────────────────────────────────
echo ""
_hr
printf '%s\n' "  ${BOLD}MonsterOps — Installer${RESET}"
printf '%s\n' "  ${DIM}Install dir : ${INSTALL_DIR}${RESET}"
printf '%s\n' "  ${DIM}Service port: ${MONSTEROPS_PORT}${RESET}"
_hr

# ── Pre-flight ────────────────────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || die "This script must be run as root (or via sudo)."
command -v openssl &>/dev/null || die "'openssl' is required but not found."

###############################################################################
# 1. System packages
###############################################################################
step "System packages"

info "Refreshing package index …"
apt-get update -qq

info "Installing freeradius, postgresql, python3 …"
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
    freeradius freeradius-postgresql \
    postgresql postgresql-client \
    python3 python3-pip python3-venv \
    nftables \
    openssl curl git ca-certificates rsync sudo

ok "All system packages installed."

###############################################################################
# 2. PostgreSQL — user + database
###############################################################################
step "PostgreSQL: user & database"

info "Starting PostgreSQL service …"
systemctl start postgresql

info "Waiting for PostgreSQL to accept connections …"
for _ in $(seq 1 15); do
  pg_isready -q && break || true
  sleep 1
done
pg_isready -q || die "PostgreSQL did not become ready after 15 seconds."

info "Configuring role 'radius' …"
if run_as postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='radius'" | grep -q 1; then
  info "Role already exists — refreshing password."
else
  run_as postgres psql -c "CREATE USER radius WITH PASSWORD '${RADIUS_DB_PASSWORD}';" >/dev/null
fi
run_as postgres psql -c "ALTER USER radius WITH PASSWORD '${RADIUS_DB_PASSWORD}';" >/dev/null

info "Configuring database 'radius' …"
if run_as postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='radius'" | grep -q 1; then
  info "Database already exists — skipping creation."
else
  run_as postgres createdb -O radius radius
fi

ok "PostgreSQL ready (user: radius, database: radius)."

###############################################################################
# 3. FreeRADIUS — SQL module
###############################################################################
step "FreeRADIUS: SQL module"
FR_DIR=/etc/freeradius/3.0

info "Installing queries.conf …"
cp "${SCRIPT_DIR}/freeradius/mods-config/sql/main/postgresql/queries.conf" \
   "${FR_DIR}/mods-config/sql/main/postgresql/queries.conf"
chown freerad:freerad "${FR_DIR}/mods-config/sql/main/postgresql/queries.conf"

info "Writing sql module config (injecting DB password) …"
sed "s/RADIUS_DB_PASSWORD/${RADIUS_DB_PASSWORD}/g" \
    "${SCRIPT_DIR}/freeradius/mods-available/sql" \
    > "${FR_DIR}/mods-available/sql"
chown freerad:freerad "${FR_DIR}/mods-available/sql"

info "Enabling sql module symlink …"
if [ -L "${FR_DIR}/mods-enabled/sql" ]; then
  info "Symlink already exists — skipping."
else
  ln -s "${FR_DIR}/mods-available/sql" "${FR_DIR}/mods-enabled/sql"
fi

# Ensure sql is active (not soft-fail) in authorize, accounting, and post-auth.
# FreeRADIUS ships with -sql (soft-fail prefix) in the default site.
# Change -sql → sql so failures are visible rather than silently skipped.
DEFAULT_SITE="${FR_DIR}/sites-available/default"
for SECTION in authorize accounting post-auth; do
  if grep -q "^[[:space:]]*-sql" "${DEFAULT_SITE}" 2>/dev/null; then
    # Replace the first occurrence of -sql (with leading whitespace) with sql
    # within the context of the file — do all occurrences since each section
    # has at most one -sql line and we want sql in all of them.
    sed -i 's/^\([[:space:]]*\)-sql$/\1sql/' "${DEFAULT_SITE}"
    ok "Activated sql (removed soft-fail prefix) in ${DEFAULT_SITE}."
    break
  fi
done

# Verify sql appears in all three sections
for SECTION in authorize accounting post-auth; do
  if ! awk "/^${SECTION} \{/{found=1} found && /^[[:space:]]*sql/{print; exit} /^\}$/{found=0}" \
      "${DEFAULT_SITE}" 2>/dev/null | grep -q "sql"; then
    warn "'sql' not confirmed in '${SECTION}' section of default site — verify manually."
  fi
done

ok "FreeRADIUS SQL module configured."

###############################################################################
# 4. System user
###############################################################################
step "System user '${MR_USER}'"

if id "${MR_USER}" &>/dev/null; then
  info "User already exists — skipping."
else
  info "Creating system user …"
  useradd --system --no-create-home --shell /usr/sbin/nologin "${MR_USER}"
fi

# FreeRADIUS ships its config as freerad:freerad, mode 0750 — unreadable to
# anyone outside the 'freerad' group. The app needs to read it for the Health →
# "Validate config" action (which runs `freeradius -C`), so add MR_USER to the
# group. (The freerad group was created when freeradius was installed in step 1.)
info "Adding '${MR_USER}' to the 'freerad' group (read FreeRADIUS config) …"
if getent group freerad >/dev/null 2>&1; then
  usermod -aG freerad "${MR_USER}"
  ok "'${MR_USER}' added to 'freerad' group."
else
  warn "'freerad' group not found — 'Validate config' in the UI may fail."
fi

# The Realms module generates and hot-applies proxy.conf. It writes to
# ${FR_DIR}/proxy.conf, but that directory is writable only by the freerad user.
# Give the app ownership of just that one file so it can rewrite it; the rest of
# the FreeRADIUS config tree stays freerad-owned. radiusd.conf already
# '$INCLUDE proxy.conf' with proxy_requests = yes on Debian/Ubuntu.
PROXY_CONF="${FR_DIR}/proxy.conf"
info "Granting '${MR_USER}' ownership of proxy.conf (Realms module) …"
[ -e "${PROXY_CONF}" ] || : > "${PROXY_CONF}"
if chown "${MR_USER}:freerad" "${PROXY_CONF}" 2>/dev/null; then
  chmod 0640 "${PROXY_CONF}"
  ok "proxy.conf is writable by '${MR_USER}' (readable by freerad)."
else
  warn "Could not chown ${PROXY_CONF} — Realms 'Apply proxy.conf' may fail."
fi

info "Writing sudoers rules (FreeRADIUS control + scoped nftables) …"
NFT_BIN=$(command -v nft || echo /usr/sbin/nft)  # also referenced by the boot unit below
# The allow-list itself lives in provision-sudoers.sh so install and upgrade
# provision it from one place (same split as provision-vpn.sh — see step 9).
MR_USER="${MR_USER}" bash "${SCRIPT_DIR}/provision-sudoers.sh" \
  || die "sudoers provisioning failed — see above."

ok "User '${MR_USER}' ready (sudoers rules written)."

###############################################################################
# 5. Application files → ${INSTALL_DIR}
###############################################################################
step "Application files → ${INSTALL_DIR}"

if [ "${REPO_ROOT}" != "${INSTALL_DIR}" ]; then
  info "Copying from ${REPO_ROOT} …"
  mkdir -p "${INSTALL_DIR}"
  rsync -a --exclude='.venv' --exclude='__pycache__' --exclude='*.pyc' \
        "${REPO_ROOT}/" "${INSTALL_DIR}/"
  ok "Files copied."
else
  ok "Already in install directory — no copy needed."
fi

###############################################################################
# 6. Python virtualenv & dependencies
###############################################################################
step "Python virtualenv & dependencies"

info "Creating virtualenv at ${VENV_DIR} …"
python3 -m venv "${VENV_DIR}"

info "Upgrading pip …"
"${VENV_DIR}/bin/pip" install --quiet --upgrade pip

info "Installing MonsterOps package …"
"${VENV_DIR}/bin/pip" install --quiet -e "${INSTALL_DIR}"

info "Setting ownership to ${MR_USER} …"
chown -R "${MR_USER}:${MR_USER}" "${INSTALL_DIR}"

ok "Python environment ready."

###############################################################################
# 7. Environment file (.env)
###############################################################################
step "Environment configuration"

info "Writing ${INSTALL_DIR}/.env (mode 600) …"
cat > "${INSTALL_DIR}/.env" <<ENV
MONSTEROPS_DATABASE_URL=postgresql+asyncpg://radius:${RADIUS_DB_PASSWORD}@localhost/radius
MONSTEROPS_SECRET_KEY=${MONSTEROPS_SECRET_KEY}
MONSTEROPS_LOG_LEVEL=INFO
MONSTEROPS_DEBUG=false
MONSTEROPS_VPN_CONFIG_DIR=${VPN_CONFIG_DIR}
ENV
chmod 600 "${INSTALL_DIR}/.env"
chown "${MR_USER}:${MR_USER}" "${INSTALL_DIR}/.env"

ok ".env written."

###############################################################################
# 8. Backup directory
###############################################################################
step "Backup directory"

info "Creating ${BACKUP_DIR} …"
mkdir -p "${BACKUP_DIR}"
chown "${MR_USER}:${MR_USER}" "${BACKUP_DIR}"
chmod 750 "${BACKUP_DIR}"

ok "Backup directory ready at ${BACKUP_DIR}."

###############################################################################
# 9. VPN tunnel backends (Phase 22V)
###############################################################################
step "VPN tunnel backends"

info "Provisioning VPN backends (WireGuard + L2TP/IPsec) …"
MR_USER="${MR_USER}" VPN_CONFIG_DIR="${VPN_CONFIG_DIR}" \
  bash "${SCRIPT_DIR}/provision-vpn.sh" \
  || warn "VPN provisioning reported problems (see above) — VPN is optional; the rest of the install continues."

###############################################################################
# 10. Database migrations
###############################################################################
step "Database migrations"

info "Running 'alembic upgrade head' as ${MR_USER} …"
cd "${INSTALL_DIR}"
run_as "${MR_USER}" env \
    MONSTEROPS_DATABASE_URL="postgresql+asyncpg://radius:${RADIUS_DB_PASSWORD}@localhost/radius" \
    "${VENV_DIR}/bin/python" -m alembic upgrade head

ok "Database schema is up to date."

###############################################################################
# 11. Services
###############################################################################
step "Systemd services"

info "Writing monsterops.service unit …"
cat > /etc/systemd/system/monsterops.service <<UNIT
[Unit]
Description=MonsterOps — Network operations platform
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${MR_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=${VENV_DIR}/bin/monsterops serve --host 0.0.0.0 --port ${MONSTEROPS_PORT}
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=monsterops
# Let the (non-root) service bind the privileged TCP 49 for the optional
# TACACS+ listener (MONSTEROPS_TACACS_ENABLED=true). Harmless when TACACS+ is
# off — the app only binds a low port when the listener is turned on. If you'd
# rather not grant this, set MONSTEROPS_TACACS_PORT to a high port (>1024) and
# redirect 49→that port at the firewall.
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT

# ── Firewall boot-restore unit (Phase 24.11) ───────────────────────────────────
# The app writes its confirmed ruleset to /etc/monsterops/firewall.nft; this unit
# re-applies it early at boot so the firewall survives reboots. It only runs if
# the file exists (i.e. the firewall is actively managed).
info "Writing firewall config dir and boot-restore unit …"
mkdir -p /etc/monsterops
chown "${MR_USER}:${MR_USER}" /etc/monsterops
chmod 0750 /etc/monsterops
cat > /etc/systemd/system/monsterops-firewall.service <<FWUNIT
[Unit]
Description=MonsterOps firewall — restore nftables ruleset
DefaultDependencies=no
Before=network-pre.target
Wants=network-pre.target
ConditionPathExists=/etc/monsterops/firewall.nft

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${NFT_BIN} -f /etc/monsterops/firewall.nft
ExecReload=${NFT_BIN} -f /etc/monsterops/firewall.nft

[Install]
WantedBy=multi-user.target
FWUNIT

info "Enabling and starting monsterops …"
systemctl daemon-reload
systemctl enable --quiet monsterops
systemctl enable --quiet monsterops-firewall
systemctl restart monsterops

# Wait briefly and confirm the service came up
sleep 3
if systemctl is-active --quiet monsterops; then
  ok "monsterops service is running."
else
  warn "monsterops service did not start cleanly — check: journalctl -u monsterops -n 30"
fi

info "Enabling and restarting freeradius …"
systemctl enable --quiet freeradius
if systemctl restart freeradius; then
  ok "freeradius service is running."
else
  warn "freeradius failed to restart — check: journalctl -u freeradius -n 30"
fi

###############################################################################
# Summary
###############################################################################
IP=$(hostname -I | awk '{print $1}')
echo ""
_hr
printf '%s\n' "  ${GREEN}${BOLD}Installation complete!${RESET}"
_hr
printf "\n"
printf "  ${BOLD}%-18s${RESET} http://%s:%s\n"  "URL"          "${IP}" "${MONSTEROPS_PORT}"
printf "  ${BOLD}%-18s${RESET} %s\n"             "DB password"  "${RADIUS_DB_PASSWORD}"
printf "  ${BOLD}%-18s${RESET} saved to %s\n"   "Secret key"   "${INSTALL_DIR}/.env"
printf "\n"
printf '%s\n' "  ${CYAN}${BOLD}First login steps:${RESET}"
printf "  ${DIM}1.${RESET}  Open  http://%s:%s  in your browser\n" "${IP}" "${MONSTEROPS_PORT}"
printf '%s\n' "  ${DIM}2.${RESET}  You will be redirected to the setup wizard"
printf '%s\n' "  ${DIM}3.${RESET}  Create your superadmin account (username + password)"
printf "\n"
printf '%s\n' "  ${DIM}App logs    :${RESET}  journalctl -u monsterops -f"
printf '%s\n' "  ${DIM}RADIUS logs :${RESET}  journalctl -u freeradius -f"
printf '%s\n' "  ${DIM}Backup dir  :${RESET}  ${BACKUP_DIR}"
printf "\n"
printf '%s\n' "  ${YELLOW}${BOLD}⚠  Save the DB password — it will not be shown again.${RESET}"
printf "\n"
_hr
echo ""
