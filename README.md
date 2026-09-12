# BA GGY — Premium E-commerce

A full-stack e-commerce platform for baggy jeans, oversized tees, accessories and uppers. Denim-heavy, editorial design, MongoDB-backed with a JSON fallback for offline dev.

## Quick Start

```bash
npm install
cp .env.example .env      # then edit .env with your values
npm start                 # → http://localhost:3000
```

MongoDB must be running locally (or set `MONGO_URI`). Without Mongo the app boots in JSON-file fallback mode so the storefront still works.

## Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `MONGO_URI` | prod only | Falls back to `mongodb://localhost:27017/baggy` in dev |
| `SESSION_SECRET` | prod only | Min 32 chars; dev gets a random value |
| `ADMIN_EMAILS` | prod only | Comma-separated admin email addresses |
| `ADMIN_PASSWORD` | prod only | Min 8 chars; dev gets a random value |
| `CLOUDINARY_*` | no | Image uploads; falls back to local `/public/images` |
| `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY` | no | Enables card payments; without them only COD/JazzCash/EasyPaisa show |
| `RESEND_API_KEY` | no | Enables transactional email; without it emails are logged to the console |
| `EMAIL_FROM` | no | Verified sender for Resend (default: `onboarding@resend.dev`) |

## Scripts

| Command | What it does |
|---------|--------------|
| `npm start` | Boot the server |
| `npm test` | Run the Vitest suite (48 integration tests) |
| `npm run check` | Phase 1 + 2 unit checks (30 assertions) |
| `npm run audit` | Security audit (28 checks, incl. live header/cookie probe) |
| `npm run smoke` | Render every template to catch crashes (35 templates) |
| `npm run load` | Load-test home/shop/search (autocannon, 50 conn) |
| `npm run load:api` | Load-test search API + checkout page |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run seed` | Seed products from `seeds/productSeed.js` |
| `npm run seed:coupons` | Seed test coupons |

## Project Structure

```
abc/
├── config/          # env validation, DB connection
├── middleware/      # csrf, auth, errors, rate-limiters
├── models/          # Mongoose models (Product, Order, User, Review, …)
├── routes/          # storefront, api, cart, checkout, auth, admin, order-chat
├── services/        # productRepo, logger, email, stripe, cloudinary
├── utils/           # sanitize, helpers, password
├── scripts/         # audit, smoke, check, load-test, seed
├── tests/           # Vitest + Supertest integration tests
├── views/           # EJS templates (40 pages)
├── public/          # css, js, images, manifest, service worker
├── server.js        # app bootstrap (env → DB → sessions → routes)
├── seeds/           # product + coupon seed data
├── Dockerfile       # production image
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## Features

- **Storefront**: home, shop, category pages, product detail, search (MongoDB text index + regex fallback), wishlist
- **Cart & Checkout**: session cart, coupon validation, atomic stock decrement, COD / card / JazzCash / EasyPaisa / bank transfer
- **Payments**: Stripe Checkout (hosted) when keys are present; manual-confirm flows otherwise
- **Auth**: register, login, logout, password reset (token emailed), account lockout after 5 failed attempts, session store in MongoDB
- **Admin**: dashboard, order management, product CRUD (Cloudinary uploads), coupon management, customer contacts, newsletter, user management, order chat
- **Reviews**: star ratings, verified-purchase flag, live rating aggregation
- **Order Chat**: per-order messaging between customer and admin, email notification on admin reply
- **Email**: order confirmation, password reset, order-status updates, newsletter welcome, contact auto-reply (Resend API; degrades to console logging without a key)
- **SEO**: meta/OG tags, JSON-LD Organization, sitemap.xml, robots.txt, canonical URLs
- **PWA**: installable manifest + offline service worker (network-first pages, stale-while-revalidate assets)
- **Dark mode**: toggle in header, persisted to localStorage, respects system preference
- **Mobile**: bottom navigation bar ≤768px, sticky add-to-cart bar on product page
- **Accessibility**: skip link, focus-visible rings, aria-live regions, reduced-motion support
- **Security**: Helmet CSP, CSRF tokens, per-route rate limits, account lockout, input sanitization, fail-fast prod config
- **Performance**: gzip compression, ETags, DB indexes, deferred JS, font-display swap, hero preload

## CI

GitHub Actions runs lint → test → audit on every push to `main`.

## License

ISC