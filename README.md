<div align="center">

# BA GGY: Full-Stack Fashion E-Commerce

**A production-style online store for baggy jeans, oversized tees and accessories, built with Node.js, Express, MongoDB and server-rendered EJS.**

[**Live demo →**](https://baggy-theta.vercel.app)

[![CI](https://github.com/dawoodcs195-spec/Baggy/actions/workflows/ci.yml/badge.svg)](https://github.com/dawoodcs195-spec/Baggy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-000000?logo=vercel&logoColor=white)](https://baggy-theta.vercel.app)

![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose%208-47A248?logo=mongodb&logoColor=white)
![EJS](https://img.shields.io/badge/EJS-templates-B4CA65)
![Stripe](https://img.shields.io/badge/Stripe-Checkout-635BFF?logo=stripe&logoColor=white)
![Cloudinary](https://img.shields.io/badge/Cloudinary-images-3448C5?logo=cloudinary&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![Vitest](https://img.shields.io/badge/Tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)

</div>

---

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [API overview](#api-overview)
- [Deployment](#deployment)
- [Roadmap](#roadmap)
- [Author](#author)

## Features

**Storefront**
- Home, shop, category pages (jeans, shirts), product detail and wishlist
- Product search using a MongoDB text index, with a regex fallback
- Reviews with star ratings, a verified-purchase flag and live rating aggregation
- Order tracking page and customer order history

**Cart and checkout**
- Session-based cart with coupon validation
- Atomic stock decrement when an order is placed
- Payment options: Cash on Delivery, card (Stripe Checkout), JazzCash, EasyPaisa and bank transfer
- Stripe webhook with signature verification; the success redirect also reconciles the order if the webhook is missed
- Store prices are in PKR; card totals are converted to a Stripe-supported currency (`STRIPE_CURRENCY`, default USD)

**Accounts**
- Register, login, logout, saved addresses and password change
- Password reset by emailed token
- Passwords hashed with scrypt; password policy blocks common and weak passwords
- Account lockout after 5 failed logins (15 minutes); sessions stored in MongoDB (`connect-mongo`)

**Admin dashboard**
- Orders: list, filter, detail view, status updates, CSV export and print view
- Products: create/edit with Cloudinary image uploads, inventory and low-stock alerts
- Coupons, newsletter subscribers (export and send), customers, contact messages and store settings
- Per-order chat between customer and admin, with an email when the admin replies

**Email** (Resend HTTP API)
- Order confirmation, order-status updates, password reset, newsletter welcome and contact auto-reply
- Without an API key, emails are logged to the console so local development needs no setup

**Security**
- Helmet with a Content Security Policy, CSRF tokens, per-route rate limits and input sanitisation
- Fail-fast config check: the app refuses to start in production with missing or weak secrets

**Frontend quality**
- SEO: meta and Open Graph tags, JSON-LD, `sitemap.xml`, `robots.txt`, canonical URLs
- Installable PWA with an offline service worker
- Dark mode, mobile bottom navigation, sticky add-to-cart bar, skip link and reduced-motion support
- gzip compression, ETags, database indexes and deferred scripts

**Engineering**
- 48 integration tests with Vitest and Supertest
- GitHub Actions CI: lint, security audit, tests and a template render smoke test on every push and PR to `main`
- Multi-stage Dockerfile with a health check, plus `docker-compose.yml` with MongoDB

## Tech stack

| Layer | Technology |
| :--- | :--- |
| Runtime and server | Node.js 20, Express 4 |
| Views | EJS (server-rendered), vanilla JS, CSS |
| Database | MongoDB with Mongoose 8; sessions in `connect-mongo` |
| Payments | Stripe Checkout and webhooks (called over Stripe's REST API, no SDK) |
| Media | Cloudinary (uploads via Multer) |
| Email | Resend HTTP API |
| Security | Helmet, express-rate-limit, CSRF middleware, scrypt password hashing, password policy checks |
| Logging | Pino |
| Testing | Vitest, Supertest, autocannon (load tests) |
| Tooling | ESLint, Prettier, optional Git pre-commit hook (`npm run hooks:install`) |
| DevOps | Docker, Docker Compose, GitHub Actions, Vercel (serverless adapter in `api/index.js`) |

## Architecture

```text
Browser ──► Express app (server.js)
              ├─ middleware/   helmet · compression · rate limits · sessions · CSRF · auth
              ├─ routes/       storefront · api · cart · checkout · auth · admin · order-chat
              ├─ services/     productRepo · stripe · email (Resend) · cloudinary · logger
              ├─ models/       Mongoose: Product, Order, User, Review, Coupon, Wishlist, Newsletter, Settings
              └─ views/        EJS templates
                     │
                     ├──► MongoDB (data + sessions)
                     ├──► Stripe (Checkout + webhook)
                     ├──► Cloudinary (product images)
                     └──► Resend (transactional email)
```

```text
Baggy/
├── api/index.js         # Vercel serverless entry (boots the Express app once per warm instance)
├── config/              # env validation, DB connection
├── middleware/          # auth, csrf, errors, rate limiters
├── models/              # Mongoose models
├── routes/              # route modules
├── services/            # Stripe, email, Cloudinary, product repository, logger
├── utils/               # sanitise, helpers, password hashing
├── views/               # EJS pages and admin screens
├── public/              # CSS, JS, images, manifest, service worker
├── seeds/               # product and coupon seeds, Atlas seeding, image migration
├── scripts/             # security audit, render smoke test, checks, load tests
├── tests/               # Vitest + Supertest integration tests
├── server.js            # app bootstrap
├── Dockerfile
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## Getting started

**Prerequisites:** Node.js 20+, npm, and MongoDB (local, Docker or Atlas).

```bash
git clone https://github.com/dawoodcs195-spec/Baggy.git
cd Baggy
npm install
cp .env.example .env     # fill in your values
npm run seed             # optional: seed products
npm run seed:coupons     # optional: seed test coupons
npm run dev              # http://localhost:3000
```

Without `MONGO_URI` the app uses `mongodb://localhost:27017/baggy_jeans_shop` in development. Stripe, Cloudinary and Resend are optional: the store runs without them and falls back to non-card payments, local images and console-logged email.

**Run the tests**

```bash
npm test            # Vitest integration suite (needs MongoDB running)
npm run lint
npm run audit       # security checks
npm run smoke       # render every template
```

**Run with Docker**

```bash
cp .env.example .env
docker compose up --build    # app on :3000, MongoDB on :27017
```

## Environment variables

Copy `.env.example` to `.env`. Names only are listed here; never commit real values.

| Variable | Required | Purpose |
| :--- | :---: | :--- |
| `PORT` | No | HTTP port (default 3000) |
| `NODE_ENV` | No | `development` or `production` |
| `MONGO_URI` | Production | MongoDB connection string |
| `SESSION_SECRET` | Production | Session signing secret, 32+ characters |
| `ADMIN_EMAILS` | Production | Comma-separated admin emails |
| `ADMIN_PASSWORD` | Production | Admin bootstrap password, 10+ characters |
| `APP_URL` | No | Public base URL for email links and Stripe redirects |
| `STRIPE_SECRET_KEY` | No | Enables card payments |
| `STRIPE_PUBLISHABLE_KEY` | No | Enables card payments |
| `STRIPE_WEBHOOK_SECRET` | No | Verifies Stripe webhook signatures |
| `STRIPE_CURRENCY` | No | Card currency (default `usd`) |
| `PKR_PER_UNIT` | No | PKR to card-currency rate (default 280) |
| `CLOUDINARY_CLOUD_NAME` | No | Cloudinary image uploads |
| `CLOUDINARY_API_KEY` | No | Cloudinary image uploads |
| `CLOUDINARY_API_SECRET` | No | Cloudinary image uploads |
| `RESEND_API_KEY` | No | Sends transactional email |
| `EMAIL_FROM` | No | Verified sender address |
| `STORE_EMAIL` | No | Store inbox for notifications |
| `EMAIL_REPLY_TO` | No | Reply-to address |
| `LOG_LEVEL` | No | Pino log level |

## Scripts

| Command | What it does |
| :--- | :--- |
| `npm start` / `npm run dev` | Start the server (dev uses nodemon) |
| `npm test` | Vitest integration tests |
| `npm run test:coverage` | Tests with coverage |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run audit` | Security audit script |
| `npm run smoke` | Render every EJS template |
| `npm run check` | Phase 1 and 2 checks |
| `npm run load` / `npm run load:api` | autocannon load tests |
| `npm run seed` / `npm run seed:coupons` / `npm run seed:atlas` | Seed data |

## API overview

JSON endpoints used by the storefront and admin UI (HTML pages are served by the same app).

| Area | Endpoints |
| :--- | :--- |
| Auth | `GET /api/auth/session` · `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/logout` · `POST /api/auth/forgot-password` · `POST /api/auth/reset-password` |
| User | `POST /api/user/change-password` · `GET/POST /api/user/addresses` · `GET /api/my-orders` |
| Products | `GET /api/product/:id` · `POST /api/reviews` |
| Cart | `GET /api/cart` · `POST /api/cart/add` · `/update` · `/remove` · `/clear` |
| Wishlist | `GET /api/wishlist` · `POST /api/wishlist/toggle` · `/remove` · `/clear` |
| Checkout | `POST /api/coupon/validate` · `POST /api/checkout` · `POST /api/stripe/checkout` · `POST /api/stripe/webhook` · `GET /checkout/success` |
| Orders | `GET /api/order/:id` · `POST /api/track` · `POST /api/order-message` · `GET /api/order-message/:orderId` |
| Marketing | `POST /api/contact` · `POST /api/newsletter/subscribe` |
| Admin | `/api/admin/products` · `/coupons` · `/settings` · `/store-info` · `/reviews` · `/stock/alerts` · `/newsletter/*` · `/contact/:id` |

## Deployment

The live demo runs on **Vercel** with **MongoDB Atlas**.

1. Create an Atlas cluster and a database user, and allow access from Vercel.
2. Seed once from your machine: `npm run seed && npm run seed:coupons` (with `MONGO_URI` pointing at Atlas).
3. Import the repo in Vercel. `vercel.json` routes all requests to `api/index.js`, which boots the Express app; `/public` is served as static files.
4. Add the production environment variables above (`MONGO_URI`, `SESSION_SECRET`, `ADMIN_EMAILS`, `ADMIN_PASSWORD`, `APP_URL`, plus Stripe, Cloudinary and Resend keys if used).
5. Point a Stripe webhook at `/api/stripe/webhook` and set `STRIPE_WEBHOOK_SECRET`.

The Dockerfile also lets you run it on any container host (Render, Railway, Fly.io, a VPS).

## Roadmap

- [ ] Live JazzCash / EasyPaisa gateway integration (currently manual confirmation)
- [ ] Product variants with per-size stock
- [ ] End-to-end browser tests (Playwright)
- [ ] Admin sales analytics charts

## Author

**Muhammad Dawood**, Full-Stack Developer

- Email: [dawood.cs195@gmail.com](mailto:dawood.cs195@gmail.com)
- GitHub: [@dawoodcs195-spec](https://github.com/dawoodcs195-spec)

## License

Released under the [MIT License](LICENSE).
