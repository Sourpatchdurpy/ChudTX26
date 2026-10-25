// Renders the arcade screens from the server's latest RoomView (MASTER_PLAN §5):
// the server owns phases, timers and rules; this file maps each phase to a screen.
import { useState } from 'react';
import type { PlayerId, RoomView } from '@game/shared';
import EntryScreen from './components/auth/EntryScreen';
import LobbyWaitingRoom from './components/lobby/LobbyWaitingRoom';
import MobilePreview from './components/shared/MobilePreview';
import DiscussionChatView from './components/discussion/DiscussionChatView';
import PrivateAnswerView from './components/game/PrivateAnswerView';
import RoundVoteModal from './components/discussion/RoundVoteModal';
import VouchModal from './components/discussion/VouchModal';
import GameOverReveal from './components/game/GameOverReveal';
import CollabResultBox from './components/game/CollabResultBox';
import type { DiscussionMsg, LobbyPlayer, RoundAnswer, TalkToMission } from '@/types/game';
import { useGame, useSecondsLeft } from './lib/gameClient';
import { PreviewScreen, previewScreen } from './lib/preview';

const TIER_LABEL = { light: 'LIGHT', personal: 'PERSONAL', collab: 'DEEP' } as const;
const NO_MISSION: TalkToMission = { partnerRealName: '', partnerNickname: '', sharedMoment: '', openingLine: '' };

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [error, setError] = useState('');
  const game = useGame();
  const { view } = game;
  const seconds = useSecondsLeft(view?.phaseEndsAt ?? null, game.clockOffset);
  const theme = { isDarkMode, onToggleTheme: () => setIsDarkMode(value => !value) };

  /** Runs a server action; a rejection becomes the error banner (and is rethrown for screens that show it inline). */
  const run = (action: () => Promise<unknown>) => { setError(''); return action().catch((e: unknown) => { setError(e instanceof Error ? e.message : 'Something went wrong.'); throw e; }); };
  const fire = (action: () => Promise<unknown>) => { void run(action).catch(() => undefined); };

  if (new URLSearchParams(window.location.search).get('device') === 'mobile') return <MobilePreview />;
  const preview = previewScreen();
  if (preview) return <PreviewScreen screen={preview} {...theme} />;

  if (!view || !view.me) {
    return <EntryScreen key={game.closedReason} {...theme} initialError={game.closedReason} onEnter={async entry => {
      game.dismissClosed();
      if (entry.isHost) await game.create(entry.realName, entry.nickname, entry.roomCode);
      else await game.join(entry.roomCode, entry.realName, entry.nickname);
    }} />;
  }

  const me = view.me;
  const name = (id: PlayerId) => view.players.find(p => p.id === id)?.nickname ?? '???';
  const idByName = (nickname: string) => view.players.find(p => p.nickname === nickname)?.id ?? '';
  const round = view.round?.number ?? 1;
  const currentRecord = view.history[view.history.length - 1];
  const myPair = view.pairs?.find(pair => pair.members.includes(me.id)) ?? null;
  const partnerIds = myPair?.members.filter(id => id !== me.id) ?? [];
  // Each round's chat starts empty, as in the original design (older servers don't send `round`).
  const toMsg = (m: RoomView['messages'][number]): DiscussionMsg => ({ id: m.id, senderNickname: name(m.from), text: m.text, timestamp: m.at });
  const groupMessages = view.messages.filter(m => m.channel === 'group' && (m.round == null || m.round === round)).map(toMsg);
  const pairMessages = view.messages.filter(m => m.channel === 'pair' && m.pairId === myPair?.id).map(toMsg);
  const results = view.collabResults ?? {};
  const resultPills = (withVouches: boolean): RoundAnswer[] => view.players.map(p => {
    const vouched = withVouches ? (view.vouches ?? []).filter(v => v.from === p.id && v.vouched).map(v => name(v.target)) : [];
    const text = (results[p.id] ?? '(no answer)') + (vouched.length ? ` · vouched for ${vouched.join(', ')}` : '');
    return { id: p.id, authorNickname: name(p.id), text };
  });

  const errorNotice = error && <div role="alert" className="fixed bottom-4 left-4 right-4 z-50 mx-auto flex max-w-lg items-center justify-between gap-3 rounded-xl border border-[#FF5376] bg-[#060B28] p-3 font-sans text-sm text-white"><p>{error}</p><button type="button" onClick={() => setError('')} className="min-h-11 px-2 font-bold">Dismiss</button></div>;
  const screen = (node: React.ReactNode) => <>{node}{errorNotice}</>;
  const behindModal = (node: React.ReactNode) => <div aria-hidden="true" ref={el => { el?.toggleAttribute('inert', true); }}>{node}</div>;

  switch (view.phase) {
    case 'lobby': {
      // First names only (codenames stay secret until the game starts); the crown only on your own row.
      const names = view.lobby?.realNames ?? [];
      const myIndex = names.indexOf(me.realName);
      const players: LobbyPlayer[] = names.map((n, i) => ({ id: `${i}:${n}`, nickname: n, isHost: i === myIndex && me.isHost }));
      return screen(<LobbyWaitingRoom {...theme} roomCode={view.code} players={players} currentUserId={`${myIndex}:${me.realName}`} isHost={me.isHost}
        onStartGame={() => fire(game.start)} onLeaveRoom={game.leave} />);
    }

    case 'answer':
      return screen(<PrivateAnswerView key={`answer-${round}`} {...theme} roundNumber={round} roundTier={TIER_LABEL[view.round?.tier ?? 'light']}
        question={view.round?.prompt ?? ''} totalPlayers={view.answerProgress?.total ?? view.players.length} answeredCount={view.answerProgress?.answered ?? 0}
        initialSeconds={seconds} onSubmitAnswer={text => fire(() => game.answer(text))} onTimeUp={() => undefined} />);

    case 'discuss':
    case 'vote':
    case 'voteResult': {
      const answers = (currentRecord?.answers ?? []).map(a => ({ id: a.playerId, authorNickname: name(a.playerId), text: a.text ?? '(no answer)' }));
      const chat = <DiscussionChatView key={`discuss-${round}`} {...theme} question={view.round?.prompt ?? ''} answers={answers} messages={groupMessages}
        currentUserNickname={me.nickname ?? ''} initialSeconds={view.phase === 'discuss' ? seconds : 0}
        onSendMessage={view.phase === 'discuss' ? text => fire(() => game.chat(text, 'group')) : undefined} onDiscussionEnd={() => undefined} />;
      if (view.phase === 'discuss') return screen(chat);
      return screen(<>
        {behindModal(chat)}
        <RoundVoteModal key={`vote-${round}`} isDarkMode={isDarkMode} secondsRemaining={view.phase === 'vote' ? seconds : 0}
          candidates={view.players.filter(p => p.id !== me.id).map(p => ({ nickname: p.nickname, answerSnippet: answers.find(a => a.id === p.id)?.text ?? '' }))}
          onCastVote={nickname => run(() => game.vote(idByName(nickname)))}
          tally={view.phase === 'voteResult' ? view.players.map(p => ({ nickname: p.nickname, votes: view.lastVoteCounts?.[p.id] ?? 0 })) : null} />
      </>);
    }

    case 'pairChat':
      return screen(<DiscussionChatView key="pair-chat" {...theme} question={view.round?.prompt ?? ''} answers={[]} messages={pairMessages}
        currentUserNickname={me.nickname ?? ''} initialSeconds={seconds} maxSeconds={90}
        onSendMessage={text => fire(() => game.chat(text, 'pair'))} onDiscussionEnd={() => undefined}
        asideExtra={<CollabResultBox isDarkMode={isDarkMode} partnerNames={partnerIds.map(name)} submitPrompt={view.round?.submitPrompt ?? 'Your answer'}
          lockedResult={me.myCollabResult} disabled={seconds <= 0} onSubmit={text => run(() => game.collab(text))} />} />);

    case 'pairResults':
    case 'finalVote': {
      const chat = <DiscussionChatView key={`results-${view.phase}`} {...theme} question={view.round?.prompt ?? ''} answers={resultPills(view.phase === 'finalVote')}
        messages={pairMessages} currentUserNickname={me.nickname ?? ''} initialSeconds={0} onDiscussionEnd={() => undefined} />;
      return screen(<>
        {behindModal(chat)}
        {view.phase === 'pairResults'
          ? <VouchModal isDarkMode={isDarkMode} secondsRemaining={seconds} vouches={me.myVouches}
              partners={partnerIds.map(id => ({ id, nickname: name(id), result: results[id] ?? '' }))}
              onToggle={(id, vouched) => run(() => game.vouch(id, vouched))} />
          : <RoundVoteModal key="final-vote" isDarkMode={isDarkMode} secondsRemaining={seconds}
              candidates={view.players.filter(p => p.id !== me.id).map(p => ({ nickname: p.nickname, answerSnippet: results[p.id] ?? '' }))}
              onCastVote={nickname => run(() => game.vote(idByName(nickname)))} />}
      </>);
    }

    case 'reveal':
    case 'partners': {
      const reveal = view.reveal;
      if (!reveal) return null;
      // Votes received across all three votes (rounds 1–2 + the final vote).
      const totalVotes = (id: PlayerId) => view.history.reduce((sum, r) => sum + (r.voteCounts?.[id] ?? 0), 0) + (reveal.finalVoteCounts[id] ?? 0);
      const card = me.partnerCard;
      const partner = card?.partners[0];
      const talkToMission: TalkToMission = card?.kind === 'partner' && partner
        ? { partnerRealName: partner.realName, partnerNickname: partner.nickname, sharedMoment: partner.collabResult ? `“${partner.collabResult}”` : '', openingLine: '' }
        : card?.suggestion
          ? { partnerRealName: card.suggestion.realName, partnerNickname: name(card.suggestion.playerId), sharedMoment: card.suggestion.reason, openingLine: '' }
          : NO_MISSION;
      return screen(<GameOverReveal {...theme} didHumansWin={reveal.humansWon} aiNickname={name(reveal.aiPlayerId)}
        players={view.players.map(p => ({ nickname: p.nickname, realName: reveal.realNames[p.id] ?? '', isAi: p.id === reveal.aiPlayerId, totalVotesReceived: totalVotes(p.id) }))}
        mostSusHuman={reveal.mostSuspiciousHuman ? name(reveal.mostSuspiciousHuman.playerId) : ''}
        aiConfessionalNotes={reveal.aiNotes.map(n => n.text)} talkToMission={talkToMission}
        // As in the original: the host returns everyone to the lobby; anyone else leaves the room.
        onPlayAgain={() => (me.isHost ? fire(game.playAgain) : game.leave())} />);
    }
  }
}
