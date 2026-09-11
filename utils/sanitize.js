// Input sanitization + small validators shared by all routes.
function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function sanitizeText(value, maxLen = 2000) {
  return String(value || '').replace(/[<>]/g, '').trim().slice(0, maxLen);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

module.exports = { isValidEmail, sanitizeText, escapeRegex, parseBoolean };
