import { NICKNAMES } from '@game/shared';

// The server's list (the AI draws from it too), so a picked codename never stands out.
const CODENAMES = NICKNAMES.map(n => n.nickname);
const CODE_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateCodename(previous = '') {
  const choices = CODENAMES.filter(name => name !== previous);
  return choices[Math.floor(Math.random() * choices.length)];
}

export function generateRoomCode(previous = '') {
  const code = Array.from({ length: 4 }, () => CODE_CHARACTERS[Math.floor(Math.random() * CODE_CHARACTERS.length)]).join('');
  return code === previous
    ? code.slice(0, 3) + CODE_CHARACTERS[(CODE_CHARACTERS.indexOf(code[3]) + 1) % CODE_CHARACTERS.length]
    : code;
}
