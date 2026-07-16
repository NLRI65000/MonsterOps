#!/usr/bin/env bash
# MonsterOps — Active Directory delegated-auth provisioning (opt-in, admin-run)
#
# Joins THIS RADIUS host to an Active Directory domain and wires FreeRADIUS to
# validate MS-CHAPv2 logins live against a domain controller via winbind /
# ntlm_auth. Needed ONLY for realms whose authentication method is
# "directory_delegated". Local-password realms (the default) need none of this —
# MonsterOps owns their passwords and authenticates them straight from the DB.
#
# CONSEQUENTIAL AND HARD TO REVERSE:
#   `net ads join` creates a MACHINE ACCOUNT in the live Active Directory and
#   reconfigures Kerberos/winbind on this host. Run it deliberately, with
#   domain-admin credentials, on a host you intend to keep joined to the domain.
#   This script is NOT invoked by install.sh or upgrade.sh — it is opt-in.
#
# Inputs (environment):
#   AD_REALM         Kerberos realm = AD DNS domain, UPPERCASE (e.g. CORP.LOCAL)  [required]
#   AD_SHORT_DOMAIN  NetBIOS short/workgroup name              (e.g. CORP)        [required]
#   AD_DC            Domain-controller hostname (optional; DNS SRV auto-discovers)
#   AD_JOIN_USER     AD account used to perform the join       (default: Administrator)
#   MR_USER          MonsterOps service user                   (default: monsterops)
#   SKIP_JOIN        set =1 to (re)wire FreeRADIUS only and skip `net ads join`
#                    (use when the host is already domain-joined)
set -uo pipefail

AD_REALM="${AD_REALM:-}"
AD_SHORT_DOMAIN="${AD_SHORT_DOMAIN:-}"
AD_DC="${AD_DC:-}"
AD_JOIN_USER="${AD_JOIN_USER:-Administrator}"
MR_USER="${MR_USER:-monsterops}"
SKIP_JOIN="${SKIP_JOIN:-0}"
FR_DIR="/etc/freeradius/3.0"

if [ -t 1 ]; then
  GREEN='\033[1;32m' YELLOW='\033[1;33m' RED='\033[1;31m' BLUE='\033[0;34m' RESET='\033[0m'
else
  GREEN='' YELLOW='' RED='' BLUE='' RESET=''
fi
info() { printf "       ${BLUE}\xe2\x86\x92${RESET}  %s\n" "$*"; }
ok()   { printf "       ${GREEN}\xe2\x9c\x93${RESET}  %s\n" "$*"; }
warn() { printf "       ${YELLOW}\xe2\x9a\xa0${RESET}  %s\n" "$*"; }
err()  { printf "       ${RED}\xe2\x9c\x97${RESET}  %s\n" "$*" >&2; }
step() { printf "\n${BLUE}==>${RESET} %s\n" "$*"; }

# ── 0. Preflight ─────────────────────────────────────────────────────────────
step "Preflight"
if [ "$(id -u)" -ne 0 ]; then
  err "Run as root (needs to install packages, join the domain, edit /etc)."
  exit 1
fi
missing=0
[ -z "${AD_REALM}" ]        && { err "AD_REALM is required (e.g. AD_REALM=CORP.LOCAL)."; missing=1; }
[ -z "${AD_SHORT_DOMAIN}" ] && { err "AD_SHORT_DOMAIN is required (e.g. AD_SHORT_DOMAIN=CORP)."; missing=1; }
[ "${missing}" -eq 1 ] && exit 1

# Normalise: realm uppercase, short domain uppercase (winbind convention).
AD_REALM="$(printf '%s' "${AD_REALM}" | tr '[:lower:]' '[:upper:]')"
AD_SHORT_DOMAIN="$(printf '%s' "${AD_SHORT_DOMAIN}" | tr '[:lower:]' '[:upper:]')"
AD_REALM_LC="$(printf '%s' "${AD_REALM}" | tr '[:upper:]' '[:lower:]')"

if ! id "${MR_USER}" >/dev/null 2>&1; then
  err "Service user '${MR_USER}' does not exist — run install.sh first."
  exit 1
fi
ok "Realm ${AD_REALM} · short domain ${AD_SHORT_DOMAIN} · join user ${AD_JOIN_USER}"

# ── 1. Packages ──────────────────────────────────────────────────────────────
step "Packages (Samba / winbind / Kerberos)"
info "Installing samba winbind krb5-user libnss-winbind libpam-winbind …"
if command -v apt-get >/dev/null 2>&1 \
   && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
        samba winbind krb5-user libnss-winbind libpam-winbind acl; then
  ok "Directory tooling installed."
else
  err "Package installation failed — cannot continue."
  exit 1
fi

# ── 2. Kerberos config ───────────────────────────────────────────────────────
step "Kerberos (/etc/krb5.conf)"
info "Writing /etc/krb5.conf for realm ${AD_REALM} …"
[ -f /etc/krb5.conf ] && cp -a /etc/krb5.conf "/etc/krb5.conf.monsterops.bak.$(date +%s)"
{
  printf '[libdefaults]\n'
  printf '    default_realm = %s\n' "${AD_REALM}"
  printf '    dns_lookup_realm = false\n'
  printf '    dns_lookup_kdc = true\n'
  printf '    rdns = false\n\n'
  printf '[realms]\n'
  printf '    %s = {\n' "${AD_REALM}"
  if [ -n "${AD_DC}" ]; then
    printf '        kdc = %s\n' "${AD_DC}"
    printf '        admin_server = %s\n' "${AD_DC}"
  fi
  printf '        default_domain = %s\n' "${AD_REALM_LC}"
  printf '    }\n\n'
  printf '[domain_realm]\n'
  printf '    .%s = %s\n' "${AD_REALM_LC}" "${AD_REALM}"
  printf '    %s = %s\n' "${AD_REALM_LC}" "${AD_REALM}"
} > /etc/krb5.conf
ok "Kerberos configured (previous file backed up)."

# ── 3. Samba config ──────────────────────────────────────────────────────────
step "Samba (/etc/samba/smb.conf, security = ads)"
info "Writing /etc/samba/smb.conf …"
[ -f /etc/samba/smb.conf ] && cp -a /etc/samba/smb.conf "/etc/samba/smb.conf.monsterops.bak.$(date +%s)"
mkdir -p /etc/samba
{
  printf '[global]\n'
  printf '    security = ads\n'
  printf '    realm = %s\n' "${AD_REALM}"
  printf '    workgroup = %s\n' "${AD_SHORT_DOMAIN}"
  printf '    kerberos method = secrets and keytab\n\n'
  printf '    winbind use default domain = yes\n'
  printf '    winbind refresh tickets = yes\n'
  printf '    winbind enum users = no\n'
  printf '    winbind enum groups = no\n'
  printf '    template shell = /usr/sbin/nologin\n\n'
  printf '    idmap config * : backend = tdb\n'
  printf '    idmap config * : range = 3000-7999\n'
  printf '    idmap config %s : backend = rid\n' "${AD_SHORT_DOMAIN}"
  printf '    idmap config %s : range = 10000-999999\n' "${AD_SHORT_DOMAIN}"
} > /etc/samba/smb.conf
if command -v testparm >/dev/null 2>&1 && testparm -s /etc/samba/smb.conf >/dev/null 2>&1; then
  ok "smb.conf written and validated."
else
  warn "smb.conf written but testparm validation was inconclusive — verify manually."
fi

# ── 4. Join the domain (interactive — creates a machine account in AD) ────────
step "Domain join"
if [ "${SKIP_JOIN}" = "1" ]; then
  warn "SKIP_JOIN=1 — leaving existing machine account/join untouched."
else
  NET_BIN="$(command -v net || echo /usr/bin/net)"
  info "About to run: ${NET_BIN} ads join -U ${AD_JOIN_USER}"
  warn "This CREATES A MACHINE ACCOUNT in Active Directory (${AD_REALM})."
  printf "       Type 'JOIN' to proceed (anything else aborts): "
  read -r _confirm
  if [ "${_confirm}" != "JOIN" ]; then
    err "Aborted before domain join. FreeRADIUS was not rewired."
    err "Re-run with SKIP_JOIN=1 once the host is already joined to wire FreeRADIUS only."
    exit 1
  fi
  if "${NET_BIN}" ads join -U "${AD_JOIN_USER}"; then
    ok "Host joined to ${AD_REALM}."
  else
    err "Domain join failed — check DNS to the DC, time sync (Kerberos), and credentials."
    exit 1
  fi
fi

# ── 5. winbind service + privileged-pipe access for freerad ──────────────────
step "winbind"
info "Enabling and starting winbind …"
systemctl enable --quiet winbind 2>/dev/null || true
if systemctl restart winbind; then
  ok "winbind is running."
else
  warn "winbind failed to start — check: journalctl -u winbind -n 30"
fi

# ntlm_auth reads the privileged winbind pipe (/var/lib/samba/winbindd_privileged),
# which is group-owned by 'winbindd_priv'. FreeRADIUS runs as 'freerad', so add it.
if getent group winbindd_priv >/dev/null 2>&1; then
  info "Adding 'freerad' to the 'winbindd_priv' group (ntlm_auth access) …"
  usermod -aG winbindd_priv freerad 2>/dev/null \
    && ok "'freerad' added to 'winbindd_priv'." \
    || warn "Could not add 'freerad' to 'winbindd_priv' — MS-CHAPv2 via ntlm_auth may fail."
else
  warn "'winbindd_priv' group not found — created after the first winbind start; re-run if ntlm_auth is denied."
fi

# ── 6. Verify winbind ↔ DC trust ─────────────────────────────────────────────
step "Verify directory trust"
if command -v wbinfo >/dev/null 2>&1 && wbinfo -t >/dev/null 2>&1; then
  ok "wbinfo -t: secure channel to the DC is healthy."
else
  warn "wbinfo -t did not confirm the trust — check winbind and the join."
fi

# ── 7. FreeRADIUS: mschap_ntlm instance + Auth-Type NTLM-Auth ────────────────
step "FreeRADIUS wiring"
if [ ! -d "${FR_DIR}" ]; then
  warn "FreeRADIUS config dir ${FR_DIR} not found — skipping FR wiring."
  warn "Install FreeRADIUS (deploy/install.sh) and re-run with SKIP_JOIN=1."
  exit 0
fi

NTLM_AUTH_BIN="$(command -v ntlm_auth || echo /usr/bin/ntlm_auth)"
MSCHAP_NTLM="${FR_DIR}/mods-available/mschap_ntlm"
info "Writing mschap_ntlm module (ntlm_auth → live DC) …"
# A second mschap instance whose ntlm_auth directive delegates the MS-CHAPv2
# check to the domain controller. The adapter routes delegated users here by
# writing 'Auth-Type := NTLM-Auth' into radcheck; the block below runs this.
cat > "${MSCHAP_NTLM}" <<EOF
# MonsterOps — delegated MS-CHAPv2 against Active Directory via winbind/ntlm_auth.
# Installed by deploy/provision-ad.sh for "directory_delegated" realms. The short
# domain is fixed to ${AD_SHORT_DOMAIN}; a single delegated AD domain is supported.
mschap mschap_ntlm {
	ntlm_auth = "${NTLM_AUTH_BIN} --request-nt-key --allow-mschapv2 --username=%{%{Stripped-User-Name}:-%{User-Name}} --domain=${AD_SHORT_DOMAIN} --challenge=%{mschap:Challenge:-00} --nt-response=%{mschap:NT-Response:-00}"
}
EOF
chown freerad:freerad "${MSCHAP_NTLM}"

if [ -L "${FR_DIR}/mods-enabled/mschap_ntlm" ]; then
  info "mschap_ntlm symlink already present — skipping."
else
  ln -s "${MSCHAP_NTLM}" "${FR_DIR}/mods-enabled/mschap_ntlm"
  ok "Enabled mschap_ntlm module."
fi

DEFAULT_SITE="${FR_DIR}/sites-available/default"
if grep -q "Auth-Type NTLM-Auth" "${DEFAULT_SITE}" 2>/dev/null; then
  info "Auth-Type NTLM-Auth block already present in the default site — skipping."
else
  info "Adding 'Auth-Type NTLM-Auth { mschap_ntlm }' to the default site's authenticate{} …"
  cp -a "${DEFAULT_SITE}" "${DEFAULT_SITE}.monsterops.bak.$(date +%s)"
  # Insert the block immediately after the 'authenticate {' line.
  awk '
    /^authenticate \{/ && !done {
      print
      print "\t#  MonsterOps: delegated MS-CHAPv2 against Active Directory."
      print "\tAuth-Type NTLM-Auth {"
      print "\t\tmschap_ntlm"
      print "\t}"
      done = 1
      next
    }
    { print }
  ' "${DEFAULT_SITE}" > "${DEFAULT_SITE}.tmp" && mv "${DEFAULT_SITE}.tmp" "${DEFAULT_SITE}"
  chown freerad:freerad "${DEFAULT_SITE}"
  ok "authenticate{} updated (previous file backed up)."
fi

# The adapter writes 'Auth-Type := NTLM-Auth' from radcheck (read by the sql
# module in authorize{}). For that to win over mschap's auto MS-CHAP selection,
# sql must run AFTER mschap in authorize{}. Verify and warn (don't reorder the
# stock site automatically).
if awk '/^authorize \{/{a=1} a&&/^[[:space:]]*mschap/{m=NR} a&&/^[[:space:]]*sql/{s=NR} /^\}/{if(a){a=0}} END{exit !(m && s && s>m)}' \
     "${DEFAULT_SITE}" 2>/dev/null; then
  ok "authorize{} order OK: sql runs after mschap (Auth-Type := NTLM-Auth wins)."
else
  warn "Could not confirm sql runs after mschap in authorize{} — if delegated"
  warn "logins select MS-CHAP instead of NTLM-Auth, move 'sql' below 'mschap'."
fi

# ── 8. Validate + reload FreeRADIUS ──────────────────────────────────────────
step "Reload FreeRADIUS"
if freeradius -Cx >/dev/null 2>&1 || freeradius -C >/dev/null 2>&1; then
  ok "FreeRADIUS config validates."
else
  warn "freeradius -C reported problems — review before relying on delegated auth:"
  warn "  freeradius -CX 2>&1 | tail -40"
fi
if systemctl reload freeradius 2>/dev/null || systemctl restart freeradius; then
  ok "FreeRADIUS reloaded."
else
  warn "FreeRADIUS reload failed — check: journalctl -u freeradius -n 30"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
step "Done"
ok "Delegated AD authentication is provisioned."
info "Create a 'directory_delegated' realm in MonsterOps (Realms → Authentication)"
info "with short domain ${AD_SHORT_DOMAIN}, then verify a real login:"
info "  radtest -t mschap '<sAMAccountName>' '<AD password>' 127.0.0.1 0 <NAS-secret>"
