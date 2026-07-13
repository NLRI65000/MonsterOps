#!/usr/bin/env bash
# MonsterOps — in-place upgrade script
# Tested on: Ubuntu 22.04 / 24.04, Debian 12
# Run as root or with sudo.
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
INSTALL_DIR="${INSTALL_DIR:-/opt/monsterops}"
VENV_DIR="${INSTALL_DIR}/.venv"
MR_USER="${MR_USER:-monsterops}"
BACKUP_DIR="/var/backups/monsterops"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TOTAL_STEPS=7
_STEP=0

# ── Colors (disabled when not a TTY) ─────────────────────────────────────────
if [ -t 1 ]; then
  BOLD='\033[1m' DIM='\033[2m' RESET='\033[0m'
  RED='\033[1;31m' GREEN='\033[1;32m' YELLOW='\033[1;33m'
  BLUE='\033[0;34m' CYAN='\033[0;36m'
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
# Works whether or not sudo is installed. Root uses runuser directly.
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
printf "  ${BOLD}MonsterOps — Upgrade${RESET}\n"
printf "  ${DIM}Install dir : ${INSTALL_DIR}${RESET}\n"
_hr

# ── Pre-flight ────────────────────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || die "This script must be run as root (or via sudo)."
[ -d "${INSTALL_DIR}" ]      || die "MonsterOps not found at ${INSTALL_DIR} — run install.sh first."
[ -f "${INSTALL_DIR}/.env" ] || die ".env not found at ${INSTALL_DIR}/.env — installation may be incomplete."

# shellcheck source=/dev/null
source "${INSTALL_DIR}/.env"

###############################################################################
# 1. Database backup
###############################################################################
step "Database backup"

info "Parsing connection string …"
DB_URL="${MONSTEROPS_DATABASE_URL}"
PG_CONN="${DB_URL#postgresql+asyncpg://}"
PG_USER="${PG_CONN%%:*}"
PG_REST="${PG_CONN#*:}"
PG_PASS="${PG_REST%%@*}"
PG_HOST_DB="${PG_REST#*@}"
PG_HOST="${PG_HOST_DB%%/*}"
PG_DB="${PG_HOST_DB##*/}"

mkdir -p "${BACKUP_DIR}"
BACKUP_FILE="${BACKUP_DIR}/radius_$(date +%Y%m%d_%H%M%S).sql.gz"
info "Dumping database to ${BACKUP_FILE} …"
PGPASSWORD="${PG_PASS}" pg_dump -h "${PG_HOST%%:*}" -U "${PG_USER}" "${PG_DB}" \
    | gzip > "${BACKUP_FILE}"

ok "Backup saved: ${BACKUP_FILE}"

###############################################################################
# 2. Pull latest code (git only — skipped for tarball installs)
###############################################################################
step "Code update"

cd "${INSTALL_DIR}"
if [ -d ".git" ]; then
  info "Git repository detected — pulling latest changes …"
  git pull --ff-only
  ok "Code is up to date."
else
  warn "No .git directory found — skipping 'git pull'."
  warn "To upgrade a tarball install, copy the new files manually before running this script."
fi

###############################################################################
# 3. FreeRADIUS config
###############################################################################
step "FreeRADIUS config"

FR_DIR=/etc/freeradius/3.0
FR_QUERIES="${FR_DIR}/mods-config/sql/main/postgresql/queries.conf"
info "Updating queries.conf …"
cp "${SCRIPT_DIR}/freeradius/mods-config/sql/main/postgresql/queries.conf" \
   "${FR_QUERIES}"
chown freerad:freerad "${FR_QUERIES}"

# Repair FreeRADIUS integration permissions on existing installs (idempotent):
#  - MR_USER must be in the 'freerad' group to read config for "Validate config"
#  - MR_USER must own proxy.conf so the Realms module can hot-apply it
if getent group freerad >/dev/null 2>&1; then
  usermod -aG freerad "${MR_USER}" 2>/dev/null \
    && ok "'${MR_USER}' is in the 'freerad' group." \
    || warn "Could not add '${MR_USER}' to 'freerad' group."
fi
PROXY_CONF="${FR_DIR}/proxy.conf"
[ -e "${PROXY_CONF}" ] || : > "${PROXY_CONF}"
if chown "${MR_USER}:freerad" "${PROXY_CONF}" 2>/dev/null; then
  chmod 0640 "${PROXY_CONF}"
  ok "proxy.conf is writable by '${MR_USER}'."
fi

ok "FreeRADIUS config updated."

###############################################################################
# 4. Python package
###############################################################################
step "Python package"

info "Upgrading MonsterOps package …"
"${VENV_DIR}/bin/pip" install --quiet --upgrade -e "${INSTALL_DIR}"

ok "Package upgraded."

###############################################################################
# 5. VPN tunnel backends (Phase 22V)
###############################################################################
step "VPN tunnel backends"

info "Provisioning VPN backends (WireGuard + L2TP/IPsec) …"
MR_USER="${MR_USER}" \
VPN_CONFIG_DIR="${MONSTEROPS_VPN_CONFIG_DIR:-/etc/monsterops/vpn}" \
  bash "${SCRIPT_DIR}/provision-vpn.sh" \
  || warn "VPN provisioning reported problems (see above) — VPN is optional; the upgrade continues."

###############################################################################
# 6. Sudoers rules (refresh the privileged-command allow-list in place)
###############################################################################
step "Sudoers rules"

info "Refreshing sudoers allow-list (FreeRADIUS control + scoped nftables) …"
MR_USER="${MR_USER}" bash "${SCRIPT_DIR}/provision-sudoers.sh" \
  || warn "sudoers refresh failed (see above) — the previous allow-list is left in place."

###############################################################################
# 7. Database migrations
###############################################################################
step "Database migrations"

info "Running 'alembic upgrade head' as ${MR_USER} …"
run_as "${MR_USER}" env \
    MONSTEROPS_DATABASE_URL="${MONSTEROPS_DATABASE_URL}" \
    "${VENV_DIR}/bin/python" -m alembic upgrade head

ok "Database schema is up to date."

###############################################################################
# 8. Restart services
###############################################################################
step "Restart services"

# Ensure backup dir exists (in case this is an upgrade from an older install)
mkdir -p "${BACKUP_DIR}"
chown "${MR_USER}:${MR_USER}" "${BACKUP_DIR}" 2>/dev/null || true
chmod 750 "${BACKUP_DIR}" 2>/dev/null || true

info "Restarting monsterops …"
systemctl restart monsterops
sleep 2
if systemctl is-active --quiet monsterops; then
  ok "monsterops is running."
else
  warn "monsterops did not start — check: journalctl -u monsterops -n 30"
fi

info "Reloading freeradius config …"
if systemctl reload freeradius 2>/dev/null || systemctl reload freeradius3 2>/dev/null; then
  ok "freeradius reloaded."
elif systemctl restart freeradius 2>/dev/null || systemctl restart freeradius3 2>/dev/null; then
  ok "freeradius restarted."
else
  warn "Could not reload/restart freeradius — check manually."
fi

###############################################################################
# Summary
###############################################################################
echo ""
_hr
printf "  ${GREEN}${BOLD}Upgrade complete!${RESET}\n"
_hr
printf "\n"
printf "  ${DIM}App logs   :${RESET}  journalctl -u monsterops -f\n"
printf "  ${DIM}RADIUS logs:${RESET}  journalctl -u freeradius -f\n"
printf "  ${DIM}Backup     :${RESET}  ${BACKUP_FILE}\n"
printf "\n"
_hr
echo ""
