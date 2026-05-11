'use strict';
/**
 * src/routes/admin.js
 * Admin-only routes (PostgreSQL version).
 *
 *   GET   /api/admin/users        → list all users
 *   PATCH /api/admin/users/:id    → update user role
 *   GET   /api/admin/audit        → recent audit log entries
 */

const { DB, txn, audit }          = require('../db');
const { getSession, requireRole } = require('../middleware/auth');
const { sendJSON, sendError, parseBody } = require('../utils');

async function handle(req, res, method, pathname) {
  const session = await getSession(req);

  // ── GET /api/admin/users ──────────────────────────────────────────────
  if (pathname === '/api/admin/users' && method === 'GET') {
    if (!requireRole(session, ['admin'], res)) return true;
    try {
      const result = await DB.query(
        'SELECT id, username, email, role, created_at, updated_at FROM users ORDER BY created_at DESC'
      );
      return sendJSON(res, { success: true, users: result.rows });
    } catch (err) {
      console.error('Users fetch error:', err);
      return sendError(res, 'Failed to fetch users.', 500);
    }
  }

  // ── PATCH /api/admin/users/:id ────────────────────────────────────────
  const userMatch = pathname.match(/^\/api\/admin\/users\/([a-z0-9\-]+)$/);
  if (userMatch && method === 'PATCH') {
    if (!requireRole(session, ['admin'], res)) return true;
    const { role } = await parseBody(req);
    const targetId = userMatch[1];

    const validRoles = ['customer', 'staff', 'admin'];
    if (!validRoles.includes(role))
      return sendError(res, `Invalid role. Must be one of: ${validRoles.join(', ')}.`, 400);

    if (targetId === session.user.id)
      return sendError(res, 'You cannot change your own role.', 400);

    try {
      await txn(async (client) => {
        await client.query(
          'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2',
          [role, targetId]
        );
        await audit(session.user.id, 'UPDATE_ROLE', 'users', targetId, { role });
      });

      return sendJSON(res, { success: true, message: `User role updated to "${role}".` });
    } catch (err) {
      console.error('User update error:', err);
      return sendError(res, 'Failed to update user role.', 500);
    }
  }

  // ── GET /api/admin/audit ──────────────────────────────────────────────
  if (pathname === '/api/admin/audit' && method === 'GET') {
    if (!requireRole(session, ['admin'], res)) return true;
    try {
      const result = await DB.query(
        'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200'
      );
      return sendJSON(res, { success: true, logs: result.rows });
    } catch (err) {
      console.error('Audit log fetch error:', err);
      return sendError(res, 'Failed to fetch audit logs.', 500);
    }
  }

  return null;
}

module.exports = { handle };
