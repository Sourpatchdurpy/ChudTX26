export interface EntryIdentity {
  /** Real first name: only revealed to the group at the end of the game. */
  realName: string;
  /** Join only; hosts get a code from the server. */
  roomCode: string;
  isHost: boolean;
}

export interface EntryScreenProps {
  onEnter: (identity: EntryIdentity) => void | Promise<void>;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  /** E.g. why the previous room closed. */
  initialError?: string;
}

export interface Player {
  id: string;
  secretNickname: string;
}

export interface LobbyPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  avatarSeed?: string;
}

export interface LobbyWaitingRoomProps {
  isDarkMode: boolean;
  onToggleTheme: () => void;
  roomCode: string;
  players: LobbyPlayer[];
  currentUserId: string;
  isHost: boolean;
  onStartGame: () => void;
  onLeaveRoom: () => void;
}

export interface RoundAnswer {
  id: string;
  authorNickname: string;
  text: string;
}

export interface DiscussionMsg {
  id: string;
  senderNickname: string;
  text: string;
  timestamp: number;
}

export interface DiscussionChatViewProps {
  isDarkMode: boolean;
  onToggleTheme: () => void;
  question: string;
  answers: RoundAnswer[];
  messages: DiscussionMsg[];
  currentUserNickname: string;
  onSendMessage?: (text: string) => void;
  onDiscussionEnd: () => void;
  initialSeconds?: number;
}

export interface PrivateAnswerViewProps {
  isDarkMode: boolean;
  onToggleTheme: () => void;
  roundNumber: number;
  roundTier: 'LIGHT' | 'PERSONAL' | 'DEEP';
  question: string;
  totalPlayers: number;
  answeredCount: number;
  initialSeconds?: number;
  onSubmitAnswer: (answer: string) => void;
  onTimeUp: () => void;
}

export interface VoteOption {
  nickname: string;
  answerSnippet: string;
}

export interface RoundVoteResult {
  eliminatedNickname: string | null;
  wasAi: boolean;
  isTie: boolean;
}

export interface RoundVoteModalProps {
  isDarkMode: boolean;
  secondsRemaining: number;
  candidates: VoteOption[];
  onCastVote: (targetNickname: string) => void;
  roundResult?: RoundVoteResult | null;
}

export interface PlayerSummary {
  nickname: string;
  realName: string;
  isAi: boolean;
  totalVotesReceived: number;
}

export interface TalkToMission {
  partnerRealName: string;
  partnerNickname: string;
  sharedMoment: string;
  openingLine: string;
}

export interface GameOverRevealProps {
  isDarkMode: boolean;
  onToggleTheme: () => void;
  didHumansWin: boolean;
  aiNickname: string;
  players: PlayerSummary[];
  mostSusHuman: string;
  aiConfessionalNotes: string[];
  talkToMission: TalkToMission;
  /** Omit to show `waitingText` instead of the button (e.g. non-hosts). */
  onPlayAgain?: () => void;
  playAgainLabel?: string;
  waitingText?: string;
}
