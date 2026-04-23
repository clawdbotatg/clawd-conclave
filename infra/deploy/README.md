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

### `.env.stream` (optional)
```
YOUTUBE_STREAM_KEY=<from YouTube Studio>
YOUTUBE_RTMP_URL=rtmp://a.rtmp.youtube.com/live2
```

## Deploy

```bash
# on your local
rsync -a packages/relay/.env zkllmapi:/home/ubuntu/clawd-conclave/packages/relay/.env
rsync -a packages/nextjs/.env.production zkllmapi:/home/ubuntu/clawd-conclave/packages/nextjs/.env.production
# (optional) rsync .env.stream similarly

# on the server
ssh zkllmapi
cd /home/ubuntu/clawd-conclave
git pull
CERTBOT_EMAIL=you@example.com bash infra/deploy/deploy.sh
```

Re-running the script is safe — every step is idempotent.

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
