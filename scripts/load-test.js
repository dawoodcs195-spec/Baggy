'use strict';
// scripts/load-test.js — Phase 5 performance check.
//
// Hits the read-heavy endpoints (home, shop, search, product page) with a
// sustained load and reports latency + throughput. Run against a running
// server: `node scripts/load-test.js`.
const autocannon = require('autocannon');

const TARGET = process.env.TARGET || 'http://localhost:3000';
const endpoints = [
  { name: 'home',     url: TARGET + '/' },
  { name: 'shop',     url: TARGET + '/shop' },
  { name: 'search',   url: TARGET + '/search?q=baggy' },
];

async function run() {
  for (const ep of endpoints) {
    console.log('\n==  ' + ep.name + '  ==');
    const result = await autocannon({
      url: ep.url,
      connections: 50,
      duration: 12,
      headers: { 'Accept': 'text/html' },
    });
    const lat = result.latency;
    const rps = result.requests.average;
    console.log('  req/s:   ' + rps.toFixed(1));
    console.log('  avg lat: ' + lat.average.toFixed(1) + ' ms');
    console.log('  p99 lat: ' + lat.p99.toFixed(1) + ' ms');
    if (lat.p99 > 500) {
      console.log('  ⚠ p99 exceeds 500 ms — investigate');
    } else {
      console.log('  ✓ p99 within budget');
    }
  }
  console.log('\nLoad test complete.');
}

run().catch(err => { console.error(err); process.exit(1); });
