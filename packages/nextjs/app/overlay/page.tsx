"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { ChatMessage } from "~~/components/conclave/ChatMessage";
import { useChatFeed } from "~~/hooks/conclave/useChatFeed";
import type { ChatEvent } from "~~/utils/conclave/chat";

const BUBBLE_LIFETIME_MS = 25_000;
const CONFETTI_DURATION_MS = 6_000;
const CONFETTI_BASE_PIECE_COUNT = 160;
const CONFETTI_MEGA_THRESHOLD = 1_000_000;
const CONFETTI_MEGA_MULTIPLIER = 3;

type Bubble = ChatEvent & { bornAt: number };

type ConfettiPiece = {
  id: string;
  left: number;
  delay: number;
  duration: number;
  drift: number;
  rotate: number;
  color: string;
  size: number;
};

const CONFETTI_COLORS = ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#ec4899", "#facc15"];

const makeConfettiBurst = (key: string, cvCost: number): ConfettiPiece[] => {
  const isMega = cvCost >= CONFETTI_MEGA_THRESHOLD;
  const count = isMega ? CONFETTI_BASE_PIECE_COUNT * CONFETTI_MEGA_MULTIPLIER : CONFETTI_BASE_PIECE_COUNT;
  const sizeBoost = isMega ? 1.4 : 1;
  const driftBoost = isMega ? 1.5 : 1;
  return Array.from({ length: count }, (_, i) => ({
    id: `${key}-${i}`,
    left: Math.random() * 100,
    delay: Math.random() * (isMega ? 900 : 600),
    duration: 2800 + Math.random() * 2200,
    drift: (Math.random() - 0.5) * 240 * driftBoost,
    rotate: Math.random() * 720 - 360,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]!,
    size: (6 + Math.random() * 8) * sizeBoost,
  }));
};

const Overlay: NextPage = () => {
  const [confettiPieces, setConfettiPieces] = useState<ConfettiPiece[]>([]);
  const confettiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerConfetti = useCallback((key: string, cvCost: number) => {
    if (confettiTimeoutRef.current) clearTimeout(confettiTimeoutRef.current);
    setConfettiPieces(makeConfettiBurst(key, cvCost));
    confettiTimeoutRef.current = setTimeout(() => setConfettiPieces([]), CONFETTI_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (confettiTimeoutRef.current) clearTimeout(confettiTimeoutRef.current);
    };
  }, []);

  const { messages, connected } = useChatFeed({
    onConfetti: e => triggerConfetti(e.id, e.cvCost),
  });
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setPreview(new URLSearchParams(window.location.search).has("preview"));
  }, []);

  const [hasBootstrapped, setHasBootstrapped] = useState(false);

  useEffect(() => {
    if (!hasBootstrapped && messages.length > 0) {
      setHasBootstrapped(true);
      return;
    }
    if (messages.length === 0) return;
    const last = messages[messages.length - 1]!;
    setBubbles(prev => {
      if (prev.some(b => b.id === last.id)) return prev;
      return [...prev, { ...last, bornAt: Date.now() }];
    });
  }, [messages, hasBootstrapped]);

  useEffect(() => {
    if (bubbles.length === 0) return;
    const id = setInterval(() => {
      const cutoff = Date.now() - BUBBLE_LIFETIME_MS;
      setBubbles(prev => prev.filter(b => b.bornAt > cutoff));
    }, 500);
    return () => clearInterval(id);
  }, [bubbles.length]);

  return (
    <div className={`overlay-root ${preview ? "overlay-preview" : ""}`}>
      {preview && (
        <div className="overlay-devbar">
          <span className={`overlay-dot ${connected ? "overlay-dot-on" : "overlay-dot-off"}`} />
          {connected ? "WS connected" : "WS disconnected"} · {bubbles.length} bubble{bubbles.length === 1 ? "" : "s"} ·
          preview mode (drop <code>?preview=1</code> before using in OBS)
          <button
            type="button"
            className="overlay-devbutton"
            onClick={() => triggerConfetti(`preview-${Date.now()}`, 500_000)}
          >
            test confetti
          </button>
          <button
            type="button"
            className="overlay-devbutton"
            onClick={() => triggerConfetti(`preview-mega-${Date.now()}`, 1_000_000)}
          >
            test MEGA
          </button>
        </div>
      )}
      <div className="overlay-column">
        {[...bubbles].reverse().map(b => (
          <div key={b.id} className="overlay-bubble">
            <Address address={b.wallet as `0x${string}`} disableAddressLink size="sm" />
            <ChatMessage body={b.body} className="overlay-bubble-body" />
          </div>
        ))}
      </div>
      {confettiPieces.length > 0 && (
        <div className="overlay-confetti">
          {confettiPieces.map(p => (
            <span
              key={p.id}
              className="overlay-confetti-piece"
              style={{
                left: `${p.left}%`,
                width: `${p.size}px`,
                height: `${p.size * 0.4}px`,
                background: p.color,
                animationDelay: `${p.delay}ms`,
                animationDuration: `${p.duration}ms`,
                ["--drift" as string]: `${p.drift}px`,
                ["--rotate" as string]: `${p.rotate}deg`,
              }}
            />
          ))}
        </div>
      )}

      <style>{`
        :root, html, body { background: transparent !important; }
        .overlay-preview, .overlay-preview :where(html, body) {
          background: #0b0c10 !important;
          min-height: 100vh;
          color: #eee;
        }
        .overlay-devbar {
          position: fixed;
          top: 12px;
          left: 12px;
          padding: 6px 10px;
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.55);
          color: #ddd;
          font-size: 12px;
          font-family: ui-monospace, Menlo, monospace;
        }
        .overlay-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 6px;
          vertical-align: middle;
        }
        .overlay-dot-on { background: #22c55e; }
        .overlay-dot-off { background: #ef4444; }
        .overlay-root {
          position: fixed;
          inset: 0;
          pointer-events: none;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .overlay-column {
          position: absolute;
          right: 24px;
          bottom: 24px;
          display: flex;
          flex-direction: column-reverse;
          align-items: flex-end;
          gap: 6px;
          max-width: 480px;
          max-height: calc(100vh - 80px);
          overflow: hidden;
        }
        .overlay-bubble {
          background: rgba(8, 8, 10, 0.85);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          color: white;
          padding: 10px 14px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          animation: slide-in 250ms ease-out, fade-out 1500ms ease-in forwards 23500ms;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
          width: 100%;
        }
        .overlay-bubble-body {
          font-size: 22px;
          line-height: 1.35;
          margin-top: 4px;
          word-break: break-word;
        }
        .overlay-bubble-body a {
          color: #c084fc;
          word-break: break-all;
        }
        @keyframes slide-in {
          from { transform: translateX(30px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fade-out {
          to { opacity: 0; }
        }
        .overlay-devbutton {
          margin-left: 10px;
          padding: 2px 8px;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.12);
          color: #fff;
          font-size: 11px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          cursor: pointer;
          pointer-events: auto;
        }
        .overlay-confetti {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
        }
        .overlay-confetti-piece {
          position: absolute;
          top: -20px;
          border-radius: 2px;
          animation-name: confetti-fall;
          animation-timing-function: cubic-bezier(0.25, 0.4, 0.55, 1);
          animation-fill-mode: forwards;
          will-change: transform, opacity;
        }
        @keyframes confetti-fall {
          0% { transform: translate3d(0, -20px, 0) rotate(0deg); opacity: 1; }
          85% { opacity: 1; }
          100% {
            transform: translate3d(var(--drift, 0px), 110vh, 0) rotate(var(--rotate, 360deg));
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
};

export default Overlay;
