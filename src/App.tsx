// Renders purely from the server's latest RoomView (MASTER_PLAN §5): the server
// owns phases, timers and rules; this file maps each phase to a screen.
import { useState } from 'react';
import { FastForward, WifiOff } from 'lucide-react';
import type { PlayerId, RoomView } from '@game/shared';
import EntryScreen from './components/auth/EntryScreen';
import LobbyWaitingRoom from './components/lobby/LobbyWaitingRoom';
import MobilePreview from './components/shared/MobilePreview';
import DiscussionChatView from './components/discussion/DiscussionChatView';
import PrivateAnswerView from './components/game/PrivateAnswerView';
import RoundVoteModal from './components/discussion/RoundVoteModal';
import GameOverReveal from './components/game/GameOverReveal';
import { PairChatView, PairResultsView, PartnerCardView, VoteResultsView, VouchBoard, type PairSummary, type Who } from './components/game/GameScreens';
import type { DiscussionMsg, EntryIdentity, LobbyPlayer, TalkToMission } from '@/types/game';
import { useGame, useSecondsLeft } from './lib/gameClient';

const TIER_LABEL = { light: 'LIGHT', personal: 'PERSONAL', collab: 'DEEP' } as const;

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [error, setError] = useState('');
  const game = useGame();
  const { view } = game;
  const seconds = useSecondsLeft(view?.phaseEndsAt ?? null, game.clockOffset);
  const theme = { isDarkMode, onToggleTheme: () => setIsDarkMode(value => !value) };

  /** Runs a server action; any rejection becomes the error banner. */
  const run = (action: () => Promise<unknown>) => { setError(''); return action().catch((e: unknown) => { setError(e instanceof Error ? e.message : 'Something went wrong.'); throw e; }); };
  const fire = (action: () => Promise<unknown>) => { void run(action).catch(() => undefined); };

  if (new URLSearchParams(window.location.search).get('device') === 'mobile') return <MobilePreview />;

  if (!view || !view.me) {
    return <EntryScreen key={game.closedReason} {...theme} initialError={game.closedReason} onEnter={async (entry: EntryIdentity) => {
      game.dismissClosed();
      if (entry.isHost) await game.create(entry.realName);
      else await game.join(entry.roomCode, entry.realName);
    }} />;
  }

  const me = view.me;
  const who = (id: PlayerId): Who => {
    const p = view.players.find(player => player.id === id);
    return { id, label: p ? `${p.emoji} ${p.nickname}` : '???' };
  };
  const myLabel = who(me.id).label;
  const idByLabel = (label: string) => view.players.find(p => `${p.emoji} ${p.nickname}` === label)?.id;
  const currentRecord = view.history[view.history.length - 1];
  const myPair = view.pairs?.find(pair => pair.members.includes(me.id)) ?? null;
  const partnerIds = myPair?.members.filter(id => id !== me.id) ?? [];
  const pairSummaries = (): PairSummary[] => (view.pairs ?? []).map(pair => ({
    id: pair.id,
    mine: pair.id === myPair?.id,
    members: pair.members.map(id => ({ who: who(id), result: view.collabResults?.[id] ?? null })),
  }));

  const errorNotice = error && <div role="alert" className="fixed bottom-4 left-4 right-4 z-50 mx-auto flex max-w-lg items-center justify-between gap-3 rounded-xl border border-[#FF5376] bg-[#060B28] p-3 font-sans text-sm text-white"><p>{error}</p><button type="button" onClick={() => setError('')} className="min-h-11 px-2 font-bold">Dismiss</button></div>;
  const offline = !game.connected && <div role="status" className="fixed left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#FF5376] bg-[#060B28] px-3 py-1.5 font-sans text-xs text-white"><WifiOff size={13} aria-hidden="true" />Reconnecting…</div>;
  // Host only, timed phases: end the phase now (for demos and judging).
  const skip = me.isHost && view.phaseEndsAt !== null && <button type="button" onClick={() => fire(game.advance)} className="fixed bottom-4 right-4 z-[45] flex min-h-11 items-center gap-2 rounded-xl border-2 border-[#00E5FF]/70 bg-[#060B28]/90 px-3 font-pixel text-[8px] text-[#00E5FF] shadow-[3px_3px_0_#000]"><FastForward size={14} aria-hidden="true" />SKIP</button>;
  const overlays = <>{offline}{skip}{errorNotice}</>;
  const screen = (node: React.ReactNode) => <>{node}{overlays}</>;

  switch (view.phase) {
    case 'lobby': {
      const names = view.lobby?.realNames ?? [];
      const myIndex = names.indexOf(me.realName);
      const players: LobbyPlayer[] = names.map((name, i) => ({ id: `${i}:${name}`, nickname: name, isHost: i === myIndex && me.isHost }));
      return screen(<LobbyWaitingRoom {...theme} roomCode={view.code} players={players} currentUserId={`${myIndex}:${me.realName}`} isHost={me.isHost}
        onStartGame={() => fire(game.start)} onLeaveRoom={game.leave} />);
    }

    case 'answer':
      return screen(<PrivateAnswerView key={`answer-${view.round?.number}`} {...theme}
        roundNumber={view.round?.number ?? 1} roundTier={TIER_LABEL[view.round?.tier ?? 'light']} question={view.round?.prompt ?? ''}
        totalPlayers={view.answerProgress?.total ?? view.players.length} answeredCount={view.answerProgress?.answered ?? 0}
        initialSeconds={seconds} onSubmitAnswer={text => fire(() => game.answer(text))} onTimeUp={() => undefined} />);

    case 'discuss':
    case 'vote': {
      const answers = (currentRecord?.answers ?? []).map(a => ({ id: a.playerId, authorNickname: who(a.playerId).label, text: a.text ?? '(no answer)' }));
      const messages: DiscussionMsg[] = view.messages.filter(m => m.channel === 'group').map(m => ({ id: m.id, senderNickname: who(m.from).label, text: m.text, timestamp: m.at }));
      return screen(<>
        <div aria-hidden={view.phase === 'vote' || undefined} ref={node => { node?.toggleAttribute('inert', view.phase === 'vote'); }}>
          <DiscussionChatView key={`discuss-${view.round?.number}`} {...theme} question={view.round?.prompt ?? ''} answers={answers} messages={messages}
            currentUserNickname={myLabel} initialSeconds={view.phase === 'discuss' ? seconds : 0}
            onSendMessage={view.phase === 'discuss' ? text => fire(() => game.chat(text, 'group')) : undefined} onDiscussionEnd={() => undefined} />
        </div>
        {view.phase === 'vote' && <RoundVoteModal key={`vote-${view.round?.number}`} isDarkMode={isDarkMode} secondsRemaining={seconds}
          candidates={view.players.filter(p => p.id !== me.id).map(p => ({ nickname: who(p.id).label, answerSnippet: answers.find(a => a.id === p.id)?.text ?? '' }))}
          onCastVote={label => run(() => game.vote(idByLabel(label) ?? ''))} />}
      </>);
    }

    case 'voteResult': {
      const counts = view.players.map(p => ({ who: who(p.id), votes: view.lastVoteCounts?.[p.id] ?? 0 }));
      return screen(<VoteResultsView {...theme} round={view.round?.number ?? 1} seconds={seconds} counts={counts} me={me.id} />);
    }

    case 'pairChat': {
      const messages = view.messages.filter(m => m.channel === 'pair' && m.pairId === myPair?.id)
        .map(m => ({ id: m.id, from: who(m.from), text: m.text, mine: m.from === me.id }));
      return screen(<PairChatView {...theme} seconds={seconds} card={view.round?.prompt ?? ''} submitPrompt={view.round?.submitPrompt ?? 'Your result'}
        partners={partnerIds.map(who)} messages={messages} myResult={me.myCollabResult}
        onSend={text => run(() => game.chat(text, 'pair'))} onSubmitResult={text => run(() => game.collab(text))} />);
    }

    case 'pairResults':
      return screen(<PairResultsView {...theme} seconds={seconds} pairs={pairSummaries()} me={me.id} myVouches={me.myVouches}
        onVouch={(targetId, vouched) => run(() => game.vouch(targetId, vouched))} />);

    case 'finalVote': {
      const vouches = (view.vouches ?? []).map(v => ({ from: who(v.from), target: who(v.target), vouched: v.vouched }));
      return screen(<>
        <div aria-hidden ref={node => { node?.toggleAttribute('inert', true); }}><VouchBoard {...theme} pairs={pairSummaries()} vouches={vouches} /></div>
        <RoundVoteModal key="final-vote" isDarkMode={isDarkMode} secondsRemaining={seconds}
          candidates={view.players.filter(p => p.id !== me.id).map(p => ({ nickname: who(p.id).label, answerSnippet: view.collabResults?.[p.id] ? `Result: “${view.collabResults[p.id]}”` : '' }))}
          onCastVote={label => run(() => game.vote(idByLabel(label) ?? ''))} />
      </>);
    }

    case 'reveal':
      return screen(<RevealScreen view={view} who={who} theme={theme} partnerIds={partnerIds}
        onNext={me.isHost ? () => fire(game.advance) : undefined} />);

    case 'partners': {
      const card = me.partnerCard;
      return screen(<PartnerCardView {...theme} onPlayAgain={me.isHost ? () => fire(game.playAgain) : undefined} card={card && {
        kind: card.kind,
        partners: card.partners.map(p => ({ label: who(p.playerId).label, realName: p.realName, result: p.collabResult })),
        myResult: card.myCollabResult,
        aiWasInMyPair: card.aiWasInMyPair,
        suggestion: card.suggestion && { realName: card.suggestion.realName, reason: card.suggestion.reason },
      }} />);
    }
  }
}

function RevealScreen({ view, who, theme, partnerIds, onNext }: {
  view: RoomView; who: (id: PlayerId) => Who; theme: { isDarkMode: boolean; onToggleTheme: () => void }; partnerIds: PlayerId[]; onNext?: () => void;
}) {
  const reveal = view.reveal;
  if (!reveal) return null;
  // Votes received across all three votes (rounds 1–2 history + the final vote).
  const totalVotes = (id: PlayerId) => view.history.reduce((sum, r) => sum + (r.voteCounts?.[id] ?? 0), 0) + (reveal.finalVoteCounts[id] ?? 0);
  const humanPartner = partnerIds.find(id => id !== reveal.aiPlayerId && reveal.realNames[id]);
  const talkToMission: TalkToMission = humanPartner
    ? {
        partnerRealName: reveal.realNames[humanPartner]!,
        partnerNickname: who(humanPartner).label,
        sharedMoment: view.collabResults?.[humanPartner] ? `Their round 3 answer: “${view.collabResults[humanPartner]}”` : '',
        openingLine: `Hey ${reveal.realNames[humanPartner]}, I was ${who(view.me!.id).label} in the game!`,
      }
    : { partnerRealName: '', partnerNickname: '', sharedMoment: 'Your partner was the AI. Your partner card (next) suggests who to talk to.', openingLine: '' };
  return <GameOverReveal {...theme}
    didHumansWin={reveal.humansWon}
    aiNickname={`${who(reveal.aiPlayerId).label}${reveal.aiPersona.blurb ? ` · ${reveal.aiPersona.blurb}` : ''}`}
    players={view.players.map(p => ({ nickname: who(p.id).label, realName: reveal.realNames[p.id] ?? '', isAi: p.id === reveal.aiPlayerId, totalVotesReceived: totalVotes(p.id) }))}
    mostSusHuman={reveal.mostSuspiciousHuman ? who(reveal.mostSuspiciousHuman.playerId).label : ''}
    aiConfessionalNotes={reveal.aiNotes.map(n => n.text)}
    talkToMission={talkToMission}
    onPlayAgain={onNext} playAgainLabel="SHOW PARTNER CARDS" waitingText="Waiting for the host to show partner cards…" />;
}
