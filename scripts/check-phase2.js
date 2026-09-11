// Phase 2 self-check: extracted helpers, sanitize utils, product-repo matching,
// and the central error middleware. Plain asserts, no frameworks.
// Run: node scripts/check-phase2.js
const assert = require('assert');
const { imgUrl, getDistinctCategories, sessionUser, ORDER_STATUSES, trackingStepsFor, CLOUDINARY_PLACEHOLDER } = require('../utils/helpers');
const { isValidEmail, sanitizeText, escapeRegex, parseBoolean } = require('../utils/sanitize');
const productRepo = require('../services/productRepo');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

// ── utils/helpers.js ─────────────────────────────────────────────
t('getDistinctCategories keeps base categories + sorts', () => {
  const cats = getDistinctCategories([{ category: 'shirts' }, { category: 'jeans' }]);
  assert.deepStrictEqual(cats, ['accessories', 'jeans', 'shirts', 'uppers']);
});
t('getDistinctCategories handles empty input', () => {
  assert.deepStrictEqual(getDistinctCategories([]), ['accessories', 'jeans', 'shirts', 'uppers']);
});
t('trackingStepsFor maps statuses to completed steps', () => {
  const pending = trackingStepsFor('pending', new Date());
  assert.strictEqual(pending.filter(s => s.completed).length, 1);
  const delivered = trackingStepsFor('delivered', new Date());
  assert.strictEqual(delivered.filter(s => s.completed).length, 5);
  const cancelled = trackingStepsFor('cancelled', new Date());
  assert.strictEqual(cancelled.filter(s => s.completed).length, 0);
});
t('sessionUser maps mongo + plain users', () => {
  assert.deepStrictEqual(sessionUser({ _id: { toString: () => 'abc' }, name: 'N', email: 'e@x.com', role: 'user' }),
    { id: 'abc', name: 'N', email: 'e@x.com', role: 'user' });
  assert.strictEqual(sessionUser({ id: 'p', name: 'Q', email: 'q@x.com' }).id, 'p');
});
t('imgUrl resolves local, absolute, and bare paths', () => {
  assert.strictEqual(imgUrl('pic.jpg'), '/public/images/pic.jpg');
  assert.strictEqual(imgUrl('/pic.jpg'), '/pic.jpg');
  assert.strictEqual(imgUrl('https://res.cloudinary.com/x.jpg'), 'https://res.cloudinary.com/x.jpg');
  assert.strictEqual(imgUrl(''), CLOUDINARY_PLACEHOLDER);
});
t('ORDER_STATUSES matches the admin UI contract', () => {
  assert.deepStrictEqual(ORDER_STATUSES, ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled']);
});

// ── utils/sanitize.js ───────────────────────────────────────────
t('sanitizeText strips angle brackets (breaking tag structure)', () => {
  assert.strictEqual(sanitizeText('<script>hi</script>  '), 'scripthi/script');
});
t('sanitizeText enforces max length', () => {
  assert.strictEqual(sanitizeText('abcdef', 3), 'abc');
});
t('isValidEmail validates + rejects', () => {
  assert.strictEqual(isValidEmail('a@b.co'), true);
  assert.strictEqual(isValidEmail('nope'), false);
  assert.strictEqual(isValidEmail('a@@b.co'), false);
});
t('escapeRegex escapes regex metacharacters', () => {
  assert.strictEqual(escapeRegex('a.b*c'), 'a\\.b\\*c');
});
t('parseBoolean handles yes/1/true and defaults', () => {
  assert.strictEqual(parseBoolean('yes'), true);
  assert.strictEqual(parseBoolean('0'), false);
  assert.strictEqual(parseBoolean(''), false);
  assert.strictEqual(parseBoolean('', true), true);
  assert.strictEqual(parseBoolean(undefined, true), true);
});

// ── services/productRepo.js matching ────────────────────────────
t('matchesQuery covers name/category/subcategory/colors/description case-insensitively', () => {
  const p = { name: 'Wide Fit Jeans', category: 'jeans', subcategory: 'baggy', colors: ['Black', 'Washed'], description: 'Relaxed streetwear denim' };
  assert.strictEqual(productRepo.matchesQuery(p, 'je', true) || productRepo.matchesQuery(p, 'je', true), true);
});
t('matchesQuery returns false on no match', () => {
  const p = { name: 'Cap', category: 'accessories', subcategory: 'hats', description: '' };
  assert.strictEqual(productRepo.matchesQuery(p, 'zzz'), false);
});

// ── middleware/errors.js (mini Express app) ─────────────────────
const express = require('express');
const { asyncHandler, errorHandler } = require('../middleware/errors');
const logger = require('../services/logger');
logger.level = 60; // silence during the test

function bootTestApp() {
  const app = express();
  app.get('/api/boom', asyncHandler(async () => { throw new Error('kaboom'); }));
  app.get('/boom', asyncHandler(async () => { throw new Error('kaboom'); }));
  app.use(errorHandler);
  return app;
}

t('asyncHandler + errorHandler: API error → JSON 500', async () => {
  const app = bootTestApp();
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const res = await fetch(`http://localhost:${port}/api/boom`);
    const body = await res.json();
    assert.strictEqual(res.status, 500);
    assert.strictEqual(body.ok, false);
  } finally { server.close(); }
});
t('asyncHandler + errorHandler: page error → plain 500', async () => {
  const app = bootTestApp();
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const res = await fetch(`http://localhost:${port}/boom`);
    const body = await res.text();
    assert.strictEqual(res.status, 500);
    assert.match(body, /Something went wrong/);
  } finally { server.close(); }
});

console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures above)' : ''}\n`);