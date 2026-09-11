// renderPage coverage audit — parses every renderPage call site in server.js,
// extracts passed data keys via brace balancing, then renders each template
// (+layout) with renderPage's base defaults + TOLERANT STUBS for ONLY those
// keys. Any ReferenceError => real crash waiting on that route.
//
// Tolerant stubs: when a route passes `orders`, the stub for `orders` is a
// Proxy array that answers any property read with another safe stub, so
// "template iterates it" works without inventing data. Keys the route does
// NOT pass get NO stub — referencing them produces the true ReferenceError.
//
// Usage: node scripts/audit-renders.js
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const server = fs.readFileSync('server.js', 'utf8');

// ── 1) Find every renderPage(req, res, 'tpl', { ... }) call ──
const calls = [];
const re = /renderPage\(req,\s*res,\s*'([a-z0-9-]+)'\s*,\s*\{/gi;
let m;
while ((m = re.exec(server)) !== null) {
  const tpl = m[1];
  const objStart = m.index + m[0].length - 1; // index of '{'
  // brace-balance to find the matching close
  let depth = 0, end = -1, inS = null, esc = false;
  for (let i = objStart; i < server.length; i++) {
    const ch = server[i];
    if (esc) { esc = false; continue; }
    if (inS) {
      if (ch === '\\') esc = true;
      else if (ch === inS) inS = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inS = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) { console.error('UNBALANCED object for', tpl); continue; }
  const line = server.slice(0, m.index).split('\n').length;
  const objSrc = server.slice(objStart, end + 1);
  // line number where the object starts (for reporting multi-line calls)
  const objLine = server.slice(0, objStart).split('\n').length;
  calls.push({ tpl, objSrc, line, objLine });
}

// ── 2) Extract top-level keys from each object literal source ──
// Handles: shorthand `orders`, `key: value`, spread `...base`, nested objects.
function topKeys(objSrc) {
  const keys = new Set();
  const spreads = [];
  let depth = 0, inS = null, esc = false, tok = '';
  for (let i = 1; i < objSrc.length - 1; i++) { // skip outer braces
    const ch = objSrc[i];
    if (esc) { tok += ch; esc = false; continue; }
    if (inS) {
      tok += ch;
      if (ch === '\\') esc = true;
      else if (ch === inS) inS = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inS = ch; tok += ch; continue; }
    if (ch === '{' || ch === '(' || ch === '[') { depth++; tok += ch; continue; }
    if (ch === '}' || ch === ')' || ch === ']') { depth--; tok += ch; continue; }
    if (depth === 0 && ch === ',') {
      record(tok); tok = '';
      continue;
    }
    tok += ch;
  }
  record(tok);
  function record(t) {
    t = t.trim();
    if (!t) return;
    if (t.startsWith('...')) { spreads.push(t.slice(3).trim()); return; }
    const km = t.match(/^(["']?)([A-Za-z_$][\w$]*)\1\s*:/);
    if (km) { keys.add(km[2]); return; }
    // shorthand: identifier (possibly with trailing stuff like `activePage,`)
    const sm = t.match(/^([A-Za-z_$][\w$]*)$/);
    if (sm) keys.add(sm[1]);
    else {
      // something like `orderId: String(...)` handled; expressions without ':' that
      // aren't plain identifiers are ignored (rare) — flag for visibility
      const fm = t.match(/^([A-Za-z_$][\w$]*)\s*[^:]/);
      if (fm && !/^[\s\n]*$/.test(t)) keys.add('__EXPR__' + t.slice(0, 40));
    }
  }
  return { keys: [...keys], spreads };
}

// ── 3) Tolerant stub factory ──
function makeStub(name, seen = new Set()) {
  const target = function stub() {};
  const proxy = new Proxy(target, {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => `[${name}]`;
      if (prop === 'toString') return () => `[${name}]`;
      if (prop === 'valueOf') return () => 0;
      if (prop === Symbol.iterator) {
        return function* () { yield makeStub(name + '[0]', seen); };
      }
      if (prop === 'length' || prop === 'size') return 1;
      if (prop === 'then') return undefined; // not a thenable
      if (prop === 'toLocaleString' || prop === 'toFixed') return () => '0';
      if (prop === 'reduce') return (fn, init) => init;
      if (prop === 'map') return (fn) => [makeStub(name + '[0]', seen)];
      if (prop === 'filter' || prop === 'slice' || prop === 'concat') return () => [];
      if (prop === 'forEach') return (fn) => { fn(makeStub(name + '[0]', seen), 0, []); };
      if (prop === 'hasOwnProperty') return () => false;
      if (prop === 'constructor') return Object;
      if (typeof prop === 'symbol') return undefined;
      return makeStub(name + '.' + String(prop), seen);
    },
    apply() { return makeStub(name + '()', seen); },
    construct() { return makeStub('new ' + name, seen); }
  });
  return proxy;
}

// ── 4) renderPage base defaults (mirror of server.js) ──
function imgUrl(src) {
  const s = String(src || '').trim();
  if (!s) return '/public/images/placeholder.png';
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (s.startsWith('/')) return s;
  return '/public/images/' + s;
}
const BASE = (req) => ({
  year: 2026,
  assetV: 'audit',
  pageTitle: 'BA GGY — Fashion That Moves With You',
  bodyClass: '',
  category: '',
  filtered: null,
  pageCss: null,
  pageJs: null,
  cart: [],
  cartCount: 0,
  wishlist: [],
  wishlistCount: 0,
  user: null,
  csrfToken: 'audit-csrf',
  imgUrl,
  activePage: '',
  path: '/',
  query: {},
  body: '<div></div>'
});

// ── 5) Render each call's template + layout with its keys stubbed ──
const layoutSrc = fs.readFileSync('views/layout.ejs', 'utf8');
const results = [];

(async () => {
  for (const c of calls) {
    const { keys, spreads } = topKeys(c.objSrc);
    const vars = BASE();
    for (const k of keys) {
      if (k.startsWith('__EXPR__')) continue; // cannot know; tolerant render may still pass
      vars[k] = makeStub(k);
    }
    // NOTE: spreads (e.g. ...data) appear in renderPage itself, not call sites; ignore.
    let status = 'OK';
    let error = '';
    try {
      const inner = await ejs.renderFile(path.join('views', c.tpl + '.ejs'), vars, { async: true });
      await ejs.render(layoutSrc, { ...vars, body: inner }, { async: true });
    } catch (e) {
      status = /ReferenceError|is not defined/.test(e.message) ? 'CRASH' : 'WARN';
      error = e.message.split('\n')[0].slice(0, 160);
    }
    results.push({ tpl: c.tpl, line: c.objLine, keys: keys.filter(k => !k.startsWith('__EXPR__')), status, error, exprs: keys.filter(k => k.startsWith('__EXPR__')) });
  }

  // ── 6) Report ──
  const crashes = results.filter(r => r.status === 'CRASH');
  const warns = results.filter(r => r.status === 'WARN');
  console.log(`\nAudited ${results.length} renderPage call sites across ${new Set(results.map(r => r.tpl)).size} templates.\n`);
  if (crashes.length) {
    console.log('=== CRASHES (ReferenceError — will 500/crash in production) ===');
    crashes.forEach(r => console.log(`  [${r.tpl}] line ${r.line}: ${r.error}`));
  } else console.log('=== CRASHES: none ===');
  if (warns.length) {
    console.log('\n=== WARNINGS (non-Reference errors — check manually) ===');
    warns.forEach(r => console.log(`  [${r.tpl}] line ${r.line}: ${r.error}`));
  }
  console.log('\n=== Per-template summary ===');
  const byTpl = {};
  results.forEach(r => { (byTpl[r.tpl] = byTpl[r.tpl] || []).push(r.status); });
  Object.entries(byTpl).forEach(([t, sts]) => {
    const bad = sts.filter(s => s !== 'OK').length;
    console.log(`  ${t}: ${sts.length} call(s)${bad ? ` — ${bad} flagged` : ''}`);
  });
  process.exitCode = crashes.length ? 1 : 0;
})();
