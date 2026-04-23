"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

type Status = "idle" | "loading" | "playing" | "offline" | "error";

/**
 * Low-latency HLS player for the conclave stream. Uses native HLS on Safari
 * (which handles LL-HLS fine) and falls back to hls.js everywhere else.
 * Polls the playlist while offline so the player flips to "playing" as soon
 * as OBS starts pushing.
 */
export function HlsPlayer({ src, autoplay = true }: { src: string; autoplay?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const nativeSupport = video.canPlayType("application/vnd.apple.mpegurl") !== "";

    const poll = async () => {
      // Check whether the playlist exists before attaching — cheaper signal
      // than waiting for hls.js to emit errors.
      try {
        const res = await fetch(src, { method: "HEAD", cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setStatus("offline");
          retryTimeout = setTimeout(poll, 3000);
          return;
        }
      } catch {
        if (cancelled) return;
        setStatus("offline");
        retryTimeout = setTimeout(poll, 3000);
        return;
      }

      attach();
    };

    const attach = () => {
      setStatus("loading");
      if (nativeSupport) {
        video.src = src;
        if (autoplay) video.play().catch(() => {});
        return;
      }
      if (!Hls.isSupported()) {
        setStatus("error");
        setMessage("This browser can't play HLS.");
        return;
      }
      hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 5,
        liveSyncDurationCount: 2,
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoplay) video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        setStatus("offline");
        hls?.destroy();
        hls = null;
        retryTimeout = setTimeout(poll, 3000);
      });
    };

    const onPlaying = () => setStatus("playing");
    const onWaiting = () => setStatus("loading");
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);

    poll();

    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, autoplay]);

  return (
    <div className="relative w-full h-full bg-black rounded-xl overflow-hidden flex items-center justify-center">
      <video ref={videoRef} className="w-full h-full" playsInline muted controls={status === "playing"} />
      {status !== "playing" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-base-content/50">
            <div className="text-5xl mb-2">🦞</div>
            {status === "offline" && <div className="text-sm">Stream offline — start OBS to go live.</div>}
            {status === "loading" && <div className="text-sm">Loading stream…</div>}
            {status === "error" && <div className="text-sm text-error">{message || "Playback error"}</div>}
            {status === "idle" && <div className="text-sm">Waiting…</div>}
          </div>
        </div>
      )}
      {status === "playing" && (
        <div className="absolute top-3 left-3 badge badge-error gap-1 pointer-events-none animate-pulse">
          <span className="inline-block w-2 h-2 rounded-full bg-white" />
          LIVE
        </div>
      )}
    </div>
  );
}
