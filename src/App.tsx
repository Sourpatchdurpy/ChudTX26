import { useEffect, useState } from 'react';
import EntryScreen from './components/auth/EntryScreen';
import LobbyWaitingRoom from './components/lobby/LobbyWaitingRoom';
import PixelSky from './components/shared/PixelSky';
import MobilePreview from './components/shared/MobilePreview';
import DiscussionChatView from './components/discussion/DiscussionChatView';
import PrivateAnswerView from './components/game/PrivateAnswerView';
import RoundVoteModal from './components/discussion/RoundVoteModal';
import GameOverReveal from './components/game/GameOverReveal';
import type { DiscussionMsg, EntryIdentity, LobbyPlayer, RoundVoteResult } from '@/types/game';
import { generateCodename, generateRoomCode } from './lib/entryIdentity';
import { advanceLocalRound, castLocalVote, enterLocalRoom, leaveLocalRoom, LOCAL_ROOMS_CHANGED, readLocalRoom, resetLocalLobby, resolveLocalVote, sendLocalMessage, startLocalDiscussion } from './lib/localRooms';

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [currentUserId] = useState(() => crypto.randomUUID());
  const [identity, setIdentity] = useState<EntryIdentity | null>(() =>
    ['lobby', 'chat', 'answer', 'vote', 'reveal'].includes(new URLSearchParams(window.location.search).get('preview') ?? '')
      ? { nickname: generateCodename(), roomCode: generateRoomCode(), isHost: true }
      : null,
  );
  const [phase, setPhase] = useState<'lobby' | 'answer' | 'chat' | 'voting' | 'complete'>(() =>
    new URLSearchParams(window.location.search).get('preview') === 'reveal' ? 'complete' :
    new URLSearchParams(window.location.search).get('preview') === 'vote' ? 'voting' :
    new URLSearchParams(window.location.search).get('preview') === 'answer' ? 'answer' :
      new URLSearchParams(window.location.search).get('preview') === 'chat' ? 'chat' : 'lobby',
  );
  const [messages, setMessages] = useState<DiscussionMsg[]>([]);
  const [previewAnswer, setPreviewAnswer] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  const [voteSeconds, setVoteSeconds] = useState(20);
  const [joinedRoomCode, setJoinedRoomCode] = useState<string | null>(null);
  const [discussionStartedAt, setDiscussionStartedAt] = useState<number | null>(null);
  const [roomError, setRoomError] = useState('');
  const [roundNumber, setRoundNumber] = useState(1);
  const [roundParticipants, setRoundParticipants] = useState<LobbyPlayer[]>([]);
  const [roundResult, setRoundResult] = useState<RoundVoteResult | null>(null);
  const [voteResolvedAt, setVoteResolvedAt] = useState<number | null>(null);
  const [gameWon, setGameWon] = useState(() => new URLSearchParams(window.location.search).get('preview') === 'reveal' && new URLSearchParams(window.location.search).get('win') === 'humans');
  const [roomPlayers, setRoomPlayers] = useState<LobbyPlayer[]>(() => identity
    ? [{ id: currentUserId, nickname: identity.nickname, isHost: identity.isHost }]
    : []);
  const canvas = isDarkMode ? 'bg-[#060B28] text-white' : 'bg-gradient-to-b from-[#FFAE70] via-[#FFD199] to-[#86C5DA] text-[#0E1726]';
  const glass = isDarkMode ? 'border-[#00E5FF] bg-black/20 shadow-[0_0_25px_#00E5FF50]' : 'border-[#16223B]/80 bg-white/20 shadow-[0_0_25px_#FFAE7099]';
  const muted = isDarkMode ? 'text-[#B5DFFF]' : 'text-[#26374F]';
  const accent = isDarkMode ? 'text-[#00E5FF]' : 'text-[#0E1726]';

  useEffect(() => {
    if (!joinedRoomCode) return;
    const syncRoom = () => {
      try {
        const room = readLocalRoom(joinedRoomCode);
        if (room && room.players.some(player => player.id === currentUserId)) {
          setRoomPlayers(room.players);
          setMessages(room.messages ?? []);
          setDiscussionStartedAt(room.discussionStartedAt ?? null);
          setRoundNumber(room.roundNumber ?? 1);
          setRoundParticipants(room.roundParticipants ?? room.players);
          setRoundResult(room.roundResult ?? null);
          setVoteResolvedAt(room.voteResolvedAt ?? null);
          setPhase(room.discussionStartedAt === undefined ? 'lobby' : room.roundResult && !room.roundResult.isTie && room.roundResult.wasAi ? 'complete' : room.roundResult && (room.roundNumber ?? 1) >= 3 && room.voteResolvedAt !== undefined && Date.now() >= room.voteResolvedAt + 3000 ? 'complete' : Date.now() < room.discussionStartedAt + 50000 ? 'chat' : 'voting');
          setGameWon(!!room.roundResult && !room.roundResult.isTie && room.roundResult.wasAi);
        } else {
          setRoomPlayers([]);
          setIdentity(null);
          setJoinedRoomCode(null);
          setDiscussionStartedAt(null);
          setPhase('lobby');
        }
      } catch { setRoomError('Unable to sync the room. Please try again.'); }
    };
    window.addEventListener('storage', syncRoom);
    window.addEventListener(LOCAL_ROOMS_CHANGED, syncRoom);
    window.addEventListener('focus', syncRoom);
    document.addEventListener('visibilitychange', syncRoom);
    syncRoom();
    return () => {
      window.removeEventListener('storage', syncRoom);
      window.removeEventListener(LOCAL_ROOMS_CHANGED, syncRoom);
      window.removeEventListener('focus', syncRoom);
      document.removeEventListener('visibilitychange', syncRoom);
    };
  }, [joinedRoomCode, currentUserId]);

  useEffect(() => {
    if (!joinedRoomCode || discussionStartedAt === null) return;
    let resolving = false;
    let advancing = false;
    const tick = () => {
      const endsAt = discussionStartedAt + 50000;
      if (roundResult) {
        setVoteSeconds(0);
        if (roundResult.wasAi && !roundResult.isTie) { onAiEliminated(); return; }
        if (voteResolvedAt !== null && Date.now() >= voteResolvedAt + 3000) {
          if (roundNumber >= 3) setPhase('complete');
          else if (!advancing) {
            advancing = true;
            void advanceLocalRound(joinedRoomCode, currentUserId, discussionStartedAt).catch(error => setRoomError(error instanceof Error ? error.message : 'Unable to advance the round.'));
          }
        } else setPhase('voting');
        return;
      }
      if (Date.now() >= endsAt) {
        const seconds = Math.max(0, Math.ceil((endsAt + 20000 - Date.now()) / 1000));
        setVoteSeconds(seconds);
        setPhase('voting');
        if (seconds === 0 && !resolving) {
          resolving = true;
          void resolveLocalVote(joinedRoomCode, currentUserId, discussionStartedAt).catch(error => setRoomError(error instanceof Error ? error.message : 'Unable to resolve the vote.'));
        }
      } else setPhase('chat');
    };
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [joinedRoomCode, discussionStartedAt, roundResult, voteResolvedAt, roundNumber, currentUserId]);

  useEffect(() => {
    if (phase !== 'voting' || joinedRoomCode || roundResult) return;
    const deadline = Date.now() + 20000;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setVoteSeconds(remaining);
      if (remaining === 0) {
        clearInterval(interval);
        setRoundResult({ eliminatedNickname: null, wasAi: false, isTie: true });
        setVoteResolvedAt(Date.now());
      }
    }, 100);
    return () => clearInterval(interval);
  }, [phase, joinedRoomCode, roundResult]);

  useEffect(() => {
    if (joinedRoomCode || phase !== 'voting' || !roundResult) return;
    if (roundResult.wasAi && !roundResult.isTie) { onAiEliminated(); return; }
    const timer = setTimeout(() => {
      if (roundNumber >= 3) setPhase('complete');
      else { setRoundNumber(value => value + 1); openChatPreview(); }
    }, Math.max(0, (voteResolvedAt ?? Date.now()) + 3000 - Date.now()));
    return () => clearTimeout(timer);
  }, [joinedRoomCode, phase, roundResult, roundNumber, voteResolvedAt]);

  function onAiEliminated() { setGameWon(true); setPhase('complete'); }

  async function enterRoom(entry: EntryIdentity) {
    const room = await enterLocalRoom(entry, currentUserId);
    setRoomPlayers(room.players);
    setJoinedRoomCode(room.roomCode);
    setIdentity(entry);
    setRoomError('');
    setRoundResult(null);
    setVoteResolvedAt(null);
    setGameWon(false);
    setPhase('lobby');
  }

  function leaveRoom() {
    if (joinedRoomCode) void leaveLocalRoom(joinedRoomCode, currentUserId).catch(() => undefined);
    setJoinedRoomCode(null);
    setDiscussionStartedAt(null);
    setRoomPlayers([]);
    setIdentity(null);
    setMessages([]);
    setPhase('lobby');
    setRoundResult(null);
    setVoteResolvedAt(null);
    setGameWon(false);
    setRoomError('');
  }

  function openChatPreview() {
    setSession(value => value + 1);
    setMessages([]);
    setRoundResult(null);
    setVoteResolvedAt(null);
    setVoteSeconds(20);
    setPhase('chat');
  }

  async function launchGame() {
    if (!joinedRoomCode) { openChatPreview(); return; }
    try {
      setRoomError('');
      await startLocalDiscussion(joinedRoomCode, currentUserId);
    } catch (error) { setRoomError(error instanceof Error ? error.message : 'Unable to launch. Please try again.'); }
  }

  function publishMessage(text: string) {
    if (joinedRoomCode) {
      void sendLocalMessage(joinedRoomCode, currentUserId, text).catch(error => setRoomError(error instanceof Error ? error.message : 'Unable to send your message.'));
    } else if (identity) setMessages(previous => [...previous, { id: crypto.randomUUID(), senderNickname: identity.nickname, text, timestamp: Date.now() }]);
  }

  async function returnToLobby() {
    if (!joinedRoomCode) { setRoundNumber(1); setRoundResult(null); setGameWon(false); setPhase('lobby'); return; }
    try { await resetLocalLobby(joinedRoomCode, currentUserId); }
    catch (error) { setRoomError(error instanceof Error ? error.message : 'Unable to reopen the lobby.'); }
  }

  const errorNotice = roomError && <div role="alert" className="fixed bottom-4 left-4 right-4 z-50 mx-auto flex max-w-lg items-center justify-between gap-3 rounded-xl border border-[#FF5376] bg-[#060B28] p-3 font-sans text-sm text-white"><p>{roomError}</p><button type="button" onClick={() => setRoomError('')} className="min-h-11 px-2 font-bold">Dismiss</button></div>;

  if (new URLSearchParams(window.location.search).get('device') === 'mobile') return <MobilePreview />;
  if (!identity) return <EntryScreen onEnter={enterRoom} isDarkMode={isDarkMode} onToggleTheme={() => setIsDarkMode(value => !value)} />;

  if (phase === 'answer') return <PrivateAnswerView
    isDarkMode={isDarkMode}
    onToggleTheme={() => setIsDarkMode(value => !value)}
    roundNumber={roundNumber}
    roundTier={(['LIGHT', 'PERSONAL', 'DEEP'] as const)[Math.min(2, roundNumber - 1)]}
    question=""
    totalPlayers={roomPlayers.length}
    answeredCount={previewAnswer === null ? 0 : 1}
    onSubmitAnswer={setPreviewAnswer}
    onTimeUp={openChatPreview}
  />;

  if (phase === 'chat' || phase === 'voting') return <>
    <div aria-hidden={phase === 'voting' ? true : undefined} ref={node => { node?.toggleAttribute('inert', phase === 'voting'); }}>
      <DiscussionChatView
        key={discussionStartedAt ?? session}
        isDarkMode={isDarkMode}
        onToggleTheme={() => setIsDarkMode(value => !value)}
        question=""
        answers={joinedRoomCode === null && previewAnswer !== null ? [{ id: currentUserId, authorNickname: identity.nickname, text: previewAnswer }] : []}
        messages={messages}
        currentUserNickname={identity.nickname}
        initialSeconds={phase === 'voting' ? 0 : discussionStartedAt === null ? 50 : Math.max(0, 50 - (Date.now() - discussionStartedAt) / 1000)}
        onSendMessage={publishMessage}
        onDiscussionEnd={() => {
          if (phase !== 'chat') return;
          setVoteSeconds(discussionStartedAt === null ? 20 : Math.max(0, Math.ceil((discussionStartedAt + 70000 - Date.now()) / 1000)));
          setPhase('voting');
        }}
      />
    </div>
    {phase === 'voting' && <RoundVoteModal
      key={discussionStartedAt ?? session}
      isDarkMode={isDarkMode}
      secondsRemaining={voteSeconds}
      candidates={(roundParticipants.length ? roundParticipants : roomPlayers).filter(player => player.id !== currentUserId).map(player => ({ nickname: player.nickname, answerSnippet: '' }))}
      onCastVote={async nickname => {
        if (joinedRoomCode && discussionStartedAt !== null) await castLocalVote(joinedRoomCode, currentUserId, nickname, discussionStartedAt);
      }}
      roundResult={roundResult}
    />}
    {errorNotice}
  </>;

  if (phase === 'complete' && (gameWon || new URLSearchParams(window.location.search).get('preview') === 'reveal')) return <><GameOverReveal
    isDarkMode={isDarkMode}
    onToggleTheme={() => setIsDarkMode(value => !value)}
    didHumansWin={gameWon}
    aiNickname={gameWon && roundResult?.wasAi ? roundResult.eliminatedNickname ?? '' : ''}
    players={roomPlayers.map(player => ({ nickname: player.nickname, realName: '', isAi: !!gameWon && !!roundResult?.wasAi && player.nickname === roundResult.eliminatedNickname, totalVotesReceived: 0 }))}
    mostSusHuman=""
    aiConfessionalNotes={[]}
    talkToMission={{ partnerRealName: '', partnerNickname: '', sharedMoment: '', openingLine: '' }}
    onPlayAgain={() => { if (joinedRoomCode && !identity.isHost) leaveRoom(); else void returnToLobby(); }}
  />{errorNotice}</>;

  if (phase === 'complete') return <main className={`relative isolate flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-8 font-sans ${canvas}`}>
    <PixelSky isDarkMode={isDarkMode} />
    <section className={`relative z-10 flex w-full max-w-lg flex-col gap-5 rounded-2xl border-2 p-5 backdrop-blur-xs sm:p-7 ${glass}`}>
      <h1 className={`break-words font-pixel text-sm leading-loose ${gameWon ? (isDarkMode ? 'text-[#38EF7D]' : 'text-[#126438]') : accent}`}>{gameWon ? '[ IMPOSTER DETECTED // PROTOCOL BREACHED ]' : '[ 3 ROUNDS COMPLETE ]'}</h1>
      <p className={`text-sm ${muted}`}>{gameWon ? 'The AI has been found. Humans win.' : 'The round results are complete. Everyone stays in the room.'}</p>
      {(!joinedRoomCode || identity.isHost) ? <button type="button" onClick={returnToLobby} className="min-h-14 rounded-xl border-b-4 border-[#B31D3F] bg-[#FF5376] px-4 py-3 font-bold text-white hover:bg-[#FF3360]">{joinedRoomCode ? 'Return everyone to lobby' : 'Back to lobby'}</button> : <p className={`text-sm ${muted}`}>Waiting for the host to reopen the lobby.</p>}
      {joinedRoomCode && <button type="button" onClick={leaveRoom} className={`min-h-11 text-sm ${muted}`}>Leave room</button>}
    </section>
    {errorNotice}
  </main>;

  return <><LobbyWaitingRoom
    isDarkMode={isDarkMode}
    onToggleTheme={() => setIsDarkMode(value => !value)}
    roomCode={identity.roomCode}
    players={roomPlayers}
    currentUserId={currentUserId}
    isHost={identity.isHost}
    onStartGame={launchGame}
    onLeaveRoom={leaveRoom}
  />{errorNotice}</>;
}
