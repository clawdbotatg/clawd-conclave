import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";

/**
 * Fanout manager: spawns ffmpeg children that re-publish the conclave
 * stream to external destinations (YouTube Live, Twitch, X/Twitter Live).
 *
 * Why this lives in the relay (not in MediaMTX's runOnReady): we want
 * admin-toggleable fanout. A streamer should be able to test OBS → conclave
 * without automatically broadcasting to YouTube. stream-fanout.sh still
 * runs on the path's runOnReady, but only for the Opus transcode; external
 * restreams are started/stopped via /admin/fanouts.
 *
 * X/Twitter caveat: studio.x.com generates RTMP keys per-broadcast (or
 * possibly per-recurring-series — TBD). If the key in .env.stream stops
 * working, regenerate it in studio.x.com → Producer and update the env.
 * If that becomes a recurring chore, route X through Restream instead
 * (see git history for the restream destination).
 *
 * Process model: one long-lived ffmpeg per destination, `-c copy` so no
 * transcoding cost. If the child exits unexpectedly (crash, source drops),
 * we just remove it from the registry; user clicks Start again to respawn.
 */

type FanoutId = "youtube" | "twitch" | "twitter" | "kick";

const registry = new Map<FanoutId, ChildProcess>();

export type FanoutDestination = {
  id: FanoutId;
  name: string;
  configured: boolean;
  running: boolean;
  startedAt?: string;
};

const startedAts = new Map<FanoutId, string>();

function destinationUrl(id: FanoutId): string | null {
  if (id === "youtube") {
    const key = process.env.YOUTUBE_STREAM_KEY;
    if (!key) return null;
    const base = process.env.YOUTUBE_RTMP_URL || "rtmp://a.rtmp.youtube.com/live2";
    return `${base}/${key}`;
  }
  if (id === "twitch") {
    const key = process.env.TWITCH_STREAM_KEY;
    if (!key) return null;
    const base = process.env.TWITCH_RTMP_URL || "rtmp://live.twitch.tv/app";
    return `${base}/${key}`;
  }
  if (id === "twitter") {
    const key = process.env.TWITTER_STREAM_KEY;
    if (!key) return null;
    const base = process.env.TWITTER_RTMP_URL || "rtmps://va.pscp.tv:443/x";
    return `${base}/${key}`;
  }
  if (id === "kick") {
    const key = process.env.KICK_STREAM_KEY;
    if (!key) return null;
    // Kick uses Amazon IVS ingest; the publish URL is per-channel and lives
    // in the broadcaster's Stream tab. Strip a trailing slash so the final
    // URL has exactly one slash before the key.
    const raw = process.env.KICK_RTMP_URL ?? "";
    const base = raw.replace(/\/$/, "");
    if (!base) return null;
    return `${base}/${key}`;
  }
  return null;
}

export function listFanouts(): FanoutDestination[] {
  return (["youtube", "twitch", "twitter", "kick"] as const).map(id => ({
    id,
    name:
      id === "youtube"
        ? "YouTube Live"
        : id === "twitch"
          ? "Twitch"
          : id === "twitter"
            ? "X / Twitter Live"
            : id === "kick"
              ? "Kick"
              : id,
    configured: destinationUrl(id) !== null,
    running: registry.has(id),
    startedAt: startedAts.get(id),
  }));
}

export function isRunning(id: FanoutId): boolean {
  return registry.has(id);
}

export function startFanout(id: FanoutId, log: (line: string) => void): { ok: true } | { ok: false; error: string } {
  if (registry.has(id)) return { ok: false, error: "Already running" };
  const url = destinationUrl(id);
  if (!url) return { ok: false, error: `${id} is not configured (missing stream key in .env.stream)` };

  const source = "rtmp://127.0.0.1:1935/live/conclave";
  const proc = spawn(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "warning", "-i", source, "-c", "copy", "-f", "flv", url],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  // Pipe child output to the fastify logger. ffmpeg writes to stderr.
  proc.stdout?.on("data", d => log(`[fanout ${id}] ${d.toString().trim()}`));
  proc.stderr?.on("data", d => log(`[fanout ${id}] ${d.toString().trim()}`));
  proc.on("exit", code => {
    log(`[fanout ${id}] exited with code ${code}`);
    registry.delete(id);
    startedAts.delete(id);
  });

  registry.set(id, proc);
  startedAts.set(id, new Date().toISOString());
  return { ok: true };
}

export function stopFanout(id: FanoutId): { ok: true } | { ok: false; error: string } {
  const proc = registry.get(id);
  if (!proc) return { ok: false, error: "Not running" };
  proc.kill("SIGTERM");
  registry.delete(id);
  startedAts.delete(id);
  return { ok: true };
}

export function isKnownFanoutId(id: string): id is FanoutId {
  return id === "youtube" || id === "twitch" || id === "twitter" || id === "kick";
}

/**
 * SIGTERM all active children on relay shutdown. systemd's stop sequence
 * sends SIGTERM to the whole cgroup anyway, but calling this explicitly on
 * SIGINT/SIGTERM lets ffmpeg close its connection to YouTube cleanly (which
 * YouTube counts as "stream ended" instead of "stream dropped").
 */
export function shutdownAllFanouts(): void {
  for (const [, proc] of registry) {
    proc.kill("SIGTERM");
  }
  registry.clear();
  startedAts.clear();
}
