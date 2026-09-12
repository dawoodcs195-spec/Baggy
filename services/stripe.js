'use strict';
// services/stripe.js — card payments over Stripe's REST API.
//
// No SDK dependency: the three calls this store needs (create a Checkout
// Session, retrieve one, verify a webhook signature) are a form POST, a GET and
// one HMAC, so we speak the API directly.
//
// CURRENCY NOTE — Stripe does not process PKR (Pakistan is not a supported
// Stripe country). The store prices in rupees, so card checkout converts to
// STRIPE_CURRENCY (default USD) at PKR_PER_UNIT rupees per unit, purely for the
// Stripe test gateway. COD / JazzCash / EasyPaisa keep charging rupees directly.
const crypto = require('crypto');
const logger = require('./logger');

const API = 'https://api.stripe.com/v1';
const API_VERSION = '2024-06-20';

const secretKey = () => process.env.STRIPE_SECRET_KEY || '';
const publishableKey = () => process.env.STRIPE_PUBLISHABLE_KEY || '';
const webhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET || '';
const currency = () => (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();
const pkrPerUnit = () => Number(process.env.PKR_PER_UNIT) > 0 ? Number(process.env.PKR_PER_UNIT) : 280;

function isConfigured() {
  return Boolean(secretKey() && publishableKey());
}

// Rupees → smallest currency unit (cents) for the Stripe gateway.
function toStripeAmount(pkr) {
  return Math.max(0, Math.round((Number(pkr) || 0) / pkrPerUnit() * 100));
}

// Stripe expects application/x-www-form-urlencoded with nested bracket keys.
function encodeForm(params) {
  const parts = [];
  const walk = (value, prefix) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((entry, i) => walk(entry, `${prefix}[${i}]`));
      return;
    }
    if (typeof value === 'object') {
      Object.keys(value).forEach((key) => walk(value[key], prefix ? `${prefix}[${key}]` : key));
      return;
    }
    parts.push(encodeURIComponent(prefix) + '=' + encodeURIComponent(String(value)));
  };
  walk(params, '');
  return parts.join('&');
}

async function request(path, params = {}, method = 'POST') {
  if (!secretKey()) throw new Error('Stripe is not configured');
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + secretKey(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': API_VERSION,
    },
    ...(method === 'GET' ? {} : { body: encodeForm(params) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data && data.error ? data.error.message : `Stripe request failed (${res.status})`;
    logger.error('Stripe %s %s: %s', method, path, message);
    throw new Error(message);
  }
  return data;
}

/**
 * Create a hosted Checkout Session for an order.
 * Items are rebuilt from the catalog by the caller — never from the browser.
 */
async function createCheckoutSession({ orderId, items, shipping = 0, discount = 0, customerEmail, successUrl, cancelUrl, metadata = {} }) {
  // Object (not array) so encodeForm turns this into line_items[0][quantity]=…
  const lineItems = {};
  items.forEach((item, i) => {
    lineItems[i] = {
      quantity: item.qty,
      price_data: {
        currency: currency(),
        unit_amount: toStripeAmount(item.price),
        product_data: { name: item.name, metadata: { productId: item.productId || '' } },
      },
    };
  });

  // Shipping is a line item so it shows up in the Stripe receipt total.
  if (shipping > 0) {
    lineItems[items.length] = {
      quantity: 1,
      price_data: {
        currency: currency(),
        unit_amount: toStripeAmount(shipping),
        product_data: { name: 'Shipping' },
      },
    };
  }

  const params = {
    mode: 'payment',
    client_reference_id: orderId,
    success_url: successUrl,
    cancel_url: cancelUrl,
    ...(customerEmail ? { customer_email: customerEmail } : {}),
    metadata: { orderId, ...metadata },
    line_items: lineItems,
  };

  // A store coupon becomes a one-off Stripe coupon (amount_off) for this session.
  if (discount > 0) {
    const coupon = await request('/coupons', {
      amount_off: toStripeAmount(discount),
      currency: currency(),
      duration: 'once',
      name: 'Store discount',
      metadata: { orderId },
    });
    params.discounts = [{ coupon: coupon.id }];
  }

  return request('/checkout/sessions', params);
}

function retrieveCheckoutSession(sessionId) {
  return request('/checkout/sessions/' + encodeURIComponent(sessionId), {}, 'GET');
}

/**
 * Verify a Stripe webhook signature.
 * @returns {object|null} the parsed event, or null when the signature is bad.
 */
function verifyWebhook(rawBody, signatureHeader) {
  const secret = webhookSecret();
  if (!secret) return null;
  const header = String(signatureHeader || '');
  const parts = header.split(',').reduce((acc, piece) => {
    const [k, v] = piece.split('=');
    if (k === 't') acc.timestamp = v;
    if (k === 'v1') (acc.signatures = acc.signatures || []).push(v);
    return acc;
  }, {});
  if (!parts.timestamp || !parts.signatures) return null;

  // Reject events older than 5 minutes (replay protection).
  const age = Math.abs(Date.now() / 1000 - Number(parts.timestamp));
  if (!Number.isFinite(age) || age > 300) return null;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(parts.timestamp + '.' + rawBody)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const match = parts.signatures.some((sig) => {
    const sigBuf = Buffer.from(String(sig), 'utf8');
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
  if (!match) return null;

  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

module.exports = {
  isConfigured,
  publishableKey,
  currency,
  toStripeAmount,
  createCheckoutSession,
  retrieveCheckoutSession,
  verifyWebhook,
  encodeForm,
};
