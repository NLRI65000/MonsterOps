#!/usr/bin/env bash
# MonsterOps — VPN backend provisioning (Phase 22V)
#
# Idempotent and best-effort. Invoked by BOTH install.sh and upgrade.sh so a
# fresh install and an in-place upgrade provision the VPN tooling identically.
# VPN is an optional feature, so nothing here aborts the caller — problems are
# reported and skipped.
#
# Inputs (environment):
#   MR_USER          service user          (default: monsterops)
#   VPN_CONFIG_DIR   WireGuard config dir  (default: /etc/monsterops/vpn)
set -uo pipefail

MR_USER="${MR_USER:-monsterops}"
VPN_CONFIG_DIR="${VPN_CONFIG_DIR:-/etc/monsterops/vpn}"
RUN_DIR="/run/monsterops-vpn"

if [ -t 1 ]; then
  GREEN='\033[1;32m' YELLOW='\033[1;33m' BLUE='\033[0;34m' RESET='\033[0m'
else
  GREEN='' YELLOW='' BLUE='' RESET=''
fi
info() { printf "       ${BLUE}\xe2\x86\x92${RESET}  %s\n" "$*"; }
ok()   { printf "       ${GREEN}\xe2\x9c\x93${RESET}  %s\n" "$*"; }
warn() { printf "       ${YELLOW}\xe2\x9a\xa0${RESET}  %s\n" "$*"; }

# ── 1. Packages (heavier optional deps — never fatal) ────────────────────────
info "Installing VPN tooling (WireGuard + L2TP/IPsec) …"
if command -v apt-get >/dev/null 2>&1 \
   && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
        wireguard-tools strongswan xl2tpd ppp acl; then
  ok "VPN tooling installed."
else
  warn "Some VPN packages could not be installed — tunnels of that type can be"
  warn "defined in the UI but not activated until the tools are present."
fi

# ── 2. WireGuard config dir (app-owned; holds private keys) ──────────────────
info "Ensuring WireGuard config directory ${VPN_CONFIG_DIR} …"
if mkdir -p "${VPN_CONFIG_DIR}" \
   && chown "${MR_USER}:${MR_USER}" "${VPN_CONFIG_DIR}" \
   && chmod 700 "${VPN_CONFIG_DIR}"; then
  ok "WireGuard config directory ready (owned by ${MR_USER}, mode 700)."
else
  warn "Could not prepare ${VPN_CONFIG_DIR} — WireGuard tunnels will not activate."
fi

# ── 3. Sudoers allow-list for the commands the backends shell out to ─────────
WG_QUICK_BIN=$(command -v wg-quick || echo /usr/bin/wg-quick)
WG_BIN=$(command -v wg || echo /usr/bin/wg)
IPSEC_BIN=$(command -v ipsec || echo /usr/sbin/ipsec)
XL2TPD_BIN=$(command -v xl2tpd || echo /usr/sbin/xl2tpd)
XL2TPDCTL_BIN=$(command -v xl2tpd-control || echo /usr/sbin/xl2tpd-control)
IP_BIN=$(command -v ip || echo /usr/sbin/ip)
KILL_BIN=$(command -v kill || echo /usr/bin/kill)

info "Writing sudoers allow-list /etc/sudoers.d/monsterops-vpn …"
cat > /etc/sudoers.d/monsterops-vpn <<SUDOERS
# MonsterOps VPN module (Phase 22V) — bring managed tunnels up/down and read
# their state. The app shells out with no shell string; every argument is
# allow-list validated before it reaches these commands.
${MR_USER} ALL=(ALL) NOPASSWD: ${WG_QUICK_BIN}
${MR_USER} ALL=(ALL) NOPASSWD: ${WG_BIN}
${MR_USER} ALL=(ALL) NOPASSWD: ${IPSEC_BIN}
${MR_USER} ALL=(ALL) NOPASSWD: ${XL2TPD_BIN}
${MR_USER} ALL=(ALL) NOPASSWD: ${XL2TPDCTL_BIN}
${MR_USER} ALL=(ALL) NOPASSWD: ${IP_BIN}
${MR_USER} ALL=(ALL) NOPASSWD: ${KILL_BIN}
SUDOERS
chmod 0440 /etc/sudoers.d/monsterops-vpn
if visudo -cf /etc/sudoers.d/monsterops-vpn >/dev/null 2>&1; then
  ok "Sudoers allow-list installed."
else
  rm -f /etc/sudoers.d/monsterops-vpn
  warn "VPN sudoers fragment failed validation and was removed — tunnel"
  warn "activation will not work until it is added manually."
fi

# ── 4. L2TP/IPsec config-file write access for the unprivileged service user ─
if command -v setfacl >/dev/null 2>&1; then
  info "Granting ${MR_USER} write access to L2TP/IPsec config locations …"
  for d in /etc/ipsec.d /etc/xl2tpd /etc/ppp; do
    if [ -d "${d}" ]; then
      setfacl -m "u:${MR_USER}:rwx" "${d}" 2>/dev/null \
        && setfacl -d -m "u:${MR_USER}:rw" "${d}" 2>/dev/null || true
    fi
  done
  touch /etc/ppp/chap-secrets 2>/dev/null || true
  if [ -f /etc/ppp/chap-secrets ]; then
    chmod 600 /etc/ppp/chap-secrets 2>/dev/null || true
    setfacl -m "u:${MR_USER}:rw" /etc/ppp/chap-secrets 2>/dev/null || true
  fi
  ok "L2TP/IPsec config locations are writable by ${MR_USER}."
else
  warn "setfacl not found — for L2TP/IPsec tunnels, grant ${MR_USER} write access"
  warn "to /etc/ipsec.d, /etc/xl2tpd, /etc/ppp and /etc/ppp/chap-secrets manually."
fi

# ── 5. Runtime dir for L2TP control sockets ──────────────────────────────────
# tmpfiles is used (rather than the unit's RuntimeDirectory) so it works on an
# in-place upgrade without rewriting the systemd unit, and is recreated on boot.
info "Configuring runtime directory ${RUN_DIR} …"
cat > /etc/tmpfiles.d/monsterops-vpn.conf <<TMPFILES
# MonsterOps VPN module — per-tunnel L2TP/IPsec control sockets
d ${RUN_DIR} 0700 ${MR_USER} ${MR_USER} -
TMPFILES
if command -v systemd-tmpfiles >/dev/null 2>&1; then
  systemd-tmpfiles --create /etc/tmpfiles.d/monsterops-vpn.conf 2>/dev/null || true
else
  mkdir -p "${RUN_DIR}" 2>/dev/null \
    && chown "${MR_USER}:${MR_USER}" "${RUN_DIR}" 2>/dev/null \
    && chmod 700 "${RUN_DIR}" 2>/dev/null || true
fi
ok "Runtime directory configured."
