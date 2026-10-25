import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, LockKeyhole, Moon, Sun } from 'lucide-react';
import PixelSky from '../shared/PixelSky';
import { useVisualViewportHeight } from '../../hooks/useVisualViewportHeight';
import type { PrivateAnswerViewProps } from '@/types/game';

export type { PrivateAnswerViewProps } from '@/types/game';

const ROUND_SECONDS = 35;
const ANSWER_LIMIT = 280;
const TIERS = ['LIGHT', 'PERSONAL', 'DEEP'] as const;

export default function PrivateAnswerView(props: PrivateAnswerViewProps) {
  return <PrivateAnswerRound key={`${props.roundNumber}:${props.roundTier}`} {...props} />;
}

function PrivateAnswerRound({
  isDarkMode, onToggleTheme, roundNumber, roundTier, question, totalPlayers,
  answeredCount, initialSeconds = ROUND_SECONDS, onSubmitAnswer, onTimeUp,
}: PrivateAnswerViewProps) {
  const [startSeconds] = useState(() => Number.isFinite(initialSeconds) ? Math.max(0, initialSeconds) : ROUND_SECONDS);
  const [remaining, setRemaining] = useState(Math.ceil(startSeconds));
  const [text, setText] = useState('');
  const [lockedAnswer, setLockedAnswer] = useState<string | null>(null);
  const [error, setError] = useState('');
  const deadlineRef = useRef<number | null>(null);
  const lockedRef = useRef(false);
  const endedRef = useRef(false);
  const callbacksRef = useRef({ onSubmitAnswer, onTimeUp });
  const reduceMotion = !!useReducedMotion();
  const viewportHeight = useVisualViewportHeight();
  const total = Number.isFinite(totalPlayers) ? Math.max(0, Math.floor(totalPlayers)) : 0;
  const answered = Number.isFinite(answeredCount) ? Math.max(0, Math.min(total, Math.floor(answeredCount))) : 0;
  const progress = total > 0 ? answered / total * 100 : 0;
  const isLocked = lockedAnswer !== null;
  const accent = isDarkMode ? 'text-[#00E5FF]' : 'text-[#0E1726]';
  const muted = isDarkMode ? 'text-[#B5DFFF]' : 'text-[#26374F]';
  const border = isDarkMode ? 'border-[#00E5FF]/40' : 'border-[#16223B]/40';
  const focusClass = `focus-visible:outline-2 focus-visible:outline-offset-4 ${isDarkMode ? 'focus-visible:outline-[#00E5FF]' : 'focus-visible:outline-[#16223B]'}`;

  useEffect(() => { callbacksRef.current = { onSubmitAnswer, onTimeUp }; }, [onSubmitAnswer, onTimeUp]);
  useEffect(() => {
    deadlineRef.current ??= Date.now() + startSeconds * 1000;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((deadlineRef.current! - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) {
        clearInterval(timer);
        if (!endedRef.current) { endedRef.current = true; callbacksRef.current.onTimeUp(); }
      }
    };
    const timer = setInterval(tick, 100);
    tick();
    return () => clearInterval(timer);
  }, [startSeconds]);

  function submit() {
    const answer = text.trim();
    if (lockedRef.current || endedRef.current || deadlineRef.current === null || Date.now() >= deadlineRef.current || !answer || text.length > ANSWER_LIMIT) return;
    lockedRef.current = true;
    setLockedAnswer(answer);
    setError('');
    try { callbacksRef.current.onSubmitAnswer(answer); }
    catch {
      lockedRef.current = false;
      setLockedAnswer(null);
      setError('Your answer could not be submitted. Please try again.');
    }
  }

  return <main style={{ minHeight: viewportHeight }} className={`relative isolate flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] font-sans transition-colors duration-300 ${isDarkMode ? 'bg-[#060B28] text-white' : 'bg-gradient-to-b from-[#FFAE70] via-[#FFD199] to-[#86C5DA] text-[#0E1726]'}`}>
    <PixelSky isDarkMode={isDarkMode} />
    <motion.section aria-label="Private round answer" initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.25 }} className="relative z-10 my-3 flex w-full max-w-xl flex-col gap-4 sm:gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={`rounded-lg border px-2.5 py-2 font-pixel text-[8px] leading-relaxed sm:text-[10px] ${isDarkMode ? 'border-[#FF5376]/60 bg-[#FF5376]/10 text-[#FFADBF]' : 'border-[#9E173B]/40 bg-white/20 text-[#8B1634]'}`}>[ ROUND {String(roundNumber).padStart(2, '0')} : {roundTier} ]</h1>
        <div className="flex items-center gap-3">
          <span role="timer" aria-label={`${remaining} seconds remaining`} className={`font-pixel text-xs ${accent}`}>{remaining}s</span>
          <button type="button" onClick={onToggleTheme} aria-pressed={!isDarkMode} aria-label={isDarkMode ? 'Switch to sunrise mode' : 'Switch to dark mode'} className={`flex h-11 w-11 items-center justify-center rounded-xl border-2 backdrop-blur-xs ${border} ${accent} ${isDarkMode ? 'bg-black/20 hover:bg-white/10' : 'bg-white/20 hover:bg-white/40'} ${focusClass}`}>
            {isDarkMode ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <ol aria-label="Three round progression" className="grid grid-cols-3 gap-2">
        {TIERS.map((tier, index) => <li key={tier} aria-current={roundNumber === index + 1 ? 'step' : undefined} className={`rounded-lg border px-1.5 py-2 text-center font-pixel text-[7px] leading-relaxed sm:text-[9px] ${roundNumber === index + 1 ? (isDarkMode ? 'border-[#00E5FF] bg-[#00E5FF]/10 text-[#00E5FF]' : 'border-[#16223B] bg-white/35 text-[#0E1726]') : `${border} ${muted}`}`}>{index + 1}. {tier}</li>)}
      </ol>

      <div className={`relative flex flex-col gap-5 rounded-2xl border-4 p-4 backdrop-blur-xs sm:p-7 ${isDarkMode ? 'border-white/90 bg-black/20 shadow-[0_0_25px_#00E5FF]' : 'border-[#16223B]/80 bg-white/20 shadow-[0_0_25px_#FFAE7099]'}`}>
        <span aria-hidden="true" className="pointer-events-none absolute -left-2 -top-2 h-6 w-6 border-l-4 border-t-4 border-white" />
        <span aria-hidden="true" className="pointer-events-none absolute -right-2 -top-2 h-6 w-6 border-r-4 border-t-4 border-white" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-2 -left-2 h-6 w-6 border-b-4 border-l-4 border-white" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-2 -right-2 h-6 w-6 border-b-4 border-r-4 border-white" />

        <div>
          <p className={`mb-2 font-pixel text-[9px] leading-relaxed ${accent}`}>ROUND QUESTION</p>
          {question ? <h2 className="max-h-40 overflow-y-auto break-words text-lg font-bold leading-relaxed sm:text-xl">{question}</h2> : <h2 className={`text-base font-semibold ${muted}`}>Waiting for the game question</h2>}
        </div>
        <div>
          <p aria-live="polite" aria-atomic="true" className={`mb-2 font-pixel text-[9px] leading-relaxed ${accent}`}>[ {answered} / {total} ANSWERED ]</p>
          <div role="progressbar" aria-label="Players who answered" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-valuetext={`${answered} of ${total} answered`} className={`h-3 overflow-hidden border-2 ${border} ${isDarkMode ? 'bg-black/30 shadow-[2px_2px_0_#000]' : 'bg-white/20 shadow-[2px_2px_0_#16223B30]'}`}>
            <motion.div initial={false} animate={{ width: `${progress}%` }} transition={{ duration: reduceMotion ? 0 : 0.25 }} className={`h-full bg-[repeating-linear-gradient(90deg,transparent_0_14px,#060B2830_14px_16px)] ${isDarkMode ? 'bg-[#00E5FF]' : 'bg-[#16223B]'}`} />
          </div>
        </div>

        <form onSubmit={event => { event.preventDefault(); submit(); }} className="flex flex-col gap-3">
          <label htmlFor="private-answer" className={`flex items-center gap-2 text-sm font-semibold ${muted}`}><LockKeyhole size={14} aria-hidden="true" />Your private answer</label>
          <textarea id="private-answer" aria-describedby="private-answer-counter private-answer-help" maxLength={ANSWER_LIMIT} rows={4} value={text} readOnly={isLocked} disabled={remaining === 0} onChange={event => { if (!lockedRef.current) setText(event.target.value.slice(0, ANSWER_LIMIT)); }} onKeyDown={event => {
              // Enter locks in the answer, like the chat boxes; Shift+Enter still adds a line break.
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
            }} placeholder="Write your answer..." className={`max-h-56 min-h-32 w-full resize-y rounded-xl border p-3 text-base leading-relaxed focus:outline-2 focus:outline-offset-2 disabled:opacity-50 ${isDarkMode ? 'border-[#00E5FF]/40 bg-black/30 text-white placeholder:text-[#8495B3] focus:outline-[#00E5FF]' : 'border-[#16223B]/40 bg-white/25 text-[#0E1726] placeholder:text-[#526078] focus:outline-[#16223B]'}`} />
          <div className="flex items-center justify-between gap-2">
            <p id="private-answer-help" className={`text-xs ${muted}`}>Only you can see this answer. Press Enter to lock it in.</p>
            <span id="private-answer-counter" className={`shrink-0 font-pixel text-[9px] ${text.length >= 250 ? (isDarkMode ? 'text-[#FFADBF]' : 'text-[#8B1634]') : accent}`}>[ {text.length} / {ANSWER_LIMIT} ]</span>
          </div>
          {error && <p role="alert" className={`text-sm ${isDarkMode ? 'text-[#FFADBF]' : 'text-[#8B1634]'}`}>{error}</p>}
          <AnimatePresence mode="wait" initial={false}>
            {isLocked ? <motion.div key="locked" role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduceMotion ? 0 : 0.2 }} className={`space-y-3 rounded-xl border p-3 ${border} ${isDarkMode ? 'bg-black/25' : 'bg-white/20'}`}>
              <p className={`flex items-start gap-2 font-pixel text-[8px] leading-loose ${accent}`}><Check size={15} className="shrink-0" aria-hidden="true" />LOCKED IN // WAITING FOR REMAINING PLAYERS</p>
              <div className={`flex items-start gap-2 font-pixel text-[7px] leading-loose sm:text-[8px] ${muted}`}><motion.span aria-hidden="true" animate={reduceMotion ? { opacity: 1 } : { opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.5, repeat: Infinity }} className={`mt-1 h-2 w-2 shrink-0 ${isDarkMode ? 'bg-[#00E5FF] shadow-[0_0_6px_#00E5FF]' : 'bg-[#16223B]'}`} />[ ANSWER TRANSMITTED // STAND BY ]</div>
              <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed">{lockedAnswer}</p>
            </motion.div> : <motion.button key="submit" type="submit" disabled={!text.trim() || text.length > ANSWER_LIMIT || remaining === 0} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.15 }} className={`min-h-14 w-full rounded-xl border-b-4 border-[#B31D3F] bg-[#FF5376] px-3 py-4 font-pixel text-[10px] leading-relaxed text-white shadow-[0_0_15px_#FF5376] transition-colors hover:bg-[#FF3360] active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-y-0 sm:text-xs ${focusClass}`}>LOCK IN ANSWER</motion.button>}
          </AnimatePresence>
        </form>
      </div>
    </motion.section>
  </main>;
}
