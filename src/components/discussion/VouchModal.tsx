// Round 3 vouching, in RoundVoteModal's design: same dialog frame, timer bar and
// candidate cards. Tapping a partner toggles "I vouch they're human" (default off).
import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Crosshair } from 'lucide-react';

const VOUCH_SECONDS = 20;

export interface VouchModalProps {
  isDarkMode: boolean;
  secondsRemaining: number;
  partners: { id: string; nickname: string; result: string }[];
  vouches: Record<string, boolean>;
  onToggle: (partnerId: string, vouched: boolean) => Promise<unknown>;
}

export default function VouchModal({ isDarkMode, secondsRemaining, partners, vouches, onToggle }: VouchModalProps) {
  const seconds = Number.isFinite(secondsRemaining) ? Math.min(VOUCH_SECONDS, Math.max(0, Math.ceil(secondsRemaining))) : 0;
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const reduceMotion = !!useReducedMotion();
  const accent = isDarkMode ? 'text-[#00E5FF]' : 'text-[#0E1726]';
  const muted = isDarkMode ? 'text-[#B5DFFF]' : 'text-[#26374F]';
  const focusClass = `focus-visible:outline-2 focus-visible:outline-offset-2 ${isDarkMode ? 'focus-visible:outline-[#00E5FF]' : 'focus-visible:outline-[#16223B]'}`;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduceMotion ? 0 : 0.18 }} className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-[max(1.5rem,env(safe-area-inset-top))] backdrop-blur-md">
    <motion.div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="vouch-title" aria-describedby="vouch-description" tabIndex={-1} initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: reduceMotion ? 0 : 0.2 }} className={`relative my-auto flex max-h-[85dvh] w-full max-w-lg flex-col gap-5 rounded-2xl border-2 p-4 font-sans backdrop-blur-md focus:outline-none sm:p-6 ${isDarkMode ? 'border-[#00E5FF] bg-[#060B28]/85 text-white shadow-[0_0_30px_#00E5FF50]' : 'border-[#16223B]/80 bg-[#FFF1DC]/90 text-[#0E1726] shadow-[0_0_30px_#FFAE7060]'}`}>
      <span aria-hidden="true" className="pointer-events-none absolute -left-1 -top-1 h-4 w-4 border-l-2 border-t-2 border-white" />
      <span aria-hidden="true" className="pointer-events-none absolute -right-1 -top-1 h-4 w-4 border-r-2 border-t-2 border-white" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-1 -left-1 h-4 w-4 border-b-2 border-l-2 border-white" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-1 -right-1 h-4 w-4 border-b-2 border-r-2 border-white" />
      <header className="shrink-0 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h2 id="vouch-title" className={`font-pixel text-xs leading-loose sm:text-sm ${accent}`}>VOUCH FOR YOUR PARTNER</h2>
          <span role="timer" aria-label={`${seconds} seconds remaining`} className={`shrink-0 font-pixel text-xs ${isDarkMode ? 'text-[#FF8CA4]' : 'text-[#9E173B]'}`}>{seconds}s</span>
        </div>
        <motion.div aria-hidden="true" initial={false} animate={reduceMotion || seconds === 0 ? { opacity: 1 } : { opacity: [1, 0.55, 1] }} transition={{ duration: 1, repeat: Infinity }} className={`h-2 overflow-hidden border ${isDarkMode ? 'border-[#FF5376]/40 bg-black/30' : 'border-[#9E173B]/30 bg-white/20'}`}>
          <motion.div initial={false} animate={{ width: `${seconds / VOUCH_SECONDS * 100}%` }} transition={{ duration: reduceMotion ? 0 : 0.2 }} className="h-full bg-[#FF5376]" />
        </motion.div>
        <p id="vouch-description" className={`text-xs leading-relaxed ${muted}`}>Tap to vouch that your partner is human. Vouches go public before the final vote.</p>
      </header>

      <div className="min-h-0 space-y-3 overflow-y-auto p-1">
        <div role="group" aria-label="Vouch for your partner" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {partners.map(partner => {
            const on = !!vouches[partner.id];
            return <motion.button key={partner.id} type="button" aria-pressed={on} disabled={seconds === 0} onClick={async () => {
              setError('');
              try { await onToggle(partner.id, !on); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Your vouch could not be saved. Please try again.'); }
            }} whileTap={reduceMotion ? undefined : { y: 2 }} className={`min-h-24 min-w-0 rounded-xl border-2 p-3 text-left shadow-[2px_2px_0_#000] transition-colors disabled:cursor-default ${focusClass} ${on ? (isDarkMode ? 'border-[#00E5FF] bg-[#00E5FF]/15 shadow-[0_0_16px_#00E5FF60]' : 'border-[#16223B] bg-white/60') : (isDarkMode ? 'border-[#1E2E6B] bg-black/20 enabled:hover:border-[#00E5FF]/70' : 'border-[#16223B]/30 bg-white/20 enabled:hover:border-[#16223B]')}`}>
              <span className={`flex items-start gap-2 font-pixel text-[10px] leading-loose ${accent}`}>{on ? <Check size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> : <Crosshair size={15} className="mt-0.5 shrink-0" aria-hidden="true" />}<span className="min-w-0 break-words">{partner.nickname}</span></span>
              <span className={`mt-2 block whitespace-pre-wrap break-words text-xs leading-relaxed ${muted}`}>{partner.result || 'No submitted answer'}</span>
            </motion.button>;
          })}
        </div>
        <p role="status" className={`text-center font-pixel text-[9px] leading-loose ${accent}`}>{partners.some(p => vouches[p.id]) ? 'VOUCH LOCKED // WAITING FOR RESULTS' : seconds === 0 ? 'Vouching closed. Awaiting the final vote.' : ''}</p>
        {error && <p role="alert" className={`text-sm ${isDarkMode ? 'text-[#FFADBF]' : 'text-[#9E173B]'}`}>{error}</p>}
      </div>
    </motion.div>
  </motion.div>;
}
