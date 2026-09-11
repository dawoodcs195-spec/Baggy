// Single CSRF middleware.
// The token is created per session and embedded in every page (body data-csrf,
// plus hidden _csrf inputs in native forms). Clients send it as the
// X-CSRF-Token header (AJAX, auto-attached in main.js) or the _csrf body field
// (native form posts). verifyCsrf is mounted globally after the body parsers;
// multipart upload routes additionally call it after multer parses the body.
const crypto = require('crypto');

function getCsrfToken(req) {
  if (!req.session) return '';
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.get('X-CSRF-Token') || req.body?._csrf;
  const expected = req.session?.csrfToken;
  const ok = typeof token === 'string' &&
    typeof expected === 'string' &&
    token.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  if (!ok) return res.status(403).json({ ok: false, message: 'Invalid or missing CSRF token' });
  next();
}

module.exports = { getCsrfToken, verifyCsrf };
