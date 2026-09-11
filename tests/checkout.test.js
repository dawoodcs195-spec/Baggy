const { csrfPost, createClient, ensureBooted, loginUser } = require('./helpers');
const Coupon = require('../models/Coupon');

let client;

beforeAll(async () => {
  await ensureBooted();
  client = createClient();
});

describe('Checkout — coupon validation', () => {
  it('validates a valid coupon', async () => {
    const res = await csrfPost(client, '/api/coupon/validate', {
      code: 'TEST10',
      subtotal: 5000,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.discount).toBe(500); // 10% of 5000
  });

    it('rejects an expired coupon', async () => {
    // EXPIRED20 is already seeded with an expiry in the past
    const res = await csrfPost(client, '/api/coupon/validate', {
      code: 'EXPIRED20',
      subtotal: 500,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or expired/i);
  });

  it('rejects a coupon below min order', async () => {
    const res = await csrfPost(client, '/api/coupon/validate', {
      code: 'TEST10',
      subtotal: 50,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/minimum/i);
  });

  it('rejects a coupon that has reached usage limit', async () => {
    const coupon = await Coupon.create({
      code: 'LIMIT5',
      type: 'fixed',
      value: 100,
      minOrder: 50,
      active: true,
      usageLimit: 5,
      usedCount: 5,
    });

    const res = await csrfPost(client, '/api/coupon/validate', {
      code: 'LIMIT5',
      subtotal: 500,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or expired/i);
    await Coupon.deleteOne({ _id: coupon._id });
  });

  it('rejects invalid coupon code format', async () => {
    const res = await csrfPost(client, '/api/coupon/validate', {
      code: 'x',
      subtotal: 500,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/valid coupon/i);
  });

});

describe('Checkout — order placement', () => {
  it('rejects checkout with empty cart', async () => {
    const c = createClient();
    await loginUser(c);
    const res = await csrfPost(c, '/api/checkout', {
      name: 'Test User',
      email: 'tester@baggy.test',
      phone: '+923001234567',
      address: '123 Test Street',
      payment: 'cod',
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cart is empty/i);
  });

  it('places a valid order with COD', async () => {
    const c = createClient();
    await loginUser(c);
    await csrfPost(c, '/api/cart/add', { productId: 'test-jeans-001', size: '32', qty: 1 });
    const res = await csrfPost(c, '/api/checkout', {
      name: 'Test User',
      email: 'tester@baggy.test',
      phone: '+923001234567',
      address: '123 Test Street',
      payment: 'cod',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.order).toBeTruthy();
    expect(res.body.redirect).toBe('/checkout/success');
  });

  it('places a valid order with coupon applied', async () => {
    const c = createClient();
    await loginUser(c);
    await csrfPost(c, '/api/cart/add', { productId: 'test-jeans-001', size: '34', qty: 2 });
    const res = await csrfPost(c, '/api/checkout', {
      name: 'Test User',
      email: 'tester@baggy.test',
      phone: '+923001234567',
      address: '123 Test Street',
      payment: 'cod',
      couponCode: 'TEST10',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.order.discount).toBeGreaterThan(0);
  });

  it('rejects checkout with insufficient stock', async () => {
    const c = createClient();
    await loginUser(c);
    // Add more than available stock (test product has 100 stock, request 101)
    await csrfPost(c, '/api/cart/add', { productId: 'test-jeans-001', size: '38', qty: 101 });
    const res = await csrfPost(c, '/api/checkout', {
      name: 'Test User',
      email: 'tester@baggy.test',
      phone: '+923001234567',
      address: '123 Test Street',
      payment: 'cod',
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/stock|insufficient|no longer/i);
  });

  it('rejects checkout with invalid payment method', async () => {
    const c = createClient();
    await loginUser(c);
    await csrfPost(c, '/api/cart/add', { productId: 'test-jeans-001', size: '32', qty: 1 });
    const res = await csrfPost(c, '/api/checkout', {
      name: 'Test User',
      email: 'tester@baggy.test',
      phone: '+923001234567',
      address: '123 Test Street',
      payment: 'bitcoin',
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid payment/i);
  });
});





