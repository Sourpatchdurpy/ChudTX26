import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// The browser always talks to the game server on its own origin (/socket.io):
// Caddy routes it in production, and this proxy does the same in development.
const GAME_SERVER = process.env.GAME_SERVER_URL ?? 'http://localhost:4000';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/socket.io': { target: GAME_SERVER, ws: true, changeOrigin: true } } },
  preview: { proxy: { '/socket.io': { target: GAME_SERVER, ws: true, changeOrigin: true } } },
});
