#!/usr/bin/env bash
#
# One-shot deploy script for the CLAWD Conclave stack onto an Ubuntu host
# that is already running other services (nginx + other sites). Designed
# to be re-run safely: every step is idempotent.
#
# Usage (from the server, after cloning this repo into /home/ubuntu/clawd-conclave):
#
#   cd /home/ubuntu/clawd-conclave
#   bash infra/deploy/deploy.sh
#
# Prereqs this script will NOT do for you:
#   1. `packages/relay/.env` must exist with CV_SPEND_SECRET, DATABASE_URL,
#      CORS_ORIGINS=https://conclave.larv.ai (rsync it up from your local
#      or create it manually).
#   2. `packages/nextjs/.env.production` must exist with the production
#      NEXT_PUBLIC_* vars baked in (ALCHEMY key, RELAY/MEDIA URLs, etc.).
#   3. `.env.stream` (optional) with YOUTUBE_STREAM_KEY if you want MediaMTX
#      to auto-fan out to YouTube on every session.
#   4. AWS Security Group inbound 1935/tcp for OBS RTMP ingest.
#   5. DNS A records for conclave.larv.ai / relay.larv.ai / media.larv.ai
#      pointing at this host.

set -euo pipefail

REPO=/home/ubuntu/clawd-conclave
MEDIAMTX_VERSION="${MEDIAMTX_VERSION:-v1.17.1}"

say() { printf "\033[1;36m==>\033[0m %s\n" "$*"; }
need_sudo() { sudo -n true 2>/dev/null || { echo "This script needs passwordless sudo"; exit 1; }; }

cd "$REPO"
need_sudo

# --- system packages ------------------------------------------------------
say "installing apt packages (ffmpeg, certbot, etc)"
sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  ffmpeg \
  certbot python3-certbot-nginx

# --- mediamtx binary ------------------------------------------------------
if ! command -v mediamtx >/dev/null 2>&1 || [[ "$(mediamtx --help 2>&1 | head -1)" != *"$MEDIAMTX_VERSION"* ]]; then
  say "installing mediamtx $MEDIAMTX_VERSION"
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64)  MTX_ARCH=amd64 ;;
    aarch64) MTX_ARCH=arm64v8 ;;
    *) echo "unsupported arch: $ARCH"; exit 1 ;;
  esac
  TMPDIR=$(mktemp -d)
  URL="https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/mediamtx_${MEDIAMTX_VERSION}_linux_${MTX_ARCH}.tar.gz"
  curl -sfL "$URL" | tar xz -C "$TMPDIR"
  sudo install -m 0755 "$TMPDIR/mediamtx" /usr/local/bin/mediamtx
  rm -rf "$TMPDIR"
fi
mediamtx --help >/dev/null 2>&1 || mediamtx 2>&1 | head -1

# --- yarn / node deps -----------------------------------------------------
if ! command -v yarn >/dev/null 2>&1; then
  say "enabling corepack for yarn"
  sudo corepack enable
fi
say "installing node_modules (yarn workspaces)"
yarn install --immutable

# --- build frontend -------------------------------------------------------
say "building frontend (static export)"
( cd packages/nextjs && NEXT_PUBLIC_IPFS_BUILD=true yarn build )
test -f packages/nextjs/out/index.html || { echo "frontend build didn't produce out/index.html"; exit 1; }

# --- render mediamtx runtime config --------------------------------------
say "rendering mediamtx runtime config from env"
bash infra/render-mediamtx.sh

# --- init SQLite + push schema -------------------------------------------
say "pushing relay DB schema"
( cd packages/relay && mkdir -p data && yarn db:push )

# --- systemd units -------------------------------------------------------
say "installing systemd units"
sudo install -m 0644 infra/deploy/mediamtx.service        /etc/systemd/system/mediamtx.service
sudo install -m 0644 infra/deploy/conclave-relay.service  /etc/systemd/system/conclave-relay.service
sudo systemctl daemon-reload
sudo systemctl enable --now mediamtx.service
sudo systemctl enable --now conclave-relay.service

# --- nginx sites ---------------------------------------------------------
say "installing nginx sites (not enabling HTTPS yet — certbot does that)"
sudo install -m 0644 infra/deploy/nginx/conclave.larv.ai.conf /etc/nginx/sites-available/conclave.larv.ai
sudo install -m 0644 infra/deploy/nginx/relay.larv.ai.conf    /etc/nginx/sites-available/relay.larv.ai
sudo install -m 0644 infra/deploy/nginx/media.larv.ai.conf    /etc/nginx/sites-available/media.larv.ai
for s in conclave.larv.ai relay.larv.ai media.larv.ai; do
  sudo ln -sf "/etc/nginx/sites-available/$s" "/etc/nginx/sites-enabled/$s"
done
sudo nginx -t
sudo systemctl reload nginx

# --- TLS via certbot -----------------------------------------------------
say "provisioning TLS certs (non-interactive)"
if [[ -z "${CERTBOT_EMAIL:-}" ]]; then
  echo "Set CERTBOT_EMAIL before running the script (e.g. CERTBOT_EMAIL=you@example.com bash ...)"
  exit 1
fi
sudo certbot --nginx --non-interactive --agree-tos --redirect \
  -m "$CERTBOT_EMAIL" \
  -d conclave.larv.ai -d relay.larv.ai -d media.larv.ai

# --- done ---------------------------------------------------------------
say "deploy complete"
echo
echo "  Frontend:   https://conclave.larv.ai"
echo "  Relay:      https://relay.larv.ai/health"
echo "  Media HLS:  https://media.larv.ai/live/conclave/index.m3u8"
echo "  OBS RTMP:   rtmp://conclave.larv.ai:1935/live  (stream key: conclave)"
echo
echo "  systemctl status conclave-relay mediamtx nginx"
