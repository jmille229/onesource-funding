#!/usr/bin/env bash
# Basic hardening for the Ubuntu server. Run once as root, and re-run any time:
#   sudo ./infra/harden.sh          shows what it would change
#   sudo ./infra/harden.sh --apply  changes it
#
#   Firewall      only SSH (22), HTTP (80) and HTTPS (443) reach the server
#   Updates       security updates install themselves (unattended-upgrades)
#   SSH           key-only sign-in: password logins off — ONLY if a key is
#                 already installed for root, so this can't lock you out
#   fail2ban      bans addresses that keep failing SSH sign-in
#
# Docker publishes ports around ufw; only Caddy publishes any (80/443), which
# should be public anyway. Postgres, Redis and the rest are on Docker's
# private network and not reachable from outside.
set -euo pipefail
APPLY=false
[ "${1:-}" = "--apply" ] && APPLY=true
[ "$(id -u)" = "0" ] || { echo "Run as root (sudo)." >&2; exit 1; }
run() { if $APPLY; then echo "+ $*"; "$@"; else echo "would run: $*"; fi; }

echo "── Firewall"
command -v ufw >/dev/null || run apt-get install -y ufw
run ufw default deny incoming
run ufw default allow outgoing
run ufw allow 22/tcp
run ufw allow 80/tcp
run ufw allow 443/tcp
run ufw --force enable

echo "── Automatic security updates"
run apt-get install -y unattended-upgrades
run dpkg-reconfigure -f noninteractive unattended-upgrades

echo "── fail2ban (SSH)"
run apt-get install -y fail2ban
run systemctl enable --now fail2ban

echo "── SSH: keys only"
if [ -s /root/.ssh/authorized_keys ] || ls /home/*/.ssh/authorized_keys >/dev/null 2>&1; then
  CONF=/etc/ssh/sshd_config.d/90-constructpm.conf
  if $APPLY; then
    printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > "$CONF"
    sshd -t && systemctl reload ssh || systemctl reload sshd
    echo "+ wrote $CONF and reloaded SSH (password sign-in is off; keys still work)"
  else
    echo "would write $CONF: PasswordAuthentication no, PermitRootLogin prohibit-password"
  fi
else
  echo "⚠ No SSH key is installed (no authorized_keys) — leaving password sign-in ON so you aren't locked out."
  echo "  Add your public key to /root/.ssh/authorized_keys, check you can sign in with it, then re-run."
fi

$APPLY || echo; $APPLY || echo "Nothing changed. Re-run with --apply to make these changes."
