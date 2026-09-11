// Password policy shared by register, reset, and change-password routes.
// Rules: min 8 chars, no top-common passwords, no single repeated char,
// no leading keyboard/digit sequences.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'letmein', 'welcome',
  'admin', 'admin123', 'admin1234', 'root', 'toor', 'qwerty', 'qwerty123',
  'qwertyuiop', '123456', '1234567', '12345678', '123456789', '1234567890',
  '123123', '123321', '12341234', '112233', '111111', '000000', '121212',
  '654321', '696969', 'abc123', 'abc12345', 'abcd1234', 'a1b2c3d4',
  'iloveyou', 'princess', 'monkey', 'dragon', 'sunshine', 'master',
  'football', 'baseball', 'basketball', 'soccer', 'hockey', 'cricket',
  'superman', 'batman', 'spiderman', 'starwars', 'harrypotter',
  'trustno1', 'freedom', 'whatever', 'shadow', 'michael', 'jennifer',
  'jordan', 'hunter', 'buster', 'soccer1', 'thomas', 'robert', 'bailey',
  'daniel', 'hannah', 'summer', 'ashley', 'nicole', 'chelsea', 'biteme',
  'matrix', 'mobster', 'ninja', 'azerty', 'zaq12wsx', '1q2w3e4r',
  '1q2w3e4r5t', '1qaz2wsx', 'qazwsx', 'qazwsxedc', 'asdfgh', 'zxcvbnm',
  'pakistan', 'karachi', 'lahore', 'islamabad', 'jeans', 'baggy', 'baggy123',
  'test1234', 'changeme', 'secret', 'pass1234', 'hello123', 'loveyou1'
]);

const SEQUENCE_STARTS = /^(0123|1234|2345|3456|4567|5678|6789|7890|abcd|bcde|cdef|asdf|qwer|zxcv|aaaa|bbbb)/i;

function validatePassword(password) {
  const p = String(password || '');
  if (p.length < 8) return { ok: false, message: 'Password must be at least 8 characters' };
  if (p.length > 128) return { ok: false, message: 'Password is too long' };
  if (COMMON_PASSWORDS.has(p.toLowerCase())) {
    return { ok: false, message: 'That password is too common. Please choose a more unique one.' };
  }
  if (/^(.)\1+$/.test(p)) {
    return { ok: false, message: 'That password is too repetitive. Mix in different characters.' };
  }
  if (SEQUENCE_STARTS.test(p)) {
    return { ok: false, message: 'Avoid sequences like "1234", "abcd", or "qwer" at the start of your password.' };
  }
  return { ok: true };
}

// 0-4 score for the live strength meter (client mirrors this logic).
function passwordStrength(password) {
  const p = String(password || '');
  if (!p) return 0;
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if ((/[a-z]/.test(p) && /[A-Z]/.test(p)) || (/\d/.test(p) && /[a-zA-Z]/.test(p))) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;
  return Math.min(score, 4);
}

module.exports = { validatePassword, passwordStrength };
