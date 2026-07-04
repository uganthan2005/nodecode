// NodeCode WS Relay (TRD §7) — standalone message pump binding the browser
// session to the local `nodecode-runner` over WebSockets.
//
// It holds NO database access: a client's first frame carries a pairing token,
// which the relay resolves to a workspace id by calling the Next backend's
// /api/runner/validate. Sockets sharing a workspace id form a "room"; any frame
// from one peer is relayed to the others. Run: `npm run relay`.

import { WebSocketServer } from "ws";

const PORT = Number(process.env.RELAY_PORT ?? 3001);
const API_URL = process.env.RELAY_API_URL ?? "http://localhost:3000";

/** workspaceId -> Set<ws> */
const rooms = new Map();

function joinRoom(workspaceId, socket) {
  let room = rooms.get(workspaceId);
  if (!room) {
    room = new Set();
    rooms.set(workspaceId, room);
  }
  room.add(socket);
  return room;
}

function leaveRoom(workspaceId, socket) {
  const room = rooms.get(workspaceId);
  if (!room) return;
  room.delete(socket);
  if (room.size === 0) rooms.delete(workspaceId);
}

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

/** Relay a frame to every OTHER live socket in the room. */
function broadcast(workspaceId, sender, payload) {
  const room = rooms.get(workspaceId);
  if (!room) return;
  for (const peer of room) {
    if (peer !== sender) send(peer, payload);
  }
}

async function validateToken(token) {
  try {
    const res = await fetch(
      `${API_URL}/api/runner/validate?token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) return null;
    return await res.json(); // { workspaceId, name }
  } catch (error) {
    console.error("[relay] validate failed:", error.message);
    return null;
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (socket) => {
  socket.isAlive = true;
  socket.role = null;
  socket.workspaceId = null;

  socket.on("pong", () => {
    socket.isAlive = true;
  });

  socket.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(socket, { type: "error", message: "malformed JSON" });
    }

    // First frame must be a hello that authenticates the socket
    if (!socket.workspaceId) {
      if (msg.type !== "hello" || typeof msg.token !== "string") {
        return send(socket, { type: "error", message: "expected hello frame" });
      }
      const result = await validateToken(msg.token);
      if (!result) {
        send(socket, { type: "error", message: "invalid or expired token" });
        return socket.close();
      }
      socket.workspaceId = result.workspaceId;
      socket.role = msg.role === "runner" ? "runner" : "browser";
      const room = joinRoom(result.workspaceId, socket);
      send(socket, {
        type: "ready",
        workspaceId: result.workspaceId,
        name: result.name,
        peers: [...room].filter((p) => p !== socket).map((p) => p.role),
      });
      // Announce presence to the other peer(s)
      broadcast(result.workspaceId, socket, {
        type: "peer",
        role: socket.role,
        connected: true,
      });
      console.log(`[relay] ${socket.role} joined ${result.workspaceId}`);
      return;
    }

    // Authenticated: relay everything else to the room, tagged with origin
    broadcast(socket.workspaceId, socket, { ...msg, origin: socket.role });
  });

  socket.on("close", () => {
    if (socket.workspaceId) {
      broadcast(socket.workspaceId, socket, {
        type: "peer",
        role: socket.role,
        connected: false,
      });
      leaveRoom(socket.workspaceId, socket);
      console.log(`[relay] ${socket.role} left ${socket.workspaceId}`);
    }
  });
});

// Drop dead sockets so rooms don't leak
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 30_000);
wss.on("close", () => clearInterval(heartbeat));

console.log(`[relay] NodeCode WS relay listening on ws://localhost:${PORT}`);
console.log(`[relay] validating tokens via ${API_URL}`);
