import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Copy, MessageCircle, Moon, RotateCcw, Sun, Trophy } from 'lucide-react';
import PixelSky from '../shared/PixelSky';
import type { GameOverRevealProps, PlayerSummary } from '@/types/game';

export type { GameOverRevealProps, PlayerSummary, TalkToMission } from '@/types/game';

const STEPS = ['ROSTER REVEAL', 'AI CONFESSION', 'TALK-TO MISSION'];

function RevealPlayer({ player, index, isDarkMode }: { player: PlayerSummary; index: number; isDarkMode: boolean }) {
  const reduceMotion = !!useReducedMotion();
  const surface = isDarkMode ? 'border-[#00E5FF]/35 bg-black/25 text-white' : 'border-[#16223B]/35 bg-white/25 text-[#0E1726]';
  const accent = isDarkMode ? 'text-[#00E5FF]' : 'text-[#0E1726]';
  const delay = reduceMotion ? 0 : index * 0.1;
  return <li className="relative min-w-0 [perspective:1000px]">
    <motion.div aria-hidden="true" initial={false} animate={reduceMotion ? { opacity: 0 } : { rotateY: [0, 180], opacity: [1, 1, 0] }} transition={{ delay, duration: 0.6, opacity: { delay, duration: 0.6, times: [0, 0.49, 1] } }} className={`pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl border-2 p-4 text-center [backface-visibility:hidden] ${surface}`}>
      <span className={`break-words font-pixel text-[10px] leading-loose ${accent}`}>{player.nickname}</span>
    </motion.div>
    <motion.div initial={reduceMotion ? false : { rotateY: -180, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }} transition={{ delay, duration: reduceMotion ? 0 : 0.6 }} className={`flex min-h-44 min-w-0 flex-col justify-between gap-3 rounded-xl border-2 p-4 [backface-visibility:hidden] ${surface} ${player.isAi ? (isDarkMode ? 'border-[#FF5376] shadow-[0_0_18px_#00E5FF40]' : 'border-[#A51B43]') : ''}`}>
      <p className={`break-words font-pixel text-[9px] leading-loose ${accent}`}>{player.nickname}</p>
      <p className="break-words text-lg font-bold leading-snug">{player.realName || (player.isAi ? 'Meta AI' : 'Name not shared')}</p>
      {player.isAi ? <motion.p initial={false} animate={reduceMotion ? { opacity: 1 } : { opacity: [0.55, 1, 0.55] }} transition={{ duration: 1.8, repeat: Infinity }} className={`font-pixel text-[8px] leading-loose ${isDarkMode ? 'text-[#FFADBF]' : 'text-[#9E173B]'}`}>[ META AI AGENT ]</motion.p> : <p className={`text-xs ${isDarkMode ? 'text-[#B5DFFF]' : 'text-[#26374F]'}`}>{player.totalVotesReceived} {player.totalVotesReceived === 1 ? 'vote received' : 'votes received'}</p>}
    </motion.div>
  </li>;
}

export default function GameOverReveal({ isDarkMode, onToggleTheme, didHumansWin, aiNickname, players, mostSusHuman, aiConfessionalNotes, talkToMission, onPlayAgain, playAgainLabel = 'RETURN TO ARCADE LOBBY', waitingText = 'Waiting for the host…' }: GameOverRevealProps) {
  const [step, setStep] = useState(0);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const copyResetRef = useRef<ReturnType<typeof setTimeout>>();
  const mountedRef = useRef(false);
  const reduceMotion = !!useReducedMotion();
  const accent = isDarkMode ? 'text-[#00E5FF]' : 'text-[#0E1726]';
  const muted = isDarkMode ? 'text-[#B5DFFF]' : 'text-[#26374F]';
  const border = isDarkMode ? 'border-[#00E5FF]/40' : 'border-[#16223B]/40';
  const focusClass = `focus-visible:outline-2 focus-visible:outline-offset-4 ${isDarkMode ? 'focus-visible:outline-[#00E5FF]' : 'focus-visible:outline-[#16223B]'}`;
  const mostSusPlayer = players.find(player => !player.isAi && (player.nickname === mostSusHuman || player.realName === mostSusHuman));
  const hasPartner = !!(talkToMission.partnerRealName.trim() || talkToMission.partnerNickname.trim());

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearTimeout(copyResetRef.current); };
  }, []);
  useEffect(() => {
    setCopyStatus('idle');
    clearTimeout(copyResetRef.current);
  }, [talkToMission.openingLine]);

  useEffect(() => {
    if (!didHumansWin || reduceMotion) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    // An owned cannon can be cleaned up without affecting other celebrations.
    void import('canvas-confetti').then(({ default: confetti }) => {
      if (cancelled) return;
      const cannon = confetti.create(undefined, { resize: true, useWorker: true });
      cleanup = () => cannon.reset();
      void cannon({ particleCount: 150, spread: 105, startVelocity: 42, gravity: 0.9, origin: { x: 0.5, y: 0.25 }, colors: ['#00E5FF', '#FF5376', '#FFFFFF', '#FFD199'], disableForReducedMotion: true, zIndex: 60 });
    }).catch(() => undefined);
    return () => { cancelled = true; cleanup?.(); };
  }, [didHumansWin, reduceMotion]);

  async function copyLine() {
    if (!talkToMission.openingLine.trim()) return;
    try {
      await navigator.clipboard.writeText(talkToMission.openingLine);
      if (!mountedRef.current) return;
      setCopyStatus('copied');
    } catch {
      if (!mountedRef.current) return;
      setCopyStatus('failed');
    }
    clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => setCopyStatus('idle'), 2500);
  }

  return <main className={`relative isolate flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(5rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] font-sans transition-colors duration-300 ${isDarkMode ? 'bg-[#060B28] text-white' : 'bg-gradient-to-b from-[#FFAE70] via-[#FFD199] to-[#86C5DA] text-[#0E1726]'}`}>
    <PixelSky isDarkMode={isDarkMode} />
    <button type="button" aria-label={isDarkMode ? 'Switch to sunrise mode' : 'Switch to dark mode'} aria-pressed={!isDarkMode} onClick={onToggleTheme} className={`absolute right-5 top-[max(1.25rem,env(safe-area-inset-top))] z-20 flex h-11 w-11 items-center justify-center rounded-xl border-2 backdrop-blur-xs ${border} ${accent} ${isDarkMode ? 'bg-black/20 hover:bg-white/10' : 'bg-white/20 hover:bg-white/40'} ${focusClass}`}>
      {isDarkMode ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
    </button>

    <div className="relative z-10 flex w-full max-w-4xl flex-col gap-6">
      <header className="text-center">
        <h1 className={`relative font-pixel text-sm leading-loose sm:text-xl ${didHumansWin ? (isDarkMode ? 'text-[#6BFFAF] [text-shadow:3px_3px_0_#020410]' : 'text-[#126438] [text-shadow:3px_3px_0_#0E172630]') : (isDarkMode ? 'text-[#FFADBF] [text-shadow:3px_3px_0_#020410]' : 'text-[#9E173B] [text-shadow:3px_3px_0_#0E172630]')}`}>
          <span>{didHumansWin ? '[ AI EXPOSED // HUMANS WIN ]' : '[ INFILTRATION COMPLETE // AI WINS ]'}</span>
          <motion.span aria-hidden="true" initial={false} animate={reduceMotion ? { opacity: 0 } : { opacity: [0, 0, 0.8, 0.5, 0], x: [0, 0, -2, 2, 0] }} transition={{ duration: 5.5, times: [0, 0.84, 0.88, 0.92, 1], repeat: Infinity }} className="pointer-events-none absolute inset-0 [clip-path:inset(25%_0_45%_0)]">{didHumansWin ? '[ AI EXPOSED // HUMANS WIN ]' : '[ INFILTRATION COMPLETE // AI WINS ]'}</motion.span>
        </h1>
        {aiNickname && <p className={`mt-3 text-sm ${muted}`}>Behind the codename: <span className={`font-pixel text-[10px] ${accent}`}>{aiNickname}</span></p>}
      </header>

      <section className={`relative flex flex-col gap-5 rounded-2xl border-4 p-4 backdrop-blur-xs sm:p-7 ${isDarkMode ? 'border-white/90 bg-black/20 shadow-[0_0_25px_#00E5FF]' : 'border-[#16223B]/80 bg-white/20 shadow-[0_0_25px_#FFAE7099]'}`}>
        <span aria-hidden="true" className="pointer-events-none absolute -left-2 -top-2 h-6 w-6 border-l-4 border-t-4 border-white" />
        <span aria-hidden="true" className="pointer-events-none absolute -right-2 -top-2 h-6 w-6 border-r-4 border-t-4 border-white" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-2 -left-2 h-6 w-6 border-b-4 border-l-4 border-white" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-2 -right-2 h-6 w-6 border-b-4 border-r-4 border-white" />

        <div role="tablist" aria-label="Game reveal steps" className="grid grid-cols-3 gap-2">
          {STEPS.map((label, index) => <button key={label} ref={node => { tabRefs.current[index] = node; }} id={`reveal-tab-${index}`} role="tab" type="button" aria-selected={step === index} aria-controls={`reveal-panel-${index}`} tabIndex={step === index ? 0 : -1} onClick={() => setStep(index)} onKeyDown={event => {
            let next: number;
            if (event.key === 'ArrowRight') next = (index + 1) % STEPS.length;
            else if (event.key === 'ArrowLeft') next = (index + STEPS.length - 1) % STEPS.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = STEPS.length - 1;
            else return;
            event.preventDefault(); setStep(next); tabRefs.current[next]?.focus();
          }} className={`min-h-14 min-w-0 rounded-xl border-2 px-1.5 py-2 font-pixel text-[7px] leading-loose transition-colors sm:text-[9px] ${focusClass} ${step === index ? (isDarkMode ? 'border-[#00E5FF] bg-[#00E5FF] text-[#060B28] shadow-[2px_2px_0_#020410]' : 'border-[#16223B] bg-[#16223B] text-white shadow-[2px_2px_0_#16223B40]') : `${border} ${muted}`}`}>{index + 1}. {label}</button>)}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step} id={`reveal-panel-${step}`} role="tabpanel" aria-labelledby={`reveal-tab-${step}`} tabIndex={0} initial={{ opacity: 0, x: reduceMotion ? 0 : 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduceMotion ? 0 : -8 }} transition={{ duration: reduceMotion ? 0 : 0.18 }} className={`min-w-0 space-y-5 rounded-lg ${focusClass}`}>
            {step === 0 && <>
              <div><h2 className={`font-pixel text-xs leading-loose ${accent}`}>THE PEOPLE BEHIND THE PIXELS</h2><p className={`mt-2 text-sm ${muted}`}>Codenames off. Introductions on.</p></div>
              <ul aria-label="Revealed identities" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{players.map((player, index) => <RevealPlayer key={player.nickname} player={player} index={index} isDarkMode={isDarkMode} />)}</ul>
              {players.length === 0 && <p className={`text-sm ${muted}`}>Player identities have not been shared yet.</p>}
              <div className={`flex items-start gap-3 rounded-xl border-2 border-[#FF5376]/70 p-4 ${isDarkMode ? 'bg-[#FF5376]/10 text-[#FFADBF]' : 'bg-white/25 text-[#9E173B]'}`}>
                <Trophy size={24} className="shrink-0" aria-hidden="true" />
                <div className="min-w-0"><h3 className="break-words font-pixel text-[9px] leading-loose">MOST SUSPICIOUS HUMAN{mostSusHuman ? `: ${mostSusHuman}` : ''}</h3><p className="mt-2 text-sm">{mostSusPlayer ? `Voted bot ${mostSusPlayer.totalVotesReceived} ${mostSusPlayer.totalVotesReceived === 1 ? 'time' : 'times'}, but 100% human.` : 'The suspicion award has not been shared yet.'}</p></div>
              </div>
            </>}

            {step === 1 && <>
              <div><h2 className={`font-pixel text-xs leading-loose ${accent}`}>AI CONFESSIONAL LOG</h2><p className={`mt-2 text-sm ${muted}`}>The AI’s post-game account of its cover story.</p></div>
              <div className={`overflow-hidden rounded-xl border-2 ${border} ${isDarkMode ? 'bg-black/40' : 'bg-white/25'}`}>
                <div aria-hidden="true" className={`flex gap-1.5 border-b px-4 py-3 ${border}`}><span className="h-2 w-2 bg-[#FF5376]" /><span className="h-2 w-2 bg-[#FFD199]" /><span className="h-2 w-2 bg-[#00E5FF]" /></div>
                <ol aria-label="AI post-game notes" className="space-y-4 p-4 sm:p-5">{aiConfessionalNotes.map((note, index) => <motion.li key={`${index}:${note}`} initial={{ opacity: 0, y: reduceMotion ? 0 : 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.2, delay: reduceMotion ? 0 : index * 0.08 }} className="flex items-start gap-3"><span className={`shrink-0 font-pixel text-[9px] leading-loose ${accent}`}>{String(index + 1).padStart(2, '0')}</span><p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-relaxed">{note}</p></motion.li>)}</ol>
                {aiConfessionalNotes.length === 0 && <p className={`px-4 pb-5 text-sm ${muted}`}>The AI’s post-game notes are not available yet.</p>}
              </div>
            </>}

            {step === 2 && <div className={`flex min-h-80 flex-col justify-center gap-5 rounded-xl border-2 p-4 sm:p-7 ${border} ${isDarkMode ? 'bg-black/25' : 'bg-white/25'}`}>
              <MessageCircle size={32} aria-hidden="true" className={accent} />
              <p className={`font-pixel text-[9px] leading-loose ${accent}`}>YOUR IRL CONNECTION TARGET</p>
              <h2 className="break-words text-xl font-bold leading-snug sm:text-2xl">{hasPartner ? <>FIND {talkToMission.partnerRealName || talkToMission.partnerNickname}{talkToMission.partnerRealName && talkToMission.partnerNickname && <span className={`mt-2 block font-pixel text-[10px] leading-loose ${accent}`}>({talkToMission.partnerNickname})</span>}<span className="mt-1 block">IN THE ROOM</span></> : 'A connection has not been assigned yet.'}</h2>
              {talkToMission.sharedMoment && <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${muted}`}>{talkToMission.sharedMoment}</p>}
              <button type="button" onClick={() => { void copyLine(); }} disabled={!talkToMission.openingLine.trim()} className={`rounded-xl border-2 p-4 text-left transition-colors disabled:cursor-default ${border} ${focusClass} ${isDarkMode ? 'bg-[#00E5FF]/5 enabled:hover:bg-[#00E5FF]/10' : 'bg-white/20 enabled:hover:bg-white/40'}`}>
                <span className="block select-text whitespace-pre-wrap break-words text-base leading-relaxed">{talkToMission.openingLine ? `“${talkToMission.openingLine}”` : 'Your conversation starter will appear here.'}</span>
                <span className={`mt-4 flex items-center gap-2 font-pixel text-[9px] ${accent}`}>{copyStatus === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copyStatus === 'copied' ? 'LINE COPIED!' : 'COPY LINE'}</span>
              </button>
              <p role="status" className={`min-h-4 text-xs ${muted}`}>{copyStatus === 'failed' ? 'Couldn’t copy. Select the line to copy it manually.' : copyStatus === 'copied' ? 'Opening line copied.' : ''}</p>
            </div>}
          </motion.div>
        </AnimatePresence>

        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => setStep(value => Math.max(0, value - 1))} disabled={step === 0} className={`flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm disabled:opacity-30 ${accent} ${focusClass}`}><ArrowLeft size={16} aria-hidden="true" />Back</button>
          <span className={`font-pixel text-[9px] ${muted}`}>{step + 1} / 3</span>
          <button type="button" onClick={() => setStep(value => Math.min(2, value + 1))} disabled={step === 2} className={`flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm disabled:opacity-30 ${accent} ${focusClass}`}>Next<ArrowRight size={16} aria-hidden="true" /></button>
        </div>
        {onPlayAgain
          ? <button type="button" onClick={onPlayAgain} className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border-b-4 border-[#B31D3F] bg-[#FF5376] px-3 py-4 font-pixel text-[9px] leading-loose text-white shadow-[0_0_15px_#FF5376] transition-colors hover:bg-[#FF3360] active:translate-y-1 sm:text-xs ${focusClass}`}><RotateCcw size={16} className="shrink-0" aria-hidden="true" />{playAgainLabel}</button>
          : <p role="status" className={`text-center font-pixel text-[9px] leading-loose ${accent}`}>{waitingText}</p>}
      </section>
    </div>
  </main>;
}
