'use strict';
/**
 * DATH CUSSIN – Main Entry Point
 * ─────────────────────────────────────────────────────────────────────────────
 * Run:  node --experimental-sqlite server.js
 * URL:  http://localhost:3000
 * ─────────────────────────────────────────────────────────────────────────────
 */

const http   = require('http');
const path   = require('path');
const config = require('./src/config');
const db     = require('./src/db');
const router = require('./src/router');

// ── Create HTTP server ────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  router.handle(req, res);
});

// ── Start ─────────────────────────────────────────────────────────────────
server.listen(config.PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║            🍽  DATH CUSSIN  SERVER               ║
╠══════════════════════════════════════════════════╣
║  URL      →  http://localhost:${config.PORT}              ║
║  Database →  ${config.DB_PATH.padEnd(35)}║
║  Env      →  ${config.NODE_ENV.padEnd(35)}║
╠══════════════════════════════════════════════════╣
║  Pages                                           ║
║    /                  Login  (customers)          ║
║    /pages/home.html   Menu   (customers)          ║
║    /pages/cart.html   Cart   (customers)          ║
║    /pos/              POS    (staff / admin)       ║
╠══════════════════════════════════════════════════╣
║  Demo Accounts                                   ║
║    admin@dathcussin.com  /  admin1234             ║
║    cook@gmail.com        /  cook1234              ║
╚══════════════════════════════════════════════════╝
`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────
process.on('SIGINT',  () => { db.close(); server.close(); process.exit(0); });
process.on('SIGTERM', () => { db.close(); server.close(); process.exit(0); });
