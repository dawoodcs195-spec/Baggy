// Security self-audit — Phase 1 acceptance checks.
// Static analysis of the codebase + a live probe of a running server.
// Usage: npm run audit  (exit 1 = at least one FAIL)
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const results = [];
let liveChecked = false;

function check(name, ok, detail = '') {
  results.push({ name, status: ok ? 'PASS' : 'FAIL', detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}
function warn(name, detail = '') {
  results.push({ name, status: 'WARN', detail });
  console.log(`  ⚠ ${name}${detail ? ' — ' + detail : ''}`);
}

function read(file) {
  try { return fs.readFileSync(path.join(ROOT, file), 'utf8'); } catch { return null; }
}

console.log('\n🔒 BA GGY Security Audit\n');

// ── 1. .env hygiene ──────────────────────────────────────────────
const envFile = read('.env');
const envVars = {};
if (envFile) {
  envFile.split(/\r?\n/).forEach(line => {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) envVars[m[1]] = m[2].trim();
  });
}
check('.env file exists', Boolean(envFile));
if (envFile) {
  check('SESSION_SECRET is set and 32+ chars',
    (envVars.SESSION_SECRET || '').length >= 32 && envVars.SESSION_SECRET !== 'baggy-jeans-shop-dev-secret');
  if (envVars.SESSION_SECRET === 'baggy_jeans_shop_session_secret_2024') {
    warn('SESSION_SECRET uses the repo-known value', 'fine for dev; generate a unique one before production');
  } else {
    check('SESSION_SECRET is unique', true);
  }
  check('MONGO_URI is set', Boolean(envVars.MONGO_URI));
  check('ADMIN_EMAILS is set', Boolean(envVars.ADMIN_EMAILS));
  if (!envVars.ADMIN_PASSWORD || envVars.ADMIN_PASSWORD.length < 10) {
    warn('ADMIN_PASSWORD is short/default', 'set a strong value before production');
  }
}

// ── 2. Static source checks ──────────────────────────────────────
// App source now lives in server.js + routes/*.js (Phase 2 split)
let serverSrc = read('server.js') || '';
try {
  for (const f of fs.readdirSync(path.join(ROOT, 'routes'))) {
    if (f.endsWith('.js')) serverSrc += read('routes/' + f) || '';
  }
} catch { /* routes/ missing (pre-split) */ }
const server = serverSrc;
check('Session store uses MongoDB (connect-mongo)', /MongoStore\s*\(\s*\{[\s\S]{0,200}client:/.test(server));
check('No hardcoded session fallback secret', !server.includes("SESSION_SECRET || 'baggy-jeans-shop-dev-secret'"));
check('CSP has no unsafe-eval', !server.includes("'unsafe-eval'"));
check('CSP has no scriptSrcAttr inline allowance', !server.includes('scriptSrcAttr'));
check('Global CSRF middleware mounted', /app\.use\(verifyCsrf\)/.test(server));
check('Multipart admin routes verify CSRF after multer',
  /productImageUpload\.array\('images', 5\), validateProductImages, verifyCsrf,/.test(server));
check('Session cookie flags (httpOnly/sameSite/secure)', /httpOnly: true, sameSite: 'lax', secure: env\.isProduction/.test(server));
check('Checkout route rate-limited', /app\.post\('\/api\/checkout', checkoutLimiter/.test(server));
check('Coupon validate route rate-limited', /app\.post\('\/api\/coupon\/validate', couponLimiter/.test(server));
check('Contact route rate-limited', /app\.post\('\/api\/contact', contactLimiter/.test(server));

const userModel = read('models/User.js') || '';
check('Account lockout fields + methods present',
  userModel.includes('failedAttempts') && userModel.includes('lockedUntil') &&
  userModel.includes('registerFailedLogin') && userModel.includes('isLockedOut'));
check('Login route enforces lockout', server.includes('user.isLockedOut()'));

const pwUtil = read('utils/password.js') || '';
check('Password policy module exists (min 8 + blocklist)', pwUtil.includes("p.length < 8") && pwUtil.includes('COMMON_PASSWORDS'));
check('Register/reset/change-password use password policy',
  (server.match(/validatePassword\(/g) || []).length >= 3);
check('No inline event handler attributes in views', !(() => {
  const dir = path.join(ROOT, 'views');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ejs')) continue;
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/\son(click|change|submit|load|input|error|keyup|keydown)=/i.test(content)) return true;
  }
  return false;
})());

// ── 3. Live probe (only if the server is running) ────────────────
const port = envVars.PORT || '3001';
function probe(url) {
  return new Promise(resolve => {
    const req = http.get(url, { timeout: 2000 }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

(async () => {
const home = await probe(`http://localhost:${port}/`);
if (!home) {
  warn('Live probe skipped', `server not reachable on http://localhost:${port} — start it and re-run for header checks`);
} else {
  liveChecked = true;
  const csp = home.headers['content-security-policy'] || '';
  check('[live] CSP header present', Boolean(csp));
  check('[live] CSP has no unsafe-eval', !csp.includes('unsafe-eval'));
  check('[live] X-Content-Type-Options: nosniff', home.headers['x-content-type-options'] === 'nosniff');
  check('[live] X-Frame-Options set', Boolean(home.headers['x-frame-options']));
  check('[live] X-Powered-By hidden', !home.headers['x-powered-by']);
  check('[live] Referrer-Policy set', Boolean(home.headers['referrer-policy']));
  const setCookie = (home.headers['set-cookie'] || []).find(c => c.startsWith('connect.sid')) || '';
  check('[live] Session cookie HttpOnly', /httponly/i.test(setCookie));
  check('[live] Session cookie SameSite', /samesite/i.test(setCookie));
  if (process.env.NODE_ENV === 'production') {
    check('[live] Session cookie Secure (production)', /secure/i.test(setCookie));
    check('[live] HSTS header (production)', Boolean(home.headers['strict-transport-security']));
  }
  if (csp.includes("'unsafe-inline'") && /script/i.test(csp)) {
    warn('[live] scriptSrc still allows unsafe-inline', 'inline page scripts pending move to pageJs (Phase 2/4)');
  }
  // CSRF enforcement: a state-changing request without a token must be rejected
  const csrfRejected = await new Promise(resolve => {
    const data = JSON.stringify({ productId: 'audit-probe' });
    const req = http.request(`http://localhost:${port}/api/cart/add`, {
      method: 'POST', timeout: 2000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode === 403));
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.write(data);
    req.end();
  });
  check('[live] CSRF rejects token-less POST', csrfRejected);
}

// ── Summary ──────────────────────────────────────────────────────
const fails = results.filter(r => r.status === 'FAIL');
const warns = results.filter(r => r.status === 'WARN');
console.log(`\n${results.filter(r => r.status === 'PASS').length} passed, ${warns.length} warnings, ${fails.length} failed${liveChecked ? ' (incl. live probe)' : ' (static only — start the server for live checks)'}\n`);
if (fails.length > 0) {
  fails.forEach(f => console.error(`  ✗ FAILED: ${f.name}`));
  process.exit(1);
}
})().catch(err => { console.error('audit crashed:', err); process.exit(1); });
