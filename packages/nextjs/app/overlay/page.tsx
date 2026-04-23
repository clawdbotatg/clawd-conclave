"use client";

import { useEffect, useState } from "react";
import type { NextPage } from "next";
import { useChatFeed } from "~~/hooks/conclave/useChatFeed";
import type { ChatEvent } from "~~/utils/conclave/chat";

const BUBBLE_LIFETIME_MS = 10_000;

type Bubble = ChatEvent & { bornAt: number };

const shortAddress = (addr: string) => (addr.startsWith("0x") ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr);

const Overlay: NextPage = () => {
  const { messages, connected } = useChatFeed();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  // Dev preview mode (?preview=1) shows a dark backdrop + connection status
  // dot so you can see that the overlay is working before you wire it into
  // OBS as a transparent browser source.
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setPreview(new URLSearchParams(window.location.search).has("preview"));
  }, []);

  // Track which message ids we've already flown in, so the seed fetch
  // doesn't spam the overlay with stale messages when OBS first loads.
  const [hasBootstrapped, setHasBootstrapped] = useState(false);

  useEffect(() => {
    // On the very first population from the history fetch, skip the existing
    // messages — we only want new traffic to animate in.
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

  // Reap old bubbles
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
        </div>
      )}
      <div className="overlay-column">
        {bubbles.map(b => (
          <div key={b.id} className="overlay-bubble">
            <div className="overlay-bubble-wallet">{shortAddress(b.wallet)}</div>
            <div className="overlay-bubble-body">{b.body}</div>
            <div className="overlay-bubble-cost">{b.cvCost} CV</div>
          </div>
        ))}
      </div>

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
          left: 24px;
          bottom: 24px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-width: 520px;
        }
        .overlay-bubble {
          background: rgba(8, 8, 10, 0.82);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          color: white;
          padding: 10px 14px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          animation: slide-in 250ms ease-out, fade-out 1000ms ease-in forwards 9000ms;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
        }
        .overlay-bubble-wallet {
          font-size: 11px;
          font-weight: 600;
          color: #c084fc;
          letter-spacing: 0.02em;
        }
        .overlay-bubble-body {
          font-size: 18px;
          line-height: 1.35;
          margin-top: 2px;
          word-break: break-word;
        }
        .overlay-bubble-cost {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.4);
          margin-top: 4px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        @keyframes slide-in {
          from { transform: translateX(-30px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fade-out {
          to { opacity: 0; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
};

export default Overlay;
