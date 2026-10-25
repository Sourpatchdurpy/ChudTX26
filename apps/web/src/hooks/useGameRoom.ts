import { useCallback, useEffect, useRef, useState } from 'react';
import type { AckResult, Channel, PlayerId, RoomView } from '@game/shared';
import { clearSession, connectGameSocket, loadSession, request, saveSession, type GameSocket } from '../lib/gameClient';

export interface GameRoom {
  /** Latest snapshot from the server; null until we're in a room. */
  view: RoomView | null;
  connected: boolean;
  /** True while a saved session is being restored after a refresh. */
  rejoining: boolean;
  /** Set when the server closes our room (expired, restarted) or a rejoin fails. */
  closedReason: string | null;
  /** Last failed action, for the error banner. */
  error: string;
  clearError: () => void;
  /** Seconds left in the current phase on the server's clock, or null if the host advances it. */
  secondsLeft: () => number | null;
  create: (realName: string) => Promise<void>;
  join: (code: string, realName: string) => Promise<void>;
  leave: () => void;
  start: () => Promise<void>;
  submitAnswer: (text: string) => Promise<void>;
  sendChat: (text: string, channel: Channel) => Promise<void>;
  vote: (targetId: PlayerId) => Promise<void>;
  submitCollab: (text: string) => Promise<void>;
  setVouch: (targetId: PlayerId, vouched: boolean) => Promise<void>;
  advance: () => Promise<void>;
  playAgain: () => Promise<void>;
}

export function useGameRoom(): GameRoom {
  const socketRef = useRef<GameSocket | null>(null);
  /** Local clock minus server clock, refreshed with every snapshot. */
  const offsetRef = useRef(0);
  const [view, setView] = useState<RoomView | null>(null);
  const [connected, setConnected] = useState(false);
  const [rejoining, setRejoining] = useState(() => loadSession() !== null);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const socket = connectGameSocket();
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnected(true);
      // Re-attach to our seat after a refresh, sleep or network blip.
      const saved = loadSession();
      if (!saved) return setRejoining(false);
      void request<{ playerId: PlayerId }>(ack => socket.emit('room:rejoin', saved, ack)).then(res => {
        setRejoining(false);
        if (!res.ok) {
          clearSession();
          setView(null);
          setClosedReason('That room has ended. Start or join a new one.');
        }
      });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('room:state', next => {
      offsetRef.current = Date.now() - next.serverNow;
      setView(next);
    });
    socket.on('room:closed', ({ reason }) => {
      clearSession();
      setView(null);
      setClosedReason(reason);
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, []);

  /** Run an action; failures land in `error` (and reject, for callers that show them inline). */
  const act = useCallback(async <T extends object>(emit: (socket: GameSocket, ack: (res: AckResult<T>) => void) => void, rethrow = false): Promise<AckResult<T>> => {
    const socket = socketRef.current;
    const res: AckResult<T> = socket ? await request<T>(ack => emit(socket, ack)) : { ok: false, error: 'Not connected to the game server.' };
    if (!res.ok) {
      if (rethrow) throw new Error(res.error);
      setError(res.error);
    }
    return res;
  }, []);

  const enter = useCallback((res: AckResult<{ token: string }>, code: string) => {
    if (!res.ok) return;
    saveSession({ code, token: res.token });
    setClosedReason(null);
    setError('');
  }, []);

  return {
    view,
    connected,
    rejoining,
    closedReason,
    error,
    clearError: useCallback(() => setError(''), []),
    secondsLeft: useCallback(() => {
      if (!view || view.phaseEndsAt === null) return null;
      return Math.max(0, (view.phaseEndsAt + offsetRef.current - Date.now()) / 1000);
    }, [view]),
    create: useCallback(async realName => {
      const res = await act<{ code: string; playerId: PlayerId; token: string }>((s, ack) => s.emit('room:create', { realName }, ack), true);
      if (res.ok) enter(res, res.code);
    }, [act, enter]),
    join: useCallback(async (code, realName) => {
      const res = await act<{ playerId: PlayerId; token: string }>((s, ack) => s.emit('room:join', { code, realName }, ack), true);
      if (res.ok) enter(res, code);
    }, [act, enter]),
    leave: useCallback(() => {
      // The server keeps the seat (there is no leave event); we just forget it on this device.
      clearSession();
      setView(null);
      setClosedReason(null);
    }, []),
    start: useCallback(async () => { await act((s, ack) => s.emit('game:start', ack)); }, [act]),
    submitAnswer: useCallback(async text => { await act((s, ack) => s.emit('answer:submit', { text }, ack)); }, [act]),
    sendChat: useCallback(async (text, channel) => { await act<{ messageId: string; visibleAt: number }>((s, ack) => s.emit('chat:send', { text, channel }, ack)); }, [act]),
    vote: useCallback(async targetId => { await act((s, ack) => s.emit('vote:cast', { targetId }, ack), true); }, [act]),
    submitCollab: useCallback(async text => { await act((s, ack) => s.emit('collab:submit', { text }, ack), true); }, [act]),
    setVouch: useCallback(async (targetId, vouched) => { await act((s, ack) => s.emit('vouch:set', { targetId, vouched }, ack)); }, [act]),
    advance: useCallback(async () => { await act((s, ack) => s.emit('host:advance', ack)); }, [act]),
    playAgain: useCallback(async () => { await act((s, ack) => s.emit('host:playAgain', ack)); }, [act]),
  };
}
