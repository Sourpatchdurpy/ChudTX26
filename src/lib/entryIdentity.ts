import { NICKNAMES } from '@game/shared';

/** Same list the server uses, so a picked codename is one the server accepts (and the AI draws from). */
const CODENAMES = NICKNAMES.map(n => n.nickname);

export function generateCodename(previous = '') {
  const choices = CODENAMES.filter(name => name !== previous);
  return choices[Math.floor(Math.random() * choices.length)];
}
