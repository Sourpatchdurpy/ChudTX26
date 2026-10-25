// Screens for the parts of the game the original arcade UI didn't cover:
// vote results, round 3 (pair chat, pair results + vouching, vouch board) and
// partner cards. Same visual language as the other screens.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Handshake, MessageCircle, Moon, Send, ShieldCheck, Sun, Users } from 'lucide-react';
import PixelSky from '../shared/PixelSky';
import { useVisualViewportHeight } from '../../hooks/useVisualViewportHeight';

export interface Who {
  id: string;
  label: string; // "🦊 Fox"
}

interface ThemeProps {
  isDarkMode: boolean;
  onToggleTheme: () => void;
}

function useTheme(isDarkMode: boolean) {
  return {
    accent: isDarkMode ? 'text-[#00E5FF]' : 'text-[#0E1726]',
    muted: isDarkMode ? 'text-[#B5DFFF]' : 'text-[#26374F]',
    border: isDarkMode ? 'border-[#00E5FF]/40' : 'border-[#16223B]/40',
    surface: isDarkMode ? 'bg-black/25' : 'bg-white/25',
    focus: `focus-visible:outline-2 focus-visible:outline-offset-2 ${isDarkMode ? 'focus-visible:outline-[#00E5FF]' : 'focus-visible:outline-[#16223B]'}`,
    good: isDarkMode ? 'text-[#38EF7D]' : 'text-[#126438]',
    bad: isDarkMode ? 'text-[#FF8CA4]' : 'text-[#9E173B]',
  };
}

const primaryButton = 'flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-b-4 border-[#B31D3F] bg-[#FF5376] px-3 py-3 font-pixel text-[9px] leading-loose text-white shadow-[0_0_15px_#FF5376] transition-colors hover:bg-[#FF3360] active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-y-0 sm:text-[10px]';

function Corners() {
  return <>
    <span aria-hidden="true" className="pointer-events-none absolute -left-2 -top-2 h-6 w-6 border-l-4 border-t-4 border-white" />
    <span aria-hidden="true" className="pointer-events-none absolute -right-2 -top-2 h-6 w-6 border-r-4 border-t-4 border-white" />
    <span aria-hidden="true" className="pointer-events-none absolute -bottom-2 -left-2 h-6 w-6 border-b-4 border-l-4 border-white" />
    <span aria-hidden="true" className="pointer-events-none absolute -bottom-2 -right-2 h-6 w-6 border-b-4 border-r-4 border-white" />
  </>;
}

/** Full-screen shell: sky, a title bar with timer and theme toggle, and a framed panel. */
export function ScreenShell({ isDarkMode, onToggleTheme, title, seconds, children, wide = false }: ThemeProps & { title: string; seconds?: number | null; children: ReactNode; wide?: boolean }) {
  const t = useTheme(isDarkMode);
  const reduceMotion = !!useReducedMotion();
  const viewportHeight = useVisualViewportHeight();
  return <main style={{ minHeight: viewportHeight }} className={`relative isolate flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] font-sans transition-colors duration-300 ${isDarkMode ? 'bg-[#060B28] text-white' : 'bg-gradient-to-b from-[#FFAE70] via-[#FFD199] to-[#86C5DA] text-[#0E1726]'}`}>
    <PixelSky isDarkMode={isDarkMode} />
    <motion.section initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.25 }} className={`relative z-10 my-3 flex w-full flex-col gap-4 ${wide ? 'max-w-3xl' : 'max-w-xl'}`}>
      <header className="flex items-center justify-between gap-3">
        <h1 className={`font-pixel text-[10px] leading-relaxed sm:text-xs ${t.accent}`}>{title}</h1>
        <div className="flex items-center gap-3">
          {seconds !== undefined && seconds !== null && <span role="timer" aria-label={`${seconds} seconds remaining`} className={`font-pixel text-xs ${t.accent}`}>{seconds}s</span>}
          <button type="button" onClick={onToggleTheme} aria-pressed={!isDarkMode} aria-label={isDarkMode ? 'Switch to sunrise mode' : 'Switch to dark mode'} className={`flex h-11 w-11 items-center justify-center rounded-xl border-2 backdrop-blur-xs ${t.border} ${t.accent} ${isDarkMode ? 'bg-black/20 hover:bg-white/10' : 'bg-white/20 hover:bg-white/40'} ${t.focus}`}>
            {isDarkMode ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
          </button>
        </div>
      </header>
      <div className={`relative flex flex-col gap-5 rounded-2xl border-4 p-4 backdrop-blur-xs sm:p-6 ${isDarkMode ? 'border-white/90 bg-black/20 shadow-[0_0_25px_#00E5FF]' : 'border-[#16223B]/80 bg-white/20 shadow-[0_0_25px_#FFAE7099]'}`}>
        <Corners />
        {children}
      </div>
    </motion.section>
  </main>;
}

// ── Rounds 1–2: vote results (nobody leaves) ─────────────────────────────────

export function VoteResultsView({ isDarkMode, onToggleTheme, round, seconds, counts, me }: ThemeProps & { round: number; seconds: number; counts: { who: Who; votes: number }[]; me: string | null }) {
  const t = useTheme(isDarkMode);
  const max = Math.max(1, ...counts.map(c => c.votes));
  const sorted = [...counts].sort((a, b) => b.votes - a.votes);
  return <ScreenShell isDarkMode={isDarkMode} onToggleTheme={onToggleTheme} title={`ROUND ${round} // SUSPICION`} seconds={seconds}>
    <p className={`text-sm ${t.muted}`}>Nobody leaves the game. {round < 2 ? 'Next round starts in a moment.' : 'Round 3 pairs you up next.'}</p>
    <ul aria-label="Vote counts" className="space-y-2.5">
      {sorted.map(({ who, votes }) => <li key={who.id} className={`rounded-xl border p-3 ${t.border} ${t.surface}`}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className={`font-pixel text-[10px] leading-relaxed ${t.accent}`}>{who.label}{who.id === me && ' (you)'}</span>
          <span className="font-pixel text-[10px]">{votes}</span>
        </div>
        <div className={`h-2 overflow-hidden border ${t.border}`}><div className="h-full bg-[#FF5376]" style={{ width: `${votes / max * 100}%` }} /></div>
      </li>)}
    </ul>
  </ScreenShell>;
}

// ── Round 3: pair chat + collab result ───────────────────────────────────────

export interface PairMessage { id: string; from: Who; text: string; mine: boolean }

export function PairChatView({ isDarkMode, onToggleTheme, seconds, card, submitPrompt, partners, messages, myResult, onSend, onSubmitResult }: ThemeProps & {
  seconds: number; card: string; submitPrompt: string; partners: Who[]; messages: PairMessage[]; myResult: string | null;
  onSend: (text: string) => Promise<unknown>; onSubmitResult: (text: string) => Promise<unknown>;
}) {
  const t = useTheme(isDarkMode);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(myResult ?? '');
  const [saved, setSaved] = useState(myResult);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);
  useEffect(() => { setSaved(myResult); }, [myResult]);

  async function send() {
    const text = draft.trim();
    if (!text || sending || seconds <= 0) return;
    setSending(true);
    setError('');
    try { await onSend(text); setDraft(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Message not sent.'); }
    finally { setTimeout(() => setSending(false), 5000); } // mirrors the server's 5s hold
  }
  async function submit() {
    const text = result.trim();
    if (!text) return;
    setError('');
    try { await onSubmitResult(text); setSaved(text); }
    catch (e) { setError(e instanceof Error ? e.message : 'Result not saved.'); }
  }

  return <ScreenShell isDarkMode={isDarkMode} onToggleTheme={onToggleTheme} title="ROUND 3 // PAIR UP" seconds={seconds}>
    <div>
      <p className={`mb-1 flex items-center gap-2 font-pixel text-[9px] leading-relaxed ${t.accent}`}><Users size={14} aria-hidden="true" />YOUR PARTNER{partners.length > 1 ? 'S' : ''}: {partners.map(p => p.label).join(' + ')}</p>
      <p className="break-words text-base font-bold leading-relaxed sm:text-lg">{card}</p>
      <p className={`mt-1 text-xs ${t.muted}`}>Private: only your pair sees this chat. One of you might be the AI.</p>
    </div>

    <div role="log" aria-label="Pair messages" aria-live="polite" className={`max-h-64 min-h-32 space-y-2 overflow-y-auto rounded-xl border p-3 ${t.border} ${t.surface}`}>
      {messages.length === 0 && <p className={`py-6 text-center text-sm ${t.muted}`}>Say hi to your partner.</p>}
      {messages.map(m => <div key={m.id} className={`flex flex-col ${m.mine ? 'items-end' : 'items-start'}`}>
        {!m.mine && <span className={`mb-0.5 font-pixel text-[9px] ${t.accent}`}>{m.from.label}</span>}
        <span className={`max-w-[85%] whitespace-pre-wrap break-words rounded-xl border-2 px-3 py-2 text-sm ${m.mine ? 'border-[#00E5FF] bg-[#0066FF] text-white' : `${t.border} ${isDarkMode ? 'bg-[#0D153A]/80' : 'bg-white/40'}`}`}>{m.text}</span>
      </div>)}
      <div ref={endRef} />
    </div>
    <form onSubmit={e => { e.preventDefault(); void send(); }} className="flex items-end gap-2">
      <input aria-label="Message your partner" maxLength={200} value={draft} onChange={e => setDraft(e.target.value)} disabled={seconds <= 0} placeholder={sending ? 'Transmitting…' : 'Message your partner…'} className={`min-h-11 min-w-0 flex-1 rounded-xl border px-3 py-2 text-base sm:text-sm ${t.border} ${isDarkMode ? 'bg-black/30 text-white placeholder:text-[#8495B3]' : 'bg-white/25 placeholder:text-[#526078]'}`} />
      <button type="submit" aria-label="Send" disabled={!draft.trim() || sending || seconds <= 0} className={`flex min-h-11 min-w-11 items-center justify-center rounded-xl border-b-2 border-[#B31D3F] bg-[#FF5376] px-3 text-white disabled:opacity-40 ${t.focus}`}><Send size={17} aria-hidden="true" /></button>
    </form>
    {sending && <p role="status" className={`-mt-3 font-pixel text-[8px] ${t.bad}`}>TRANSMITTING… (messages arrive after 5s)</p>}

    <form onSubmit={e => { e.preventDefault(); void submit(); }} className={`flex flex-col gap-2 rounded-xl border p-3 ${t.border} ${t.surface}`}>
      <label htmlFor="collab-result" className={`font-pixel text-[9px] leading-relaxed ${t.accent}`}>YOUR RESULT: {submitPrompt}</label>
      <input id="collab-result" maxLength={140} value={result} onChange={e => setResult(e.target.value)} disabled={seconds <= 0} placeholder="One line, everyone sees it next" className={`min-h-11 rounded-xl border px-3 py-2 text-base sm:text-sm ${t.border} ${isDarkMode ? 'bg-black/30 text-white placeholder:text-[#8495B3]' : 'bg-white/25 placeholder:text-[#526078]'}`} />
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs ${saved ? t.good : t.muted}`}>{saved ? <span className="inline-flex items-center gap-1"><Check size={13} aria-hidden="true" />Saved: “{saved}”</span> : 'Not submitted yet'}</span>
        <button type="submit" disabled={!result.trim() || seconds <= 0 || result.trim() === saved} className={`min-h-11 rounded-lg border-b-2 border-[#B31D3F] bg-[#FF5376] px-3 font-pixel text-[8px] text-white disabled:opacity-40 ${t.focus}`}>{saved ? 'UPDATE' : 'SUBMIT'}</button>
      </div>
    </form>
    {error && <p role="alert" className={`text-sm ${t.bad}`}>{error}</p>}
  </ScreenShell>;
}

// ── Round 3: everyone's results + vouching ───────────────────────────────────

export interface PairSummary { id: string; members: { who: Who; result: string | null }[]; mine: boolean }

export function PairResultsView({ isDarkMode, onToggleTheme, seconds, pairs, me, myVouches, onVouch }: ThemeProps & {
  seconds: number; pairs: PairSummary[]; me: string; myVouches: Record<string, boolean>; onVouch: (targetId: string, vouched: boolean) => Promise<unknown>;
}) {
  const t = useTheme(isDarkMode);
  const [error, setError] = useState('');
  return <ScreenShell isDarkMode={isDarkMode} onToggleTheme={onToggleTheme} title="ROUND 3 // RESULTS" seconds={seconds} wide>
    <p className={`text-sm ${t.muted}`}>Do you vouch that your partner is human? Your vouch goes public before the final vote.</p>
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {pairs.map(pair => <li key={pair.id} className={`rounded-xl border-2 p-3 ${pair.mine ? (isDarkMode ? 'border-[#00E5FF]' : 'border-[#16223B]') : t.border} ${t.surface}`}>
        {pair.mine && <p className={`mb-2 font-pixel text-[8px] ${t.accent}`}>YOUR PAIR</p>}
        <ul className="space-y-2">
          {pair.members.map(({ who, result }) => <li key={who.id}>
            <span className={`font-pixel text-[9px] leading-relaxed ${t.accent}`}>{who.label}{who.id === me && ' (you)'}</span>
            <p className="break-words text-sm">{result ? `“${result}”` : <span className={t.muted}>(no result)</span>}</p>
            {pair.mine && who.id !== me && <button type="button" aria-pressed={!!myVouches[who.id]} disabled={seconds <= 0} onClick={async () => {
              setError('');
              try { await onVouch(who.id, !myVouches[who.id]); } catch (e) { setError(e instanceof Error ? e.message : 'Vouch not saved.'); }
            }} className={`mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border-2 px-2 font-pixel text-[8px] leading-relaxed transition-colors disabled:opacity-50 ${t.focus} ${myVouches[who.id] ? 'border-[#38EF7D] bg-[#38EF7D]/15 text-[#38EF7D]' : `${t.border} ${t.muted}`}`}>
              <ShieldCheck size={14} aria-hidden="true" />{myVouches[who.id] ? `I VOUCH ${who.label.toUpperCase()} IS HUMAN` : `VOUCH FOR ${who.label.toUpperCase()}?`}
            </button>}
          </li>)}
        </ul>
      </li>)}
    </ul>
    {error && <p role="alert" className={`text-sm ${t.bad}`}>{error}</p>}
  </ScreenShell>;
}

/** Background for the final vote: every pair, their results and public vouches. */
export function VouchBoard({ isDarkMode, onToggleTheme, pairs, vouches }: ThemeProps & { pairs: PairSummary[]; vouches: { from: Who; target: Who; vouched: boolean }[] }) {
  const t = useTheme(isDarkMode);
  return <ScreenShell isDarkMode={isDarkMode} onToggleTheme={onToggleTheme} title="FINAL VOTE // VOUCHES" wide>
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {pairs.map(pair => <li key={pair.id} className={`rounded-xl border p-3 ${t.border} ${t.surface}`}>
        {pair.members.map(({ who, result }) => <p key={who.id} className="text-sm"><span className={`font-pixel text-[9px] ${t.accent}`}>{who.label}</span> {result ? `“${result}”` : '(no result)'}</p>)}
      </li>)}
    </ul>
    <ul aria-label="Vouches" className="space-y-1">
      {vouches.map(v => <li key={`${v.from.id}:${v.target.id}`} className={`text-sm ${v.vouched ? t.good : t.muted}`}>{v.from.label} {v.vouched ? 'vouches' : "didn't vouch"} for {v.target.label}</li>)}
    </ul>
  </ScreenShell>;
}

// ── After the reveal: your own partner card ──────────────────────────────────

export interface PartnerCardData {
  kind: 'partner' | 'aiPartner';
  partners: { label: string; realName: string; result: string | null }[];
  myResult: string | null;
  aiWasInMyPair: boolean;
  suggestion: { realName: string; reason: string } | null;
}

export function PartnerCardView({ isDarkMode, onToggleTheme, card, onPlayAgain }: ThemeProps & { card: PartnerCardData | null; onPlayAgain?: () => void }) {
  const t = useTheme(isDarkMode);
  return <ScreenShell isDarkMode={isDarkMode} onToggleTheme={onToggleTheme} title="YOUR PARTNER CARD">
    {!card ? <p className={`text-sm ${t.muted}`}>Your card is on its way…</p> : card.kind === 'partner' ? <>
      <MessageCircle size={30} aria-hidden="true" className={t.accent} />
      {card.partners.map(p => <div key={p.label}>
        <p className={`font-pixel text-[9px] leading-loose ${t.accent}`}>YOUR PARTNER {p.label.toUpperCase()} WAS</p>
        <p className="break-words text-3xl font-bold leading-tight">{p.realName}</p>
        {p.result && <p className={`mt-1 text-sm ${t.muted}`}>They said: “{p.result}”</p>}
      </div>)}
      {card.myResult && <p className={`text-sm ${t.muted}`}>You said: “{card.myResult}”</p>}
      {card.aiWasInMyPair && <p className={`text-xs ${t.bad}`}>(The AI was in your trio too.)</p>}
      <p className="font-bold">Go find them. You already have something to talk about.</p>
    </> : <>
      <Handshake size={30} aria-hidden="true" className={t.accent} />
      <p className={`font-pixel text-[9px] leading-loose ${t.accent}`}>YOUR PARTNER WAS THE AI</p>
      {card.myResult && <p className={`text-sm ${t.muted}`}>You said: “{card.myResult}”</p>}
      {card.suggestion ? <>
        <p className="break-words text-2xl font-bold leading-tight">Go talk to {card.suggestion.realName}</p>
        <p className={`text-sm ${t.muted}`}>They {card.suggestion.reason}.</p>
      </> : <p className="font-bold">Go say hi to someone from the game!</p>}
    </>}
    {onPlayAgain ? <button type="button" onClick={onPlayAgain} className={`${primaryButton} ${t.focus}`}>PLAY AGAIN</button>
      : <p role="status" className={`text-center font-pixel text-[9px] leading-loose ${t.accent}`}>Waiting for the host to start a new game…</p>}
  </ScreenShell>;
}
