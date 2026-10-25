import type { EntryIdentity, LobbyPlayer, LocalRoom, RoundVoteResult } from '@/types/game';

const ROOM_PREFIX = 'imposter:local-room:v1:';
export const LOCAL_ROOMS_CHANGED = 'imposter:local-rooms-changed';

function validPlayer(value: unknown): value is LobbyPlayer {
  if (!value || typeof value !== 'object') return false;
  const player = value as Partial<LobbyPlayer>;
  return typeof player.id === 'string' && typeof player.nickname === 'string' && typeof player.isHost === 'boolean';
}

export function readLocalRoom(code: string): LocalRoom | null {
  const saved = localStorage.getItem(ROOM_PREFIX + code);
  if (!saved) return null;
  try {
    const room: Partial<LocalRoom> = JSON.parse(saved);
    return room?.roomCode === code && typeof room.hostId === 'string' &&
      Array.isArray(room.players) && room.players.length > 0 &&
      room.players.every(validPlayer) && room.players.some(player => player.id === room.hostId && player.isHost) &&
      (room.discussionStartedAt === undefined || (typeof room.discussionStartedAt === 'number' && Number.isFinite(room.discussionStartedAt))) &&
      (room.roundNumber === undefined || (Number.isInteger(room.roundNumber) && room.roundNumber >= 1 && room.roundNumber <= 3)) &&
      (room.roundParticipants === undefined || (Array.isArray(room.roundParticipants) && room.roundParticipants.every(validPlayer))) &&
      (room.votes === undefined || (!!room.votes && typeof room.votes === 'object' && !Array.isArray(room.votes) && Object.values(room.votes).every(target => typeof target === 'string'))) &&
      (room.voteResolvedAt === undefined || (typeof room.voteResolvedAt === 'number' && Number.isFinite(room.voteResolvedAt))) &&
      (room.roundResult == null || (typeof room.roundResult === 'object' && typeof room.roundResult.wasAi === 'boolean' && typeof room.roundResult.isTie === 'boolean' && (room.roundResult.eliminatedNickname === null || typeof room.roundResult.eliminatedNickname === 'string'))) &&
      (room.messages === undefined || (Array.isArray(room.messages) && room.messages.every(message =>
        message && typeof message.id === 'string' && typeof message.senderNickname === 'string' &&
        typeof message.text === 'string' && typeof message.timestamp === 'number' && Number.isFinite(message.timestamp))))
      ? room as LocalRoom : null;
  } catch {
    return null;
  }
}

function saveRoom(room: LocalRoom) {
  localStorage.setItem(ROOM_PREFIX + room.roomCode, JSON.stringify(room));
  window.dispatchEvent(new Event(LOCAL_ROOMS_CHANGED));
}

async function withRoomLock<T>(code: string, action: () => T): Promise<T> {
  if (navigator.locks) return navigator.locks.request(ROOM_PREFIX + code, action);
  return action();
}

/** Only creating a lobby registers a code; merely rerolling one does not. */
export async function enterLocalRoom(identity: EntryIdentity, playerId: string): Promise<LocalRoom> {
  if (!/^[A-Z0-9]{4}$/.test(identity.roomCode)) throw new Error('Enter a valid 4-character room code.');
  return withRoomLock(identity.roomCode, () => {
    const room = readLocalRoom(identity.roomCode);
    if (identity.isHost) {
      if (room) throw new Error('That room code is already in use. Reroll the code and try again.');
      const created: LocalRoom = {
        roomCode: identity.roomCode, hostId: playerId,
        players: [{ id: playerId, nickname: identity.nickname, isHost: true }], messages: [],
      };
      saveRoom(created);
      return created;
    }
    if (!room) throw new Error('Room not found. Check the code or ask your host to create the lobby first.');
    const existing = room.players.find(player => player.id === playerId);
    if (!existing && room.discussionStartedAt !== undefined) throw new Error('This game has already started. Wait for the host to open a new round.');
    if (!existing && room.players.length >= 6) throw new Error('This room is full. Ask your host for another room.');
    if (room.players.some(player => player.id !== playerId && player.nickname === identity.nickname)) {
      throw new Error('That codename is already in this room. Reroll your name and try again.');
    }
    const joined = {
      ...room,
      players: existing ? room.players : [...room.players, { id: playerId, nickname: identity.nickname, isHost: false }],
    };
    saveRoom(joined);
    return joined;
  });
}

/** One shared launch timestamp drives every joined tab's discussion and vote. */
export async function startLocalDiscussion(code: string, playerId: string): Promise<LocalRoom> {
  return withRoomLock(code, () => {
    const room = readLocalRoom(code);
    if (!room) throw new Error('This room has closed. Please create or join another lobby.');
    if (room.hostId !== playerId) throw new Error('Only the host can launch the game.');
    if (room.players.length < 3) throw new Error('At least 3 players must be connected to launch.');
    if (room.discussionStartedAt !== undefined) return room;
    const started: LocalRoom = { ...room, discussionStartedAt: Date.now(), roundNumber: 1, roundParticipants: room.players, messages: [], votes: {}, roundResult: null, voteResolvedAt: undefined };
    saveRoom(started);
    return started;
  });
}

export async function sendLocalMessage(code: string, playerId: string, text: string) {
  await withRoomLock(code, () => {
    const room = readLocalRoom(code);
    const player = room?.players.find(member => member.id === playerId);
    if (!room || !player) throw new Error('You are no longer in this room.');
    if (room.discussionStartedAt === undefined || Date.now() >= room.discussionStartedAt + 50000) {
      throw new Error('The discussion has ended.');
    }
    if (!text.trim() || text.length > 200) throw new Error('Messages must contain 1–200 characters.');
    saveRoom({ ...room, messages: [...(room.messages ?? []), {
      id: crypto.randomUUID(), senderNickname: player.nickname, text: text.trim(), timestamp: Date.now(),
    }] });
  });
}

export async function resetLocalLobby(code: string, playerId: string) {
  await withRoomLock(code, () => {
    const room = readLocalRoom(code);
    if (!room) throw new Error('This room has closed.');
    if (room.hostId !== playerId) throw new Error('Only the host can reopen the lobby.');
    saveRoom({ ...room, discussionStartedAt: undefined, roundNumber: undefined, roundParticipants: undefined, messages: [], votes: {}, roundResult: null, voteResolvedAt: undefined });
  });
}

export async function castLocalVote(code: string, playerId: string, targetNickname: string, expectedStartedAt: number) {
  await withRoomLock(code, () => {
    const room = readLocalRoom(code);
    if (!room || room.discussionStartedAt !== expectedStartedAt) throw new Error('This voting round is no longer active.');
    const participants = room.roundParticipants ?? room.players;
    const voter = participants.find(player => player.id === playerId);
    if (!voter || !room.players.some(player => player.id === playerId)) throw new Error('You are no longer in this round.');
    if (Date.now() < expectedStartedAt + 50000 || Date.now() >= expectedStartedAt + 70000 || room.roundResult) throw new Error('Voting is closed.');
    if (targetNickname === voter.nickname) throw new Error('You cannot vote for yourself.');
    if (!participants.some(player => player.nickname === targetNickname)) throw new Error('That player is not in this round.');
    if (Object.hasOwn(room.votes ?? {}, playerId)) throw new Error('Your vote is already locked.');
    saveRoom({ ...room, votes: { ...room.votes, [playerId]: targetNickname } });
  });
}

/** Local test rooms contain humans only; the server must resolve the secret AI. */
export function tallyLocalVotes(room: LocalRoom): RoundVoteResult {
  const participants = room.roundParticipants ?? room.players;
  const totals = new Map<string, number>();
  for (const [voterId, nickname] of Object.entries(room.votes ?? {})) {
    const voter = participants.find(player => player.id === voterId);
    if (voter && voter.nickname !== nickname && participants.some(player => player.nickname === nickname)) {
      totals.set(nickname, (totals.get(nickname) ?? 0) + 1);
    }
  }
  const winner = [...totals.entries()].find(([, count]) => count > participants.length / 2);
  return winner
    ? { eliminatedNickname: winner[0], wasAi: false, isTie: false }
    : { eliminatedNickname: null, wasAi: false, isTie: true };
}

export async function resolveLocalVote(code: string, playerId: string, expectedStartedAt: number) {
  return withRoomLock(code, () => {
    const room = readLocalRoom(code);
    if (!room || !room.players.some(player => player.id === playerId)) throw new Error('This room is no longer available.');
    if (room.discussionStartedAt !== expectedStartedAt || room.roundResult || Date.now() < expectedStartedAt + 70000) return room;
    const resolved = { ...room, roundResult: tallyLocalVotes(room), voteResolvedAt: expectedStartedAt + 70000 };
    saveRoom(resolved);
    return resolved;
  });
}

export async function advanceLocalRound(code: string, playerId: string, expectedStartedAt: number) {
  return withRoomLock(code, () => {
    const room = readLocalRoom(code);
    if (!room || !room.players.some(player => player.id === playerId)) throw new Error('This room is no longer available.');
    if (room.discussionStartedAt !== expectedStartedAt || !room.roundResult || room.roundResult.wasAi || room.voteResolvedAt === undefined || Date.now() < room.voteResolvedAt + 3000 || (room.roundNumber ?? 1) >= 3) return room;
    const next: LocalRoom = {
      ...room, discussionStartedAt: Date.now(), roundNumber: (room.roundNumber ?? 1) + 1,
      roundParticipants: room.players, messages: [], votes: {}, roundResult: null, voteResolvedAt: undefined,
    };
    saveRoom(next);
    return next;
  });
}

export async function leaveLocalRoom(code: string, playerId: string) {
  await withRoomLock(code, () => {
    const room = readLocalRoom(code);
    if (!room) return;
    if (room.hostId === playerId) {
      localStorage.removeItem(ROOM_PREFIX + code);
      window.dispatchEvent(new Event(LOCAL_ROOMS_CHANGED));
    } else saveRoom({ ...room, players: room.players.filter(player => player.id !== playerId) });
  });
}
