#!/usr/bin/env bash
# Where the launch checklist stands (DEPLOY.md → Launch checklist). Read-only:
# changes nothing, prints no secret values. Run on the server from
# apps/constructpm, as root (some checks read firewall and SSH settings):
#   sudo ./infra/launch-check.sh
set -uo pipefail
cd "$(dirname "$0")/.."
. infra/lib.sh
load_env

DOMAIN_MAIL="${MAIL_DOMAIN:-os-funding.com}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
todo=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
no()   { printf '  \033[31m✗\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '      → %s\n' "$2"; todo=$((todo + 1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '      → %s\n' "$2"; }
set_() { [ -n "${!1:-}" ] && [ "${!1}" != "CHANGE_ME" ]; }
age_h() { echo $(( ($(date +%s) - $(stat -c %Y "$1")) / 3600 )); }
psql_q() { $COMPOSE exec -T postgres psql -U constructpm -d constructpm -qtA -c "$1" 2>/dev/null; }

echo "Running version: $(git rev-parse --short HEAD 2>/dev/null) ($(git log -1 --format=%cd --date=short 2>/dev/null))"

echo; echo "1. Secrets"
set_ APPLICATION_DATA_KEY && ok "APPLICATION_DATA_KEY set" || no "APPLICATION_DATA_KEY not set" "openssl rand -base64 32 → .env.production, then ./infra/deploy.sh"
[ -f secrets/jwt_private.pem ] && ok "signing keys present" || no "secrets/jwt_private.pem missing" "./infra/gen-jwt-keys.sh"
warn "Can't check this one: .env.production, secrets/, APPLICATION_DATA_KEY and BACKUP_PASSPHRASE copied into your password manager?"

echo; echo "2. File storage"
if [ -z "${S3_ENDPOINT:-}" ] || [[ "$S3_ENDPOINT" == *minio* ]]; then
  if set_ NEW_S3_ENDPOINT; then
    no "files still on the server (MinIO); new bucket configured as NEW_S3_*" "./infra/migrate-files.sh, then --check, then switch S3_* (DEPLOY.md → File storage)"
  else
    no "files still on the server (MinIO)" "create the R2 bucket and set NEW_S3_* (DEPLOY.md → File storage)"
  fi
else
  ok "files in managed storage (${S3_ENDPOINT#https://})"
  set_ NEW_S3_ENDPOINT && warn "NEW_S3_* still in .env.production" "delete those lines once you've switched"
fi

echo; echo "3. Backups"
set_ BACKUP_PASSPHRASE && ok "BACKUP_PASSPHRASE set" || no "BACKUP_PASSPHRASE not set" "openssl rand -base64 32 → .env.production (and your password manager)"
if set_ BACKUP_S3_BUCKET && set_ BACKUP_S3_ACCESS_KEY; then
  ok "off-site bucket set (${BACKUP_S3_ENDPOINT#https://})"
  if [ -n "${S3_ACCESS_KEY:-}" ] && [ "${BACKUP_S3_ACCESS_KEY}" = "${S3_ACCESS_KEY}" ]; then
    no "backups use the same key as the files" "use a separate account (Backblaze B2) so one leaked key can't delete both"
  fi
else
  no "no off-site bucket (BACKUP_S3_*)" "create the Backblaze B2 bucket and key (DEPLOY.md → Backups)"
fi
set_ BACKUP_HEALTHCHECK_URL && ok "backup health check set" || no "BACKUP_HEALTHCHECK_URL not set" "free check at healthchecks.io (daily, 1-hour grace)"
if crontab -l 2>/dev/null | grep -v '^#' | grep -q 'infra/backup.sh'; then ok "nightly backup scheduled"; else no "nightly backup not scheduled" "sudo crontab -e (line in DEPLOY.md → Backups)"; fi
newest="$(ls -t "$BACKUP_DIR"/db-*.sql.gz.enc 2>/dev/null | head -1)"
if [ -n "$newest" ]; then
  h="$(age_h "$newest")"
  [ "$h" -le 26 ] && ok "newest encrypted backup ${h}h old" || no "newest encrypted backup is ${h}h old" "./infra/backup.sh, and check the cron line"
else
  no "no encrypted backup yet" "./infra/backup.sh"
fi
if [ -f "$BACKUP_DIR/restore_check.ok" ]; then
  d=$(( $(age_h "$BACKUP_DIR/restore_check.ok") / 24 ))
  [ "$d" -gt 35 ] && no "last restore test passed ${d} days ago" "./infra/restore.sh verify (monthly)" || ok "restore test passed ${d} day(s) ago"
elif [ -f "$BACKUP_DIR/restore_check.log" ]; then
  no "last restore test didn't pass" "./infra/restore.sh verify, and see $BACKUP_DIR/restore_check.log"
else
  no "restore never tested" "./infra/restore.sh verify"
fi

echo; echo "4. Email"
set_ SMTP_HOST && ok "sending through ${SMTP_HOST}:${SMTP_PORT:-587} as ${EMAIL_FROM:-?}" || no "SMTP_HOST not set — no invites, resets or alerts" "DEPLOY.md → Email"
[[ "${SMTP_HOST:-}" == *office365* || "${SMTP_HOST:-}" == *outlook* ]] && warn "Microsoft 365 password sending is being switched off" "use a sending service instead (DEPLOY.md → Email)"
set_ OPS_NOTIFICATION_EMAIL && ok "alerts go to ${OPS_NOTIFICATION_EMAIL}" || no "OPS_NOTIFICATION_EMAIL not set — funding requests won't email you"
if command -v dig >/dev/null; then
  spf="$(dig +short TXT "$DOMAIN_MAIL" | tr -d '"' | grep -i '^v=spf1' || true)"
  n="$(printf '%s\n' "$spf" | grep -c . || true)"
  if [ "$n" = "0" ]; then no "no SPF record on $DOMAIN_MAIL" "DEPLOY.md → Email"
  elif [ "$n" -gt 1 ]; then no "$n SPF records on $DOMAIN_MAIL — there must be exactly one" "merge them into one v=spf1 record"
  elif [[ "${SMTP_HOST:-}" == *gmail* || "${SMTP_HOST:-}" == *google* ]] && [[ "$spf" != *_spf.google.com* ]]; then no "SPF doesn't include Google" "add include:_spf.google.com to: $spf"
  else ok "SPF: $spf"; fi
  if [[ "${SMTP_HOST:-}" == *gmail* || "${SMTP_HOST:-}" == *google* ]]; then
    [ -n "$(dig +short TXT "google._domainkey.$DOMAIN_MAIL")" ] && ok "DKIM (google._domainkey) published" || no "no Google DKIM record" "Google Admin → Gmail → Authenticate email"
  else
    warn "DKIM: check your sending service's dashboard shows the domain as verified"
  fi
  dmarc="$(dig +short TXT "_dmarc.$DOMAIN_MAIL" | tr -d '"' | grep -i '^v=DMARC1' || true)"
  [ -n "$dmarc" ] && ok "DMARC: $dmarc" || no "no DMARC record" "TXT on _dmarc.$DOMAIN_MAIL: v=DMARC1; p=none; rua=mailto:<you>"
else
  warn "dig isn't installed, so DNS wasn't checked" "apt-get install -y dnsutils"
fi
warn "Then: console → System → Send me a test, and check it isn't in spam"

echo; echo "5. Operators"
rows="$(psql_q "SELECT email || CASE WHEN mfa_enabled THEN ' on' ELSE ' off' END FROM platform_users WHERE is_active ORDER BY email")"
if [ -z "$rows" ]; then warn "couldn't read operators (is the stack running?)"
else
  while read -r email state; do
    [ "$state" = on ] && ok "$email: two-step on" || no "$email: two-step not set up yet" "sign in to the console once"
  done <<< "$rows"
fi

echo; echo "6. Monitoring"
set_ SENTRY_DSN && ok "error tracking on" || no "SENTRY_DSN not set" "free project at sentry.io (Node.js), paste its DSN, ./infra/deploy.sh"
warn "Can't check this one: an uptime monitor on https://${DOMAIN:-app.os-funding.com}/health/ready"

echo; echo "7. Server hardening"
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then ok "firewall on"; else no "firewall off" "sudo ./infra/harden.sh, then --apply"; fi
if [ -f /etc/ssh/sshd_config.d/90-constructpm.conf ]; then ok "SSH: keys only"; else no "SSH still accepts passwords" "add your key (ssh-copy-id), then harden.sh --apply"; fi
systemctl is-active --quiet fail2ban 2>/dev/null && ok "fail2ban running" || no "fail2ban not running" "harden.sh --apply"
dpkg -s unattended-upgrades >/dev/null 2>&1 && ok "automatic security updates" || no "automatic security updates off" "harden.sh --apply"

echo; echo "8. Malware scanning"
mem_gb="$(awk '/MemTotal/ {printf "%.1f", $2/1048576}' /proc/meminfo)"
if set_ CLAMAV_HOST; then
  ok "scanning configured (server memory ${mem_gb} GB)"
  $COMPOSE ps clamav 2>/dev/null | grep -q healthy && ok "scanner healthy" || warn "scanner not healthy yet" "the first signature download takes a few minutes; check the System tab"
else
  if awk "BEGIN {exit !($mem_gb >= 3.5)}"; then no "scanning off (server has ${mem_gb} GB — enough)" "CLAMAV_HOST=clamav, ./infra/deploy.sh"
  else no "scanning off; server has ${mem_gb} GB" "resize the server to 4 GB or more first (DigitalOcean → Resize)"; fi
fi

echo
if [ "$todo" = 0 ]; then echo "All checks pass. Ready for customers."
else echo "$todo to do. Fix them top to bottom and run this again."; fi
