// Fixture for audit-route-scopes.js — reproduces the 2026-09-11 admin-dashboard
// crash pattern: variables assigned ONLY inside catch, then read in renderPage
// args on the success path. Expect: 2 unsafe reads (totalCoupons, activeCoupons).
const express = require('express');
const app = express();

app.get('/admin-broken', async (req, res) => {
  let totalOrders = 0;
  try {
    totalOrders = await Promise.resolve(5);
  } catch (err) {
    console.error(err.message);
    totalCoupons = 0;
    activeCoupons = 0;
  }
  renderPage(req, res, 'admin-index', {
    totalOrders,
    totalCoupons,
    activeCoupons
  });
});

app.get('/admin-good', async (req, res) => {
  let totalCoupons = 0;
  try {
    totalCoupons = await Promise.resolve(3);
  } catch (err) {
    console.error(err.message);
    totalCoupons = 0;
  }
  renderPage(req, res, 'admin-index', {
    totalCoupons
  });
});
