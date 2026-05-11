'use strict';
/**
 * src/routes/reservations.js
 * Table reservation CRUD (PostgreSQL version):
 *   GET    /api/reservations          → list all (staff/admin)
 *   GET    /api/reservations/my       → list user's reservations
 *   POST   /api/reservations          → create (customer)
 *   GET    /api/reservations/:id      → read one
 *   PATCH  /api/reservations/:id      → update status (staff/admin)
 *   DELETE /api/reservations/:id      → cancel (staff/admin or owner)
 *   GET    /api/tables                → list all tables with availability
 *   GET    /api/tables/available      → get available tables for date/time
 */

const { DB, txn, audit } = require('../db');
const { getSession, requireRole } = require('../middleware/auth');
const { sendJSON, sendError, parseBody } = require('../utils');
const crypto = require('crypto');

async function handle(req, res, method, pathname) {
  const session = await getSession(req);

  // ── GET /api/tables ─────────────────────────────────────────────────
  if (pathname === '/api/tables' && method === 'GET') {
    try {
      const result = await DB.query('SELECT * FROM tables ORDER BY table_number');
      return sendJSON(res, { success: true, tables: result.rows });
    } catch (err) {
      console.error('Tables fetch error:', err);
      return sendError(res, 'Failed to fetch tables.', 500);
    }
  }

  // ── GET /api/tables/available ───────────────────────────────────────
  if (pathname.match(/^\/api\/tables\/available$/i) && method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const date = url.searchParams.get('date');
      const time = url.searchParams.get('time');
      const guests = url.searchParams.get('guests');

      if (!date || !time || !guests) {
        return sendError(res, 'date, time, and guests are required', 400);
      }

      // Get all tables
      const tablesResult = await DB.query('SELECT * FROM tables ORDER BY capacity');
      const allTables = tablesResult.rows;

      // Get booked tables for this date/time - SQLite compatible
      const bookedResult = await DB.query(
        'SELECT table_id FROM reservations WHERE reservation_date = $1 AND status IN (\'confirmed\', \'checked-in\')',
        [date]
      );

      const bookedIds = bookedResult.rows.map(t => t.table_id);

      // Filter available tables by capacity
      const available = allTables.filter(t =>
        !bookedIds.includes(t.id) && parseInt(t.capacity) >= parseInt(guests)
      );

      return sendJSON(res, { success: true, tables: available, booked: bookedResult.rows.length });
    } catch (err) {
      console.error('Tables available error:', err);
      return sendError(res, 'Failed to fetch available tables.', 500);
    }
  }

  // ── POST /api/reservations ────────────────────────────────────────
  if (pathname === '/api/reservations' && method === 'POST') {
    if (!session) return sendError(res, 'You must be logged in', 401);

    const b = await parseBody(req);

    if (!b.table_id || !b.reservation_date || !b.reservation_time || !b.guest_count) {
      return sendError(res, 'table_id, reservation_date, reservation_time, and guest_count are required', 400);
    }

    try {
      // Validate table exists and has capacity
      const tableResult = await DB.query('SELECT * FROM tables WHERE id = $1', [b.table_id]);
      const table = tableResult.rows[0];
      if (!table) return sendError(res, 'Table not found', 404);
      if (table.capacity < parseInt(b.guest_count)) {
        return sendError(res, `Table capacity is ${table.capacity}, but you need ${b.guest_count} seats`, 400);
      }

      // Check if table is available
      const conflictingResult = await DB.query(
        'SELECT id FROM reservations WHERE table_id = $1 AND reservation_date = $2 AND status IN (\'confirmed\', \'checked-in\') LIMIT 1',
        [b.table_id, b.reservation_date]
      );

      if (conflictingResult.rows.length > 0) {
        return sendError(res, 'Table is already booked for that time', 409);
      }

      const resId = crypto.randomUUID();
      await txn(async (client) => {
        await client.query(
          'INSERT INTO reservations (id, user_id, table_id, reservation_date, reservation_time, guest_count, status, customer_name, customer_phone, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
          [
            resId,
            session.user.id,
            b.table_id,
            b.reservation_date,
            b.reservation_time,
            b.guest_count,
            'confirmed',
            b.customer_name || session.user.username,
            b.customer_phone || '',
            b.notes || ''
          ]
        );
        await audit(session.user.id, 'CREATE', 'reservations', resId, {
          table_id: b.table_id,
          date: b.reservation_date,
          guests: b.guest_count
        });
      });

      const resResult = await DB.query(
        `SELECT r.*, t.table_number, t.capacity, t.price 
         FROM reservations r 
         JOIN tables t ON r.table_id = t.id 
         WHERE r.id = $1`,
        [resId]
      );
      const reservation = resResult.rows[0];
      return sendJSON(res, { success: true, reservation }, 201);
    } catch (err) {
      console.error('Reservation create error:', err);
      return sendError(res, 'Failed to create reservation.', 500);
    }
  }

  // ── GET /api/reservations/my ────────────────────────────────────────
  if (pathname === '/api/reservations/my' && method === 'GET') {
    if (!session) return sendError(res, 'You must be logged in', 401);

    try {
      const result = await DB.query(`
        SELECT r.*, t.table_number, t.capacity, t.price
        FROM reservations r
        JOIN tables t ON r.table_id = t.id
        WHERE r.user_id = $1
        ORDER BY r.reservation_date DESC, r.reservation_time DESC
      `, [session.user.id]);

      return sendJSON(res, { success: true, reservations: result.rows });
    } catch (err) {
      console.error('My reservations fetch error:', err);
      return sendError(res, 'Failed to fetch reservations.', 500);
    }
  }

  // ── GET /api/reservations ───────────────────────────────────────────
  if (pathname === '/api/reservations' && method === 'GET') {
    if (!requireRole(session, ['admin', 'staff'], res)) return true;

    try {
      const url = new URL(req.url, 'http://localhost');
      const date = url.searchParams.get('date');

      let query = `
        SELECT r.*, t.table_number, t.capacity, t.price, u.email, u.username
        FROM reservations r
        JOIN tables t ON r.table_id = t.id
        LEFT JOIN users u ON r.user_id = u.id
      `;
      const params = [];

      if (date) {
        query += ` WHERE r.reservation_date = $1`;
        params.push(date);
      }

      query += ` ORDER BY r.reservation_date, r.reservation_time`;

      const result = await DB.query(query, params);
      return sendJSON(res, { success: true, reservations: result.rows });
    } catch (err) {
      console.error('Reservations fetch error:', err);
      return sendError(res, 'Failed to fetch reservations.', 500);
    }
  }

  // ── Routes that need an ID ──────────────────────────────────────────
  const singleMatch = pathname.match(/^\/api\/reservations\/([a-f0-9-]+)$/i);

  if (singleMatch && method === 'GET') {
    try {
      const resId = singleMatch[1];
      const result = await DB.query(`
        SELECT r.*, t.table_number, t.capacity, t.price, u.username, u.email
        FROM reservations r
        JOIN tables t ON r.table_id = t.id
        LEFT JOIN users u ON r.user_id = u.id
        WHERE r.id = $1
      `, [resId]);

      const reservation = result.rows[0];
      if (!reservation) return sendError(res, 'Reservation not found', 404);

      // Check access
      if (session && session.user.id !== reservation.user_id && !['admin', 'staff'].includes(session.user?.role)) {
        return sendError(res, 'Access denied', 403);
      }

      return sendJSON(res, { success: true, reservation });
    } catch (err) {
      console.error('Reservation fetch error:', err);
      return sendError(res, 'Failed to fetch reservation.', 500);
    }
  }

  // ── PATCH /api/reservations/:id ─────────────────────────────────────
  if (singleMatch && method === 'PATCH') {
    if (!requireRole(session, ['admin', 'staff'], res)) return true;

    try {
      const resId = singleMatch[1];
      const b = await parseBody(req);

      const resResult = await DB.query('SELECT * FROM reservations WHERE id = $1', [resId]);
      const reservation = resResult.rows[0];
      if (!reservation) return sendError(res, 'Reservation not found', 404);

      if (b.status && !['pending', 'confirmed', 'checked-in', 'completed', 'cancelled'].includes(b.status)) {
        return sendError(res, 'Invalid status', 400);
      }

      await txn(async (client) => {
        await client.query(`
          UPDATE reservations 
          SET status = $1, customer_name = $2, customer_phone = $3, notes = $4, updated_at = NOW()
          WHERE id = $5
        `, [
          b.status || reservation.status,
          b.customer_name || reservation.customer_name,
          b.customer_phone || reservation.customer_phone,
          b.notes || reservation.notes,
          resId
        ]);
        await audit(session.user.id, 'UPDATE', 'reservations', resId, { status: b.status });
      });

      const updatedResult = await DB.query(`
        SELECT r.*, t.table_number, t.capacity, t.price
        FROM reservations r
        JOIN tables t ON r.table_id = t.id
        WHERE r.id = $1
      `, [resId]);

      const updated = updatedResult.rows[0];
      return sendJSON(res, { success: true, reservation: updated });
    } catch (err) {
      console.error('Reservation update error:', err);
      return sendError(res, 'Failed to update reservation.', 500);
    }
  }

  // ── DELETE /api/reservations/:id ────────────────────────────────────
  if (singleMatch && method === 'DELETE') {
    if (!requireRole(session, ['admin', 'staff'], res)) return true;

    try {
      const resId = singleMatch[1];
      const resResult = await DB.query('SELECT * FROM reservations WHERE id = $1', [resId]);

      if (resResult.rows.length === 0) return sendError(res, 'Reservation not found', 404);

      await txn(async (client) => {
        await client.query('UPDATE reservations SET status = $1 WHERE id = $2', ['cancelled', resId]);
        await audit(session.user.id, 'DELETE', 'reservations', resId, { cancelled: true });
      });

      return sendJSON(res, { success: true, message: 'Reservation cancelled' });
    } catch (err) {
      console.error('Reservation delete error:', err);
      return sendError(res, 'Failed to cancel reservation.', 500);
    }
  }

  return sendError(res, 'Not found', 404);
}

module.exports = { handle };
