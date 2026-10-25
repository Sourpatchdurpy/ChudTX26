import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Moon, Send, Sun, Users } from 'lucide-react';
import { LIMITS } from '@game/shared';
import PixelSky from '../shared/PixelSky';
import { useVisualViewportHeight } from '../../hooks/useVisualViewportHeight';
import type { PairChatViewProps } from '@/types/game';

export type { PairChatViewProps } from '@/types/game';

/** The server holds every message this long before anyone sees it; we show "sending…" meanwhile. */
const HOLD_SECONDS = 5;

function PixelCorners() {
  return <>
    <span aria-hidden="true" className="pointer-events-none absolute -left-1 -top-1 h-3 w-3 border-l-2 border-t-2 border-white" />
    <span aria-hidden="true" className="pointer-events-none absolute -right-1 -top-1 h-3 w-3 border-r-2 border-t-2 border-white" />
    <span aria-hidden="true" className="pointer-events-none absolute -bottom-1 -left-1 h-3 w-3 border-b-2 border-l-2 border-white" />
    <span aria-hidden="true" className="pointer-events-none absolute -bottom-1 -right-1 h-3 w-3 border-b-2 border-r-2 border-white" />
  </>;
}

export default function PairChatView({
  isDarkMode, onToggleTheme, card, submitPrompt, partnerNicknames, messages, currentUserNickname,
  initialSeconds, myResult, onSendMessage, onSubmitResult,
}: PairChatViewProps) {
  const [deadline] = useState(() => Date.now() + Math.max(0, initialSeconds) * 1000);
  const [remaining, setRemaining] = useState(Math.ceil(Math.max(0, initialSeconds)));
  const [inputText, setInputText] = useState('');
  const [holdUntil, setHoldUntil] = useState(0);
  const [result, setResult] = useState(myResult ?? '');
  const [resultStatus, setResultStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(myResult ? 'saved' : 'idle');
  const [resultError, setResultError] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  /** True while the reader is at (or near) the newest message. */
  const stickToBottomRef = useRef(true);
  const reduceMotion = !!useReducedMotion();
  const viewportHeight = useVisualViewportHeight();
  const open = remaining > 0;
  const holding = holdUntil > Date.now();
  const accent = isDarkMode ? 'text-[#00E5FF]' : 'text-[#0E1726]';
  const muted = isDarkMode ? 'text-[#B5DFFF]' : 'text-[#26374F]';
  const focusClass = `focus-visible:outline-2 focus-visible:outline-offset-2 ${isDarkMode ? 'focus-visible:outline-[#00E5FF]' : 'focus-visible:outline-[#16223B]'}`;
  const glass = isDarkMode ? 'border-[#00E5FF]/60 bg-black/20 shadow-[0_0_20px_#00E5FF35]' : 'border-[#16223B]/60 bg-white/20 shadow-[0_0_20px_#FFAE7060]';
  const field = isDarkMode ? 'border-[#00E5FF]/30 bg-black/30 text-white placeholder:text-[#8495B3] focus:outline-[#00E5FF]' : 'border-[#16223B]/40 bg-white/25 text-[#0E1726] placeholder:text-[#526078] focus:outline-[#16223B]';

  useEffect(() => {
    const timer = setInterval(() => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
    return () => clearInterval(timer);
  }, [deadline]);
  // Follow new messages only when one arrives, and only if the reader is already at the bottom.
  useEffect(() => {
    const log = logRef.current;
    if (log && stickToBottomRef.current) log.scrollTop = log.scrollHeight;
  }, [messages.length]);

  function send() {
    const text = inputText.trim();
    if (!open || holding || !text || text.length > LIMITS.chatMaxChars) return;
    onSendMessage(text);
    stickToBottomRef.current = true;
    setInputText('');
    setHoldUntil(Date.now() + HOLD_SECONDS * 1000);
    setTimeout(() => setHoldUntil(0), HOLD_SECONDS * 1000);
  }

  async function saveResult() {
    const text = result.trim();
    if (!open || !text || text.length > LIMITS.collabMaxChars) return;
    setResultStatus('saving');
    setResultError('');
    try {
      await onSubmitResult(text);
      setResultStatus('saved');
    } catch (error) {
      setResultStatus('error');
      setResultError(error instanceof Error ? error.message : 'Your result could not be saved. Please try again.');
    }
  }

  return <main style={{ height: viewportHeight }} className={`relative isolate h-[100dvh] overflow-hidden font-sans transition-colors duration-300 ${isDarkMode ? 'bg-[#060B28] text-white' : 'bg-gradient-to-b from-[#FFAE70] via-[#FFD199] to-[#86C5DA] text-[#0E1726]'}`}>
    <PixelSky isDarkMode={isDarkMode} />
    <section aria-label="Pair chat" className="relative z-10 mx-auto flex h-full w-full max-w-lg flex-col gap-2 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:gap-3 lg:max-w-3xl">
      <header className="flex shrink-0 items-center justify-between gap-3 py-2">
        <h1 className={`font-pixel text-[10px] leading-relaxed sm:text-xs ${accent}`}>ROUND 03 // PAIR UP</h1>
        <div className="flex items-center gap-3">
          <span role="timer" aria-label={`${remaining} seconds remaining`} className={`font-pixel text-xs ${accent}`}>{remaining}s</span>
          <button type="button" onClick={onToggleTheme} aria-label={isDarkMode ? 'Switch to sunrise mode' : 'Switch to dark mode'} aria-pressed={!isDarkMode} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 backdrop-blur-xs transition-colors ${isDarkMode ? 'border-[#00E5FF]/60 bg-black/20 text-[#00E5FF] hover:bg-white/10' : 'border-[#16223B]/60 bg-white/20 text-[#0E1726] hover:bg-white/40'} ${focusClass}`}>
            {isDarkMode ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <div className={`relative shrink-0 rounded-xl border-2 p-4 backdrop-blur-xs ${glass}`}>
        <PixelCorners />
        <p className={`mb-2 font-pixel text-[9px] leading-relaxed ${accent}`}>COLLAB CARD</p>
        <p className="max-h-24 overflow-y-auto break-words text-sm font-bold leading-relaxed sm:text-base">{card}</p>
        <p className={`mt-3 flex flex-wrap items-center gap-2 text-xs ${muted}`}><Users size={14} aria-hidden="true" />Paired with <span className={`font-pixel text-[9px] ${accent}`}>{partnerNicknames.join(' + ') || '...'}</span>. One of you might be the AI.</p>
      </div>

      <div className={`relative flex min-h-0 flex-1 flex-col gap-3 rounded-2xl border-2 p-3 backdrop-blur-xs ${glass}`}>
        <PixelCorners />
        <div ref={logRef} onScroll={event => { const log = event.currentTarget; stickToBottomRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 80; }} role="log" aria-label="Pair messages" aria-live="polite" aria-relevant="additions" className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-1 pr-1">
          {messages.length === 0 && <p className={`py-6 text-center text-sm ${muted}`}>Say hi. Only your pair can see this chat.</p>}
          {messages.map(message => {
            const self = message.senderNickname === currentUserNickname;
            return <motion.div key={message.id} initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.2 }} className={`flex flex-col ${self ? 'items-end' : 'items-start'}`}>
              {!self && <span className={`mb-1 font-pixel text-[9px] leading-relaxed ${accent}`}>{message.senderNickname}</span>}
              <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-xl border-2 p-3 text-sm leading-relaxed ${self ? (isDarkMode ? 'border-[#00E5FF] bg-gradient-to-r from-[#0066FF] to-[#0052CC] text-white' : 'border-[#16223B]/60 bg-white/50 text-[#0E1726]') : (isDarkMode ? 'border-[#1E2E6B] bg-[#0D153A]/80 text-white' : 'border-[#16223B]/30 bg-white/25 text-[#0E1726]')}`}>{message.text}</div>
            </motion.div>;
          })}
        </div>
        <form onSubmit={event => { event.preventDefault(); send(); }} className="flex shrink-0 items-end gap-2">
          <textarea rows={1} aria-label="Pair message" maxLength={LIMITS.chatMaxChars} value={inputText} disabled={!open} onChange={event => setInputText(event.target.value.slice(0, LIMITS.chatMaxChars))} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} placeholder={open ? 'Message your partner...' : 'Pair chat is closed'} className={`max-h-24 min-h-11 min-w-0 flex-1 resize-none rounded-xl border px-3 py-2 text-base focus:outline-2 focus:outline-offset-1 disabled:opacity-50 sm:text-sm ${field}`} />
          <button type="submit" aria-label="Send message" disabled={!open || holding || !inputText.trim()} className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border-b-2 border-[#B31D3F] bg-[#FF5376] px-3 py-2 text-white shadow-[2px_2px_0_#000] hover:bg-[#FF3360] disabled:cursor-not-allowed disabled:opacity-40 ${focusClass}`}><Send size={17} aria-hidden="true" /></button>
        </form>
        <AnimatePresence>{holding && <motion.p role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={`font-pixel text-[8px] leading-relaxed ${isDarkMode ? 'text-[#FFADBF]' : 'text-[#8B1634]'}`}>TRANSMITTING...</motion.p>}</AnimatePresence>
      </div>

      <form onSubmit={event => { event.preventDefault(); void saveResult(); }} className={`relative shrink-0 space-y-2 rounded-2xl border-2 p-3 backdrop-blur-xs ${glass}`}>
        <PixelCorners />
        <label htmlFor="collab-result" className={`block font-pixel text-[9px] leading-relaxed ${accent}`}>YOUR RESULT: {submitPrompt.toUpperCase()}</label>
        <div className="flex items-end gap-2">
          <input id="collab-result" maxLength={LIMITS.collabMaxChars} value={result} disabled={!open} onChange={event => { setResult(event.target.value.slice(0, LIMITS.collabMaxChars)); if (resultStatus === 'saved') setResultStatus('idle'); }} placeholder="One line, agreed with your partner" className={`min-h-11 min-w-0 flex-1 rounded-xl border px-3 py-2 text-base focus:outline-2 focus:outline-offset-1 disabled:opacity-50 sm:text-sm ${field}`} />
          <button type="submit" disabled={!open || !result.trim() || resultStatus === 'saving'} className={`min-h-11 shrink-0 rounded-xl border-b-2 border-[#B31D3F] bg-[#FF5376] px-3 py-2 font-pixel text-[8px] leading-relaxed text-white shadow-[2px_2px_0_#000] hover:bg-[#FF3360] disabled:cursor-not-allowed disabled:opacity-40 ${focusClass}`}>{resultStatus === 'saved' ? <Check size={16} aria-label="Saved" /> : myResult ? 'UPDATE' : 'LOCK IN'}</button>
        </div>
        <p role="status" className={`min-h-4 text-xs ${resultStatus === 'error' ? (isDarkMode ? 'text-[#FFADBF]' : 'text-[#8B1634]') : muted}`}>{resultStatus === 'error' ? resultError : resultStatus === 'saved' ? 'Saved. You can update it until time runs out.' : `${result.length} / ${LIMITS.collabMaxChars} · everyone sees results next.`}</p>
      </form>
    </section>
  </main>;
}
