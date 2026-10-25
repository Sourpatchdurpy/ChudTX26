import { useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { LIMITS } from '@game/shared';
import PixelSky from '../shared/PixelSky';
import ArcadeTitle from '../shared/ArcadeTitle';
import type { EntryScreenProps } from '@/types/game';

export type { EntryScreenProps } from '@/types/game';

function PixelFrame({ isDarkMode }: { isDarkMode: boolean }) {
  return <div aria-hidden="true" className={`pointer-events-none absolute -inset-1 -z-10 ${isDarkMode ? 'text-white drop-shadow-[0_0_10px_#00E5FF]' : 'text-[#16223B] drop-shadow-[4px_4px_0_rgba(22,34,59,0.25)]'}`}>
    <div className={`absolute inset-0 backdrop-blur-xs ${isDarkMode ? 'bg-black/20' : 'bg-white/20'}`} style={{ clipPath: 'polygon(12px 0,calc(100% - 12px) 0,calc(100% - 12px) 4px,calc(100% - 8px) 4px,calc(100% - 8px) 8px,calc(100% - 4px) 8px,calc(100% - 4px) 12px,100% 12px,100% calc(100% - 12px),calc(100% - 4px) calc(100% - 12px),calc(100% - 4px) calc(100% - 8px),calc(100% - 8px) calc(100% - 8px),calc(100% - 8px) calc(100% - 4px),calc(100% - 12px) calc(100% - 4px),calc(100% - 12px) 100%,12px 100%,12px calc(100% - 4px),8px calc(100% - 4px),8px calc(100% - 8px),4px calc(100% - 8px),4px calc(100% - 12px),0 calc(100% - 12px),0 12px,4px 12px,4px 8px,8px 8px,8px 4px,12px 4px)' }} />
    <span className="absolute inset-x-3 top-0 h-1 bg-current" />
    <span className="absolute inset-x-3 bottom-0 h-1 bg-current" />
    <span className="absolute inset-y-3 left-0 w-1 bg-current" />
    <span className="absolute inset-y-3 right-0 w-1 bg-current" />
    {['left-0 top-0', 'right-0 top-0 -scale-x-100', 'left-0 bottom-0 -scale-y-100', 'right-0 bottom-0 -scale-100'].map(corner => <span key={corner} className={`absolute h-4 w-4 ${corner}`}>
      <span className="absolute left-2 top-1 h-1 w-2 bg-current" />
      <span className="absolute left-1 top-2 h-1 w-2 bg-current" />
      <span className="absolute left-0 top-3 h-1 w-2 bg-current" />
    </span>)}
  </div>;
}

export default function EntryScreen({ onEnter, isDarkMode, onToggleTheme }: EntryScreenProps) {
  const [realName, setRealName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [entryError, setEntryError] = useState('');
  const [isEntering, setIsEntering] = useState(false);
  const submittingRef = useRef(false);
  const reduceMotion = useReducedMotion();
  // The server creates the code when hosting; joiners type theirs.
  const validCode = isHost || /^[A-Z0-9]{4}$/.test(roomCode);
  const validName = realName.trim().length > 0 && realName.trim().length <= LIMITS.realNameMaxChars;
  const focusClass = `focus-visible:outline-2 focus-visible:outline-offset-4 ${isDarkMode ? 'focus-visible:outline-white' : 'focus-visible:outline-[#0064E0]'}`;
  const muted = isDarkMode ? 'text-[#B5DFFF]' : 'text-[#26374F]';
  const accent = isDarkMode ? 'text-[#00E5FF]' : 'text-[#0E1726]';
  const capsule = isDarkMode ? 'border-[#00E5FF]/40 bg-black/35' : 'border-[#16223B]/40 bg-white/20';

  return (
    <main className={`relative isolate flex min-h-[100dvh] w-full items-center justify-center overflow-hidden pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(5rem,calc(env(safe-area-inset-top)_+_4rem))] sm:pb-10 sm:pt-24 font-pixel transition-colors duration-300 ${isDarkMode ? 'bg-[#060B28] text-white' : 'bg-gradient-to-b from-[#FFAE70] via-[#FFD199] to-[#86C5DA] text-[#0E1726]'}`}>
      <PixelSky isDarkMode={isDarkMode} />
      <button type="button" aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'} title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={!isDarkMode} onClick={onToggleTheme} className={`absolute right-[max(1.25rem,env(safe-area-inset-right))] top-[max(1.25rem,env(safe-area-inset-top))] z-20 flex h-11 w-11 items-center justify-center rounded-xl border-2 backdrop-blur-sm transition-colors ${isDarkMode ? 'border-[#00E5FF]/60 bg-black/20 text-[#00E5FF] shadow-[3px_3px_0_#000] hover:bg-white/10' : 'border-[#16223B]/80 bg-white/20 text-[#0E1726] shadow-[3px_3px_0_#16223B40] hover:bg-white/40'} ${focusClass}`}>
        {isDarkMode ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
      </button>

      <motion.div initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.3 }} className="relative z-10 flex w-full flex-col items-center gap-5 sm:gap-10">
        <header className="mx-auto flex w-full max-w-5xl select-none flex-col items-center px-2 text-center sm:px-6">
          <ArcadeTitle />
          <p className="mt-3 inline-block border border-white bg-[#FF5376] px-4 py-1.5 text-[10px] leading-relaxed tracking-wider text-white uppercase shadow-[2px_2px_0_#000] sm:text-xs">PLAY // META AI ARCADE</p>
        </header>

        <section aria-labelledby="entry-title" className="relative isolate flex w-[calc(100%_-_2rem)] max-w-lg min-w-0 flex-col gap-4 border-4 border-transparent p-4 sm:gap-5 sm:p-8">
          <PixelFrame isDarkMode={isDarkMode} />
          <form aria-label={isHost ? 'Host room' : 'Join room'} aria-busy={isEntering} onSubmit={async event => {
            event.preventDefault();
            if (!validCode || !validName || submittingRef.current) return;
            submittingRef.current = true;
            setIsEntering(true);
            setEntryError('');
            try { await onEnter({ realName: realName.trim(), roomCode: isHost ? '' : roomCode, isHost }); }
            catch (error) { setEntryError(error instanceof Error ? error.message : 'Unable to enter this room. Please try again.'); }
            finally { submittingRef.current = false; setIsEntering(false); }
          }} className="flex min-w-0 w-full flex-col gap-4 sm:gap-5">
            <div role="group" aria-label="Room mode" className={`flex gap-2 rounded-xl p-1.5 ${isDarkMode ? 'bg-black/20' : 'bg-white/20'}`}>
              {[{ label: 'JOIN ROOM', host: false }, { label: 'HOST ROOM', host: true }].map(mode => <button key={mode.label} type="button" aria-pressed={isHost === mode.host} disabled={isEntering} onClick={() => { setIsHost(mode.host); setEntryError(''); }} className={`min-h-11 flex-1 rounded-lg border px-1 py-3 text-[8px] leading-relaxed transition-colors sm:text-[10px] ${focusClass} ${isHost === mode.host ? (isDarkMode ? 'border-cyan-100 bg-[#00E5FF] text-[#060B28] shadow-[2px_2px_0_#001155]' : 'border-[#16223B]/80 bg-[#16223B] text-white shadow-[2px_2px_0_#16223B40]') : `${capsule} ${muted}`}`}>{mode.label}</button>)}
            </div>
            <div>
              <label htmlFor="entry-real-name" className={`mb-2 block text-[8px] leading-relaxed tracking-wider sm:text-[10px] ${muted}`}>YOUR FIRST NAME</label>
              <input id="entry-real-name" type="text" required autoComplete="given-name" maxLength={LIMITS.realNameMaxChars} disabled={isEntering} value={realName} onChange={event => { setEntryError(''); setRealName(event.target.value.slice(0, LIMITS.realNameMaxChars)); }} placeholder="Maya" aria-describedby="real-name-help" className={`w-full rounded-xl border px-3 py-3 font-sans text-base leading-relaxed focus:outline-2 focus:outline-offset-4 ${capsule} ${isDarkMode ? 'text-[#00E5FF] placeholder:text-[#7D9CBD] focus:outline-white' : 'text-[#0E1726] placeholder:text-[#526078] focus:outline-[#0E1726]'}`} />
              <p id="real-name-help" className={`mt-2 font-sans text-xs ${muted}`}>Kept secret until the reveal. Everyone gets a random codename when the game starts.</p>
            </div>
            <motion.div key={isHost ? 'host' : 'join'} initial={{ opacity: reduceMotion ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: reduceMotion ? 0 : 0.15 }}>
              {isHost ? <>
                <p className={`rounded-xl border p-3 text-center font-sans text-xs leading-relaxed ${capsule} ${muted}`}>You'll get a room code to share as soon as the lobby opens.</p>
              </> : <>
                <label htmlFor="entry-room-code" className={`mb-2 block text-[8px] tracking-wider sm:text-[10px] ${muted}`}>ROOM CODE</label>
                <input id="entry-room-code" type="text" required autoComplete="off" autoCapitalize="characters" spellCheck={false} minLength={4} maxLength={4} pattern="[A-Z0-9]{4}" disabled={isEntering} aria-invalid={!!entryError} aria-describedby={entryError ? 'room-code-help entry-error' : 'room-code-help'} value={roomCode} onChange={event => { setEntryError(''); setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)); }} placeholder="CODE" className={`w-full rounded-xl border py-3 text-center text-xl leading-relaxed tracking-widest uppercase focus:outline-2 focus:outline-offset-4 ${capsule} ${isDarkMode ? 'text-[#00E5FF] placeholder:text-[#7D9CBD] focus:outline-white' : 'text-[#0E1726] placeholder:text-[#526078] focus:outline-[#0E1726]'}`} />
                <p id="room-code-help" className={`mt-2 text-center font-sans text-xs ${muted}`}>Enter your 4-character room code.</p>
              </>}
            </motion.div>
            {entryError && <p id="entry-error" role="alert" className={`rounded-xl border px-3 py-2 font-sans text-sm leading-relaxed ${isDarkMode ? 'border-[#FF5376]/50 bg-black/25 text-[#FFADBF]' : 'border-[#9E173B]/40 bg-white/30 text-[#8B1634]'}`}>{entryError}</p>}
            <button type="submit" disabled={!validCode || !validName || isEntering} className={`flex w-full cursor-pointer items-center justify-center rounded-xl border-b-4 border-[#B31D3F] bg-[#FF5376] py-4 text-[10px] leading-relaxed tracking-wider text-white uppercase shadow-[0_0_15px_#FF5376] transition-all hover:bg-[#FF3360] active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0 sm:text-sm ${focusClass}`}>{isEntering ? 'CHECKING ROOM...' : isHost ? 'CREATE LOBBY' : 'START MISSION'}</button>
          </form>
        </section>
      </motion.div>
    </main>
  );
}
