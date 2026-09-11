const { createClient, ensureBooted, loginAdmin, loginUser, csrfPost } = require('./helpers');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');

beforeAll(async () => {
  await ensureBooted();
});

describe('Admin — access control', () => {
    it('blocks non-logged-in users from /admin', async () => {
    const c = createClient();
    const res = await c.get('/admin');
    // Admin guard returns 403 but renders the 404 page
    expect(res.status).toBe(403);
  });

  it('blocks regular users from /admin', async () => {
    const c = createClient();
    await loginUser(c);
    const res = await c.get('/admin');
    expect(res.status).toBe(403);
  });

  it('blocks regular users from admin API endpoints', async () => {
    const c = createClient();
    await loginUser(c);
    const res = await c.get('/api/admin/product/test-jeans-001');
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
  });
});

describe('Admin — dashboard', () => {
  it('allows admin to view the dashboard', async () => {
    const c = createClient();
    await loginAdmin(c);
    const res = await c.get('/admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('BA GGY');
  });
});

describe('Admin — product API', () => {
  it('returns 404 for non-existent product', async () => {
    const c = createClient();
    await loginAdmin(c);
    const res = await c.get('/api/admin/product/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('returns product details for existing product', async () => {
    const c = createClient();
    await loginAdmin(c);
    const res = await c.get('/api/admin/product/test-jeans-001');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('test-jeans-001');
    expect(res.body.name).toBe('Test Baggy Jeans');
  });
});

describe('Admin — coupon management', () => {
  afterEach(async () => {
    await Coupon.deleteOne({ code: 'TEST-ADMIN' });
  });

  it('allows admin to create a coupon', async () => {
    const c = createClient();
    await loginAdmin(c);
    const res = await csrfPost(c, '/api/admin/coupons', {
      code: 'TEST-ADMIN',
      type: 'percent',
      value: 15,
      minOrder: 100,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.coupon.code).toBe('TEST-ADMIN');
  });

  it('rejects duplicate coupon code', async () => {
    const c = createClient();
    await loginAdmin(c);
    await csrfPost(c, '/api/admin/coupons', {
      code: 'DUP-COUPON',
      type: 'fixed',
      value: 100,
      minOrder: 50,
    });

    const res = await csrfPost(c, '/api/admin/coupons', {
      code: 'DUP-COUPON',
      type: 'fixed',
      value: 200,
      minOrder: 100,
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already exists/i);
    await Coupon.deleteOne({ code: 'DUP-COUPON' });
  });

  it('rejects admin non-admin from creating coupons', async () => {
    const c = createClient();
    await loginUser(c);
    const res = await csrfPost(c, '/api/admin/coupons', {
      code: 'HACKER-COUPON',
      type: 'fixed',
      value: 100,
      minOrder: 50,
    });
    expect(res.status).toBe(403);
  });
});
