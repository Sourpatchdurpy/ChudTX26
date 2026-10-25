import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Check, Copy, Crown, Moon, Sun } from 'lucide-react';
import PixelSky from '../shared/PixelSky';
import type { LobbyPlayer, LobbyWaitingRoomProps } from '@/types/game';

export type { LobbyPlayer, LobbyWaitingRoomProps } from '@/types/game';

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 6;

function PlayerAvatar({ player }: { player: LobbyPlayer }) {
  const variant = Array.from(player.avatarSeed ?? player.id).reduce((total, character) => total + character.charCodeAt(0), 0) % 3;
  return <svg aria-hidden="true" viewBox="0 0 24 24" shapeRendering="crispEdges" className="h-7 w-7 shrink-0 fill-current">
    <path d="M8 3H16V5H18V11H16V13H8V11H6V5H8ZM6 15H18V17H21V23H3V17H6Z" />
    <rect x={variant === 0 ? 1 : 21} y={variant === 1 ? 3 : 12} width="2" height="2" />
  </svg>;
}

export default function LobbyWaitingRoom({ isDarkMode, onToggleTheme, roomCode, players, currentUserId, isHost, onStartGame, onLeaveRoom }: LobbyWaitingRoomProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyResetRef = useRef<ReturnType<typeof setTimeout>>();
  const mountedRef = useRef(false);
  const reduceMotion = !!useReducedMotion();
  const canStart = isHost && players.length >= MIN_PLAYERS;
  const missingPlayers = Math.max(0, MIN_PLAYERS - players.length);
  const accent = isDarkMode ? 'text-[#00E5FF]' : 'text-[#0E1726]';
  const muted = isDarkMode ? 'text-[#B5DFFF]' : 'text-[#26374F]';
  const border = isDarkMode ? 'border-[#00E5FF]/40' : 'border-[#16223B]/40';
  const focusClass = `focus-visible:outline-2 focus-visible:outline-offset-4 ${isDarkMode ? 'focus-visible:outline-[#00E5FF]' : 'focus-visible:outline-[#16223B]'}`;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearTimeout(copyResetRef.current); };
  }, []);
  useEffect(() => { setCopyStatus('idle'); clearTimeout(copyResetRef.current); }, [roomCode]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(roomCode);
      if (!mountedRef.current) return;
      setCopyStatus('copied');
    } catch {
      if (!mountedRef.current) return;
      setCopyStatus('failed');
    }
    clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => setCopyStatus('idle'), 2500);
  }

  return <main className={`relative isolate flex min-h-[100dvh] w-full flex-col items-center justify-center overflow-hidden pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(5rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] font-sans transition-colors duration-300 ${isDarkMode ? 'bg-[#060B28] text-white' : 'bg-gradient-to-b from-[#FFAE70] via-[#FFD199] to-[#86C5DA] text-[#0E1726]'}`}>
    <PixelSky isDarkMode={isDarkMode} />
    <div className="absolute left-5 right-5 top-[max(1.25rem,env(safe-area-inset-top))] z-10 flex items-center justify-between gap-4 sm:left-8 sm:right-8">
      <span className={`font-pixel text-[9px] leading-relaxed tracking-widest sm:text-xs ${accent}`}>aMuse Us</span>
      <button type="button" aria-label={isDarkMode ? 'Switch to sunrise mode' : 'Switch to dark mode'} title={isDarkMode ? 'Switch to sunrise mode' : 'Switch to dark mode'} aria-pressed={!isDarkMode} onClick={onToggleTheme} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 backdrop-blur-xs ${border} ${accent} ${isDarkMode ? 'bg-black/20 hover:bg-white/10' : 'bg-white/20 hover:bg-white/40'} ${focusClass}`}>
        {isDarkMode ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
      </button>
    </div>

    <motion.div initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.25 }} className="relative z-10 flex w-full max-w-xl flex-col items-center gap-6">
      <header className="w-full text-center">
        <h1 id="lobby-title" className={`relative font-pixel text-[clamp(0.75rem,3.4vw,1.125rem)] leading-loose ${isDarkMode ? 'text-white [text-shadow:3px_3px_0_#020410]' : 'text-[#0E1726] [text-shadow:3px_3px_0_#0E172640]'}`}>
          <span>LOBBY // READY ROOM</span>
          <motion.span aria-hidden="true" initial={false} animate={reduceMotion ? { opacity: 0 } : { x: [0, 0, -2, 2, 0], opacity: [0, 0, 0.8, 0.7, 0] }} transition={{ duration: 6, times: [0, 0.86, 0.89, 0.92, 1], repeat: Infinity }} className="pointer-events-none absolute inset-0 [clip-path:inset(30%_0_45%_0)]">LOBBY // READY ROOM</motion.span>
        </h1>
      </header>

      <section aria-labelledby="lobby-title" className={`relative flex w-full flex-col gap-5 rounded-2xl border-4 p-4 backdrop-blur-xs sm:gap-6 sm:p-7 ${isDarkMode ? 'border-white/90 bg-black/20 shadow-[0_0_25px_#00E5FF]' : 'border-[#16223B]/80 bg-white/20 shadow-[0_0_25px_#FFAE7099]'}`}>
        <span aria-hidden="true" className="pointer-events-none absolute -left-2 -top-2 h-6 w-6 border-l-4 border-t-4 border-white" />
        <span aria-hidden="true" className="pointer-events-none absolute -right-2 -top-2 h-6 w-6 border-r-4 border-t-4 border-white" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-2 -left-2 h-6 w-6 border-b-4 border-l-4 border-white" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-2 -right-2 h-6 w-6 border-b-4 border-r-4 border-white" />

        <div className="flex flex-col items-center gap-3">
          <p className={`font-pixel text-[clamp(0.875rem,4.4vw,1.5rem)] leading-loose tracking-widest ${accent}`}>[ ROOM: <span className="select-all">{roomCode}</span> ]</p>
          <button type="button" onClick={copyCode} className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 font-pixel text-[9px] transition-colors hover:bg-white/15 ${border} ${accent} ${focusClass}`}>
            {copyStatus === 'copied' ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copyStatus === 'copied' ? 'COPIED!' : 'COPY CODE'}
          </button>
          <p role="status" className={`min-h-4 text-center text-xs ${muted}`}>{copyStatus === 'failed' ? 'Couldn’t copy. Select the code above to copy it.' : copyStatus === 'copied' ? 'Room code copied.' : 'Share your code to bring friends into the room.'}</p>
        </div>

        <div className={`border-t pt-5 ${border}`}>
          <p aria-live="polite" aria-atomic="true" className={`mb-4 text-center font-pixel text-[8px] leading-loose sm:text-[10px] ${accent}`}>[ {players.length} / {MAX_PLAYERS} OPERATIVES CONNECTED ]</p>
          <ul aria-label="Connected players" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <AnimatePresence initial={false}>
              {players.map(player => <motion.li key={player.id} layout initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.92 }} transition={{ duration: reduceMotion ? 0 : 0.2 }} className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 ${border} ${isDarkMode ? 'bg-black/25' : 'bg-white/25'}`}>
                <span className={accent}><PlayerAvatar player={player} /></span>
                <div className="min-w-0 flex-1">
                  <p className={`break-words font-pixel text-[9px] leading-loose ${accent}`}>{player.nickname}</p>
                  <p className={`mt-1 flex items-center gap-1.5 text-[10px] ${muted}`}>{player.isHost && <><Crown size={11} aria-hidden="true" />Host</>}{player.isHost && player.id === currentUserId && ' · '}{player.id === currentUserId && 'You'}</p>
                </div>
              </motion.li>)}
            </AnimatePresence>
          </ul>
          {players.length === 0 && <p className={`py-4 text-center text-sm ${muted}`}>Waiting for players to connect.</p>}
        </div>

        <div className="space-y-3">
          {isHost ? <>
            <button type="button" disabled={!canStart} onClick={() => { if (canStart) onStartGame(); }} className={`flex min-h-14 w-full items-center justify-center rounded-xl border-b-4 border-[#B31D3F] bg-[#FF5376] px-3 py-4 font-pixel text-[9px] leading-loose text-white shadow-[0_0_15px_#FF5376] transition-colors hover:bg-[#FF3360] active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-y-0 sm:text-xs ${focusClass}`}>LAUNCH MISSION (3 ROUNDS)</button>
            <p className={`text-center text-xs leading-relaxed ${muted}`}>{canStart ? 'Your crew is ready. Launch when everyone is here.' : `Waiting for ${missingPlayers} more ${missingPlayers === 1 ? 'player' : 'players'} to launch.`}</p>
          </> : <div role="status" className={`flex items-start justify-center gap-3 rounded-xl border px-3 py-4 ${border} ${isDarkMode ? 'bg-black/20' : 'bg-white/20'}`}>
            <motion.span aria-hidden="true" initial={false} animate={reduceMotion ? { opacity: 1 } : { opacity: [0.3, 1, 0.3], scale: [0.85, 1, 0.85] }} transition={{ duration: 1.5, repeat: Infinity }} className={`mt-1 h-2 w-2 shrink-0 ${isDarkMode ? 'bg-[#00E5FF] shadow-[0_0_8px_#00E5FF]' : 'bg-[#16223B]'}`} />
            <p className={`font-pixel text-[8px] leading-loose sm:text-[9px] ${accent}`}>SETUP AGENT CALIBRATING...<br />WAITING FOR HOST TO LAUNCH...</p>
          </div>}
          <p className={`text-center text-xs leading-relaxed ${muted}`}>3–6 players · 3 rounds · one of you is secretly an AI</p>
          <button type="button" onClick={onLeaveRoom} className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border px-4 py-2 text-xs transition-colors hover:bg-white/10 ${border} ${muted} ${focusClass}`}><ArrowLeft size={15} aria-hidden="true" />Leave room</button>
        </div>
      </section>
    </motion.div>
  </main>;
}
