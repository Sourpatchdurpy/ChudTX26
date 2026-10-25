export interface EntryIdentity {
  /** The player's real first name. It stays hidden until the reveal; the server assigns codenames at start. */
  realName: string;
  /** Empty when hosting: the server creates the code. */
  roomCode: string;
  isHost: boolean;
}

export interface EntryScreenProps {
  onEnter: (identity: EntryIdentity) => void | Promise<void>;
  isDarkMode: boolean;
  onToggleTheme: () => void;
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

export interface VoteTally {
  nickname: string;
  votes: number;
}

export interface RoundVoteModalProps {
  isDarkMode: boolean;
  secondsRemaining: number;
  candidates: VoteOption[];
  onCastVote: (targetNickname: string) => void;
  roundResult?: RoundVoteResult | null;
  /** Vote counts per codename once voting closes. Nobody leaves; only the final vote decides. */
  tally?: VoteTally[] | null;
  title?: string;
  description?: string;
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
  /** Omitted for players who wait on the host. */
  onPlayAgain?: () => void;
  playAgainLabel?: string;
  waitingLabel?: string;
  initialStep?: number;
}

export interface PairMessageView {
  id: string;
  senderNickname: string;
  text: string;
}

export interface PairChatViewProps {
  isDarkMode: boolean;
  onToggleTheme: () => void;
  card: string;
  submitPrompt: string;
  partnerNicknames: string[];
  messages: PairMessageView[];
  currentUserNickname: string;
  initialSeconds: number;
  myResult: string | null;
  onSendMessage: (text: string) => void;
  onSubmitResult: (text: string) => Promise<void>;
}

export interface PairResultMember {
  id: string;
  nickname: string;
  result: string | null;
  isMe: boolean;
}

export interface PairResultsViewProps {
  isDarkMode: boolean;
  onToggleTheme: () => void;
  card: string;
  submitPrompt: string;
  pairs: PairResultMember[][];
  initialSeconds: number;
  /** Your partners and whether you vouch for each. Omitted once vouching is closed. */
  myPartners?: { id: string; nickname: string; vouched: boolean }[];
  onSetVouch?: (targetId: string, vouched: boolean) => void;
  /** Public vouches, shown from the final vote on: "Owl vouched for Panda". */
  vouchLines?: string[];
}
