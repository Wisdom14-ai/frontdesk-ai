#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_DOMAIN="${APP_DOMAIN:-app.frontdesk-ai.cloud}"
APP_URL="https://${APP_DOMAIN}"
ACME_WEBROOT="/var/www/letsencrypt"
NGINX_SITE_NAME="frontdesk-ai-app"
NGINX_AVAILABLE="/etc/nginx/sites-available/${NGINX_SITE_NAME}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"
CERT_FULLCHAIN="/etc/letsencrypt/live/${APP_DOMAIN}/fullchain.pem"
CERT_PRIVKEY="/etc/letsencrypt/live/${APP_DOMAIN}/privkey.pem"

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "Root privileges or sudo are required to configure Nginx and SSL." >&2
    exit 1
  fi
}

set_env_value() {
  local key="$1"
  local value="$2"
  local file="$3"
  local tmp_file

  touch "$file"

  if grep -q "^${key}=" "$file"; then
    tmp_file="$(mktemp)"
    awk -v key="$key" -v value="$value" '
      BEGIN { prefix = key "=" }
      index($0, prefix) == 1 { print key "=" value; next }
      { print }
    ' "$file" > "$tmp_file"
    cat "$tmp_file" > "$file"
    rm -f "$tmp_file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

get_env_value() {
  local key="$1"
  local file="$2"

  if [ ! -f "$file" ]; then
    return 0
  fi

  awk -v key="$key" '
    BEGIN { prefix = key "=" }
    index($0, prefix) == 1 {
      sub(prefix, "", $0)
      print $0
      exit
    }
  ' "$file"
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  fi
}

ensure_env_secret() {
  local key="$1"
  local file="$2"
  local current_value

  current_value="$(get_env_value "$key" "$file" | tr -d '\r\n')"
  if [ -z "$current_value" ]; then
    set_env_value "$key" "$(generate_secret)" "$file"
  fi
}

configure_environment() {
  set_env_value "APP_BASE_URL" "$APP_URL" ".env.local"
  set_env_value "NEXT_PUBLIC_APP_URL" "$APP_URL" ".env.local"
  ensure_env_secret "CRON_SECRET" ".env.local"
}

install_nginx_tools() {
  if ! command -v apt-get >/dev/null 2>&1; then
    if command -v nginx >/dev/null 2>&1 && command -v certbot >/dev/null 2>&1; then
      return
    fi

    echo "apt-get is not available and nginx/certbot are not installed." >&2
    exit 1
  fi

  if ! command -v nginx >/dev/null 2>&1 || ! command -v certbot >/dev/null 2>&1; then
    run_root apt-get update
    run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y nginx certbot
  fi
}

open_web_firewall_ports() {
  if command -v ufw >/dev/null 2>&1 && run_root ufw status | grep -q "Status: active"; then
    run_root ufw allow 80/tcp
    run_root ufw allow 443/tcp
  fi
}

reload_nginx() {
  run_root nginx -t

  if command -v systemctl >/dev/null 2>&1; then
    run_root systemctl enable --now nginx
    run_root systemctl reload nginx
  else
    run_root service nginx reload
  fi
}

write_http_nginx_config() {
  run_root mkdir -p "$ACME_WEBROOT"
  run_root tee "$NGINX_AVAILABLE" >/dev/null <<NGINX
server {
    listen 80;
    server_name ${APP_DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${ACME_WEBROOT};
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX

  run_root ln -sf "$NGINX_AVAILABLE" "$NGINX_ENABLED"
  reload_nginx
}

write_https_nginx_config() {
  run_root tee "$NGINX_AVAILABLE" >/dev/null <<NGINX
server {
    listen 80;
    server_name ${APP_DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${ACME_WEBROOT};
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name ${APP_DOMAIN};

    ssl_certificate ${CERT_FULLCHAIN};
    ssl_certificate_key ${CERT_PRIVKEY};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_prefer_server_ciphers off;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX

  reload_nginx
}

configure_nginx() {
  install_nginx_tools
  open_web_firewall_ports
  write_http_nginx_config
}

ensure_certificate() {
  if [ ! -f "$CERT_FULLCHAIN" ] || [ ! -f "$CERT_PRIVKEY" ]; then
    run_root certbot certonly \
      --webroot \
      --webroot-path "$ACME_WEBROOT" \
      --non-interactive \
      --agree-tos \
      --register-unsafely-without-email \
      --cert-name "$APP_DOMAIN" \
      --expand \
      -d "$APP_DOMAIN"
  else
    run_root certbot renew --quiet || echo "Certificate renewal check failed; keeping the current certificate." >&2
  fi

  if [ ! -f "$CERT_FULLCHAIN" ] || [ ! -f "$CERT_PRIVKEY" ]; then
    echo "HTTPS certificate was not created for ${APP_DOMAIN}." >&2
    exit 1
  fi

  write_https_nginx_config
}

configure_runner_cron() {
  local cron_secret
  local deploy_user
  local cron_file="/etc/cron.d/frontdesk-ai-runners"

  cron_secret="$(get_env_value "CRON_SECRET" ".env.local" | tr -d '\r\n')"
  if [ -z "$cron_secret" ]; then
    echo "CRON_SECRET is missing; skipping runner cron installation." >&2
    return
  fi

  deploy_user="$(id -un)"

  run_root tee "$cron_file" >/dev/null <<CRON
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

*/5 * * * * ${deploy_user} flock -n /tmp/frontdesk-ai-automation.lock curl -fsS -X POST -H 'x-runner-secret: ${cron_secret}' http://127.0.0.1:3000/api/automation/run-due >/dev/null 2>&1
*/5 * * * * ${deploy_user} flock -n /tmp/frontdesk-ai-campaigns.lock curl -fsS -X POST -H 'x-runner-secret: ${cron_secret}' http://127.0.0.1:3000/api/campaigns/run-due >/dev/null 2>&1
*/15 * * * * ${deploy_user} flock -n /tmp/frontdesk-ai-contact-memory.lock curl -fsS -X POST -H 'x-runner-secret: ${cron_secret}' http://127.0.0.1:3000/api/contact-memory/run-due >/dev/null 2>&1
CRON

  run_root chmod 644 "$cron_file"

  if command -v systemctl >/dev/null 2>&1; then
    run_root systemctl enable --now cron >/dev/null 2>&1 || run_root systemctl enable --now crond >/dev/null 2>&1 || true
  fi
}

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 is required on the VPS." >&2
  exit 1
fi

configure_environment
configure_nginx

npm ci --include=dev --no-audit --no-fund
npm run build
pm2 startOrReload ecosystem.config.cjs --only frontdesk-ai --update-env
pm2 save
configure_runner_cron

echo "Waiting for frontdesk-ai to become healthy on http://127.0.0.1:3000/login..."
for attempt in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1:3000/login >/dev/null 2>&1; then
    echo "frontdesk-ai is healthy. Checking HTTPS certificate and public endpoint..."
    ensure_certificate
    if curl --fail --silent --show-error --retry 5 --retry-delay 3 --retry-all-errors --max-time 10 "${APP_URL}/login" >/dev/null; then
      echo "Deployment completed and ${APP_URL}/login is reachable."
    elif curl --fail --silent --show-error --insecure --max-time 10 "${APP_URL}/login" >/dev/null; then
      echo "Deployment completed, but HTTPS verification failed from the runner. The app is reachable; check the public certificate chain if this warning repeats." >&2
    else
      echo "${APP_URL}/login is not reachable from the public endpoint." >&2
      exit 1
    fi
    exit 0
  fi

  if [ $((attempt % 5)) -eq 0 ]; then
    echo "Still waiting for frontdesk-ai health check... (${attempt}/60)"
  fi

  sleep 2
done

echo "frontdesk-ai did not become healthy on http://127.0.0.1:3000/login" >&2
exit 1
