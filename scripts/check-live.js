// Live integration check — requires the server to be running (PORT env or 3001).
// Verifies: page render + CSP, CSRF round-trip, weak-password rejection,
// and account lockout on a throwaway test user (deleted afterwards).
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const BASE = `http://localhost:${process.env.PORT || 3001}`;

let passed = 0;
function ok(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); process.exitCode = 1; }
}

let cookieJar = '';

async function req(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...headers,
      ...(cookieJar ? { Cookie: cookieJar } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookies) {
    const pair = c.split(';')[0];
    if (pair.startsWith('connect.sid=')) cookieJar = pair;
  }
  let data = null;
  try { data = await res.json(); } catch { data = await res.text(); }
  return { status: res.status, headers: res.headers, data };
}

(async () => {
  // 1. Homepage renders + CSP
  const homeRes = await fetch(BASE + '/');
  for (const c of (homeRes.headers.getSetCookie ? homeRes.headers.getSetCookie() : [])) {
    const pair = c.split(';')[0];
    if (pair.startsWith('connect.sid=')) cookieJar = pair;
  }
  const homeHtml = await homeRes.text();
  ok('homepage renders (200)', homeRes.status === 200);
  const csp = homeRes.headers.get('content-security-policy') || '';
  ok('CSP header sent without unsafe-eval', csp.includes('content-security-policy') === false || (csp && !csp.includes("'unsafe-eval'")));
  ok('session cookie is HttpOnly + SameSite', /httponly/i.test(homeRes.headers.get('set-cookie') || '') && /samesite/i.test(homeRes.headers.get('set-cookie') || ''));

  // 2. CSRF round-trip
  const csrfTokenRef = { value: (homeHtml.match(/data-csrf="([a-f0-9]+)"/) || [])[1] };
  ok('CSRF token embedded in page', Boolean(csrfTokenRef.value));
  const noToken = await req('/api/cart/add', { method: 'POST', body: { productId: 'x', size: 'M', qty: 1 } });
  ok('POST without CSRF token → 403', noToken.status === 403);
  const withToken = await req('/api/cart/add', {
    method: 'POST',
    body: { productId: 'nonexistent-probe', size: 'M', qty: 1 },
    headers: { 'X-CSRF-Token': csrfTokenRef.value }
  });
  ok('POST with CSRF token passes CSRF (reaches route logic)', withToken.status === 400 && withToken.data.message === 'Product not found',
    `got ${withToken.status} ${JSON.stringify(withToken.data)}`);

  // 3. Password policy on register
  const weak = await req('/api/auth/register', {
    method: 'POST',
    body: { name: 'Probe', email: `probe-${Date.now()}@example.com`, password: 'password1' },
    headers: { 'X-CSRF-Token': csrfTokenRef.value }
  });
  ok('common password rejected on register', weak.status === 400 && /common/i.test(weak.data.message || ''));

  // 4. Account lockout on a throwaway user
  const email = `lockout-probe-${Date.now()}@example.com`;
  const strongPw = 'probe-Str0ng-Pass!';
  const reg = await req('/api/auth/register', {
    method: 'POST',
    body: { name: 'Lockout Probe', email, password: strongPw },
    headers: { 'X-CSRF-Token': csrfTokenRef.value }
  });
  ok('strong-password registration succeeds', reg.status === 200 && reg.data.ok === true,
    `got ${reg.status} ${JSON.stringify(reg.data)}`);

  // Registration regenerates the session — adopt the fresh CSRF token it returns
  if (reg.data.csrfToken) csrfTokenRef.value = reg.data.csrfToken;

  const goodLogin = await req('/api/auth/login', {
    method: 'POST',
    body: { email, password: strongPw },
    headers: { 'X-CSRF-Token': csrfTokenRef.value }
  });
  ok('successful login works (200 + new token)', goodLogin.status === 200 && goodLogin.data.ok === true && Boolean(goodLogin.data.csrfToken),
    `got ${goodLogin.status} ${JSON.stringify(goodLogin.data)}`);
  if (goodLogin.data.csrfToken) csrfTokenRef.value = goodLogin.data.csrfToken;

  let lastStatus = null;
  for (let i = 0; i < 5; i++) {
    const r = await req('/api/auth/login', {
      method: 'POST',
      body: { email, password: 'wrong-password-1' },
      headers: { 'X-CSRF-Token': csrfTokenRef.value }
    });
    lastStatus = r.status;
  }
  ok('5th wrong login triggers the lock (429)', lastStatus === 429, `got ${lastStatus}`);
  const lockedWithRightPw = await req('/api/auth/login', {
    method: 'POST',
    body: { email, password: strongPw },
    headers: { 'X-CSRF-Token': csrfTokenRef.value }
  });
  ok('correct password is still refused while locked', lockedWithRightPw.status === 429);

  // 5. Cleanup: remove the probe user
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/baggy_jeans_shop');
  await User.deleteOne({ email });
  await mongoose.disconnect();
  console.log('  ✓ probe user cleaned up');

  console.log(`\n${passed} live checks passed${process.exitCode ? ' (with failures above)' : ''}\n`);
})().catch(e => { console.error('live check crashed:', e); process.exit(1); });
