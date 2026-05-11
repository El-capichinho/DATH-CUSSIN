'use strict';
/**
 * src/middleware/auth.js
 * Session resolution and role-based access control middleware (PostgreSQL version).
 */

const { DB }      = require('../db');
const { parseCookies, sendError } = require('../utils');

// ── Resolve session from cookie (async) ───────────────────────────────────
async function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const sid     = cookies['dath_session'];
  if (!sid) return null;

  try {
    const result = await DB.query(
      'SELECT * FROM sessions WHERE id = $1 AND expires_at > $2',
      [sid, Date.now()]
    );
    const row = result.rows[0];
    if (!row) return null;

    const userResult = await DB.query(
      'SELECT id, username, email, role FROM users WHERE id = $1',
      [row.user_id]
    );
    const user = userResult.rows[0];

    return user ? { sid, user } : null;
  } catch (err) {
    console.error('Session lookup error:', err);
    return null;
  }
}

// ── Require authenticated session ─────────────────────────────────────────
function requireAuth(session, res) {
  if (!session) {
    sendError(res, 'Login required.', 401);
    return false;
  }
  return true;
}

// ── Require specific role(s) ──────────────────────────────────────────────
function requireRole(session, roles, res) {
  if (!session) {
    sendError(res, 'Login required.', 401);
    return false;
  }
  if (!roles.includes(session.user.role)) {
    sendError(res, 'Unauthorized — insufficient role.', 403);
    return false;
  }
  return true;
}

module.exports = { getSession, requireAuth, requireRole };
