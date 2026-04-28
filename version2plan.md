# Version 2 Plan — clawd-computer

## Concept

A browser-native crypto+AI desktop environment. Each user gets their own "computer" when they connect their wallet. The desktop has crypto, AI, and media built in as first-class primitives — not plugins.

The host (Austin) streams his desktop live to Twitter/YouTube/Twitch. Viewers watch the desktop as the show. Guests join via WebRTC and appear as video windows on the desktop. Apps are either prompted into existence via AI or installed from a registry of deployed SE2/BGIPFS apps.

---

## Three Layers

### Shell
- Mac OS 9 Platinum aesthetic window manager
- Drag, resize, collapse, z-index stacking
- Desktop icons, taskbar/menu bar
- Per-user desktop state (persisted by wallet address)

### Apps
- Iframe'd SE2/ethskills apps deployed to BGIPFS
- Wallet context injected via `@impersonator/iframe`
- Transaction requests bubble up to parent shell → RainbowKit prompt
- AI reads calldata and gives plain-English summary before user signs
- Apps can be: AI-generated (new), found from registry (existing), or native (built-in)

### Runtime
- **AI** — prompt to find or generate apps, calldata summarizer, general assistant
- **Crypto** — wallet (RainbowKit/wagmi), token balances, SIWE auth
- **Media** — WebRTC video windows (guests), HLS viewer output, OBS stream mode

---

## Desktop State

- Auth: SIWE (Sign-In with Ethereum) — wallet address = account ID
- Storage: backend DB, JSON blob per wallet address
- Portable: sign in from any machine, desktop loads as you left it
- Schema:
  ```json
  {
    "wallet": "0xabc...",
    "desktop": {
      "apps": [
        { "id": "uniswap", "url": "https://...", "position": [120, 80], "size": [800, 600] },
        { "id": "chat",    "url": "/apps/chat",   "position": [900, 40], "size": [400, 500] }
      ],
      "wallpaper": "blue-abstract"
    }
  }
  ```

---

## App Ecosystem

### App Registry
- Curated list of SE2/BGIPFS deployed apps with metadata (name, icon, description, URL)
- AI searches registry when user prompts for an app
- Users can publish their own apps to the registry

### AI App Generation
- Short term: AI finds/configures existing registry apps
- Long term: prompt → Claude generates new SE2 app → deploys to BGIPFS → icon appears on desktop

### Native Built-in Apps
- Chat (viewer messages from clawd-conclave relay)
- Video (WebRTC guest windows)
- Wallet/portfolio
- Terminal (AI assistant)
- App Store / Finder (browse registry)

---

## Media / Live Show

- Guests visit `/join` → share camera/mic → WebRTC P2P connection to host
- Host sees `/backstage` — grid of all connected guests
- Host drags guest onto desktop → video window appears
- `/stage` (or the whole desktop) is captured by OBS as a browser source
- OBS → RTMP → YouTube/Twitter/Twitch
- Viewer chat from clawd-conclave shows up in a chat window on the desktop

### Signaling
- Extend existing relay (already WebSocket) with WebRTC signal message types
- No SFU needed for small guest counts (mesh, direct P2P to host)
- New message types: `guest_join`, `offer`, `answer`, `ice`, `guest_leave`, `stage_update`

---

## Tech Choices

| Concern | Choice | Notes |
|---|---|---|
| Window manager | **Classicy** (patched) | React + TypeScript, Mac OS 9 Platinum aesthetic, actively maintained. Buggy drag behavior needs fixing — plan to fork and patch. |
| Drag/resize fallback | **react-rnd** | If Classicy drag issues can't be fixed, swap underlying drag to react-rnd |
| Iframe wallet injection | **@impersonator/iframe** | Passes wallet context into iframe'd apps; tx requests bubble to parent |
| Auth | **SIWE** | Wallet = account, sign message to load/save desktop state |
| Desktop state | Backend DB (extend relay) | JSON blob per wallet, loaded on SIWE auth |
| Signaling | Extend existing relay | WebSocket, new message types, no separate server needed |
| Styling | Classicy CSS + custom | Override with clawdviction dark palette where needed |
| AI | Claude (Anthropic API) | Calldata summarizer, app finder, app generator |
| App deploy target | BGIPFS | BuidlGuidl IPFS for SE2 app hosting |

---

## Build Order

### Phase 1 — Desktop Shell
- Fork Classicy, fix drag/resize bugs (react-rnd swap if needed)
- Window manager working: open, close, drag, resize, z-index
- Hardcoded desktop with 2-3 placeholder app windows
- Menu bar, desktop icons

### Phase 2 — Identity + State
- SIWE auth flow
- Relay extended to store/load desktop state per wallet
- Desktop persists across machines

### Phase 3 — Native Apps
- Chat window (wire to clawd-conclave relay)
- Iframe browser window (basic URL bar + @impersonator/iframe)
- Wallet/portfolio app

### Phase 4 — Transaction Intercept + AI Summary
- @impersonator/iframe tx bubbling to parent
- AI reads calldata → plain English summary shown before RainbowKit prompt

### Phase 5 — App Registry
- Registry of SE2/BGIPFS apps with metadata
- App Store native app to browse/install
- AI searches registry on prompt

### Phase 6 — Media
- WebRTC guest video windows
- /join, /backstage pages
- Relay extended with signaling message types

### Phase 7 — AI App Generation
- Prompt → Claude generates SE2 app spec
- Deploy to BGIPFS
- Icon appears on desktop

---

## Classicy Notes

- Repo: https://github.com/robbiebyrd/classicy
- Version: v0.8.0 (updated April 2026)
- **Known issue**: Drag behavior is buggy — windows get stuck/glitch during drag
- Plan: Fork and patch. Likely swap underlying drag implementation to react-rnd while keeping Classicy's visual chrome (CSS, title bars, buttons)
- system.css (sakofchit) is an alternative for pure CSS styling but is System 6 era (monochrome, pre-Platinum) — wrong aesthetic
- platinum.css (mat-sz) is closest in spirit but explicitly marked "not ready for use"

---

## Open Questions

- New repo (`clawd-computer`) or extend `clawd-conclave`? (Likely new repo)
- Token gating for guests — need $CLAWD to join a call, or open?
- App registry — on-chain (expensive) or off-chain DB (simple)?
- Multi-host — can multiple people stream their desktop, or just Austin?
