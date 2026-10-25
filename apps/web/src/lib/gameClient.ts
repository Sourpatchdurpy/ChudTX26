// Connection to the game server (apps/server). The server is authoritative: every
// change arrives as a full per-player RoomView snapshot ("room:state"), and every
// action is acknowledged with { ok: true } or { ok: false, error }.
import { io, type Socket } from 'socket.io-client';
import type { AckResult, ClientToServerEvents, ServerToClientEvents } from '@game/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Same origin: Caddy routes /socket.io in production, Vite's proxy does in development. */
export function connectGameSocket(): GameSocket {
  return io({ transports: ['websocket', 'polling'] });
}

const ACK_TIMEOUT_MS = 8000;

/** Emit with an acknowledgement; resolves with an error result instead of hanging if the server never answers. */
export function request<T extends object = {}>(emit: (ack: (res: AckResult<T>) => void) => void): Promise<AckResult<T>> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'The server did not respond. Check your connection.' }), ACK_TIMEOUT_MS);
    emit(res => { clearTimeout(timer); resolve(res); });
  });
}

/** {code, token} survives a refresh in this tab, so the player rejoins their seat. */
export interface SavedSession { code: string; token: string }

const SESSION_KEY = 'amuse:session';

export function loadSession(): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<SavedSession>) : null;
    return parsed && typeof parsed.code === 'string' && typeof parsed.token === 'string' ? { code: parsed.code, token: parsed.token } : null;
  } catch {
    return null;
  }
}

export function saveSession(session: SavedSession): void {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* private mode: no rejoin after refresh */ }
}

export function clearSession(): void {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* nothing to clear */ }
}
