const { ensureBooted, createClient } = require('./helpers');

let client;

beforeAll(async () => {
  await ensureBooted();
  client = createClient();
});

describe('Storefront — page rendering', () => {
  it('renders the home page', async () => {
    const res = await client.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('BA GGY');
  });

  it('renders the shop page', async () => {
    const res = await client.get('/shop');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Shop');
  });

  it('renders jeans category page', async () => {
    const res = await client.get('/jeans');
    expect(res.status).toBe(200);
  });

  it('renders shirts category page', async () => {
    const res = await client.get('/shirts');
    expect(res.status).toBe(200);
  });

  it('renders a product page', async () => {
    const res = await client.get('/product/test-jeans-001');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Test Baggy Jeans');
  });

  it('returns 404 for non-existent product', async () => {
    const res = await client.get('/product/non-existent');
    expect(res.status).toBe(404);
  });

  it('renders the search page with results', async () => {
    const res = await client.get('/search?q=jeans');
    expect(res.status).toBe(200);
  });

  it('renders the cart page', async () => {
    const res = await client.get('/cart');
    expect(res.status).toBe(200);
  });

  it('renders the 404 page for unknown routes', async () => {
    const res = await client.get('/this-does-not-exist');
    expect(res.status).toBe(404);
  });
});
