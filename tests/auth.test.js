const { csrfPost, createClient, ensureBooted } = require('./helpers');

let client;

beforeAll(async () => {
  await ensureBooted();
  client = createClient();
});

describe('Auth — register & login', () => {
  it('rejects weak password (common-password blocklist)', async () => {
    const res = await csrfPost(client, '/api/auth/register', {
      name: 'Weak User',
      email: 'weak@baggy.test',
      password: 'password123',
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/common|weak|strong/i);
  });

  it('rejects short password (< 8 chars)', async () => {
    const res = await csrfPost(client, '/api/auth/register', {
      name: 'Short User',
      email: 'short@baggy.test',
      password: 'Ab1!',
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/8|min/i);
  });

  it('rejects admin-reserved email during self-registration', async () => {
    const res = await csrfPost(client, '/api/auth/register', {
      name: 'Hacker',
      email: 'admin@baggy.test',
      password: 'StrongPass123!',
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/reserved/i);
  });

  it('registers a valid user and returns CSRF token', async () => {
    const res = await csrfPost(client, '/api/auth/register', {
      name: 'New User',
      email: 'newuser@baggy.test',
      password: 'StrongPass123!',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.email).toBe('newuser@baggy.test');
    expect(res.body.csrfToken).toBeTruthy();
  });

  it('rejects duplicate email registration', async () => {
    const client1 = createClient();
    const client2 = createClient();
    // Register a user first
    await csrfPost(client1, '/api/auth/register', {
      name: 'Dup User',
      email: 'dupuser@baggy.test',
      password: 'StrongPass123!',
    });

    // Try registering the same email from a different session (not logged in)
    const res = await csrfPost(client2, '/api/auth/register', {
      name: 'Dup User 2',
      email: 'dupuser@baggy.test',
      password: 'StrongPass123!',
    });
    expect(res.status).toBe(409);
  });

  it('logs in a registered user successfully', async () => {
    const res = await csrfPost(client, '/api/auth/login', {
      email: 'tester@baggy.test',
      password: 'TestPass123!',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.email).toBe('tester@baggy.test');
  });

  it('rejects login with wrong password', async () => {
    const res = await csrfPost(client, '/api/auth/login', {
      email: 'tester@baggy.test',
      password: 'WrongPassword999!',
    });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid|incorrect/i);
  });

  it('locks account after 5 failed login attempts', async () => {
    const freshClient = createClient();
    const email = 'lockable@baggy.test';
    // Register first
    await csrfPost(freshClient, '/api/auth/register', {
      name: 'Lock Me',
      email,
      password: 'StrongPass123!',
    });

    // 5 failed attempts
    for (let i = 0; i < 5; i++) {
      await csrfPost(freshClient, '/api/auth/login', { email, password: 'WrongPassword123!' });
    }

    // 6th attempt — even with correct password — should be locked
    const res = await csrfPost(freshClient, '/api/auth/login', { email, password: 'StrongPass123!' });
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/locked/i);
  });

  it('session endpoint reflects login state', async () => {
    const freshClient = createClient();
    const res = await freshClient.get('/api/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
  });
});



