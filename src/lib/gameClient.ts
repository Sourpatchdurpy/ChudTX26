// The only place the frontend talks to the game server. The server is
// authoritative: every change arrives as a full per-player RoomView snapshot
// ("room:state"), and the UI renders purely from the latest one.
import { useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { AckResult, Channel, ClientToServerEvents, PlayerId, RoomView, ServerToClientEvents } from '@game/shared';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type Session = { code: string; token: string };

const SESSION_KEY = 'amuse:session';
const ACK_TIMEOUT_MS = 10_000;

/** Same origin in production (Caddy routes /socket.io); the dev server on :3000 talks to :4000. */
function serverUrl(): string | undefined {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured) return configured;
  if (window.location.port === '3000') return `${window.location.protocol}//${window.location.hostname}:4000`;
  return undefined;
}

let socket: GameSocket | null = null;
function getSocket(): GameSocket {
  if (!socket) {
    const url = serverUrl();
    socket = (url ? io(url) : io()) as GameSocket;
  }
  return socket;
}

// sessionStorage, so every tab is its own player and a refresh keeps the seat.
function readSession(): Session | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as Partial<Session> | null;
    return saved && typeof saved.code === 'string' && typeof saved.token === 'string' ? { code: saved.code, token: saved.token } : null;
  } catch {
    return null;
  }
}
function saveSession(session: Session) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* private mode: no refresh-rejoin */ }
}
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

/** Emits with an ack; resolves with the payload or rejects with the server's error message. */
function call<T extends object = {}>(send: (ack: (res: AckResult<T>) => void) => void): Promise<{ ok: true } & T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The server did not respond. Check your connection.')), ACK_TIMEOUT_MS);
    send(res => {
      clearTimeout(timer);
      if (res.ok) resolve(res);
      else reject(new Error(res.error));
    });
  });
}

export function useGame() {
  const [view, setView] = useState<RoomView | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [connected, setConnected] = useState(false);
  const [closedReason, setClosedReason] = useState('');

  useEffect(() => {
    const s = getSocket();
    const onState = (next: RoomView) => {
      setClockOffset(next.serverNow - Date.now());
      setView(next);
    };
    const onClosed = ({ reason }: { reason: string }) => {
      clearSession();
      setView(null);
      setClosedReason(reason);
    };
    const onConnect = () => {
      setConnected(true);
      const saved = readSession();
      if (!saved) return;
      s.emit('room:rejoin', saved, res => {
        if (res.ok) return;
        clearSession();
        setView(null);
        setClosedReason(res.error);
      });
    };
    const onDisconnect = () => setConnected(false);
    s.on('room:state', onState);
    s.on('room:closed', onClosed);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    if (s.connected) onConnect();
    return () => {
      s.off('room:state', onState);
      s.off('room:closed', onClosed);
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
    };
  }, []);

  const actions = useMemo(() => {
    const s = getSocket();
    return {
      async create(realName: string, codename?: string) {
        const res = await call<{ code: string; playerId: PlayerId; token: string }>(ack => s.emit('room:create', { realName, codename }, ack));
        saveSession({ code: res.code, token: res.token });
        setClosedReason('');
      },
      async join(code: string, realName: string, codename?: string) {
        const res = await call<{ playerId: PlayerId; token: string }>(ack => s.emit('room:join', { code, realName, codename }, ack));
        saveSession({ code: code.toUpperCase(), token: res.token });
        setClosedReason('');
      },
      /** Forget the seat locally. A fresh connection makes the server drop this socket. */
      leave() {
        clearSession();
        setView(null);
        s.disconnect().connect();
      },
      start: () => call(ack => s.emit('game:start', ack)),
      answer: (text: string) => call(ack => s.emit('answer:submit', { text }, ack)),
      chat: (text: string, channel: Channel) => call(ack => s.emit('chat:send', { text, channel }, ack)),
      vote: (targetId: PlayerId) => call(ack => s.emit('vote:cast', { targetId }, ack)),
      collab: (text: string) => call(ack => s.emit('collab:submit', { text }, ack)),
      vouch: (targetId: PlayerId, vouched: boolean) => call(ack => s.emit('vouch:set', { targetId, vouched }, ack)),
      advance: () => call(ack => s.emit('host:advance', ack)),
      playAgain: () => call(ack => s.emit('host:playAgain', ack)),
      dismissClosed: () => setClosedReason(''),
    };
  }, []);

  return { view, clockOffset, connected, closedReason, ...actions };
}

/** Whole seconds left in the current phase, corrected for the server's clock; re-renders 4x a second. */
export function useSecondsLeft(endsAt: number | null, clockOffset: number): number {
  // The interval only triggers re-renders; the value always uses the current time, so the
  // first render of a new phase is right too (screens read it once as their starting value).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (endsAt === null) return;
    const timer = setInterval(() => setTick(t => t + 1), 250);
    return () => clearInterval(timer);
  }, [endsAt]);
  return endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - (Date.now() + clockOffset)) / 1000));
}
