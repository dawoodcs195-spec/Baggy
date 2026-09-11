// Phase 1 self-check: password policy, CSRF middleware, account lockout.
// No frameworks — plain asserts. Run: node scripts/check-phase1.js
const assert = require('assert');
const { validatePassword, passwordStrength } = require('../utils/password');
const { getCsrfToken, verifyCsrf } = require('../middleware/csrf');
const User = require('../models/User');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

// ── Password policy ──────────────────────────────────────────────
t('rejects passwords shorter than 8', () => {
  const r = validatePassword('abc1234');
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /at least 8/);
});
t('accepts a strong 8+ char password', () => {
  assert.strictEqual(validatePassword('tr0ub4dor&xyz').ok, true);
});
t('rejects the most common passwords', () => {
  for (const pw of ['password1', 'qwerty123', '1234567890', 'letmein']) {
    assert.strictEqual(validatePassword(pw).ok, false, pw);
  }
});
t('rejects repeated-character passwords', () => {
  assert.strictEqual(validatePassword('aaaaaaaa1').ok, false);
});
t('rejects keyboard-sequence passwords', () => {
  assert.strictEqual(validatePassword('qwerty123').ok, false);
});
t('strength scores: empty=0, short/weak<=1, strong=4', () => {
  assert.strictEqual(passwordStrength(''), 0);
  assert.ok(passwordStrength('aB1') <= 1);
  assert.strictEqual(passwordStrength('abcdefgh1A!x'), 4);
});

// ── CSRF middleware ──────────────────────────────────────────────
function mockReqRes(headers = {}, body = undefined, method = 'POST') {
  const store = {};
  const req = {
    method,
    session: store,
    body,
    get: h => (h.toLowerCase() === 'x-csrf-token' ? headers['x-csrf-token'] : undefined)
  };
  let statusCode = null, sent = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { sent = payload; return this; }
  };
  let nexted = false;
  const next = () => { nexted = true; };
  return { req, res, next, nexted: () => nexted, getStatus: () => statusCode };
}

t('issues a stable per-session token', () => {
  const { req } = mockReqRes({}, {}, 'GET');
  const t1 = getCsrfToken(req);
  assert.strictEqual(getCsrfToken(req), t1);
  assert.strictEqual(t1.length, 64);
});
t('accepts a matching header token', () => {
  const { req } = mockReqRes({}, {}, 'GET');
  const token = getCsrfToken(req);
  const ctx = mockReqRes({ 'x-csrf-token': token });
  ctx.req.session = req.session;
  verifyCsrf(ctx.req, ctx.res, ctx.next);
  assert.ok(ctx.nexted());
});
t('accepts a matching body token', () => {
  const { req } = mockReqRes({}, {}, 'GET');
  const token = getCsrfToken(req);
  const ctx = mockReqRes({}, { _csrf: token });
  ctx.req.session = req.session;
  verifyCsrf(ctx.req, ctx.res, ctx.next);
  assert.ok(ctx.nexted());
});
t('rejects a wrong token with 403', () => {
  const { req } = mockReqRes({}, {}, 'GET');
  getCsrfToken(req);
  const ctx = mockReqRes({ 'x-csrf-token': 'a'.repeat(64) });
  ctx.req.session = req.session;
  verifyCsrf(ctx.req, ctx.res, ctx.next);
  assert.strictEqual(ctx.getStatus(), 403);
  assert.ok(!ctx.nexted());
});
t('rejects a missing token with 403', () => {
  const ctx = mockReqRes();
  verifyCsrf(ctx.req, ctx.res, ctx.next);
  assert.strictEqual(ctx.getStatus(), 403);
});
t('skips GET requests', () => {
  const ctx = mockReqRes({}, undefined, 'GET');
  verifyCsrf(ctx.req, ctx.res, ctx.next);
  assert.ok(ctx.nexted());
});

// ── Account lockout ──────────────────────────────────────────────
function freshUser() {
  const u = new User({ name: 'T', email: 't@t.co', passwordHash: 'x', salt: 'y' });
  u.save = async () => u; // no DB needed for the logic check
  return u;
}
t('unlocked by default', () => {
  assert.strictEqual(freshUser().isLockedOut(), false);
});
(async () => {
  const u = freshUser();
  for (let i = 0; i < 5; i++) await u.registerFailedLogin();
  assert.strictEqual(u.isLockedOut(), true);
  assert.ok(u.lockedUntil > new Date());
  passed++;
  console.log('  ✓ locks after 5 failed logins');
  const u2 = freshUser();
  await u2.registerFailedLogin();
  await u2.clearLockout();
  assert.strictEqual(u2.failedAttempts, 0);
  assert.strictEqual(u2.isLockedOut(), false);
  passed++;
  console.log('  ✓ clears lockout after successful login');
  console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures above)' : ''}\n`);
})().catch(e => { console.error('  ✗ async check crashed:', e.message); process.exitCode = 1; });
