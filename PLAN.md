# CLAWD Conclave — Build Plan

A token-gated live streaming "conclave" for $CLAWD stakers. Austin streams from OBS; $CLAWD holders who have staked on [larv.ai](https://larv.ai) spend **Conviction (CV)** to post chat, trigger engagements, and talk to an on-stream AI agent. Chat + engagements are baked into the broadcast pixels by OBS, then multi-restreamed to Twitter/X and YouTube from OBS itself. In-app viewers watch via the app's own media server.

Think: Twitch, but the only currency is conviction — and the whole stack is open source and forkable so anyone can run their own conclave with their own token.

---

## Design principles (CROPs)

1. **Censorship-resistant** — no SaaS in the critical path that can kill a stream. Primary deploy is Vercel + an owned relay, but the frontend is a static build that can also be pinned to IPFS and served via `eth.link` / `eth.limo`. Streamer's OBS holds all restream keys (YouTube/X) — no central server can be pressured to drop a destination.
2. **Open source** — every component is OSS. No LiveKit Cloud, no Mux, no Twilio. Self-hosted media server (MediaMTX, Apache-2.0, one Go binary).
3. **Private** — no tracking pixels, no third-party analytics, no wallet-address telemetry. Viewers load only assets from the conclave's own origin + the media server.
4. **Secure** — SIWE for auth, signed messages with nonces for every state-changing action, secrets only in server-only routes.
5. **Forkable** — token-agnostic. A forker swaps `$CLAWD` → their ERC-20 and `larv.ai` → their CV service via env vars. No code edits. Target: `git clone && cp .env.example .env && docker compose up`.

---

## Architecture

```
                                  ┌─────────────────────────┐
                                  │  larv.ai CV API         │
                                  │  (or any CV_API_BASE_URL│ fork-configurable
                                  │   a forker runs)        │
                                  └────────▲────────────────┘
                                           │ server-side spend
                                           │ (CV_SPEND_SECRET)
                                           │
  Streamer's Mac                           │
  ┌────────────────────────┐               │         ┌───────────────────────────┐
  │                        │               │         │  Conclave Relay (Node)    │
  │   OBS Studio           │               └─────────│  ─ SIWE auth              │◀── viewer browsers
  │                        │                         │  ─ CV-spend proxy         │    (SIWE + signed
  │   Sources:             │                         │  ─ chat/engagement fanout │     CV spends)
  │  ─ webcam              │   ◀ WebSocket ──────────│  ─ WS /overlay, /room     │
  │  ─ browser source:     │                         │  ─ MediaMTX admin API     │
  │    overlay.html        │                         │    (token mint for pull)  │
  │  ─ (phase 5) AI audio  │                         └────────────▲──────────────┘
  │    via BlackHole       │                                      │
  └──┬─────────────────────┘                                      │
     │                                                            │
     │ RTMP push (OBS Multi-RTMP)                                 │
     │                                                            │
     ├────────────▶  our MediaMTX  ──── HLS/LL-HLS (hls.js) ─────▶┴─ /live page
     │              (self-hosted,        WebRTC (optional)
     │               Docker, OSS)
     │
     ├────────────▶  youtube.com/live (streamer's key, never leaves OBS)
     │
     └────────────▶  x.com/live        (streamer's key, never leaves OBS)
```

**Why OBS is the compositor:** chat/engagement overlays need to appear in the pixels that go to YouTube/X. OBS already does this and it's free/open. We ship an HTML overlay page; OBS renders it as a Browser Source over the webcam.

**Why OBS Multi-RTMP (streamer-side restream) beats server-side restream:** keys stay on the streamer's machine — nothing on our server or any fork's server can be subpoenaed or pressured to drop a destination. One step less infra for a forker to run. Tradeoff: streamer uses a bit more upload bandwidth (stream 3×). Acceptable.

**Why MediaMTX over LiveKit:** MediaMTX is a single open-source Go binary that accepts RTMP and outputs HLS, LL-HLS, WebRTC, RTSP. Zero SaaS dependency, zero API keys from any provider, runs on a $5 VPS or a forker's laptop. LiveKit (self-hosted) would also satisfy CROPs but is heavier to run. MediaMTX latency with LL-HLS is ~2s — plenty for this use case.

---

## What is "LiveKit" / why we're not using it

LiveKit is a hosted WebRTC platform (like Twilio-for-video). Earlier draft of this plan used LiveKit Cloud for lowest-latency video. After the CROPs pivot: LiveKit is dropped in favor of self-hosted MediaMTX so the stack has zero required SaaS dependency beyond Alchemy RPC (which itself has a CROPs fallback via any public RPC or a forker's own node).

---

## Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Contracts | Scaffold-ETH 2 (Foundry) | house standard |
| Frontend | Next.js App Router, **`output: 'export'` compatible** (static) | same build runs on Vercel AND IPFS/ENS |
| Wallet + auth | RainbowKit + wagmi + **SIWE** (`.agents/skills/siwe`) | standard, works client-side only |
| Off-chain state | **Postgres via Drizzle** (`.agents/skills/drizzle-neon` as reference) | sessions, chat, engagements, nonces. Hosted on Neon in primary deploy; forker can run `postgres:16` in docker-compose |
| Realtime | WebSocket (`ws` lib) | simple, no extra infra |
| Video | **MediaMTX** (OSS Go, single binary, docker) | accepts RTMP from OBS, serves HLS/LL-HLS/WebRTC |
| Restream out | **OBS Multi-RTMP plugin** (streamer-side) | keys never touch our server |
| CV spend | EIP-191 signed `"larv.ai CV Spend"` → relay → `CV_API_BASE_URL/spend` | confirmed via `leftclaw-service-job-66`; see CV Integration below |
| On-chain reads | viem via `NEXT_PUBLIC_ALCHEMY_API_KEY` (CLAUDE.md mandates Alchemy) | no public RPCs |
| AI agent (phase 5) | Node service: Claude → ElevenLabs TTS → BlackHole virtual audio → OBS | local, all OSS except the two AI APIs which are fork-configurable |

---

## CV integration — confirmed spec

Pulled from `clawdbotatg/leftclaw-service-job-66/packages/nextjs/lib/server/pfpApi.ts`. Saved to memory as `reference_cv_integration`.

**Balance (public)**: `GET https://larv.ai/api/cv/balance?address=<wallet>` → `{success, balance}` (treat `success:false` as balance 0).

**Spend (server-only)**:
```
POST https://larv.ai/api/cv/spend
Content-Type: application/json
{ wallet, amount, secret: CV_SPEND_SECRET, signature }
→ { success, newBalance, error? }
```

**User's signature** is an EIP-191 `personal_sign` over the literal string `"larv.ai CV Spend"`. One signature authorizes all subsequent spends for that wallet — we cache it per-session in localStorage (server never stores it). Do NOT verify the signature locally: larv.ai is authoritative because ERC-1271 smart-wallet sigs depend on chain_id.

**Ordering rule** (from the reference repo, matters here too): do all work that could fail cheaply *before* calling `spendCv`. larv.ai has no programmatic refund — any failure after charge needs a `[RECONCILE]` log line for manual refund.

**Env vars** (server-only unless noted):
```
# --- Public ---
NEXT_PUBLIC_ALCHEMY_API_KEY
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID
NEXT_PUBLIC_TOKEN_ADDRESS          # default: 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07 ($CLAWD)
NEXT_PUBLIC_TOKEN_SYMBOL           # default: CLAWD
NEXT_PUBLIC_TOKEN_CHAIN_ID         # default: 1 (mainnet)
NEXT_PUBLIC_RELAY_URL              # forker points the static frontend at their own relay
NEXT_PUBLIC_MEDIA_HLS_URL          # MediaMTX HLS playlist URL (usually {relay}/hls/...)
# --- Server-only ---
CV_API_BASE_URL                    # default: https://larv.ai/api/cv
CV_SPEND_SECRET                    # larv.ai-issued shared secret
DATABASE_URL                       # Postgres
SIWE_SESSION_SECRET                # for signed session cookies
ADMIN_ADDRESSES                    # comma-sep; only these can start/stop sessions
MEDIA_RTMP_INGRESS_URL             # shown in /admin for copy-paste into OBS
```

---

## Routes & services

### Next.js pages (`packages/nextjs/app/`) — static-export compatible
- `/` — landing, SIWE sign-in, shows CV balance + current live-session banner
- `/live/[session]` — viewer: HLS player (hls.js) + CV-priced action bar (comment, tip, poll, soundboard, ask AI)
- `/overlay/[session]` — transparent overlay rendered by OBS as a Browser Source; animates chat + engagements; no chrome
- `/admin` — gated to `ADMIN_ADDRESSES`. Start/stop session, copy RTMP ingress URL + stream key, show restream-setup instructions for OBS, edit CV prices, moderate
- `/fork` — one-click "how to run your own" — docker-compose snippet, env template, deploy instructions. Part of the CROPs story.

All pages use wagmi/SIWE purely client-side. Any server work happens against `NEXT_PUBLIC_RELAY_URL`, not Next.js API routes. This is what makes the frontend static-export-compatible.

### Relay server (`packages/relay/`)
Standalone Node/TS server (fastify or express + ws). Deployable on Vercel serverless OR as a docker container. Forkers pick their deploy target.

- `POST /auth/siwe` — verify SIWE message, return signed session cookie
- `POST /chat` — body: `{sessionId, message, signature, nonce}` → verify nonce/session → call CV spend → insert → broadcast on WS
- `POST /engagement/:type` — same shape, type-specific CV cost
- `GET /cv-balance/:wallet` — proxies larv.ai (pure passthrough; exists so ENS-hosted frontends can hit one URL)
- `POST /admin/session/start` — SIWE + admin gate → create session row, return RTMP ingress URL + auto-generated stream key → call MediaMTX admin API to authorize the publisher
- `POST /admin/session/stop` — end session
- `WS /overlay/:session` — transparent overlay subscribes
- `WS /room/:session` — in-app viewers subscribe

### Contracts (`packages/foundry/contracts/`)
Minimal for v0. Optional tiny `ConclaveLog.sol` that emits `SessionStarted(host, sessionId, metadataURI)` / `SessionEnded(sessionId)` — gives us on-chain provenance of when a host went live without leaking chat content. Decision deferred; not blocking.

### Off-chain schema (Drizzle)
```
sessions   (id, host_address, started_at, ended_at, media_stream_key_hash, restream_note)
messages   (id, session_id, address, body, cv_cost, nonce, sig, created_at)
engagements(id, session_id, address, type, payload_json, cv_cost, nonce, sig, created_at)
nonces     (address, nonce, used_at)           -- PK (address, nonce)
prices     (action, cv_cost)                   -- editable from /admin
```

---

## Phases

### Phase 0 — Foundation + CROPs scaffolding *(ship first)*
- [ ] Read `.agents/skills/siwe/SKILL.md` and `.agents/skills/drizzle-neon/SKILL.md`
- [ ] Configure Next.js for static export; verify `yarn build` produces an `out/` dir that works without a server
- [ ] Create `packages/relay/` (fastify + ws + drizzle + postgres)
- [ ] Top-level `docker-compose.yml` spinning up: postgres, mediamtx, relay
- [ ] Root README: one-command fork instructions (clone → `.env` → `docker compose up`)
- [ ] `/fork` page mirroring README
- [ ] Add $CLAWD mainnet to `scaffold.config.ts` (Alchemy-only per CLAUDE.md)
- [ ] Register the token in `externalContracts.ts`, behind `NEXT_PUBLIC_TOKEN_ADDRESS`
- [ ] Landing page: SIWE sign-in, shows $CLAWD on-chain balance AND CV balance from larv.ai

### Phase 1 — CV-gated chat (no video yet)
- [ ] Relay `POST /chat` with signed `"larv.ai CV Spend"` + `{sessionId, message, nonce}`
- [ ] Nonce table rejects reuse
- [ ] Relay verifies session + nonce, proxies CV spend to `CV_API_BASE_URL`, inserts, broadcasts on WS
- [ ] `/live/[session]` without video: chat column only, "post (1 CV)" button
- [ ] `/overlay/[session]`: transparent, Twitch-style lower-third animations

### Phase 2 — Self-hosted video
- [ ] MediaMTX config with RTMP input + HLS/LL-HLS output
- [ ] `/admin`: "Start session" creates session, generates stream key, writes to MediaMTX config via its HTTP admin API, copies `rtmp://<host>/live/<streamKey>` to clipboard
- [ ] `/live/[session]`: hls.js player subscribed to the LL-HLS URL; ~2s latency
- [ ] End-to-end: OBS pushes → viewers see video + overlay chat baked in
- [ ] OBS setup doc in README: add webcam, add browser source pointing at `<relay>/overlay/<session>`

### Phase 3 — Engagements (paid interactions)
- [ ] Editable price table in `/admin`
- [ ] v0 action set: **comment** (cheapest), **tip** (highlighted bubble), **poll vote**, **soundboard** (triggers a named sfx cue on overlay), **hype meter** (fills a bar)
- [ ] Each is a signed `/engagement/:type` call with its own CV cost

### Phase 4 — Multi-destination streaming
- [ ] Doc: enable OBS Multi-RTMP plugin, add YouTube and X Live RTMP URLs + keys (kept on streamer's machine)
- [ ] `/admin` surfaces a checklist, not configuration — streamer's keys never touch our server
- [ ] (Optional CROPs-compatible fallback) a `packages/egress/` docker service that a forker who wants server-side restream can run themselves. Default off.

### Phase 5 — AI agent
- [ ] `packages/ai-agent/` Node service, local-only
- [ ] "Ask AI" engagement (highest CV cost) → relay queues the prompt
- [ ] Claude generates response → ElevenLabs TTS → audio played through BlackHole virtual output
- [ ] OBS picks up BlackHole as second mic — response baked into stream
- [ ] Overlay renders animated character card while voice plays (pulse on RMS)

### Phase 6 — ENS/IPFS deploy path
- [ ] `yarn build:static && yarn deploy:ipfs` — pin to IPFS, update ENS contenthash
- [ ] Document on `/fork`: "even if the Vercel site goes down, viewers load the ENS copy and point it at any relay URL"
- [ ] Test from a fresh device with no Vercel access

### Phase 7 — Polish
- [ ] Rate-limits per address (in-memory per lambda + optional Redis for multi-instance)
- [ ] Moderation: admin can hide messages; overlay respects hidden flag
- [ ] Session replay: `/sessions/[id]` renders the chat/engagement log over a re-hosted VOD
- [ ] Mobile viewer layout
- [ ] i18n-ready (CROPs: low-friction fork for non-English communities)

---

## Open questions

1. **Minimum $CLAWD / CV gate** — default "any CV > 0 to post, any wallet to watch"?
2. **Admin address** — `austin.griffith.eth`, or a dedicated conclave bot?
3. **MediaMTX host** — where does the primary MediaMTX instance live? Vercel can't host it (long-lived RTMP connection). A $5 VPS, your own box, or something like Fly.io?
4. **ENS name** — what's the target? `clawdconclave.eth`? Need contenthash write access.
5. **AI agent voice** — ElevenLabs voice ID? Default brand voice if one exists.

---

## Non-goals (v0)

- On-chain CV accounting — stays in larv.ai
- Viewer webcams / guest-on-stream — single host feed
- Mobile broadcasting
- Recording/VOD (phase 7)
- HeyGen/D-ID avatar
- Multi-host simultaneous

---

## Reference

- `clawdbotatg/leftclaw-service-job-66` — CV-spend flow; key file `packages/nextjs/lib/server/pfpApi.ts`
- Scaffold-ETH 2 `AGENTS.md` — authoritative for scaffold conventions
- `.agents/skills/siwe/SKILL.md` — auth
- `.agents/skills/drizzle-neon/SKILL.md` — off-chain storage
- [MediaMTX](https://github.com/bluenviron/mediamtx) — OSS media server
- OBS Multi-RTMP plugin — [github.com/sorayuki/obs-multi-rtmp](https://github.com/sorayuki/obs-multi-rtmp)
