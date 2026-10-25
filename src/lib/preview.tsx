// Design preview (no server): ?preview=lobby|answer|chat|vote|reveal  (reveal: &win=humans).
import LobbyWaitingRoom from '../components/lobby/LobbyWaitingRoom';
import PrivateAnswerView from '../components/game/PrivateAnswerView';
import DiscussionChatView from '../components/discussion/DiscussionChatView';
import RoundVoteModal from '../components/discussion/RoundVoteModal';
import GameOverReveal from '../components/game/GameOverReveal';

const SCREENS = ['lobby', 'answer', 'chat', 'vote', 'reveal'] as const;
type Screen = (typeof SCREENS)[number];

export function previewScreen(): Screen | null {
  const value = new URLSearchParams(window.location.search).get('preview');
  return (SCREENS as readonly string[]).includes(value ?? '') ? (value as Screen) : null;
}

const noop = () => undefined;
const QUESTION = "What's a food everyone else thinks is mid that you'll defend forever?";
const ANSWERS = [
  { id: 'a', authorNickname: 'NEON_VIPER', text: 'candy corn, no notes' },
  { id: 'b', authorNickname: 'ECHO_01', text: 'airport sushi honestly' },
  { id: 'c', authorNickname: 'GHOST_BYTE', text: 'plain rice cakes' },
];
const MESSAGES = [
  { id: 'm1', senderNickname: 'ECHO_01', text: 'airport sushi?? who hurt you', timestamp: Date.now() - 20_000 },
  { id: 'm2', senderNickname: 'CYBER_FOX', text: 'ok neon viper is lowkey sus', timestamp: Date.now() - 8_000 },
];

export function PreviewScreen({ screen, isDarkMode, onToggleTheme }: { screen: Screen; isDarkMode: boolean; onToggleTheme: () => void }) {
  const theme = { isDarkMode, onToggleTheme };
  const chat = <DiscussionChatView {...theme} question={QUESTION} answers={ANSWERS} messages={MESSAGES} currentUserNickname="CYBER_FOX" onSendMessage={noop} onDiscussionEnd={noop} />;
  switch (screen) {
    case 'lobby':
      return <LobbyWaitingRoom {...theme} roomCode="K7QZ" currentUserId="me" isHost onStartGame={noop} onLeaveRoom={noop}
        players={[{ id: 'me', nickname: 'Maya', isHost: true }, { id: 'p2', nickname: 'Jordan', isHost: false }, { id: 'p3', nickname: 'Sam', isHost: false }]} />;
    case 'answer':
      return <PrivateAnswerView {...theme} roundNumber={1} roundTier="LIGHT" question={QUESTION} totalPlayers={5} answeredCount={2} onSubmitAnswer={noop} onTimeUp={noop} />;
    case 'chat':
      return chat;
    case 'vote':
      return <>{chat}<RoundVoteModal isDarkMode={isDarkMode} secondsRemaining={20} onCastVote={noop}
        candidates={ANSWERS.map(a => ({ nickname: a.authorNickname, answerSnippet: a.text }))} /></>;
    case 'reveal': {
      const won = new URLSearchParams(window.location.search).get('win') === 'humans';
      return <GameOverReveal {...theme} didHumansWin={won} aiNickname="GHOST_BYTE" mostSusHuman="NEON_VIPER" onPlayAgain={noop}
        players={[
          { nickname: 'CYBER_FOX', realName: 'Maya', isAi: false, totalVotesReceived: 1 },
          { nickname: 'NEON_VIPER', realName: 'Jordan', isAi: false, totalVotesReceived: 4 },
          { nickname: 'ECHO_01', realName: 'Sam', isAi: false, totalVotesReceived: 0 },
          { nickname: 'GHOST_BYTE', realName: '', isAi: true, totalVotesReceived: won ? 3 : 1 },
        ]}
        aiConfessionalNotes={['said plain rice cakes because nobody would fake that', 'vouched for my partner, felt rude not to']}
        talkToMission={{ partnerRealName: 'Jordan', partnerNickname: 'NEON_VIPER', sharedMoment: '“we both quit piano at 12”', openingLine: '' }} />;
    }
  }
}
