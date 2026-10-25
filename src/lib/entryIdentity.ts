const CODENAMES = ['CYBER_FOX', 'NEON_VIPER', 'ECHO_01', 'GHOST_BYTE', 'CIPHER_99'];
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
