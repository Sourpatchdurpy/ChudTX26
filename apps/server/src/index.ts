// Game server entry: HTTP (/health) + Socket.IO, content load, AI implementation by AI_MODE.
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // No root .env: defaults apply (AI_MODE=stub).
}

import { createServer } from "node:http";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@game/shared";
import { aiMode, chatDelayMs, timerScale } from "./game/config.js";
import { loadContent } from "./game/content.js";
import type { AiImpl } from "./game/Room.js";
import { RoomRegistry } from "./game/rooms.js";
import { registerHandlers } from "./net/handlers.js";

const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);

process.on("unhandledRejection", (e) => log(`[process] unhandledRejection: ${e instanceof Error ? e.stack : String(e)}`));
process.on("uncaughtException", (e) => log(`[process] uncaughtException: ${e.stack ?? e.message}`));

const mode = aiMode();
// tsx resolves .js to .ts. Only AI_MODE=muse loads Part 4's runtime (and its Muse client).
const ai: AiImpl = mode === "muse" ? await import("./ai/index.js") : await import("./game/stubAi.js");

const content = loadContent();
const port = Number(process.env.PORT) || 4000;
const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const httpServer = createServer((req, res) => {
  if (req.method === "GET" && req.url?.split("?")[0] === "/health") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, aiMode: mode }));
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: corsOrigins },
});

const registry = new RoomRegistry({
  ai,
  content,
  log,
  transport: {
    state: (socketId, view) => io.to(socketId).emit("room:state", view),
    closed: (socketId, reason) => io.to(socketId).emit("room:closed", { reason }),
  },
});
registerHandlers(io, registry, log);

setInterval(() => {
  try {
    registry.sweep();
  } catch (e) {
    log(`[rooms] sweep failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}, 60_000).unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    log(`[server] ${signal}: closing ${registry.rooms.size} rooms`);
    registry.closeAll("The server restarted. Start a new room.");
    // Give room:closed a moment to flush before exiting.
    setTimeout(() => process.exit(0), 300).unref();
    io.close();
  });
}

// E.g. the port is already taken: fail loudly (non-zero exit) instead of exiting "cleanly".
httpServer.on("error", (e) => {
  log(`[server] cannot listen on :${port}: ${e.message}`);
  process.exit(1);
});

httpServer.listen(port, () => {
  log(
    `[server] listening on :${port} · AI_MODE=${mode} · TIMER_SCALE=${timerScale()} · CHAT_DELAY_MS=${chatDelayMs()} · ` +
      `CORS ${corsOrigins.join(", ")}`,
  );
});
