# CLAWD Conclave

A token-gated live broadcast for `$CLAWD` stakers. Holders spend **Conviction (CV)** from [larv.ai](https://larv.ai) to post chat, trigger engagements, and summon the agent — every message baked straight into the broadcast by OBS and restreamed out to YouTube / X.

Think Twitch, but the only currency is conviction — and the whole stack is open-source and forkable, so anyone can run their own conclave with their own token.

**Repo:** [github.com/clawdbotatg/clawd-conclave](https://github.com/clawdbotatg/clawd-conclave) · see [`PLAN.md`](./PLAN.md) for the full architecture and phase plan.

---

## Design principles — CROPs

1. **C**ensorship-resistant — no SaaS in the critical path. Primary deploy is Vercel, but the frontend is also a static build pinned to IPFS for `eth.link` / `eth.limo` access. Streamer's OBS holds all restream keys.
2. **R**eusable / forkable — swap `$CLAWD` for any ERC-20 and `larv.ai` for any CV service via env vars. One command to clone and run.
3. **O**pen source — every component is OSS. MediaMTX for video, Postgres, Fastify, Next.js, Scaffold-ETH 2. No proprietary SDKs.
4. **P**rivate — no tracking, no analytics, no phone-home.
5. **S**ecure — SIWE for auth, signed messages with nonces for every state-changing action, secrets only on the server.

## Architecture

```
  Streamer's OBS ── RTMP ──▶ MediaMTX ── HLS/LL-HLS ──▶ in-app viewers
                     │
                     ├──▶ YouTube Live   (OBS Multi-RTMP, key never leaves OBS)
                     └──▶ X Live         (same)

  viewer browser ─── SIWE + signed CV-spend ──▶ Relay ── larv.ai CV API
                                                  │
                                                  └── Postgres (chat, engagements, nonces)

  viewer browser ─── WebSocket ──▶ Relay /room       (chat feed)
  OBS browser-src ── WebSocket ──▶ Relay /overlay    (chat baked into stream)
```

- **Frontend** (`packages/nextjs/`) — Next.js App Router, wagmi, RainbowKit, DaisyUI. Static-exportable — same build runs on Vercel or gets pinned to IPFS.
- **Relay** (`packages/relay/`) — Fastify + WebSocket + Drizzle. Handles SIWE, CV-spend proxy, chat/engagement fanout.
- **Contracts** (`packages/foundry/`) — SE-2 Foundry. Minimal on-chain footprint; CV stays off-chain in larv.ai.
- **Media** — MediaMTX in docker-compose. RTMP in from OBS, HLS/WebRTC out to browsers.

## Fork it

The whole thing is designed to run with one command after filling in `.env`.

```bash
git clone https://github.com/clawdbotatg/clawd-conclave.git my-conclave
cd my-conclave
cp .env.example .env
cp packages/nextjs/.env.example packages/nextjs/.env.development
# edit .env to set your token address + CV service (defaults: $CLAWD + larv.ai)
yarn install
docker compose up -d     # starts Postgres + MediaMTX + relay
yarn start               # starts the Next.js frontend on :3000
```

To run the conclave for **your own ERC-20**, set these in `.env.development` and redeploy:

```env
NEXT_PUBLIC_TOKEN_ADDRESS=0xYourTokenAddress
NEXT_PUBLIC_TOKEN_SYMBOL=YOURTOKEN
NEXT_PUBLIC_TOKEN_CHAIN_ID=1
NEXT_PUBLIC_CV_API_BASE_URL=https://your-cv-service.example/api/cv
```

## Deploy paths

**Vercel (primary)**

```bash
yarn vercel:yolo --prod
```

**IPFS / ENS (censorship-resistant fallback)**

```bash
yarn ipfs
# → publishes to BGIPFS and prints the CID
# → update your ENS contenthash to point at that CID
# → viewers can now reach the conclave via yourname.eth.limo even if the
#   Vercel deployment goes down
```

**Relay** deploys independently — Docker image via `packages/relay/Dockerfile`, or Fly.io / Railway / a $5 VPS. Vercel serverless works too if you prefer.

## Current status

Phase 0 is in. Landing page shows wallet + `$CLAWD` on-chain balance + CV balance. Relay serves `/health` and `/cv-balance/:address`. Docker-compose spins up Postgres, MediaMTX, and the relay.

See [`PLAN.md`](./PLAN.md) for the full phase breakdown.

## Built on

Scaffold-ETH 2 — [docs.scaffoldeth.io](https://docs.scaffoldeth.io). `AGENTS.md` in this repo is the source of truth for SE-2 conventions.

## License

MIT — see [`LICENCE`](./LICENCE).
