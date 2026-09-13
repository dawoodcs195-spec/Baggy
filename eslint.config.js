// ESLint flat config (required by ESLint v9+; v10 no longer reads .eslintrc.*,
// which is why `npm run lint` used to exit with a hard error).
//
// The rules below mirror the previous .eslintrc.json 1:1 so no new violations
// appear. Node's built-in globals are listed explicitly instead of pulling in
// the `globals` package — `no-undef` is the only rule that needs them, and the
// runtime target is fixed (Node 20 on Vercel/CI).
const prettier = require('eslint-config-prettier/flat');

const NODE_GLOBALS = [
  // CommonJS module scope
  'require', 'module', 'exports', '__dirname', '__filename',
  // process / environment
  'process', 'console', 'Buffer', 'global', 'globalThis',
  // timers
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'clearImmediate', 'queueMicrotask',
  // Web platform APIs exposed by Node
  'fetch', 'FormData', 'Headers', 'Request', 'Response',
  'AbortController', 'AbortSignal', 'Event', 'EventTarget',
  'MessageChannel', 'MessagePort', 'MessageEvent', 'WebSocket',
  'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  'Blob', 'File', 'ReadableStream', 'WritableStream', 'TransformStream',
  'CompressionStream', 'DecompressionStream', 'BroadcastChannel',
  'structuredClone', 'atob', 'btoa', 'performance', 'crypto', 'navigator',
  // language / standard library
  'Intl', 'Reflect', 'Proxy', 'WebAssembly',
  'Symbol', 'JSON', 'Math', 'Date', 'RegExp', 'Promise',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  'EvalError', 'URIError', 'AggregateError', 'SuppressedError',
  'Array', 'Object', 'Function', 'String', 'Number', 'Boolean', 'BigInt',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
  'BigInt64Array', 'BigUint64Array',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent',
  'escape', 'unescape', 'eval',
  'Infinity', 'NaN', 'undefined', 'arguments',
];

// vitest.config.js sets `globals: true`, so the specs use these unimported.
const TEST_GLOBALS = [
  'describe', 'it', 'test', 'expect', 'vi',
  'beforeAll', 'afterAll', 'beforeEach', 'afterEach',
  'suite', 'assert',
];

const asGlobals = (names) =>
  Object.fromEntries(names.map((name) => [name, 'readonly']));

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'public/**',
      'seeds/**',
      'coverage/**',
      'scripts/check-*.js',
      // Deliberately-invalid fixture: it reproduces the catch-only-assignment
      // shape that scripts/audit-route-scopes.js exists to detect, so the
      // undefined reads in it are the point. Run it with
      // `node scripts/audit-route-scopes.js scripts/audit-fixture.js`.
      'scripts/audit-fixture.js',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: asGlobals(NODE_GLOBALS),
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-undef': 'error',
      'no-async-promise-executor': 'error',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: asGlobals(TEST_GLOBALS) },
  },
  // Turns off rules that would fight Prettier; must stay last.
  prettier,
];
