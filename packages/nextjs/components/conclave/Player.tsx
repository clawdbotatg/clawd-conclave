"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

type Status = "idle" | "connecting" | "playing" | "offline" | "error";
type Transport = "webrtc" | "hls" | "none";

/**
 * Low-latency playback for the conclave stream. Tries WHEP (WebRTC-HTTP
 * Egress Protocol) first for ~1s glass-to-glass, falls back to LL-HLS
 * (~3-5s) if WebRTC negotiation fails or times out.
 *
 * Audio: starts muted because every major browser blocks autoplay with
 * audio on a tab that hasn't had user interaction. We show a "click to
 * unmute" button once playback begins.
 *
 * Recovery: when the stream drops (WHEP disconnect or HLS fatal error),
 * the player automatically reconnects — trying WHEP first so low latency
 * is restored without a page reload.
 */
export function Player({ whepUrl, hlsUrl, autoplay = true }: { whepUrl: string; hlsUrl: string; autoplay?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const statusRef = useRef<Status>("idle");
  const [transport, setTransport] = useState<Transport>("none");
  const [message, setMessage] = useState("");
  const [muted, setMuted] = useState(true);

  // Keep statusRef in sync so the effect can read current status without
  // adding it to the dependency array (which would teardown/recreate WHEP).
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let pc: RTCPeerConnection | null = null;
    let sessionUrl: string | null = null;
    let hls: Hls | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let whepTimeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    // Consecutive WHEP 404s — live/conclave-rtc takes a few seconds to start
    // after OBS connects. Retry WHEP up to MAX_WHEP_RETRIES before giving up
    // and falling back to HLS polling.
    let whepRetries = 0;
    const MAX_WHEP_RETRIES = 6;

    const clearRetry = () => {
      if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }
    };

    const teardownWhep = () => {
      if (whepTimeout) {
        clearTimeout(whepTimeout);
        whepTimeout = null;
      }
      if (pc) {
        try {
          pc.close();
        } catch {
          // ignore
        }
        pc = null;
      }
      // CRITICAL: clear srcObject so HLS.js (which uses video.src) can take
      // over the video element. Without this, the dead MediaStream stays
      // attached and HLS never renders.
      video.srcObject = null;
      if (sessionUrl) {
        fetch(sessionUrl, { method: "DELETE" }).catch(() => {});
        sessionUrl = null;
      }
    };

    const teardownHls = () => {
      hls?.destroy();
      hls = null;
    };

    // After stream drops, wait then retry WHEP so low latency is restored
    // automatically — no page reload needed.
    const scheduleReconnect = (delay = 1000) => {
      clearRetry();
      whepRetries = 0;
      retryTimeout = setTimeout(() => {
        if (!cancelled) startWhep();
      }, delay);
    };

    const attachHls = () => {
      setTransport("hls");
      setStatus("connecting");

      if (!Hls.isSupported()) {
        // Safari native HLS
        if (video.canPlayType("application/vnd.apple.mpegurl") !== "") {
          video.src = hlsUrl;
          if (autoplay) video.play().catch(() => {});
          return;
        }
        setStatus("error");
        setMessage("This browser can't play HLS.");
        return;
      }

      hls = new Hls({ lowLatencyMode: true, backBufferLength: 5, liveSyncDurationCount: 2 });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoplay) video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        setStatus("offline");
        teardownHls();
        // Stream dropped while on HLS — reconnect loop tries WHEP first
        scheduleReconnect(1000);
      });
    };

    const pollHls = async () => {
      try {
        const res = await fetch(hlsUrl, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setStatus("offline");
          retryTimeout = setTimeout(pollHls, 3000);
          return;
        }
      } catch {
        if (cancelled) return;
        setStatus("offline");
        retryTimeout = setTimeout(pollHls, 3000);
        return;
      }
      attachHls();
    };

    const startWhep = () => {
      setTransport("webrtc");
      setStatus("connecting");

      pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });

      pc.ontrack = ev => {
        video.srcObject = ev.streams[0] ?? null;
        if (autoplay) video.play().catch(() => {});
      };

      pc.onconnectionstatechange = () => {
        if (!pc) return;
        const state = pc.connectionState;
        if (state === "failed" || state === "disconnected") {
          teardownWhep();
          scheduleReconnect(2000);
        }
      };

      // Hard timeout — if not playing within 12s, fall back to HLS polling.
      whepTimeout = setTimeout(() => {
        if (statusRef.current !== "playing") {
          teardownWhep();
          pollHls();
        }
      }, 12000);

      (async () => {
        try {
          const offer = await pc!.createOffer();
          await pc!.setLocalDescription(offer);

          // Wait for ICE gathering so the SDP we POST includes all candidates.
          // MediaMTX plays nicer with non-trickle (everything in the initial offer).
          await new Promise<void>(resolve => {
            if (!pc) return resolve();
            if (pc.iceGatheringState === "complete") return resolve();
            const t = setTimeout(resolve, 2000);
            pc.addEventListener("icegatheringstatechange", () => {
              if (pc && pc.iceGatheringState === "complete") {
                clearTimeout(t);
                resolve();
              }
            });
          });

          if (cancelled || !pc || !pc.localDescription) return;

          const res = await fetch(whepUrl, {
            method: "POST",
            headers: { "Content-Type": "application/sdp" },
            body: pc.localDescription.sdp,
          });

          if (!res.ok) {
            teardownWhep();
            if (res.status === 404) {
              // live/conclave-rtc not ready yet (ffmpeg transcode takes a few
              // seconds to start after OBS connects). Retry WHEP directly so
              // we catch it as soon as the path comes up — much faster than
              // bailing to HLS polling. After MAX_WHEP_RETRIES give up and
              // let HLS detect the stream instead.
              whepRetries++;
              setStatus("offline");
              if (whepRetries < MAX_WHEP_RETRIES) {
                retryTimeout = setTimeout(startWhep, 1500);
              } else {
                whepRetries = 0;
                retryTimeout = setTimeout(pollHls, 2000);
              }
            } else {
              pollHls();
            }
            return;
          }

          whepRetries = 0;
          sessionUrl = res.headers.get("Location");
          const answer = await res.text();
          if (cancelled || !pc) return;
          await pc.setRemoteDescription({ type: "answer", sdp: answer });
        } catch (err) {
          if (cancelled) return;
          console.warn("[Player] WHEP failed:", err);
          teardownWhep();
          pollHls();
        }
      })();
    };

    const onPlaying = () => setStatus("playing");
    const onWaiting = () => {
      if (statusRef.current !== "offline") setStatus("connecting");
    };
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);

    startWhep();

    return () => {
      cancelled = true;
      clearRetry();
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      teardownWhep();
      teardownHls();
      video.removeAttribute("src");
      video.srcObject = null;
      video.load();
    };
  }, [whepUrl, hlsUrl, autoplay]);

  const handleUnmute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    if (video.paused) video.play().catch(() => {});
    setMuted(false);
  };

  return (
    <div className="relative w-full h-full bg-black rounded-xl overflow-hidden flex items-center justify-center">
      <video
        ref={videoRef}
        className="w-full h-full"
        playsInline
        muted={muted}
        controls={status === "playing"}
        onVolumeChange={e => setMuted((e.target as HTMLVideoElement).muted)}
      />
      {status !== "playing" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-base-content/50">
            <div className="text-5xl mb-2">🦞</div>
            {status === "offline" && <div className="text-sm">Stream offline — start OBS to go live.</div>}
            {status === "connecting" && <div className="text-sm">Connecting via {transport}…</div>}
            {status === "error" && <div className="text-sm text-error">{message || "Playback error"}</div>}
            {status === "idle" && <div className="text-sm">Waiting…</div>}
          </div>
        </div>
      )}
      {status === "playing" && (
        <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
          <div className="badge badge-error gap-1 animate-pulse">
            <span className="inline-block w-2 h-2 rounded-full bg-white" />
            LIVE
          </div>
          <div className="badge badge-neutral badge-sm opacity-70">{transport}</div>
        </div>
      )}
      {status === "playing" && muted && (
        <button
          type="button"
          onClick={handleUnmute}
          className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/50 transition"
          aria-label="Unmute stream"
        >
          <span className="btn btn-primary btn-lg gap-2 pointer-events-none">🔇 Click to unmute</span>
        </button>
      )}
    </div>
  );
}
