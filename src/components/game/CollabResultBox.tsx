// Round 3 result entry, in PrivateAnswerView's design (lock label, counter, coral
// "LOCK IN" button, locked-in panel). Sits under the question in the pair chat screen.
import { useState } from 'react';
import { Check, LockKeyhole } from 'lucide-react';

const RESULT_LIMIT = 140;

export default function CollabResultBox({ isDarkMode, partnerNames, submitPrompt, lockedResult, disabled, onSubmit }: {
  isDarkMode: boolean;
  partnerNames: string[];
  submitPrompt: string;
  lockedResult: string | null;
  disabled: boolean;
  onSubmit: (text: string) => Promise<unknown>;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const accent = isDarkMode ? 'text-[#00E5FF]' : 'text-[#0E1726]';
  const muted = isDarkMode ? 'text-[#B5DFFF]' : 'text-[#26374F]';
  const border = isDarkMode ? 'border-[#00E5FF]/40' : 'border-[#16223B]/40';

  return <div className="space-y-2 pt-1">
    <p className={`font-pixel text-[9px] leading-relaxed ${accent}`}>[ PARTNER: {partnerNames.join(' + ')} ]</p>
    {lockedResult !== null ? <div role="status" className={`space-y-2 rounded-xl border p-3 ${border} ${isDarkMode ? 'bg-black/25' : 'bg-white/20'}`}>
      <p className={`flex items-start gap-2 font-pixel text-[8px] leading-loose ${accent}`}><Check size={15} className="shrink-0" aria-hidden="true" />LOCKED IN // WAITING FOR REMAINING PLAYERS</p>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{lockedResult}</p>
    </div> : <form onSubmit={async event => {
      event.preventDefault();
      if (!text.trim() || disabled) return;
      setError('');
      try { await onSubmit(text.trim()); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Your answer could not be submitted. Please try again.'); }
    }} className="flex flex-col gap-2">
      <label htmlFor="collab-result" className={`flex items-center gap-2 text-sm font-semibold ${muted}`}><LockKeyhole size={14} aria-hidden="true" />{submitPrompt}</label>
      <textarea id="collab-result" rows={2} maxLength={RESULT_LIMIT} value={text} disabled={disabled} onChange={event => setText(event.target.value.slice(0, RESULT_LIMIT))} placeholder="Write your answer..." className={`w-full resize-none rounded-xl border p-3 text-base leading-relaxed focus:outline-2 focus:outline-offset-2 disabled:opacity-50 sm:text-sm ${isDarkMode ? 'border-[#00E5FF]/40 bg-black/30 text-white placeholder:text-[#8495B3] focus:outline-[#00E5FF]' : 'border-[#16223B]/40 bg-white/25 text-[#0E1726] placeholder:text-[#526078] focus:outline-[#16223B]'}`} />
      <div className="flex items-center justify-between gap-2">
        <span className={`font-pixel text-[9px] ${accent}`}>[ {text.length} / {RESULT_LIMIT} ]</span>
        <button type="submit" disabled={!text.trim() || disabled} className="min-h-11 rounded-xl border-b-4 border-[#B31D3F] bg-[#FF5376] px-3 font-pixel text-[9px] leading-relaxed text-white shadow-[0_0_15px_#FF5376] transition-colors hover:bg-[#FF3360] active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-y-0">LOCK IN ANSWER</button>
      </div>
      {error && <p role="alert" className={`text-sm ${isDarkMode ? 'text-[#FFADBF]' : 'text-[#8B1634]'}`}>{error}</p>}
    </form>}
  </div>;
}
