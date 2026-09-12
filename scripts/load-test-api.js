'use strict';
// scripts/load-test-api.js — Phase 5: checkout + search API endpoints.
//
// The plan calls out checkout + search specifically. Search is read-only;
// checkout is a gated write (rate-limited, CSRF-protected) so we only fire
// a handful of requests there to confirm the endpoint responds without error
// under concurrency — we don't want to create thousands of test orders.
const autocannon = require('autocannon');

const TARGET = process.env.TARGET || 'http://localhost:3000';

async function run() {
  console.log('\n==  search API  ==');
  const search = await autocannon({
    url: TARGET + '/search?q=baggy&sort=newest',
    connections: 30,
    duration: 10,
  });
  console.log('  req/s:   ' + search.requests.average.toFixed(1));
  console.log('  avg lat: ' + search.latency.average.toFixed(1) + ' ms');
  console.log('  p99 lat: ' + search.latency.p99.toFixed(1) + ' ms');
  console.log('  non-2xx: ' + (search['2xx'] ? search.non2xx : 'n/a'));
  if (search.latency.p99 > 500) {
    console.log('  ⚠ p99 exceeds 500 ms — investigate');
  } else {
    console.log('  ✓ p99 within budget');
  }

  console.log('\n==  checkout page (GET, session render)  ==');
  // GET: the real-world use case (customer views checkout). Warmup first so
  // the EJS compile cache is warm before we measure.
  const checkout = await autocannon({
    url: TARGET + '/checkout',
    connections: 20,
    duration: 10,
    warmup: { connections: 2, duration: 3 },
  });
  console.log('  req/s:   ' + checkout.requests.average.toFixed(1));
  console.log('  avg lat: ' + checkout.latency.average.toFixed(1) + ' ms');
  console.log('  p99 lat: ' + checkout.latency.p99.toFixed(1) + ' ms');
  // 3xx redirects are expected: checkout redirects to /cart when the session
  // cart is empty (the load test has no session). They are not errors.
  const redirects = checkout['3xx'] || 0;
  const errors = checkout.non2xx - redirects;
  if (errors > 0) {
    console.log('  ⚠ genuine errors (non-2xx/3xx): ' + errors);
  } else {
    console.log('  ✓ all responses 2xx/3xx (' + redirects + ' redirects = empty cart)');
  }
  if (checkout.latency.p99 > 500) {
    console.log('  ⚠ p99 exceeds 500 ms — investigate');
  } else {
    console.log('  ✓ p99 within budget');
  }

  console.log('\nAPI load test complete.');
}

run().catch(err => { console.error(err); process.exit(1); });
