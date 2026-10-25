import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Moon, ShieldCheck, Sun } from 'lucide-react';
import PixelSky from '../shared/PixelSky';
import type { PairResultsViewProps } from '@/types/game';

export type { PairResultsViewProps } from '@/types/game';

export default function PairResultsView({
  isDarkMode, onToggleTheme, card, submitPrompt, pairs, initialSeconds, myPartners, onSetVouch, vouchLines,
}: PairResultsViewProps) {
  const [deadline] = useState(() => Date.now() + Math.max(0, initialSeconds) * 1000);
  const [remaining, setRemaining] = useState(Math.ceil(Math.max(0, initialSeconds)));
  const reduceMotion = !!useReducedMotion();
  const accent = isDarkMode ? 'text-[#00E5FF]' : 'text-[#0E1726]';
  const muted = isDarkMode ? 'text-[#B5DFFF]' : 'text-[#26374F]';
  const border = isDarkMode ? 'border-[#00E5FF]/40' : 'border-[#16223B]/40';
  const focusClass = `focus-visible:outline-2 focus-visible:outline-offset-2 ${isDarkMode ? 'focus-visible:outline-[#00E5FF]' : 'focus-visible:outline-[#16223B]'}`;

  useEffect(() => {
    const timer = setInterval(() => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
    return () => clearInterval(timer);
  }, [deadline]);

  return <main className={`relative isolate flex min-h-[100dvh] flex-col items-center overflow-hidden pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] font-sans transition-colors duration-300 ${isDarkMode ? 'bg-[#060B28] text-white' : 'bg-gradient-to-b from-[#FFAE70] via-[#FFD199] to-[#86C5DA] text-[#0E1726]'}`}>
    <PixelSky isDarkMode={isDarkMode} />
    <motion.section aria-label="Pair results" initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.25 }} className="relative z-10 my-3 flex w-full max-w-xl flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className={`font-pixel text-[10px] leading-relaxed sm:text-xs ${accent}`}>ROUND 03 // RESULTS</h1>
        <div className="flex items-center gap-3">
          <span role="timer" aria-label={`${remaining} seconds remaining`} className={`font-pixel text-xs ${accent}`}>{remaining}s</span>
          <button type="button" onClick={onToggleTheme} aria-label={isDarkMode ? 'Switch to sunrise mode' : 'Switch to dark mode'} aria-pressed={!isDarkMode} className={`flex h-11 w-11 items-center justify-center rounded-xl border-2 backdrop-blur-xs ${border} ${accent} ${isDarkMode ? 'bg-black/20 hover:bg-white/10' : 'bg-white/20 hover:bg-white/40'} ${focusClass}`}>
            {isDarkMode ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <div className={`rounded-2xl border-4 p-4 backdrop-blur-xs sm:p-6 ${isDarkMode ? 'border-white/90 bg-black/20 shadow-[0_0_25px_#00E5FF]' : 'border-[#16223B]/80 bg-white/20 shadow-[0_0_25px_#FFAE7099]'}`}>
        <p className={`mb-1 font-pixel text-[9px] leading-relaxed ${accent}`}>COLLAB CARD</p>
        <p className="break-words text-sm font-bold leading-relaxed">{card}</p>
        <p className={`mt-2 text-xs ${muted}`}>Each partner answered: {submitPrompt}</p>

        <ul aria-label="Every pair's results" className="mt-4 space-y-3">
          {pairs.map((members, index) => <li key={members.map(m => m.id).join(':')} className={`rounded-xl border-2 p-3 ${border} ${isDarkMode ? 'bg-black/25' : 'bg-white/25'}`}>
            <p className={`mb-2 font-pixel text-[8px] leading-relaxed ${muted}`}>PAIR {index + 1}</p>
            <ul className="space-y-2">
              {members.map(member => <li key={member.id} className="flex flex-col gap-0.5">
                <span className={`font-pixel text-[9px] leading-relaxed ${accent}`}>{member.nickname}{member.isMe ? ' (you)' : ''}</span>
                <span className="break-words text-sm leading-relaxed">{member.result ? `“${member.result}”` : <span className={muted}>(no result)</span>}</span>
              </li>)}
            </ul>
          </li>)}
        </ul>
      </div>

      {myPartners && myPartners.length > 0 && <div className={`space-y-3 rounded-2xl border-2 p-4 backdrop-blur-xs ${border} ${isDarkMode ? 'bg-black/20' : 'bg-white/20'}`}>
        <p className={`font-pixel text-[9px] leading-relaxed ${accent}`}>VOUCH FOR YOUR PARTNER</p>
        <p className={`text-xs ${muted}`}>Vouches become public before the final vote. Vouching for the AI is a bad look.</p>
        {myPartners.map(partner => <button key={partner.id} type="button" aria-pressed={partner.vouched} disabled={remaining === 0 || !onSetVouch} onClick={() => onSetVouch?.(partner.id, !partner.vouched)} className={`flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-3 py-3 text-left transition-colors disabled:opacity-50 ${focusClass} ${partner.vouched ? (isDarkMode ? 'border-[#38EF7D] bg-[#38EF7D]/10' : 'border-[#126438] bg-white/50') : `${border} ${isDarkMode ? 'bg-black/20' : 'bg-white/20'}`}`}>
          <ShieldCheck size={20} aria-hidden="true" className={partner.vouched ? (isDarkMode ? 'text-[#38EF7D]' : 'text-[#126438]') : muted} />
          <span className="text-sm font-semibold">I vouch <span className={`font-pixel text-[9px] ${accent}`}>{partner.nickname}</span> is human</span>
          <span className={`ml-auto font-pixel text-[8px] ${muted}`}>{partner.vouched ? 'ON' : 'OFF'}</span>
        </button>)}
      </div>}

      {vouchLines && <div className={`space-y-2 rounded-2xl border-2 p-4 backdrop-blur-xs ${border} ${isDarkMode ? 'bg-black/20' : 'bg-white/20'}`}>
        <p className={`font-pixel text-[9px] leading-relaxed ${accent}`}>PUBLIC VOUCHES</p>
        {vouchLines.length === 0 ? <p className={`text-sm ${muted}`}>Nobody vouched for anyone.</p> : <ul className="space-y-1">{vouchLines.map(line => <li key={line} className="text-sm">{line}</li>)}</ul>}
      </div>}
    </motion.section>
  </main>;
}
