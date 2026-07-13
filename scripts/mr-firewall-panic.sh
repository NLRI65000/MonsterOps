#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# MonsterOps firewall panic button — LAST-RESORT recovery from a Linux shell.
#
# Run this from the host's console / SSH (as root) if a firewall Apply locked
# you out and you can no longer reach the MonsterOps web UI. It removes ONLY the
# MonsterOps-managed nftables table (`table inet monsterops`) and its boot-restore
# file, immediately restoring host connectivity. It NEVER touches any other
# nftables table, so your other firewall rules are left intact.
#
#   sudo ./mr-firewall-panic.sh
#
# After running, MonsterOps input filtering is OFF until you Apply again from the
# UI. The database still shows the firewall as "managed", so re-applying will
# rebuild it — fix the offending rule/allow-only setting first.
# ─────────────────────────────────────────────────────────────────────────────
set -eu

TABLE="inet monsterops"
BOOT_FILE="${MONSTEROPS_FIREWALL_RULESET_PATH:-/etc/monsterops/firewall.nft}"

if [ "$(id -u)" -ne 0 ]; then
    echo "This must run as root (nft needs it). Try: sudo $0" >&2
    exit 1
fi

if ! command -v nft >/dev/null 2>&1; then
    echo "nft (nftables) is not installed — nothing to flush." >&2
    exit 1
fi

echo "MonsterOps firewall panic: removing 'table $TABLE'..."
if nft list table $TABLE >/dev/null 2>&1; then
    nft delete table $TABLE
    echo "  ✓ table removed — host connectivity restored."
else
    echo "  · table not present (nothing to remove)."
fi

if [ -f "$BOOT_FILE" ]; then
    rm -f "$BOOT_FILE"
    echo "  ✓ removed boot ruleset $BOOT_FILE (won't re-lock on reboot)."
else
    echo "  · no boot ruleset at $BOOT_FILE."
fi

echo "Done. MonsterOps input filtering is disabled until you Apply again from the UI."
