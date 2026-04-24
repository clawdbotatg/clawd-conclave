# CLAWD Conclave — AWS deploy

Single-box deploy onto an Ubuntu host already running nginx + other services.

## Prereqs

1. Ubuntu 22.04+ host with nginx installed, certbot supported, passwordless sudo for the deploy user.
2. DNS: three A records pointing at the host's public IP:
   - `conclave.<yourdomain>` — frontend
   - `relay.<yourdomain>` — relay HTTP + WS
   - `media.<yourdomain>` — HLS playback
3. AWS Security Group inbound rules:
   - 80, 443 TCP (nginx, already open if other sites work)
   - **1935 TCP** (RTMP ingest for OBS)
4. Three env files (see below), rsynced up or created on the server.

## Env files

Gitignored, created manually on the server.

### `packages/relay/.env`
```
PORT=4000
HOST=127.0.0.1
CORS_ORIGINS=https://conclave.larv.ai
CV_API_BASE_URL=https://larv.ai/api/cv
CV_SPEND_SECRET=<from larv.ai>
DATABASE_URL=./data/conclave.db
```

### `packages/nextjs/.env.production`
```
NEXT_PUBLIC_ALCHEMY_API_KEY=<your key>
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=<optional>
NEXT_PUBLIC_TOKEN_ADDRESS=0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07
NEXT_PUBLIC_TOKEN_SYMBOL=CLAWD
NEXT_PUBLIC_TOKEN_CHAIN_ID=1
NEXT_PUBLIC_CV_API_BASE_URL=https://larv.ai/api/cv
NEXT_PUBLIC_RELAY_URL=https://relay.larv.ai
NEXT_PUBLIC_MEDIA_HLS_URL=https://media.larv.ai/live/conclave/index.m3u8
```

### `.env.stream` (required — MediaMTX won't start without the publisher creds)
```
# RTMP publish auth — generate with: openssl rand -hex 16
MEDIAMTX_PUBLISH_USER=conclave
MEDIAMTX_PUBLISH_PASS=<random hex>

# Optional: auto-fanout to YouTube when a stream goes live.
YOUTUBE_STREAM_KEY=<from YouTube Studio>
YOUTUBE_RTMP_URL=rtmp://a.rtmp.youtube.com/live2
```

OBS will use:
- Server: `rtmp://MEDIAMTX_PUBLISH_USER:MEDIAMTX_PUBLISH_PASS@conclave.larv.ai:1935/live`
- Stream Key: `conclave`

## Deploy

```bash
# on your local — rsync env files up (gitignored, so git pull won't move them)
rsync -az packages/relay/.env.production zkllmapi:/home/ubuntu/clawd-conclave/packages/relay/.env
rsync -az packages/nextjs/.env.production zkllmapi:/home/ubuntu/clawd-conclave/packages/nextjs/.env.production
rsync -az .env.stream zkllmapi:/home/ubuntu/clawd-conclave/.env.stream

# on the server
ssh zkllmapi
cd /home/ubuntu/clawd-conclave
git pull
CERTBOT_EMAIL=you@example.com bash infra/deploy/deploy.sh
```

Re-running the script is safe — every step is idempotent.

**Re-deploy after a small change:** if you only changed code, `git pull` +
`infra/deploy/deploy.sh` is enough. If you changed an env value, **re-rsync
the affected `.env` file first** — they're gitignored on both sides, so
`git pull` never moves them.

## OBS

Stream settings:
- Service: Custom
- Server: `rtmp://conclave.larv.ai:1935/live`
- Stream key: `conclave`

Browser source (for chat overlay baked into broadcast):
- URL: `https://conclave.larv.ai/overlay`

## Operate

```bash
systemctl status conclave-relay mediamtx nginx
journalctl -u conclave-relay -f
journalctl -u mediamtx -f
curl https://relay.larv.ai/health
curl https://media.larv.ai/live/conclave/index.m3u8
```
