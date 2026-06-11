#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_DOMAIN="${APP_DOMAIN:-app.frontdesk-ai.cloud}"
APP_URL="https://${APP_DOMAIN}"
ROOT_REDIRECT_DOMAIN="${ROOT_REDIRECT_DOMAIN:-frontdesk-ai.cloud}"
ACME_WEBROOT="/var/www/letsencrypt"
APP_NGINX_SITE_NAME="frontdesk-ai-app"
ROOT_NGINX_SITE_NAME="frontdesk-ai-root-redirect"
APP_NGINX_AVAILABLE="/etc/nginx/sites-available/${APP_NGINX_SITE_NAME}"
APP_NGINX_ENABLED="/etc/nginx/sites-enabled/${APP_NGINX_SITE_NAME}"
ROOT_NGINX_AVAILABLE="/etc/nginx/sites-available/${ROOT_NGINX_SITE_NAME}"
ROOT_NGINX_ENABLED="/etc/nginx/sites-enabled/${ROOT_NGINX_SITE_NAME}"

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

root_redirect_enabled() {
  [ -n "$ROOT_REDIRECT_DOMAIN" ] && [ "$ROOT_REDIRECT_DOMAIN" != "$APP_DOMAIN" ]
}

cert_fullchain_for() {
  printf '/etc/letsencrypt/live/%s/fullchain.pem' "$1"
}

cert_privkey_for() {
  printf '/etc/letsencrypt/live/%s/privkey.pem' "$1"
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
  set_env_value "ROOT_REDIRECT_DOMAIN" "$ROOT_REDIRECT_DOMAIN" ".env.local"
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

disable_legacy_root_sites() {
  if ! root_redirect_enabled; then
    return
  fi

  for site in /etc/nginx/sites-enabled/*; do
    [ -e "$site" ] || continue

    # Skip files we have already disabled in a previous run.
    case "$site" in
      *.disabled-by-frontdesk-ai*)
        # Remove any duplicate ".disabled-by-frontdesk-ai" suffixes that
        # accumulated from previous buggy runs of this script.
        cleaned="${site%%.disabled-by-frontdesk-ai*}.disabled-by-frontdesk-ai"
        if [ "$cleaned" != "$site" ] && [ ! -e "$cleaned" ]; then
          run_root mv "$site" "$cleaned" || true
        elif [ "$cleaned" != "$site" ]; then
          run_root rm -f "$site" || true
        fi
        continue
        ;;
    esac

    local target
    target="$(readlink -f "$site" 2>/dev/null || printf '%s' "$site")"
    if [ "$target" = "$APP_NGINX_AVAILABLE" ] || [ "$target" = "$ROOT_NGINX_AVAILABLE" ]; then
      continue
    fi

    if run_root grep -q "$ROOT_REDIRECT_DOMAIN" "$site"; then
      echo "Disabling legacy Nginx site that also serves ${ROOT_REDIRECT_DOMAIN}: ${site}"
      run_root mv "$site" "${site}.disabled-by-frontdesk-ai"
    fi
  done
}

write_http_nginx_config() {
  run_root mkdir -p "$ACME_WEBROOT"
  disable_legacy_root_sites

  run_root tee "$APP_NGINX_AVAILABLE" >/dev/null <<NGINX
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

  run_root ln -sf "$APP_NGINX_AVAILABLE" "$APP_NGINX_ENABLED"

  if root_redirect_enabled; then
    run_root tee "$ROOT_NGINX_AVAILABLE" >/dev/null <<NGINX
server {
    listen 80;
    server_name ${ROOT_REDIRECT_DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${ACME_WEBROOT};
    }

    location / {
        return 301 ${APP_URL}\$request_uri;
    }
}
NGINX

    run_root ln -sf "$ROOT_NGINX_AVAILABLE" "$ROOT_NGINX_ENABLED"
  fi

  reload_nginx
}

write_https_nginx_config() {
  local app_cert_fullchain
  local app_cert_privkey

  app_cert_fullchain="$(cert_fullchain_for "$APP_DOMAIN")"
  app_cert_privkey="$(cert_privkey_for "$APP_DOMAIN")"

  run_root tee "$APP_NGINX_AVAILABLE" >/dev/null <<NGINX
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

    ssl_certificate ${app_cert_fullchain};
    ssl_certificate_key ${app_cert_privkey};
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

  if root_redirect_enabled; then
    local root_cert_fullchain
    local root_cert_privkey

    root_cert_fullchain="$(cert_fullchain_for "$ROOT_REDIRECT_DOMAIN")"
    root_cert_privkey="$(cert_privkey_for "$ROOT_REDIRECT_DOMAIN")"

    run_root tee "$ROOT_NGINX_AVAILABLE" >/dev/null <<NGINX
server {
    listen 80;
    server_name ${ROOT_REDIRECT_DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${ACME_WEBROOT};
    }

    location / {
        return 301 ${APP_URL}\$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name ${ROOT_REDIRECT_DOMAIN};

    ssl_certificate ${root_cert_fullchain};
    ssl_certificate_key ${root_cert_privkey};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_prefer_server_ciphers off;

    location / {
        return 301 ${APP_URL}\$request_uri;
    }
}
NGINX
  fi

  reload_nginx
}

configure_nginx() {
  install_nginx_tools
  open_web_firewall_ports
  write_http_nginx_config
}

ensure_certificate_for_domain() {
  local domain="$1"
  local cert_fullchain
  local cert_privkey

  cert_fullchain="$(cert_fullchain_for "$domain")"
  cert_privkey="$(cert_privkey_for "$domain")"

  if [ ! -f "$cert_fullchain" ] || [ ! -f "$cert_privkey" ]; then
    run_root certbot certonly \
      --webroot \
      --webroot-path "$ACME_WEBROOT" \
      --non-interactive \
      --agree-tos \
      --register-unsafely-without-email \
      --cert-name "$domain" \
      --expand \
      -d "$domain"
  else
    run_root certbot renew --quiet || echo "Certificate renewal check failed; keeping the current certificate." >&2
  fi

  if [ ! -f "$cert_fullchain" ] || [ ! -f "$cert_privkey" ]; then
    echo "HTTPS certificate was not created for ${domain}." >&2
    exit 1
  fi
}

ensure_certificate() {
  ensure_certificate_for_domain "$APP_DOMAIN"
  if root_redirect_enabled; then
    ensure_certificate_for_domain "$ROOT_REDIRECT_DOMAIN"
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
15 1 * * * ${deploy_user} flock -n /tmp/frontdesk-ai-cap-reset.lock curl -fsS -X POST -H 'x-runner-secret: ${cron_secret}' http://127.0.0.1:3000/api/cron/ai-cap-reset >/dev/null 2>&1
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
      if root_redirect_enabled; then
        root_final_url="$(
          curl --fail --location --silent --show-error --retry 5 --retry-delay 3 --retry-all-errors --max-time 10 \
            --output /dev/null \
            --write-out '%{url_effective}' \
            "https://${ROOT_REDIRECT_DOMAIN}/login"
        )"

        if [ "$root_final_url" != "${APP_URL}/login" ]; then
          echo "Root domain redirect ended at ${root_final_url}, expected ${APP_URL}/login." >&2
          exit 1
        fi
      fi

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
