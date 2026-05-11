'use strict';
/**
 * src/routes/auth.js
 * Authentication routes: login, signup, logout, me (PostgreSQL version).
 */

const { DB, txn, audit } = require('../db');
const { getSession } = require('../middleware/auth');
const {
  hashPassword, checkPassword,
  generateSessionId, generateUserId,
  sendJSON, sendError, parseBody,
  makeSessionCookie, clearSessionCookie,
} = require('../utils');
const config = require('../config');

async function handle(req, res, method, pathname) {
  const session = await getSession(req);

  // ── GET /api/auth/me ──────────────────────────────────────────────────
  if (pathname === '/api/auth/me' && method === 'GET') {
    if (!session) return sendJSON(res, { loggedIn: false });
    return sendJSON(res, { loggedIn: true, user: session.user });
  }

  // ── POST /api/auth/login ──────────────────────────────────────────────
  if (pathname === '/api/auth/login' && method === 'POST') {
    const { email, password } = await parseBody(req);

    if (!email || !password)
      return sendError(res, 'Email and password are required.', 400);

    try {
      const userResult = await DB.query('SELECT * FROM users WHERE email = $1', [email]);
      const user = userResult.rows[0];

      if (!user || !checkPassword(password, user.password_hash))
        return sendError(res, 'Invalid email or password.', 401);

      const sid = generateSessionId();
      const now = Date.now();

      await DB.query(
        'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
        [sid, user.id, now, now + config.SESSION_TTL]
      );

      await audit(user.id, 'LOGIN', 'users', user.id, { email });

      return sendJSON(res,
        { success: true, user: { id: user.id, username: user.username, email: user.email, role: user.role } },
        200,
        { 'Set-Cookie': makeSessionCookie(sid) }
      );
    } catch (err) {
      console.error('Login error:', err);
      return sendError(res, 'Login failed.', 500);
    }
  }

  // ── POST /api/auth/signup ─────────────────────────────────────────────
  if (pathname === '/api/auth/signup' && method === 'POST') {
    const { username, email, password } = await parseBody(req);

    if (!username || !email || !password)
      return sendError(res, 'All fields are required.', 400);
    if (password.length < 10)
      return sendError(res, 'Password must be at least 10 characters.', 400);

    try {
      const existingResult = await DB.query(
        'SELECT id FROM users WHERE email = $1 OR username = $2',
        [email, username]
      );

      if (existingResult.rows.length > 0)
        return sendError(res, 'Email or username is already taken.', 409);

      const uid = generateUserId();

      await txn(async (client) => {
        await client.query(
          'INSERT INTO users (id, username, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
          [uid, username, email, hashPassword(password), 'customer']
        );
        await audit(uid, 'SIGNUP', 'users', uid, { username, email });
      });

      const sid = generateSessionId();
      const now = Date.now();
      await DB.query(
        'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
        [sid, uid, now, now + config.SESSION_TTL]
      );

      return sendJSON(res,
        { success: true, user: { id: uid, username, email, role: 'customer' } },
        201,
        { 'Set-Cookie': makeSessionCookie(sid) }
      );
    } catch (err) {
      console.error('Signup error:', err);
      return sendError(res, 'Could not create account. Please try again.', 500);
    }
  }

  // ── POST /api/auth/logout ─────────────────────────────────────────────
  if (pathname === '/api/auth/logout' && method === 'POST') {
    if (session) {
      try {
        await DB.query('DELETE FROM sessions WHERE id = $1', [session.sid]);
        await audit(session.user.id, 'LOGOUT', 'sessions', session.sid, {});
      } catch (err) {
        console.error('Logout error:', err);
      }
    }
    return sendJSON(res, { success: true }, 200, { 'Set-Cookie': clearSessionCookie() });
  }

  return null; // not handled
}

module.exports = { handle };
