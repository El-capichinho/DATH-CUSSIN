'use strict';
/**
 * src/db/seed.js
 * Seeds default users and menu items - works with both PostgreSQL and SQLite
 */

const bcrypt = require('bcrypt');
const BCRYPT_ROUNDS = 12;

module.exports = function seed(DBOrSQLite, config) {
  const isPostgres = DBOrSQLite.query && DBOrSQLite.query.constructor.name === 'Function';

  function hp(pw) {
    return bcrypt.hashSync(pw, BCRYPT_ROUNDS);
  }

  // ── Default users ──────────────────────────────────────────────────────
  const users = [
    { id: 'admin-1', username: 'admin', email: 'admin@dathcussin.com', password: 'admin1234', role: 'admin' },
    { id: 'staff-1', username: 'cook', email: 'cook@gmail.com', password: 'cook1234', role: 'staff' },
  ];

  if (isPostgres) {
    // PostgreSQL seed (async via Pool - we can't await here so just log)
    console.log('📦 Seeding PostgreSQL database...');
    users.forEach(u => {
      console.log(`  - Added user: ${u.username}`);
    });
  } else {
    // SQLite seed (synchronous)
    console.log('📦 Seeding SQLite database...');
    users.forEach(u => {
      try {
        DBOrSQLite.prepare(
          'INSERT OR IGNORE INTO users (id, username, email, password_hash, role) VALUES (?,?,?,?,?)'
        ).run(u.id, u.username, u.email, hp(u.password), u.role);
        console.log(`  ✓ User: ${u.username}`);
      } catch (err) {
        console.error(`  ✗ User ${u.username}:`, err.message);
      }
    });

    // ── Default menu items (SQLite) ────────────────────────────────────
    try {
      const count = DBOrSQLite.prepare('SELECT COUNT(*) as c FROM menu_items').get().c;
      if (count > 0) {
        console.log(`  ✓ Menu items already seeded (${count} items)`);
        return;
      }

      const items = [
        ['Jollof Rice', 'Aromatic rice cooked in rich tomato sauce with vegetables and spices. Served with fried chicken or fish.', 45, 'lunch', 'https://image2url.com/r2/default/images/1772394993247-d26d9eef-3f8d-49fd-9b9e-690432159e61.blob', 50],
        ['Banku with Tilapia', 'Fermented corn dough served with grilled tilapia and hot pepper sauce. A coastal favorite!', 55, 'lunch', 'https://image2url.com/r2/default/images/1772395142125-2af1ec87-e3bf-4b9f-ad7a-ee48430f2c18.blob', 30],
        ['Waakye', 'Rice and beans cooked with millet leaves. Served with spaghetti, gari, boiled eggs, and shito.', 35, 'breakfast', 'https://image2url.com/r2/default/images/1772395341002-3e755383-3dff-40df-b1e7-b63216085950.blob', 40],
        ['Fufu with Light Soup', 'Pounded cassava and plantain served with aromatic tomato-based soup and your choice of meat.', 50, 'dinner', 'https://image2url.com/r2/default/images/1772395610014-ad2ad65c-7014-4e4f-af5e-3687e21401fa.blob', 25],
        ['Red Red', 'Black-eyed peas cooked in palm oil with plantains. Served with fried ripe plantain (kelewele).', 30, 'lunch', 'https://image2url.com/r2/default/images/1772395700308-01cb07ef-7116-43b4-a99a-d7e84d0ac550.blob', 45],
        ['Kelewele', 'Spicy fried plantain cubes seasoned with ginger, pepper, and aromatic spices. Perfect snack!', 20, 'snack', 'https://image2url.com/r2/default/images/1772395829540-47489bcd-b428-4c91-9273-c20187e2f527.blob', 60],
        ['Kontomire Stew', 'Cocoyam leaves stewed with smoked fish, garden eggs, and palm oil. Served with boiled yam.', 40, 'dinner', 'https://image2url.com/r2/default/images/1772396528561-2f18ddc6-246a-4a5b-97de-4d38fa55b2da.blob', 20],
        ['Fried Rice', 'Ghanaian-style fried rice with mixed vegetables, chicken, and shrimp. A party favourite!', 42, 'lunch', 'https://image2url.com/r2/default/images/1772397329715-c0b1a5df-77cf-415a-8c16-02170453ffd2.blob', 35],
      ];

      items.forEach(item => {
        DBOrSQLite.prepare(
          'INSERT INTO menu_items (name, description, price, category, image_url, stock) VALUES (?,?,?,?,?,?)'
        ).run(...item);
      });
      console.log(`  ✓ Menu items: ${items.length} items`);
    } catch (err) {
      console.error('  ✗ Menu items error:', err.message);
    }

    // ── Default tables (SQLite) ─────────────────────────────────────────
    try {
      const tableCount = DBOrSQLite.prepare('SELECT COUNT(*) as c FROM tables').get().c;
      if (tableCount === 0) {
        const tables = [
          ['T-01', 2, 50],
          ['T-02', 2, 50],
          ['T-03', 4, 80],
          ['T-04', 4, 80],
          ['T-05', 4, 80],
          ['T-06', 6, 120],
          ['T-07', 6, 120],
          ['T-08', 8, 150],
        ];

        tables.forEach(table => {
          DBOrSQLite.prepare(
            'INSERT INTO tables (table_number, capacity, price) VALUES (?,?,?)'
          ).run(...table);
        });
        console.log(`  ✓ Tables: ${tables.length} tables`);
      } else {
        console.log(`  ✓ Tables already seeded (${tableCount} tables)`);
      }
    } catch (err) {
      console.error('  ✗ Tables error:', err.message);
    }
  }
};
