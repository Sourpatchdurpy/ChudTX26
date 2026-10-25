import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Moon, Send, Sun } from 'lucide-react';
import { CHAT_COOLDOWN_MS } from '@game/shared';
import PixelSky from '../shared/PixelSky';
import { useVisualViewportHeight } from '../../hooks/useVisualViewportHeight';
import type { DiscussionChatViewProps, DiscussionMsg, RoundAnswer } from '@/types/game';

export type { DiscussionChatViewProps, DiscussionMsg, RoundAnswer } from '@/types/game';

const ROUND_SECONDS = 50;
const COOLDOWN_SECONDS = CHAT_COOLDOWN_MS / 1000;
const CHARACTER_LIMIT = 200;

function PixelCorners() {
  return <>
    <span aria-hidden="true" className="pointer-events-none absolute -left-1 -top-1 h-3 w-3 border-l-2 border-t-2 border-white" />
    <span aria-hidden="true" className="pointer-events-none absolute -right-1 -top-1 h-3 w-3 border-r-2 border-t-2 border-white" />
    <span aria-hidden="true" className="pointer-events-none absolute -bottom-1 -left-1 h-3 w-3 border-b-2 border-l-2 border-white" />
    <span aria-hidden="true" className="pointer-events-none absolute -bottom-1 -right-1 h-3 w-3 border-b-2 border-r-2 border-white" />
  </>;
}

function AnswerPill({ answer, isDarkMode }: { answer: RoundAnswer; isDarkMode: boolean }) {
  return <li className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs lg:flex-col lg:items-start ${isDarkMode ? 'border-[#00E5FF]/40 bg-black/30 shadow-[2px_2px_0_#000]' : 'border-[#16223B]/40 bg-white/30 shadow-[2px_2px_0_#16223B20]'}`}>
    <span className={`font-pixel text-[9px] leading-relaxed ${isDarkMode ? 'text-[#00E5FF]' : 'text-[#0E1726]'}`}>[{answer.authorNickname}]:</span>
    <span className="max-w-64 truncate lg:max-w-full lg:whitespace-pre-wrap lg:break-words" title={answer.text}>“{answer.text}”</span>
  </li>;
}

function Message({ message, self, isDarkMode, reduceMotion }: { message: DiscussionMsg; self: boolean; isDarkMode: boolean; reduceMotion: boolean }) {
  const date = new Date(message.timestamp);
  const accent = isDarkMode ? 'text-[#00E5FF]' : 'text-[#0E1726]';
  return <motion.div initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.2 }} className={`flex items-start gap-2 ${self ? 'justify-end' : ''}`}>
    {!self && <div aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 font-pixel text-[10px] ${isDarkMode ? 'border-[#00E5FF] bg-[#0D153A]/70 text-[#00E5FF] shadow-[2px_2px_0_#000]' : 'border-[#16223B]/60 bg-white/40 text-[#0E1726] shadow-[2px_2px_0_#16223B25]'}`}>{Array.from(message.senderNickname)[0]?.toUpperCase()}</div>}
    <div className={`flex min-w-0 max-w-[82%] flex-col ${self ? 'items-end' : 'items-start'}`}>
      {!self && <span className={`mb-1 break-words font-pixel text-[10px] leading-relaxed ${accent}`}>{message.senderNickname}</span>}
      <div className={`max-w-full whitespace-pre-wrap break-words rounded-xl border-2 p-3 text-sm leading-relaxed ${self ? (isDarkMode ? 'border-[#00E5FF] bg-gradient-to-r from-[#0066FF] to-[#0052CC] font-medium text-white shadow-[0_0_12px_#00E5FF59]' : 'border-[#16223B]/60 bg-white/50 font-medium text-[#0E1726] shadow-[2px_2px_0_#16223B30]') : (isDarkMode ? 'border-[#1E2E6B] bg-[#0D153A]/80 text-white shadow-[2px_2px_0_#000]' : 'border-[#16223B]/30 bg-white/25 text-[#0E1726] shadow-[2px_2px_0_#16223B20]')}`}>{message.text}</div>
      {Number.isFinite(date.getTime()) && <time dateTime={date.toISOString()} className={`mt-1 font-mono text-[8px] ${isDarkMode ? 'text-zinc-400' : 'text-[#34465E]'} ${self ? 'mr-1 text-right' : 'ml-1'}`}>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}
    </div>
  </motion.div>;
}

export default function DiscussionChatView({
  isDarkMode, onToggleTheme, question, answers, messages, currentUserNickname,
  onSendMessage, onDiscussionEnd, initialSeconds = ROUND_SECONDS,
}: DiscussionChatViewProps) {
  // initialSeconds comes from the server, so the countdown matches the real phase (TIMER_SCALE included).
  const [startSeconds] = useState(() => Number.isFinite(initialSeconds) ? Math.max(0, initialSeconds) : ROUND_SECONDS);
  const [remaining, setRemaining] = useState(Math.ceil(startSeconds));
  const [inputText, setInputText] = useState('');
  const [holding, setHolding] = useState(false);
  const [holdSeconds, setHoldSeconds] = useState(0);
  const [shuffleSeed] = useState(() => Math.floor(Math.random() * 2147483647));
  const pendingRef = useRef<{ text: string; releaseAt: number } | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const endedRef = useRef(false);
  const callbacksRef = useRef({ onSendMessage, onDiscussionEnd });
  const logRef = useRef<HTMLDivElement>(null);
  /** True while the reader is at (or near) the newest message. */
  const stickToBottomRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const reduceMotion = !!useReducedMotion();
  const viewportHeight = useVisualViewportHeight();
  const charCount = inputText.length;
  const canCompose = !!onSendMessage && remaining > 0;
  const accent = isDarkMode ? 'text-[#00E5FF]' : 'text-[#0E1726]';
  const muted = isDarkMode ? 'text-[#B5DFFF]' : 'text-[#26374F]';
  const focusClass = `focus-visible:outline-2 focus-visible:outline-offset-2 ${isDarkMode ? 'focus-visible:outline-[#00E5FF]' : 'focus-visible:outline-[#16223B]'}`;
  const glass = isDarkMode ? 'border-[#00E5FF]/60 bg-black/20 shadow-[0_0_20px_#00E5FF35]' : 'border-[#16223B]/60 bg-white/20 shadow-[0_0_20px_#FFAE7060]';

  const shuffledAnswers = useMemo(() => {
    const rank = (id: string) => {
      let hash = shuffleSeed;
      for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
      return hash >>> 0;
    };
    return [...answers].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
  }, [answers, shuffleSeed]);

  useEffect(() => { callbacksRef.current = { onSendMessage, onDiscussionEnd }; }, [onSendMessage, onDiscussionEnd]);

  useEffect(() => {
    deadlineRef.current ??= Date.now() + startSeconds * 1000;
    const tick = () => {
      const now = Date.now();
      const seconds = Math.max(0, Math.ceil((deadlineRef.current! - now) / 1000));
      setRemaining(seconds);
      // The phase ending also ends the compose cooldown.
      if (seconds === 0) {
        clearInterval(timer);
        pendingRef.current = null;
        setHolding(false);
        setHoldSeconds(0);
        if (!endedRef.current) {
          endedRef.current = true;
          callbacksRef.current.onDiscussionEnd();
        }
        return;
      }
      const pending = pendingRef.current;
      if (!pending) return;
      setHoldSeconds(Math.max(0, Math.ceil((pending.releaseAt - now) / 1000)));
      // The message is already visible; only the next send is blocked.
      if (now >= pending.releaseAt) {
        pendingRef.current = null;
        setHolding(false);
      }
    };
    const timer = setInterval(tick, 100);
    tick();
    return () => clearInterval(timer);
  }, [startSeconds]);

  // Follow new messages only when one arrives (the parent re-renders several times a second)
  // and only if the reader is already at the bottom; scroll the log itself, never the page.
  useEffect(() => {
    const log = logRef.current;
    if (log && stickToBottomRef.current) log.scrollTop = log.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = 'auto';
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 96)}px`;
  }, [inputText]);

  function send() {
    if (!callbacksRef.current.onSendMessage || pendingRef.current || endedRef.current || deadlineRef.current === null || Date.now() >= deadlineRef.current || !inputText.trim() || charCount > CHARACTER_LIMIT) return;
    pendingRef.current = { text: inputText.trim(), releaseAt: Date.now() + CHAT_COOLDOWN_MS };
    callbacksRef.current.onSendMessage(inputText.trim());
    stickToBottomRef.current = true;
    setHolding(true);
    setHoldSeconds(COOLDOWN_SECONDS);
    setInputText('');
    inputRef.current?.focus();
  }

  return <main style={{ height: viewportHeight }} className={`relative isolate h-[100dvh] overflow-hidden font-sans transition-colors duration-300 ${isDarkMode ? 'bg-[#060B28] text-white' : 'bg-gradient-to-b from-[#FFAE70] via-[#FFD199] to-[#86C5DA] text-[#0E1726]'}`}>
    <PixelSky isDarkMode={isDarkMode} />
    <section aria-label="Discussion" className="relative z-10 mx-auto flex h-full w-full max-w-lg flex-col justify-between gap-2 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:gap-3 lg:grid lg:max-w-6xl lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-6 lg:p-6">
      <aside aria-label="Round context" className="max-h-[40%] min-h-0 min-w-0 shrink-0 space-y-2 overflow-y-auto px-1 sm:space-y-3 lg:max-h-none lg:p-1">
        <header className="flex items-center justify-between gap-3 py-2">
          <h1 className={`font-pixel text-[10px] leading-relaxed sm:text-xs ${accent}`}>DISCUSSION</h1>
          <div className="flex items-center gap-3">
            <span role="timer" aria-label={`${remaining} seconds remaining`} className={`font-pixel text-xs ${accent}`}>{remaining}s</span>
            <button type="button" onClick={onToggleTheme} aria-label={isDarkMode ? 'Switch to sunrise mode' : 'Switch to dark mode'} title={isDarkMode ? 'Switch to sunrise mode' : 'Switch to dark mode'} aria-pressed={!isDarkMode} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 backdrop-blur-xs transition-colors ${isDarkMode ? 'border-[#00E5FF]/60 bg-black/20 text-[#00E5FF] hover:bg-white/10' : 'border-[#16223B]/60 bg-white/20 text-[#0E1726] hover:bg-white/40'} ${focusClass}`}>
              {isDarkMode ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
            </button>
          </div>
        </header>
        <div className={`relative rounded-xl border-2 p-4 backdrop-blur-xs ${glass}`}>
          <PixelCorners />
          <p className={`mb-2 font-pixel text-[9px] leading-relaxed ${accent}`}>ROUND QUESTION</p>
          {question ? <p className="max-h-16 overflow-y-auto break-words text-sm font-bold leading-relaxed sm:max-h-24 lg:max-h-64 lg:text-lg">{question}</p> : <p className={`text-sm ${muted}`}>Waiting for the game question</p>}
        </div>
        <div className={`hidden items-center justify-between pt-3 font-pixel text-[9px] lg:flex ${accent}`}><span>SUBMITTED ANSWERS</span><span>{answers.length}</span></div>
        <ul aria-label="Submitted answers" tabIndex={0} className={`flex gap-2 overflow-x-auto py-1 lg:flex-col lg:overflow-x-hidden ${focusClass}`}>
          {shuffledAnswers.map(answer => <AnswerPill key={answer.id} answer={answer} isDarkMode={isDarkMode} />)}
        </ul>
      </aside>

      <div className={`relative flex min-h-0 min-w-0 flex-1 flex-col gap-3 rounded-2xl border-2 p-3 backdrop-blur-xs lg:p-4 ${glass}`}>
        <PixelCorners />
        <div className={`hidden items-center justify-between gap-3 border-b pb-4 lg:flex ${isDarkMode ? 'border-[#00E5FF]/25' : 'border-[#16223B]/25'}`}><h2 className={`font-pixel text-xs ${accent}`}>CHAT</h2><span className={`max-w-[65%] truncate font-pixel text-[8px] ${muted}`}>{currentUserNickname}</span></div>
        <div ref={logRef} onScroll={event => { const log = event.currentTarget; stickToBottomRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 80; }} role="log" aria-label="Discussion messages" aria-live="polite" aria-relevant="additions" className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-2 pr-1">
          {messages.length === 0 && <p className={`py-8 text-center text-sm ${muted}`}>No messages yet. Start the discussion.</p>}
          {messages.map(message => <Message key={message.id} message={message} self={message.senderNickname === currentUserNickname} isDarkMode={isDarkMode} reduceMotion={reduceMotion} />)}
        </div>

        <form onSubmit={event => { event.preventDefault(); send(); }} className={`shrink-0 rounded-2xl border-2 p-2 backdrop-blur-xs sm:p-3 ${glass}`}>
          <div className="mb-3 flex min-h-5 flex-wrap items-center justify-between gap-x-2 gap-y-2">
            <span className={`font-pixel text-[9px] leading-relaxed ${charCount >= 180 ? (isDarkMode ? 'text-[#FF8CA4]' : 'text-[#9E173B]') : accent}`}>[{charCount} / {CHARACTER_LIMIT}]</span>
            <AnimatePresence>{holding && <motion.span role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.15 }} className={`flex items-center gap-1.5 rounded-full border px-2 py-1 font-pixel text-[7px] leading-relaxed sm:text-[8px] ${isDarkMode ? 'border-[#FF5376]/40 bg-[#FF5376]/10 text-[#FFADBF]' : 'border-[#9E173B]/30 bg-white/20 text-[#8B1634]'}`}>
              <motion.span aria-hidden="true" initial={false} animate={reduceMotion ? { opacity: 1 } : { opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity }} className="h-1.5 w-1.5 shrink-0 bg-[#FF5376] shadow-[0_0_6px_#FF5376]" />
              COOLDOWN {holdSeconds}s
            </motion.span>}</AnimatePresence>
          </div>
          <div className="flex items-end gap-2">
            <textarea ref={inputRef} rows={1} aria-label="Discussion message" maxLength={CHARACTER_LIMIT} value={inputText} onChange={event => setInputText(event.target.value.slice(0, CHARACTER_LIMIT))} disabled={!canCompose} placeholder={onSendMessage ? 'Join the discussion...' : 'Discussion is read-only'} onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
            }} className={`max-h-24 min-h-11 min-w-0 flex-1 resize-none rounded-xl border px-3 py-2 font-sans text-base focus:outline-2 focus:outline-offset-1 disabled:opacity-50 sm:text-sm ${isDarkMode ? 'border-[#00E5FF]/30 bg-black/30 text-white placeholder:text-[#8495B3] focus:outline-[#00E5FF]' : 'border-[#16223B]/40 bg-white/25 text-[#0E1726] placeholder:text-[#526078] focus:outline-[#16223B]'}`} />
            <button type="submit" aria-label="Send message" disabled={!inputText.trim() || holding || !canCompose} className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl border-b-2 border-[#B31D3F] bg-[#FF5376] px-3 py-2 font-pixel text-xs text-white shadow-[2px_2px_0_#000] hover:bg-[#FF3360] active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-y-0 sm:px-4 ${focusClass}`}><Send size={17} aria-hidden="true" /><span className="hidden text-[9px] sm:inline">SEND</span></button>
          </div>
        </form>
      </div>
    </section>
  </main>;
}
