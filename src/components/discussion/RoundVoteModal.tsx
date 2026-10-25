import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Crosshair } from 'lucide-react';
import type { RoundVoteModalProps } from '@/types/game';

export type { RoundVoteModalProps, VoteOption, RoundVoteResult } from '@/types/game';

const VOTE_SECONDS = 20;

export default function RoundVoteModal({ isDarkMode, secondsRemaining, candidates, onCastVote, roundResult = null, tally = null }: RoundVoteModalProps) {
  const seconds = Number.isFinite(secondsRemaining) ? Math.min(VOTE_SECONDS, Math.max(0, Math.ceil(secondsRemaining))) : 0;
  const [selected, setSelected] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const submittedRef = useRef(false);
  const deadlineRef = useRef(Date.now() + seconds * 1000);
  const dialogRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const reduceMotion = !!useReducedMotion();
  const accent = isDarkMode ? 'text-[#00E5FF]' : 'text-[#0E1726]';
  const muted = isDarkMode ? 'text-[#B5DFFF]' : 'text-[#26374F]';
  const focusClass = `focus-visible:outline-2 focus-visible:outline-offset-2 ${isDarkMode ? 'focus-visible:outline-[#00E5FF]' : 'focus-visible:outline-[#16223B]'}`;

  useEffect(() => {
    // A delayed parent render must never extend the original voting window.
    deadlineRef.current = Math.min(deadlineRef.current, Date.now() + seconds * 1000);
  }, [seconds]);
  useEffect(() => {
    mountedRef.current = true;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
      if (!controls.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLButtonElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLButtonElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      mountedRef.current = false;
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', trapFocus);
      previousFocus?.focus();
    };
  }, []);
  const showResult = !!roundResult || !!tally;
  useEffect(() => { if (showResult) dialogRef.current?.focus(); }, [showResult]);

  async function castVote(nickname: string) {
    if (submittedRef.current || seconds <= 0 || showResult || Date.now() >= deadlineRef.current) return;
    submittedRef.current = true;
    setSelected(nickname);
    setIsSending(true);
    setError('');
    try { await onCastVote(nickname); }
    catch (caught) {
      if (!mountedRef.current) return;
      submittedRef.current = false;
      setSelected(null);
      setError(caught instanceof Error ? caught.message : 'Your vote could not be submitted. Please try again.');
    } finally { if (mountedRef.current) setIsSending(false); }
  }

  const isStalemate = roundResult && (roundResult.isTie || (!roundResult.wasAi && !roundResult.eliminatedNickname));

  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.18 }} className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-[max(1.5rem,env(safe-area-inset-top))] backdrop-blur-md">
    <motion.div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="round-vote-title" aria-describedby="round-vote-description" tabIndex={-1} initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: reduceMotion ? 0 : 0.2 }} className={`relative my-auto flex max-h-[85dvh] w-full max-w-lg flex-col gap-5 rounded-2xl border-2 p-4 font-sans backdrop-blur-md focus:outline-none sm:p-6 ${isDarkMode ? 'border-[#00E5FF] bg-[#060B28]/85 text-white shadow-[0_0_30px_#00E5FF50]' : 'border-[#16223B]/80 bg-[#FFF1DC]/90 text-[#0E1726] shadow-[0_0_30px_#FFAE7060]'}`}>
      <span aria-hidden="true" className="pointer-events-none absolute -left-1 -top-1 h-4 w-4 border-l-2 border-t-2 border-white" />
      <span aria-hidden="true" className="pointer-events-none absolute -right-1 -top-1 h-4 w-4 border-r-2 border-t-2 border-white" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-1 -left-1 h-4 w-4 border-b-2 border-l-2 border-white" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-1 -right-1 h-4 w-4 border-b-2 border-r-2 border-white" />
      <header className="shrink-0 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h2 id="round-vote-title" className={`font-pixel text-xs leading-loose sm:text-sm ${accent}`}>VOTE THE IMPOSTER</h2>
          <span role="timer" aria-label={`${seconds} seconds remaining`} className={`shrink-0 font-pixel text-xs ${isDarkMode ? 'text-[#FF8CA4]' : 'text-[#9E173B]'}`}>{seconds}s</span>
        </div>
        <motion.div aria-hidden="true" initial={false} animate={reduceMotion || showResult || seconds === 0 ? { opacity: 1 } : { opacity: [1, 0.55, 1] }} transition={{ duration: 1, repeat: Infinity }} className={`h-2 overflow-hidden border ${isDarkMode ? 'border-[#FF5376]/40 bg-black/30' : 'border-[#9E173B]/30 bg-white/20'}`}>
          <motion.div initial={false} animate={{ width: `${seconds / VOTE_SECONDS * 100}%` }} transition={{ duration: reduceMotion ? 0 : 0.2 }} className="h-full bg-[#FF5376]" />
        </motion.div>
        <p id="round-vote-description" className={`text-xs leading-relaxed ${muted}`}>{showResult ? 'The votes are in.' : 'Choose the codename you believe belongs to the AI. Your vote locks when selected.'}</p>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        {tally ? <motion.div key="tally" role="status" initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: reduceMotion ? 0 : 0.25 }} className={`flex min-h-48 min-w-0 flex-col items-center justify-center gap-4 overflow-y-auto rounded-xl border-2 p-5 text-center ${isDarkMode ? "border-[#00E5FF]/50 bg-[#00E5FF]/5" : "border-[#16223B]/40 bg-white/20"}`}>
          <p className={`break-words font-pixel text-xs leading-loose sm:text-sm ${accent}`}>[ VOTES IN // NOBODY LEAVES ]</p>
          <ul aria-label="Vote counts" className="w-full space-y-2">{[...tally].sort((a, b) => b.votes - a.votes).map(t => <li key={t.nickname} className="flex items-center justify-between gap-3 text-sm"><span className={`break-words font-pixel text-[10px] leading-loose ${accent}`}>{t.nickname}</span><span className="font-pixel text-[10px]">{t.votes}</span></li>)}</ul>
          <p className={`text-sm ${muted}`}>Everyone stays in the game. Advancing to the next round.</p>
        </motion.div> : roundResult ? <motion.div key="result" role="status" initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: reduceMotion ? 0 : 0.25 }} className={`flex min-h-48 min-w-0 flex-col items-center justify-center gap-4 overflow-y-auto rounded-xl border-2 p-5 text-center ${isStalemate ? (isDarkMode ? 'border-[#00E5FF]/50 bg-[#00E5FF]/5' : 'border-[#16223B]/40 bg-white/20') : roundResult.wasAi ? 'border-[#38EF7D] bg-[#38EF7D]/10' : 'border-[#FF5376] bg-[#FF5376]/10'}`}>
          <p className={`break-words font-pixel text-xs leading-loose sm:text-sm ${isStalemate ? accent : roundResult.wasAi ? (isDarkMode ? 'text-[#38EF7D] [text-shadow:0_0_12px_#38EF7D60]' : 'text-[#126438]') : (isDarkMode ? 'text-[#FF8CA4]' : 'text-[#9E173B]')}`}>
            {isStalemate ? '[ STALEMATE: NO CONSENSUS ]' : roundResult.wasAi ? '[ IMPOSTER DETECTED // PROTOCOL BREACHED ]' : `[ ${roundResult.eliminatedNickname} IS HUMAN // CLEARED ]`}
          </p>
          <p className={`text-sm ${muted}`}>{isStalemate ? 'No consensus. Advancing to the next round.' : roundResult.wasAi ? 'The AI has been found. Humans win.' : 'They stay in the game. Advancing to the next round.'}</p>
        </motion.div> : <motion.div key="candidates" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-0 space-y-3 overflow-y-auto p-1">
          <div role="group" aria-label="Choose a player to accuse" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {candidates.map(candidate => <motion.button key={candidate.nickname} type="button" aria-pressed={selected === candidate.nickname} disabled={seconds === 0 || selected !== null} onClick={() => { void castVote(candidate.nickname); }} whileTap={reduceMotion ? undefined : { y: 2 }} className={`min-h-24 min-w-0 rounded-xl border-2 p-3 text-left shadow-[2px_2px_0_#000] transition-colors disabled:cursor-default ${focusClass} ${selected === candidate.nickname ? (isDarkMode ? 'border-[#00E5FF] bg-[#00E5FF]/15 shadow-[0_0_16px_#00E5FF60]' : 'border-[#16223B] bg-white/60') : (isDarkMode ? 'border-[#1E2E6B] bg-black/20 enabled:hover:border-[#00E5FF]/70' : 'border-[#16223B]/30 bg-white/20 enabled:hover:border-[#16223B]')}`}>
              <span className={`flex items-start gap-2 font-pixel text-[10px] leading-loose ${accent}`}>{selected === candidate.nickname ? <Check size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> : <Crosshair size={15} className="mt-0.5 shrink-0" aria-hidden="true" />}<span className="min-w-0 break-words">{candidate.nickname}</span></span>
              <span className={`mt-2 block whitespace-pre-wrap break-words text-xs leading-relaxed ${muted}`}>{candidate.answerSnippet || 'No submitted answer'}</span>
            </motion.button>)}
          </div>
          {candidates.length === 0 && <p className={`py-6 text-center text-sm ${muted}`}>No other participants are available to vote for.</p>}
          {selected && <p role="status" className={`text-center font-pixel text-[9px] leading-loose ${accent}`}>{isSending ? 'TRANSMITTING VOTE...' : 'VOTE LOCKED // WAITING FOR RESULTS'}</p>}
          {!selected && seconds === 0 && <p role="status" className={`text-center text-sm ${muted}`}>Voting closed. Awaiting the result.</p>}
          {error && <p role="alert" className={`text-sm ${isDarkMode ? 'text-[#FFADBF]' : 'text-[#9E173B]'}`}>{error}</p>}
        </motion.div>}
      </AnimatePresence>
    </motion.div>
  </motion.div>;
}
