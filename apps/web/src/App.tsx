import { useEffect, useState, type ReactNode } from 'react';
import type { PartnerCard, Phase, PlayerId, RoomView } from '@game/shared';
import EntryScreen from './components/auth/EntryScreen';
import LobbyWaitingRoom from './components/lobby/LobbyWaitingRoom';
import PixelSky from './components/shared/PixelSky';
import MobilePreview from './components/shared/MobilePreview';
import DiscussionChatView from './components/discussion/DiscussionChatView';
import PrivateAnswerView from './components/game/PrivateAnswerView';
import RoundVoteModal from './components/discussion/RoundVoteModal';
import GameOverReveal from './components/game/GameOverReveal';
import PairChatView from './components/pair/PairChatView';
import PairResultsView from './components/pair/PairResultsView';
import { useGameRoom } from './hooks/useGameRoom';
import type { EntryIdentity, TalkToMission } from '@/types/game';

/** Phases with a server timer; the host can skip ahead in any of them. */
const TIMED_PHASES: Phase[] = ['answer', 'discuss', 'vote', 'voteResult', 'pairChat', 'pairResults', 'finalVote'];
const NO_MISSION: TalkToMission = { partnerRealName: '', partnerNickname: '', sharedMoment: '', openingLine: '' };

/** The partner card from the server, in the reveal screen's "talk-to mission" shape. */
function toMission(card: PartnerCard | null, myNickname: string, nicknameOf: (id: PlayerId) => string): TalkToMission {
  if (!card) return NO_MISSION;
  if (card.kind === 'partner' && card.partners.length > 0) {
    const first = card.partners[0]!;
    const lines = [
      card.myCollabResult && `You wrote: “${card.myCollabResult}”`,
      ...card.partners.map(p => p.collabResult && `${p.nickname} wrote: “${p.collabResult}”`),
      card.aiWasInMyPair && 'The AI was in your trio too.',
    ].filter(Boolean);
    return {
      partnerRealName: card.partners.map(p => p.realName).join(' & '),
      partnerNickname: card.partners.map(p => p.nickname).join(' & '),
      sharedMoment: lines.join('\n'),
      openingLine: `Hey ${first.realName}, I was ${myNickname}! ${first.collabResult ? `Tell me more about “${first.collabResult}”.` : 'We should finish our round 3 chat.'}`,
    };
  }
  const s = card.suggestion;
  if (!s) return { ...NO_MISSION, sharedMoment: 'Your partner was the AI.' };
  return {
    partnerRealName: s.realName,
    partnerNickname: nicknameOf(s.playerId),
    sharedMoment: `Your partner was the AI, so here's a human to talk to instead: ${s.reason}`,
    openingLine: `Hey ${s.realName}, I was ${myNickname}! My partner turned out to be the AI, so the game sent me your way.`,
  };
}

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const room = useGameRoom();
  const [, setTick] = useState(0);
  const toggleTheme = () => setIsDarkMode(value => !value);
  const canvas = isDarkMode ? 'bg-[#060B28] text-white' : 'bg-gradient-to-b from-[#FFAE70] via-[#FFD199] to-[#86C5DA] text-[#0E1726]';
  const accent = isDarkMode ? 'text-[#00E5FF]' : 'text-[#0E1726]';

  // Countdowns (e.g. the vote modal) are driven from the server's phase end time, so re-render a few times a second.
  useEffect(() => {
    const timer = setInterval(() => setTick(value => value + 1), 250);
    return () => clearInterval(timer);
  }, []);

  if (new URLSearchParams(window.location.search).get('device') === 'mobile') return <MobilePreview />;

  const notice = (text: string, onDismiss?: () => void) => <div role="alert" className="fixed bottom-4 left-4 right-4 z-50 mx-auto flex max-w-lg items-center justify-between gap-3 rounded-xl border border-[#FF5376] bg-[#060B28] p-3 font-sans text-sm text-white">
    <p>{text}</p>
    {onDismiss && <button type="button" onClick={onDismiss} className="min-h-11 px-2 font-bold">Dismiss</button>}
  </div>;
  const errorNotice = room.error ? notice(room.error, room.clearError) : null;
  const offline = !room.connected && <div role="status" className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full border border-[#FF5376] bg-[#060B28] px-4 py-2 font-pixel text-[8px] text-white">RECONNECTING...</div>;

  async function enter(entry: EntryIdentity) {
    if (entry.isHost) await room.create(entry.realName);
    else await room.join(entry.roomCode, entry.realName);
  }

  const view: RoomView | null = room.view;
  if (!view || !view.me) {
    if (room.rejoining) return <main className={`relative isolate flex min-h-[100dvh] items-center justify-center font-pixel ${canvas}`}><PixelSky isDarkMode={isDarkMode} /><p className={`relative z-10 text-xs ${accent}`}>RECONNECTING TO YOUR ROOM...</p></main>;
    return <><EntryScreen onEnter={enter} isDarkMode={isDarkMode} onToggleTheme={toggleTheme} />{room.closedReason && notice(room.closedReason)}{offline}</>;
  }

  const me = view.me;
  const nicknameOf = (id: PlayerId) => view.players.find(p => p.id === id)?.nickname ?? '???';
  const round = view.round?.number ?? 1;
  const record = view.history.find(r => r.round === view.round?.number);
  const answerOf = (id: PlayerId) => record?.answers.find(a => a.playerId === id)?.text ?? '';
  const secondsLeft = room.secondsLeft() ?? 0;
  const others = view.players.filter(p => p.id !== me.id);
  const voteFor = async (nickname: string) => {
    const target = view.players.find(p => p.nickname === nickname);
    if (target) await room.vote(target.id);
  };
  const skipButton = me.isHost && TIMED_PHASES.includes(view.phase) && <button type="button" onClick={() => void room.advance()} className="fixed bottom-4 right-4 z-50 min-h-11 rounded-xl border-b-2 border-[#B31D3F] bg-[#FF5376] px-4 py-2 font-pixel text-[8px] text-white shadow-[2px_2px_0_#000] hover:bg-[#FF3360]">SKIP ▸</button>;
  const withChrome = (screen: ReactNode) => <>{screen}{skipButton}{errorNotice}{offline}</>;

  switch (view.phase) {
    case 'lobby': {
      // Lobby names are sorted and carry no host flag (privacy rule), so "you" is matched by name.
      const names = view.lobby?.realNames ?? [];
      const mine = names.indexOf(me.realName);
      return withChrome(<LobbyWaitingRoom
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
        roomCode={view.code}
        players={names.map((name, i) => ({ id: `${i}:${name}`, nickname: name, isHost: false }))}
        currentUserId={mine >= 0 ? `${mine}:${names[mine]}` : ''}
        isHost={me.isHost}
        onStartGame={() => void room.start()}
        onLeaveRoom={room.leave}
      />);
    }

    case 'answer':
      return withChrome(<PrivateAnswerView
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
        roundNumber={round}
        roundTier={view.round?.tier === 'personal' ? 'PERSONAL' : 'LIGHT'}
        question={view.round?.prompt ?? ''}
        totalPlayers={view.answerProgress?.total ?? view.players.length}
        answeredCount={view.answerProgress?.answered ?? 0}
        initialSeconds={secondsLeft}
        onSubmitAnswer={text => void room.submitAnswer(text)}
        onTimeUp={() => undefined}
      />);

    case 'discuss':
    case 'vote':
    case 'voteResult': {
      const voting = view.phase !== 'discuss';
      return withChrome(<>
        <div aria-hidden={voting ? true : undefined} ref={node => { node?.toggleAttribute('inert', voting); }}>
          <DiscussionChatView
            key={`discuss-${round}`}
            isDarkMode={isDarkMode}
            onToggleTheme={toggleTheme}
            question={view.round?.prompt ?? ''}
            answers={(record?.answers ?? []).map(a => ({ id: a.playerId, authorNickname: nicknameOf(a.playerId), text: a.text ?? '(no answer)' }))}
            messages={view.messages.filter(m => m.channel === 'group').map(m => ({ id: m.id, senderNickname: nicknameOf(m.from), text: m.text, timestamp: m.at }))}
            currentUserNickname={me.nickname ?? ''}
            initialSeconds={view.phase === 'discuss' ? secondsLeft : 0}
            onSendMessage={view.phase === 'discuss' ? text => void room.sendChat(text, 'group') : undefined}
            onDiscussionEnd={() => undefined}
          />
        </div>
        {voting && <RoundVoteModal
          key={`vote-${round}`}
          isDarkMode={isDarkMode}
          secondsRemaining={secondsLeft}
          candidates={others.map(p => ({ nickname: p.nickname, answerSnippet: answerOf(p.id) }))}
          onCastVote={voteFor}
          tally={view.phase === 'voteResult' ? Object.entries(view.lastVoteCounts ?? {}).map(([id, votes]) => ({ nickname: nicknameOf(id), votes })) : null}
        />}
      </>);
    }

    case 'pairChat': {
      const partners = view.pairs?.find(p => p.id === me.myPairId)?.members.filter(id => id !== me.id) ?? [];
      return withChrome(<PairChatView
        key="pairChat"
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
        card={view.round?.prompt ?? ''}
        submitPrompt={view.round?.submitPrompt ?? ''}
        partnerNicknames={partners.map(nicknameOf)}
        messages={view.messages.filter(m => m.channel === 'pair').map(m => ({ id: m.id, senderNickname: nicknameOf(m.from), text: m.text }))}
        currentUserNickname={me.nickname ?? ''}
        initialSeconds={secondsLeft}
        myResult={me.myCollabResult}
        onSendMessage={text => void room.sendChat(text, 'pair')}
        onSubmitResult={room.submitCollab}
      />);
    }

    case 'pairResults':
    case 'finalVote': {
      const final = view.phase === 'finalVote';
      const partners = view.pairs?.find(p => p.id === me.myPairId)?.members.filter(id => id !== me.id) ?? [];
      const vouches = (view.vouches ?? []).filter(v => v.vouched);
      const vouchersOf = (id: PlayerId) => vouches.filter(v => v.target === id).map(v => nicknameOf(v.from));
      return withChrome(<>
        <div aria-hidden={final ? true : undefined} ref={node => { node?.toggleAttribute('inert', final); }}>
          <PairResultsView
            key={view.phase}
            isDarkMode={isDarkMode}
            onToggleTheme={toggleTheme}
            card={view.round?.prompt ?? ''}
            submitPrompt={view.round?.submitPrompt ?? ''}
            pairs={(view.pairs ?? []).map(p => p.members.map(id => ({ id, nickname: nicknameOf(id), result: view.collabResults?.[id] ?? null, isMe: id === me.id })))}
            initialSeconds={secondsLeft}
            myPartners={final ? undefined : partners.map(id => ({ id, nickname: nicknameOf(id), vouched: me.myVouches[id] ?? false }))}
            onSetVouch={final ? undefined : (id, vouched) => void room.setVouch(id, vouched)}
            vouchLines={final ? vouches.map(v => `${nicknameOf(v.from)} vouched for ${nicknameOf(v.target)}`) : undefined}
          />
        </div>
        {final && <RoundVoteModal
          key="finalVote"
          isDarkMode={isDarkMode}
          secondsRemaining={secondsLeft}
          title="FINAL VOTE"
          description="This vote decides the game. Humans win only if the AI gets the most votes; ties go to the AI."
          candidates={others.map(p => {
            const by = vouchersOf(p.id);
            const result = view.collabResults?.[p.id];
            return { nickname: p.nickname, answerSnippet: by.length ? `Vouched human by ${by.join(', ')}` : result ? `“${result}”` : '' };
          })}
          onCastVote={voteFor}
        />}
      </>);
    }

    case 'reveal':
    case 'partners': {
      const reveal = view.reveal;
      if (!reveal) return withChrome(null);
      const totalVotes = (id: PlayerId) => view.history.reduce((sum, r) => sum + (r.voteCounts?.[id] ?? 0), 0) + (reveal.finalVoteCounts[id] ?? 0);
      const suspected = reveal.suspectedBy.map(s => `${nicknameOf(s.playerId)} (${s.rounds.map(r => (r === 3 ? 'final vote' : `round ${r}`)).join(', ')})`);
      const vouchers = reveal.vouchedForAi.map(nicknameOf);
      const notes = [
        reveal.aiPersona.blurb && `My cover story: ${reveal.aiPersona.blurb}`,
        ...reveal.aiNotes.map(n => n.text),
        suspected.length ? `Spotted by ${suspected.join(', ')}` : 'Nobody voted for me all game.',
        vouchers.length ? `Vouched human by ${vouchers.join(', ')}` : '',
      ].filter((line): line is string => !!line);
      const partners = view.phase === 'partners';
      return withChrome(<GameOverReveal
        key={view.phase}
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
        didHumansWin={reveal.humansWon}
        aiNickname={nicknameOf(reveal.aiPlayerId)}
        players={view.players.map(p => ({ nickname: p.nickname, realName: reveal.realNames[p.id] ?? '', isAi: p.id === reveal.aiPlayerId, totalVotesReceived: totalVotes(p.id) }))}
        mostSusHuman={reveal.mostSuspiciousHuman ? nicknameOf(reveal.mostSuspiciousHuman.playerId) : ''}
        aiConfessionalNotes={notes}
        talkToMission={toMission(me.partnerCard, me.nickname ?? '', nicknameOf)}
        initialStep={partners ? 2 : 0}
        onPlayAgain={me.isHost ? () => void (partners ? room.playAgain() : room.advance()) : undefined}
        playAgainLabel={partners ? 'PLAY AGAIN' : 'SHOW PARTNER CARDS'}
        waitingLabel={partners ? 'Waiting for the host to start a new game...' : 'Waiting for the host to reveal partner cards...'}
      />);
    }
  }
}
