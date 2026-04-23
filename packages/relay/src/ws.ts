import type { WebSocket } from "@fastify/websocket";

/**
 * Single-room broadcast for Phase 1 — every connected socket gets every
 * message. In Phase 2 this will split by session ID, but the topology
 * stays the same (server fan-out, no peer-to-peer).
 */

export type ChatEvent = {
  type: "chat";
  id: string;
  wallet: string;
  body: string;
  cvCost: number;
  createdAt: string;
};

const sockets = new Set<WebSocket>();

export function addSocket(socket: WebSocket) {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => sockets.delete(socket));
}

export function broadcast(event: ChatEvent) {
  const payload = JSON.stringify(event);
  for (const s of sockets) {
    // Type enum: 1 = OPEN (avoid importing `ws` just for the constant).
    if (s.readyState === 1) {
      try {
        s.send(payload);
      } catch {
        sockets.delete(s);
      }
    }
  }
}

export function connectedCount() {
  return sockets.size;
}
