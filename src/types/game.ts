export interface EntryIdentity {
  nickname: string;
  /** Real first name: only revealed at the end of the game. */
  realName: string;
  roomCode: string;
  isHost: boolean;
}

export interface EntryScreenProps {
  onEnter: (identity: EntryIdentity) => void | Promise<void>;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  /** Shown in the existing error box, e.g. why the previous room closed. */
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

export interface LocalRoom {
  roomCode: string;
  hostId: string;
  players: LobbyPlayer[];
  discussionStartedAt?: number;
  messages?: DiscussionMsg[];
  roundNumber?: number;
  roundParticipants?: LobbyPlayer[];
  votes?: Record<string, string>;
  roundResult?: RoundVoteResult | null;
  voteResolvedAt?: number;
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
  /** Longest countdown this screen allows (default 50s); round 3's pair chat runs 90s. */
  maxSeconds?: number;
  /** Optional content under the question card (round 3: partner + result box). */
  asideExtra?: React.ReactNode;
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
  /** Rounds 1–2 result: vote counts per codename (nobody is eliminated). Shown in place of the candidates. */
  tally?: { nickname: string; votes: number }[] | null;
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
  onPlayAgain: () => void;
}
