const { csrfPost, createClient, ensureBooted, loginUser } = require('./helpers');

let client;

beforeAll(async () => {
  await ensureBooted();
  client = createClient();
});

describe('Cart & Wishlist', () => {
  it('returns empty cart on fresh session', async () => {
    const c = createClient();
    const res = await c.get('/api/cart');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('adds a valid product to cart', async () => {
    const c = createClient();
    await loginUser(c);
    const res = await csrfPost(c, '/api/cart/add', {
      productId: 'test-jeans-001',
      size: '32',
      qty: 2,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.cart).toHaveLength(1);
    expect(res.body.cart[0].productId).toBe('test-jeans-001');
    expect(res.body.cart[0].qty).toBe(2);
  });

  it('accumulates same product with different size', async () => {
    const c = createClient();
    await loginUser(c);
    await csrfPost(c, '/api/cart/add', { productId: 'test-jeans-001', size: '34', qty: 1 });
    const res = await c.get('/api/cart');
    expect(res.body).toHaveLength(1);
  });

  it('accumulates qty on duplicate add (same productId + size)', async () => {
    const c = createClient();
    await loginUser(c);
    await csrfPost(c, '/api/cart/add', { productId: 'test-jeans-001', size: '32', qty: 3 });
    const res = await c.get('/api/cart');
    const item = res.body.find(i => i.productId === 'test-jeans-001' && i.size === '32');
    expect(item.qty).toBe(3);
  });

  it('rejects add with invalid quantity', async () => {
    const c = createClient();
    await loginUser(c);
    const res = await csrfPost(c, '/api/cart/add', {
      productId: 'test-jeans-001',
      size: '32',
      qty: -1,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid/i);
  });

  it('rejects add of non-existent product', async () => {
    const c = createClient();
    await loginUser(c);
    const res = await csrfPost(c, '/api/cart/add', {
      productId: 'does-not-exist',
      size: '32',
      qty: 1,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not found/i);
  });

  it('updates cart quantity', async () => {
    const c = createClient();
    await loginUser(c);
    await csrfPost(c, '/api/cart/add', { productId: 'test-jeans-001', size: '36', qty: 1 });
    const res = await csrfPost(c, '/api/cart/update', { productId: 'test-jeans-001', size: '36', qty: 5 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const item = res.body.cart.find(i => i.size === '36');
    expect(item.qty).toBe(5);
  });

  it('removes an item from cart', async () => {
    const c = createClient();
    await loginUser(c);
    await csrfPost(c, '/api/cart/add', { productId: 'test-jeans-001', size: '34', qty: 1 });
    const res = await csrfPost(c, '/api/cart/remove', { productId: 'test-jeans-001', size: '34' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const item = res.body.cart.find(i => i.size === '34');
    expect(item).toBeUndefined();
  });

  it('clears the cart', async () => {
    const c = createClient();
    await loginUser(c);
    await csrfPost(c, '/api/cart/add', { productId: 'test-jeans-001', size: '32', qty: 2 });
    const res = await csrfPost(c, '/api/cart/clear');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.cart).toEqual([]);
  });

  it('toggles wishlist: add then remove', async () => {
    const c = createClient();
    await loginUser(c);
    let res = await csrfPost(c, '/api/wishlist/toggle', { productId: 'test-jeans-001' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.wishlist).toHaveLength(1);

    res = await c.get('/api/wishlist');
    expect(res.status).toBe(200);
    const list = Array.isArray(res.body.wishlist) ? res.body.wishlist : res.body;
    expect(list).toHaveLength(1);

    res = await csrfPost(c, '/api/wishlist/toggle', { productId: 'test-jeans-001' });
    expect(res.status).toBe(200);
    expect(res.body.wishlist).toHaveLength(0);
  });

  it('rejects wishlist toggle for non-existent product', async () => {
    const c = createClient();
    await loginUser(c);
    const res = await csrfPost(c, '/api/wishlist/toggle', { productId: 'no-such-product' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not found/i);
  });
});


