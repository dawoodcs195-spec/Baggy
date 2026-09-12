'use strict';
// services/email.js — transactional email.
//
// Uses Resend's HTTP API directly (https://resend.com) so the project needs no
// mail SDK. Configure with RESEND_API_KEY (+ optional EMAIL_FROM / EMAIL_REPLY_TO).
// Without a key the service degrades to a logged, non-fatal "dev" send: order and
// password flows keep working, nothing throws, and the reset link is still
// returned to the caller so the flow is testable locally.
const logger = require('./logger');

const apiKey = () => process.env.RESEND_API_KEY || '';
// Resend requires a verified domain for the from address. onboarding@resend.dev
// works out of the box for testing; set EMAIL_FROM once the domain is verified.
const fromAddress = () => process.env.EMAIL_FROM || 'BA GGY <onboarding@resend.dev>';
const replyTo = () => process.env.EMAIL_REPLY_TO || process.env.STORE_EMAIL || '';

function isConfigured() {
  return Boolean(apiKey());
}

function appUrl() {
  const configured = (process.env.APP_URL || '').replace(/\/$/, '');
  if (configured) return configured;
  return 'http://localhost:' + (process.env.PORT || 3001);
}

const C = {
  black: '#0a0a0a',
  cream: '#f5f1e8',
  creamLight: '#faf7f0',
  crimson: '#b8002f',
  gray: '#6b7280',
  line: '#e5e1d8',
};

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function money(amount, currency = '₨') {
  return currency + Number(amount || 0).toLocaleString('en-PK');
}

// Shared branded shell. Table-based so it survives Outlook/Gmail.
function shell({ heading, eyebrow, body }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:${C.cream};font-family:Helvetica,Arial,sans-serif;color:${C.black};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream};padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.creamLight};border:1px solid ${C.line};">
        <tr><td style="padding:28px 32px 18px;border-bottom:1px solid ${C.line};">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;letter-spacing:0.18em;font-weight:bold;">BA GGY</div>
        </td></tr>
        <tr><td style="padding:32px 32px 8px;">
          ${eyebrow ? `<div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.gray};margin-bottom:10px;">${escapeHtml(eyebrow)}</div>` : ''}
          <h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.15;letter-spacing:-0.02em;">${escapeHtml(heading)}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:24px 32px 32px;">
          <div style="border-top:1px solid ${C.line};padding-top:18px;font-size:12px;line-height:1.6;color:${C.gray};">
            Questions? Reply to this email or reach us at ${escapeHtml(replyTo() || 'our store inbox')}.<br />
            BA GGY — Fashion That Moves With You.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;"><tr>
    <td style="background:${C.black};">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 26px;color:${C.cream};font-size:13px;font-weight:bold;letter-spacing:0.14em;text-transform:uppercase;text-decoration:none;">${escapeHtml(label)}</a>
    </td></tr></table>`;
}

/**
 * Send one email. Never throws — callers get a result object instead, so a mail
 * outage can never fail a checkout or an order update.
 */
async function send({ to, subject, html, text, replyTo: rt }) {
  if (!to) return { ok: false, error: 'no-recipient' };
  if (!isConfigured()) {
    logger.info('[email:dev] %s → %s (set RESEND_API_KEY to send for real)', subject, to);
    return { ok: false, dev: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [to],
        subject,
        html,
        ...(text ? { text } : {}),
        ...(rt || replyTo() ? { reply_to: rt || replyTo() } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logger.error('Email send failed (%s): %s', res.status, detail.slice(0, 300));
      return { ok: false, error: 'provider-' + res.status };
    }
    const data = await res.json().catch(() => ({}));
    logger.info('Email sent: %s → %s', subject, to);
    return { ok: true, id: data.id };
  } catch (err) {
    logger.error('Email send error: %s', err.message);
    return { ok: false, error: err.message };
  }
}

// ── Templates ───────────────────────────────────────────────────

async function sendPasswordReset(user, resetUrl) {
  const absolute = resetUrl.startsWith('http') ? resetUrl : appUrl() + resetUrl;
  const html = shell({
    eyebrow: 'Password reset',
    heading: 'Reset your password',
    body: `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hi ${escapeHtml(user.name || 'there')}, we received a request to reset the password on your BA GGY account.</p>
      ${button(absolute, 'Choose a new password')}
      <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:${C.gray};">This link expires in 1 hour and can only be used once. If you didn't request it, you can safely ignore this email — your password stays the same.</p>
      <p style="margin:0;font-size:12px;line-height:1.6;color:${C.gray};word-break:break-all;">${escapeHtml(absolute)}</p>`,
  });
  return send({ to: user.email, subject: 'Reset your BA GGY password', html });
}

async function sendOrderConfirmation(order) {
  if (!order || !order.customer?.email) return { ok: false, error: 'no-order' };
  const rows = (order.items || []).map((item) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${C.line};font-size:14px;">
        ${escapeHtml(item.name)}<br /><span style="color:${C.gray};font-size:12px;">Size ${escapeHtml(item.size)} · Qty ${item.qty}</span>
      </td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid ${C.line};font-size:14px;white-space:nowrap;">${money(item.price * item.qty)}</td>
    </tr>`).join('');

  const html = shell({
    eyebrow: 'Order confirmed',
    heading: 'Thanks, ' + (order.customer.name || 'friend') + '.',
    body: `
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">We've got your order <strong>#${escapeHtml(order.orderId)}</strong> and we're on it.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
        <tr><td style="padding:10px 0;font-size:13px;color:${C.gray};">Subtotal</td><td align="right" style="padding:10px 0;font-size:13px;color:${C.gray};">${money(order.subtotal)}</td></tr>
        ${order.discount ? `<tr><td style="padding:2px 0;font-size:13px;color:${C.crimson};">Discount${order.couponCode ? ' (' + escapeHtml(order.couponCode) + ')' : ''}</td><td align="right" style="padding:2px 0;font-size:13px;color:${C.crimson};">−${money(order.discount)}</td></tr>` : ''}
        <tr><td style="padding:2px 0;font-size:13px;color:${C.gray};">Shipping</td><td align="right" style="padding:2px 0;font-size:13px;color:${C.gray};">${order.shipping ? money(order.shipping) : 'Free'}</td></tr>
        <tr><td style="padding:14px 0 0;font-size:15px;font-weight:bold;border-top:1px solid ${C.line};">Total</td><td align="right" style="padding:14px 0 0;font-size:15px;font-weight:bold;border-top:1px solid ${C.line};">${money(order.total)}</td></tr>
      </table>
      ${button(appUrl() + '/track?order_id=' + encodeURIComponent(order.orderId), 'Track this order')}
      <p style="margin:0;font-size:13px;line-height:1.6;color:${C.gray};">Shipping to: ${escapeHtml(order.customer.address)} · Payment: ${escapeHtml(String(order.payment).toUpperCase())}</p>`,
  });
  return send({ to: order.customer.email, subject: `Order #${order.orderId} confirmed — BA GGY`, html });
}

async function sendOrderStatus(order, status) {
  if (!order || !order.customer?.email) return { ok: false, error: 'no-order' };
  const copy = {
    confirmed: 'Your order is confirmed and being prepared.',
    processing: 'Your order is being packed right now.',
    shipped: 'Your order is on its way.',
    delivered: 'Your order has been delivered. Enjoy!',
    cancelled: 'Your order has been cancelled. Any payment will be refunded in full.',
    pending: 'Your order has been received and is awaiting confirmation.',
  }[status] || `Your order status changed to ${status}.`;

  const html = shell({
    eyebrow: 'Order update',
    heading: 'Order #' + order.orderId,
    body: `
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">${escapeHtml(copy)}</p>
      <p style="margin:0 0 18px;font-size:13px;color:${C.gray};line-height:1.6;">Current status: <strong style="color:${C.black};">${escapeHtml(String(status).toUpperCase())}</strong></p>
      ${button(appUrl() + '/track?order_id=' + encodeURIComponent(order.orderId), 'Track your order')}`,
  });
  return send({ to: order.customer.email, subject: `Order #${order.orderId} — ${status}`, html });
}

async function sendNewsletterWelcome(email) {
  const html = shell({
    eyebrow: 'Newsletter',
    heading: "You're on the list.",
    body: `
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Drops, restocks and early access — straight to your inbox. No noise, we promise.</p>
      ${button(appUrl() + '/shop', 'Shop the collection')}`,
  });
  return send({ to: email, subject: 'Welcome to the BA GGY list', html });
}

async function sendContactAck(contact) {
  const html = shell({
    eyebrow: 'Message received',
    heading: 'We got your message.',
    body: `
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Hi ${escapeHtml(contact.name || 'there')}, thanks for reaching out. Our team replies within one business day.</p>
      <p style="margin:0 0 8px;font-size:13px;color:${C.gray};">Your message:</p>
      <blockquote style="margin:0;padding:14px 18px;border-left:3px solid ${C.crimson};background:${C.cream};font-size:14px;line-height:1.6;">${escapeHtml(contact.message)}</blockquote>`,
  });
  return send({ to: contact.email, subject: 'We received your message — BA GGY', html });
}

module.exports = {
  isConfigured,
  send,
  appUrl,
  escapeHtml,
  money,
  sendPasswordReset,
  sendOrderConfirmation,
  sendOrderStatus,
  sendNewsletterWelcome,
  sendContactAck,
};
