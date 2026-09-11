// Structured logging (pino). JSON in production; pretty output in development
// when pino-pretty is installed (safe fallback to plain JSON otherwise).
const pino = require('pino');

let transport;
try {
  require.resolve('pino-pretty');
  transport = { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } };
} catch { /* pino-pretty not installed — plain JSON logs */ }

module.exports = pino({ level: process.env.LOG_LEVEL || 'info', ...(transport ? { transport } : {}) });
