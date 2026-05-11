'use strict';
/**
 * src/router.js
 * Central request dispatcher.
 * Routes API calls to the appropriate handler; falls back to static files.
 */

const url = require('url');
const { sendError } = require('./utils');
const { serveStatic } = require('./middleware/static');

const authRoute = require('./routes/auth');
const menuRoute = require('./routes/menu');
const ordersRoute = require('./routes/orders');
const posRoute = require('./routes/pos');
const adminRoute = require('./routes/admin');
const reservationsRoute = require('./routes/reservations');

// Ordered list of API route handlers
const apiRoutes = [
  authRoute,
  menuRoute,
  ordersRoute,
  posRoute,
  adminRoute,
  reservationsRoute,
];

async function handle(req, res) {
  const parsed = url.parse(req.url);
  const pathname = decodeURIComponent(parsed.pathname);
  const method = req.method.toUpperCase();
  const origin = req.headers.origin || 'same-origin';
  const allowedOrigins = ['http://localhost:3000', 'http://localhost:3000/', ...(process.env.ALLOWED_ORIGINS?.split(',') || [])];

  // ── CORS preflight with origin validation ───────────────────────────────────
  if (method === 'OPTIONS') {
    const corsHeader = allowedOrigins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {};
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...corsHeader,
    });
    return res.end();
  }

  // ── API routes ────────────────────────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    try {
      for (const route of apiRoutes) {
        const result = await route.handle(req, res, method, pathname);
        if (result !== null) return; // route handled it
      }
      // No route matched
      sendError(res, `Cannot ${method} ${pathname}`, 404);
    } catch (err) {
      console.error('[Router Error]', err);
      sendError(res, 'Internal server error.', 500);
    }
    return;
  }

  // ── Static files ──────────────────────────────────────────────────────
  serveStatic(req, res, pathname);
}

module.exports = { handle };
