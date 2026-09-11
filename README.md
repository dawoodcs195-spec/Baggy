# Baggy Jeans Shop

A premium full-stack e-commerce website for baggy jeans and oversized shirts, featuring heavy animations, modern design, and secure checkout.

## Features

- **Heavy Animations**: GSAP-powered scroll animations, text splits, parallax effects
- **Premium Design**: Minimalist black/white/cream aesthetic inspired by luxury fashion brands
- **Full Product Catalog**: 7 products (4 baggy jeans, 3 oversized shirts)
- **Shopping Cart**: Real-time cart updates with add/remove/update quantity
- **Secure Checkout**: Form validation, payment method selection, order confirmation
- **Responsive Design**: Works on mobile, tablet, and desktop
- **Security Middleware**: Helmet, rate limiting, CORS, input sanitization

## Tech Stack

- **Backend**: Node.js v24, Express.js
- **Frontend**: EJS templating, vanilla JS, CSS3
- **Animation**: GSAP (GreenSock Animation Platform)
- **Security**: Helmet, Express Rate Limit, CSRF protection
- **Styling**: Custom CSS with CSS variables

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Visit: http://localhost:3000

## Project Structure

```
site/
├── public/          # Static assets
│   ├── css/         # Stylesheets
│   ├── js/          # JavaScript
│   └── images/      # Product images
├── views/           # EJS templates
├── data/            # Product data (JSON)
├── routes/          # API routes
├── server.js        # Main Express server
└── package.json     # Dependencies and scripts
```

## Product Catalog

- **Jeans**: A (Washed Indigo), B (Midnight Black), C (Light Blue Acid-Wash), D (Medium Blue Washed)
- **Shirts**: E (Acid-Wash Navy), F (Acid-Wash Burgundy), G (Acid-Wash Black)

All products feature realistic pricing, detailed descriptions, multiple images, and size options.

## Security Features

- Helmet.js for HTTP header security
- Rate limiting to prevent abuse
- Input validation and sanitization
- CORS configuration
- Secure password handling (for future auth implementation)

## Customization

- Modify products in `data/products.json`
- Adjust styles in `public/css/main.css`
- Update animations in `public/js/main.js`
- Add new routes in `server.js`

---
Built with ❤️ for premium streetwear fashion.