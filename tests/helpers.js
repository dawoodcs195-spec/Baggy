// Test helpers: CSRF token management + authenticated requests.
// Delegates to tests/app.js which sets env vars before importing server.js.
const { app, ensureBooted, createClient, User, Product, Coupon } = require('./app');

/** Get a CSRF token from any agent by hitting a GET route (sets up session). */
async function getCsrf(c) {
  const res = await c.get('/');
  if (typeof res.text !== 'string') throw new Error('Expected HTML response');
  const match = res.text.match(/data-csrf="([^"]+)"/);
  if (!match) throw new Error('CSRF token not found in response');
  return match[1];
}

/** POST with CSRF header auto-attached. */
async function csrfPost(c, path, body = {}) {
  const csrf = await getCsrf(c);
  return c.post(path).set('X-CSRF-Token', csrf).send(body);
}

/** PUT with CSRF header auto-attached. */
async function csrfPut(c, path, body = {}) {
  const csrf = await getCsrf(c);
  return c.put(path).set('X-CSRF-Token', csrf).send(body);
}

/** DELETE with CSRF header auto-attached. */
async function csrfDelete(c, path, body = {}) {
  const csrf = await getCsrf(c);
  return c.delete(path).set('X-CSRF-Token', csrf).send(body);
}

/** Log in as a test user; returns the response. */
async function loginUser(c = null) {
  c = c || createClient();
  return csrfPost(c, '/api/auth/login', { email: 'tester@baggy.test', password: 'TestPass123!' });
}

/** Log in as admin. */
async function loginAdmin(c = null) {
  c = c || createClient();
  return csrfPost(c, '/api/auth/login', { email: 'admin@baggy.test', password: 'TestAdminPass123!' });
}

module.exports = {
  app,
  ensureBooted,
  createClient,
  User,
  Product,
  Coupon,
  getCsrf,
  csrfPost,
  csrfPut,
  csrfDelete,
  loginUser,
  loginAdmin,
};
