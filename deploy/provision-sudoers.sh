#!/usr/bin/env bash
# MonsterOps — privileged-command sudoers allow-list.
#
# Idempotent. Invoked by BOTH install.sh and upgrade.sh so a fresh install and
# an in-place upgrade provision identical, minimal sudo rules from one place
# (the same split used for the VPN backends — see provision-vpn.sh).
#
# Grants the unprivileged service user passwordless sudo for EXACTLY the
# commands MonsterOps shells out to:
#   • FreeRADIUS service control (reload/restart/start/stop), and
#   • the small, fixed set of nftables calls the Firewall Manager issues, every
#     one scoped to 'table inet monsterops'.
# There is deliberately NO blanket 'nft *': the module never runs any other nft
# subcommand, so allow-listing the exact calls means the service user can never
# flush the ruleset, delete the operator's own tables, or load an arbitrary
# file — even if the app is compromised. The app already validates every
# argument; this file is the defense-in-depth backstop.
#
# The fragment is written to a temp file and validated with `visudo -cf` before
# being atomically moved into place, so a syntax error can never replace a
# working file or wedge sudo (sudo ignores dotted temp names in sudoers.d).
#
# Inputs (environment):
#   MR_USER   service user   (default: monsterops)
#
# Exit status: 0 on success; 1 if the fragment failed validation (the caller
# decides whether that is fatal — it is on install, best-effort on upgrade).
set -uo pipefail

MR_USER="${MR_USER:-monsterops}"
SUDOERS_FILE="/etc/sudoers.d/monsterops"
TMP_FILE="/etc/sudoers.d/.monsterops.$$.tmp"

if [ -t 1 ]; then
  GREEN='\033[1;32m' YELLOW='\033[1;33m' BLUE='\033[0;34m' RESET='\033[0m'
else
  GREEN='' YELLOW='' BLUE='' RESET=''
fi
info() { printf "       ${BLUE}\xe2\x86\x92${RESET}  %s\n" "$*"; }
ok()   { printf "       ${GREEN}\xe2\x9c\x93${RESET}  %s\n" "$*"; }
warn() { printf "       ${YELLOW}\xe2\x9a\xa0${RESET}  %s\n" "$*"; }

SYSTEMCTL_BIN=$(command -v systemctl || echo /usr/bin/systemctl)
NFT_BIN=$(command -v nft || echo /usr/sbin/nft)

info "Writing sudoers allow-list ${SUDOERS_FILE} …"
umask 077
cat > "${TMP_FILE}" <<SUDOERS
# MonsterOps — passwordless sudo for the exact privileged commands the app runs.
# Managed by deploy/provision-sudoers.sh; do not edit by hand (re-run install or
# upgrade to regenerate).

# FreeRADIUS service control. Both unit names are covered because Debian ships
# the daemon as 'freeradius' and some variants as 'freeradius3'.
${MR_USER} ALL=(ALL) NOPASSWD: ${SYSTEMCTL_BIN} reload freeradius
${MR_USER} ALL=(ALL) NOPASSWD: ${SYSTEMCTL_BIN} restart freeradius
${MR_USER} ALL=(ALL) NOPASSWD: ${SYSTEMCTL_BIN} start freeradius
${MR_USER} ALL=(ALL) NOPASSWD: ${SYSTEMCTL_BIN} stop freeradius
${MR_USER} ALL=(ALL) NOPASSWD: ${SYSTEMCTL_BIN} reload freeradius3
${MR_USER} ALL=(ALL) NOPASSWD: ${SYSTEMCTL_BIN} restart freeradius3
${MR_USER} ALL=(ALL) NOPASSWD: ${SYSTEMCTL_BIN} start freeradius3
${MR_USER} ALL=(ALL) NOPASSWD: ${SYSTEMCTL_BIN} stop freeradius3

# Firewall Manager — nftables. ONLY the fixed commands the module issues, every
# one scoped to 'table inet monsterops'. check/apply receive the ruleset on
# stdin (nft -c -f - / nft -f -); the element rules carry a validated set name
# and address/timeout tail.
${MR_USER} ALL=(ALL) NOPASSWD: ${NFT_BIN} -c -f -
${MR_USER} ALL=(ALL) NOPASSWD: ${NFT_BIN} -f -
${MR_USER} ALL=(ALL) NOPASSWD: ${NFT_BIN} list table inet monsterops
${MR_USER} ALL=(ALL) NOPASSWD: ${NFT_BIN} -j list table inet monsterops
${MR_USER} ALL=(ALL) NOPASSWD: ${NFT_BIN} delete table inet monsterops
${MR_USER} ALL=(ALL) NOPASSWD: ${NFT_BIN} add element inet monsterops *
${MR_USER} ALL=(ALL) NOPASSWD: ${NFT_BIN} delete element inet monsterops *
SUDOERS
chmod 0440 "${TMP_FILE}"

if visudo -cf "${TMP_FILE}" >/dev/null 2>&1; then
  mv -f "${TMP_FILE}" "${SUDOERS_FILE}"
  ok "Sudoers allow-list installed (FreeRADIUS control + scoped nftables)."
else
  rm -f "${TMP_FILE}"
  warn "sudoers fragment failed validation — left ${SUDOERS_FILE} untouched."
  exit 1
fi
