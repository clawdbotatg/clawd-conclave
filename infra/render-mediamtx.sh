#!/usr/bin/env bash
# Render infra/mediamtx.yml into a gitignored runtime config with env vars
# substituted. MediaMTX v1.17 doesn't reliably substitute ${VAR} in the
# config itself, so we do it at launch time with sed.
#
# Reads env from .env.stream if present (publisher creds, YT stream key).
# Exits non-zero if MEDIAMTX_PUBLISH_USER or MEDIAMTX_PUBLISH_PASS are unset
# — running without auth on an internet-exposed port is a footgun.
#
# Usage: bash infra/render-mediamtx.sh [TEMPLATE] [OUTPUT]

set -euo pipefail

TEMPLATE="${1:-infra/mediamtx.yml}"
OUTPUT="${2:-infra/mediamtx.runtime.yml}"
ENV_FILE="${ENV_FILE:-.env.stream}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${MEDIAMTX_PUBLISH_USER:?MEDIAMTX_PUBLISH_USER not set (add to $ENV_FILE)}"
: "${MEDIAMTX_PUBLISH_PASS:?MEDIAMTX_PUBLISH_PASS not set (add to $ENV_FILE)}"
# WEBRTC_PUBLIC_HOST is the hostname viewers use to reach MediaMTX's WebRTC
# endpoint (typically the media subdomain). If unset, fall back to 127.0.0.1
# so local-only dev still works; server deploys must set it.
: "${WEBRTC_PUBLIC_HOST:=127.0.0.1}"

# sed with `|` delimiter so the hex password never needs escaping. The
# template uses $VARNAME (no braces) — we match exactly that and replace.
sed \
  -e "s|\$MEDIAMTX_PUBLISH_USER|${MEDIAMTX_PUBLISH_USER}|g" \
  -e "s|\$MEDIAMTX_PUBLISH_PASS|${MEDIAMTX_PUBLISH_PASS}|g" \
  -e "s|\$WEBRTC_PUBLIC_HOST|${WEBRTC_PUBLIC_HOST}|g" \
  "$TEMPLATE" > "$OUTPUT"

chmod 600 "$OUTPUT"
echo "rendered $OUTPUT from $TEMPLATE"
