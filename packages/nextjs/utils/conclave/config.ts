/**
 * Fork-configurable conclave settings. All values have $CLAWD / larv.ai
 * defaults so the default build works out of the box, but anyone forking
 * can swap the token and CV backend by setting these env vars.
 *
 * Static exports (IPFS/ENS) bake these at build time — forkers produce
 * their own build and pin their own IPFS artifact.
 */

export const CONCLAVE_TOKEN_ADDRESS =
  (process.env.NEXT_PUBLIC_TOKEN_ADDRESS as `0x${string}`) ?? "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07";

export const CONCLAVE_TOKEN_SYMBOL = process.env.NEXT_PUBLIC_TOKEN_SYMBOL ?? "CLAWD";

export const CONCLAVE_TOKEN_CHAIN_ID = Number(process.env.NEXT_PUBLIC_TOKEN_CHAIN_ID ?? 1);

// CV service — defaults to larv.ai. Fork can point at a self-hosted CV service.
export const CONCLAVE_CV_API_BASE_URL = process.env.NEXT_PUBLIC_CV_API_BASE_URL ?? "https://larv.ai/api/cv";

// Relay server — used for authenticated endpoints (SIWE, /chat, /engagement)
// and as an optional CORS-friendly proxy for CV balance reads.
export const CONCLAVE_RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? "";

// MediaMTX HLS playlist URL. Default uses the local brew/docker MediaMTX
// with OBS pushing to path `live/conclave`. Forkers point this at their
// own media server in production.
export const CONCLAVE_MEDIA_HLS_URL =
  process.env.NEXT_PUBLIC_MEDIA_HLS_URL ?? "http://localhost:8888/live/conclave/index.m3u8";

// WHEP (WebRTC-HTTP Egress Protocol) endpoint for sub-second playback.
// Player tries this first, falls back to HLS on failure.
//
// Note the path is `live/conclave-rtc`, not `live/conclave`. OBS ingests
// AAC audio on `live/conclave`, which WebRTC can't carry; a server-side
// ffmpeg transcodes to Opus and republishes on `live/conclave-rtc`. HLS
// keeps pulling from the original so it gets untouched AAC.
export const CONCLAVE_MEDIA_WHEP_URL =
  process.env.NEXT_PUBLIC_MEDIA_WHEP_URL ?? "http://localhost:8889/live/conclave-rtc/whep";

export const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;
