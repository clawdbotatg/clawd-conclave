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
 */
export function Player({ whepUrl, hlsUrl, autoplay = true }: { whepUrl: string; hlsUrl: string; autoplay?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const statusRef = useRef<Status>("idle");
  const [transport, setTransport] = useState<Transport>("none");
  const [message, setMessage] = useState("");
  const [muted, setMuted] = useState(true);

  // Keep a ref of the latest status so we can read it inside the
  // setup effect without having to add status to its dependency
  // array (that would tear down + recreate WHEP on every state tick).
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
    let cancelled = false;
    let whepFailed = false;

    const attachHls = () => {
      setTransport("hls");
      setStatus("connecting");
      const nativeSupport = video.canPlayType("application/vnd.apple.mpegurl") !== "";
      if (nativeSupport) {
        video.src = hlsUrl;
        if (autoplay) video.play().catch(() => {});
        return;
      }
      if (!Hls.isSupported()) {
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
        hls?.destroy();
        hls = null;
        retryTimeout = setTimeout(pollHls, 3000);
      });
    };

    const pollHls = async () => {
      // HEAD isn't implemented by all HLS servers; use GET and abort fast.
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

    /**
     * WHEP handshake. POSTs the SDP offer, expects a 201 with SDP answer
     * and a Location header pointing at the session resource (used for
     * DELETE on unmount). If anything fails — bad status, ICE failure,
     * timeout — we fall through to HLS.
     */
    const tryWhep = async () => {
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
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          if (!whepFailed) {
            whepFailed = true;
            teardownWhep();
            pollHls();
          }
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // Wait for ICE gathering so the SDP we POST includes all candidates —
      // the WHEP spec supports trickle but MediaMTX plays nicer with
      // non-trickle (everything in the initial offer).
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
        // MediaMTX returns 404 when the stream isn't live — drop to HLS
        // which will poll for us.
        whepFailed = true;
        teardownWhep();
        if (res.status === 404) {
          setStatus("offline");
          retryTimeout = setTimeout(pollHls, 3000);
        } else {
          pollHls();
        }
        return;
      }
      sessionUrl = res.headers.get("Location");
      const answer = await res.text();
      if (cancelled || !pc) return;
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
    };

    const teardownWhep = () => {
      if (pc) {
        try {
          pc.close();
        } catch {
          // ignore
        }
        pc = null;
      }
      // Best-effort WHEP session cleanup — if it fails, MediaMTX will
      // expire the session on its own.
      if (sessionUrl) {
        fetch(sessionUrl, { method: "DELETE" }).catch(() => {});
        sessionUrl = null;
      }
    };

    const onPlaying = () => setStatus("playing");
    const onWaiting = () => {
      if (statusRef.current !== "offline") setStatus("connecting");
    };
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);

    // Hard timeout on the whole WHEP attempt — if we don't see `playing`
    // within 5s, assume it's not happening and drop to HLS.
    const whepTimeout = setTimeout(() => {
      if (!whepFailed && statusRef.current !== "playing") {
        whepFailed = true;
        teardownWhep();
        pollHls();
      }
    }, 5000);

    tryWhep().catch(err => {
      console.warn("[Player] WHEP failed:", err);
      whepFailed = true;
      teardownWhep();
      pollHls();
    });

    return () => {
      cancelled = true;
      clearTimeout(whepTimeout);
      if (retryTimeout) clearTimeout(retryTimeout);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      teardownWhep();
      hls?.destroy();
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
