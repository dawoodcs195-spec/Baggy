// Phase 2 of the render audit: detect variables READ inside renderPage call
// arguments that are not reliably defined in the enclosing route handler.
//
// Crash class: `renderPage(req, res, 'tpl', { totalCoupons })` where
// `totalCoupons` is never declared in the route and only ASSIGNED inside a
// catch block — the success path then throws ReferenceError and kills the
// process (the exact admin-dashboard crash of 2026-09-11).
//
// Method: for each app.METHOD handler span, collect every identifier read in
// its renderPage argument objects, then check each against:
//   - declarations in the route (let/const/var, function params, destructuring)
//   - assignments in the route OUTSIDE catch blocks (catch-only = unsafe)
//   - module-level declarations in server.js
//   - JS builtins (Math, Date, String, ...)
'use strict';
const fs = require('fs');

const src = fs.readFileSync(process.argv[2] || 'server.js', 'utf8');
const lines = src.split('\n');

// ── JS builtins + known globals that are safe to read ──
const BUILTINS = new Set([
  'Math', 'Date', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Promise', 'Error', 'RegExp', 'Map', 'Set', 'parseInt', 'parseFloat',
  'isNaN', 'encodeURIComponent', 'decodeURIComponent', 'console', 'require',
  'module', 'exports', 'process', 'Buffer', 'undefined', 'null', 'true',
  'false', 'arguments', 'this', 'super', 'global', 'Intl', 'Symbol',
  // keywords that can appear in argument expressions
  'await', 'async', 'new', 'typeof', 'return', 'if', 'else', 'try', 'catch',
  'function', 'let', 'const', 'var', 'for', 'while'
]);
// params every Express handler has in scope
const HANDLER_PARAMS = new Set(['req', 'res', 'next']);

// ── 1) Module-level declarations (top-level let/const/var/function/class) ──
const moduleNames = new Set();
{
  // naive but effective: declarations not indented (col 0) or inside no handler
  const re = /^(?:let|const|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src)) !== null) moduleNames.add(m[1]);
  // destructured requires: const { a, b } = require(...)
  const dr = /^(?:let|const|var)\s*\{([^}]*)\}\s*=/gm;
  while ((m = dr.exec(src)) !== null) {
    m[1].split(',').forEach(p => {
      const name = p.split(':')[1] || p;
      const t = name.trim().match(/^[A-Za-z_$][\w$]*/);
      if (t) moduleNames.add(t[0]);
    });
  }
}

// ── 2) Find handler spans: app.METHOD(..., async (req, res) => { ... }) ──
function findBalanced(startIdx) {
  let depth = 0, inS = null, esc = false;
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (esc) { esc = false; continue; }
    if (inS) {
      if (ch === '\\') esc = true;
      else if (ch === inS) inS = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inS = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}
const handlers = [];
{
  const re = /app\.(get|post|put|patch|delete|use)\(/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    // find the route path string for reporting
    const rest = src.slice(m.index, m.index + 200);
    const pm = rest.match(/'([^']*)'/);
    // find first '{' that starts the handler body after the args open paren
    let i = m.index + m[0].length, parenDepth = 1;
    while (i < src.length && parenDepth > 0) {
      if (src[i] === '(') parenDepth++;
      else if (src[i] === ')') parenDepth--;
      i++;
    }
    // i-1 is the closing paren of app.METHOD(...) — skip; body brace is before it
    // rescan for the first '{' after the arrow
    let j = m.index + m[0].length;
    while (j < src.length && src[j] !== '{') j++;
    const bodyStart = j;
    const bodyEnd = findBalanced(bodyStart);
    if (bodyEnd === -1) continue;
    handlers.push({ method: m[1], route: pm ? pm[1] : '?', start: bodyStart, end: bodyEnd });
  }
}

// ── 3) catch-block spans within a source range ──
function catchSpans(from, to) {
  const spans = [];
  const re = /catch\s*(\([^)]*\))?\s*\{/g;
  let m;
  const region = src.slice(from, to);
  while ((m = re.exec(region)) !== null) {
    const bs = from + m.index + m[0].length - 1;
    const be = findBalanced(bs);
    if (be !== -1) spans.push([bs, be]);
  }
  return spans;
}
const inSpan = (idx, spans) => spans.some(([a, b]) => idx >= a && idx <= b);

// ── 4) Identifiers READ in a call-arg object source ──
function readIdents(argSrc) {
  const idents = new Set();
  // strip strings, comments
  let s = argSrc
    .replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // remove property accesses (.name) and object keys (name:)
  s = s.replace(/\.\s*[A-Za-z_$][\w$]*/g, '.');
  s = s.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1');
  const re = /[A-Za-z_$][\w$]*/g;
  let m;
  while ((m = re.exec(s)) !== null) idents.add(m[0]);
  return idents;
}

// ── 5) For each handler, check its renderPage calls ──
const problems = [];
for (const h of handlers) {    const body = src.slice(h.start, h.end);
    // include the handler signature (params like (req, res) / destructuring)
    // so param names count as declared — signature precedes the body brace
    const sigStart = src.lastIndexOf('app.', h.start);
    const sig = sigStart >= 0 ? src.slice(sigStart, h.start) : '';
    const searchable = sig + body;
    const catches = catchSpans(h.start, h.end);
  const re = /renderPage\(req,\s*res,\s*'([a-z0-9-]+)'\s*,\s*\{/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const tpl = m[1];
    const argStart = h.start + m.index + m[0].length - 1;
    // balance to close
    let depth = 0, inS = null, esc = false, end = -1;
    for (let i = argStart; i < src.length; i++) {
      const ch = src[i];
      if (esc) { esc = false; continue; }
      if (inS) { if (ch === '\\') esc = true; else if (ch === inS) inS = null; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { inS = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) continue;
    const argSrc = src.slice(argStart, end + 1);
    const argLine = src.slice(0, argStart).split('\n').length;

    const idents = readIdents(argSrc);
    for (const id of idents) {
      if (BUILTINS.has(id)) continue;
      if (HANDLER_PARAMS.has(id)) continue;
      if (moduleNames.has(id)) continue;
      // declared in handler (or signature)? declarations, arrow params, destructuring
      const declRe = new RegExp(`\\b(?:let|const|var|function)\\s+${id}\\b|\\b${id}\\s*=>|\\b(?:const|let)\\s*\\{[^}]*\\b${id}\\b`);
      const declared = declRe.test(searchable);
      // assigned outside catch?
      let assignedOutsideCatch = false, assignedOnlyInCatch = false;
      const asgRe = new RegExp(`\\b${id}\\s*=(?![=>])`, 'g');
      let am;
      while ((am = asgRe.exec(body)) !== null) {
        const abs = h.start + am.index;
        // skip arrow params / comparisons misread as assignment: require the
        // char before not be '>' or '=' (already covered) and not be a param list
        if (inSpan(abs, catches)) assignedOnlyInCatch = true;
        else { assignedOutsideCatch = true; break; }
      }
      if (declared || assignedOutsideCatch) continue;
      problems.push({
        route: h.route, tpl, line: argLine, id,
        reason: assignedOnlyInCatch
          ? 'only assigned inside catch — success path throws ReferenceError (process crash)'
          : 'never declared or assigned in handler'
      });
    }
  }
}

console.log(`Checked ${handlers.length} handlers, all renderPage arg identifiers.\n`);
if (problems.length) {
  console.log('=== UNSAFE VARIABLE READS (crash candidates) ===');
  const seen = new Set();
  problems.forEach(p => {
    const k = `${p.route}|${p.id}`;
    if (seen.has(k)) return;
    seen.add(k);
    console.log(`  /${p.route} → [${p.tpl}] line ${p.line}: \`${p.id}\` — ${p.reason}`);
  });
  process.exitCode = 1;
} else {
  console.log('=== UNSAFE READS: none — every identifier is declared or safely assigned ===');
}
