const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();
const validStatuses = ['confirmed', 'seated', 'completed', 'cancelled'];
const validTableStatuses = ['available', 'reserved', 'occupied', 'unavailable'];
const clean = (value) => typeof value === 'string' ? value.trim() : '';
const fail = (res, status, error) => res.status(status).json({ error });

router.get('/session', (req, res) => res.json({ authenticated: Boolean(req.session.adminId), username: req.session.username || null }));

router.post('/login', (req, res) => {
  const username = clean(req.body.username);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = db.prepare("SELECT user_id, username, password_hash, role FROM users WHERE username = ? AND role = 'admin'").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return fail(res, 401, 'Username or password is incorrect.');
  req.session.adminId = user.user_id;
  req.session.username = user.username;
  res.json({ authenticated: true, username: user.username });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ authenticated: false }));
});

router.use((req, res, next) => {
  if (!req.session.adminId) return fail(res, 401, 'Admin sign-in required.');
  next();
});

router.get('/summary', (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const reservations = db.prepare(`SELECT COUNT(*) AS count FROM reservations WHERE reservation_date = ? AND status != 'cancelled'`).get(today).count;
  const revenue = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'success' AND date(paid_at) = ?`).get(today).total;
  const orders = db.prepare(`SELECT COUNT(*) AS count FROM orders WHERE date(order_time) = ?`).get(today).count;
  const popular = db.prepare(`SELECT i.name, COALESCE(SUM(oi.quantity), 0) AS units
    FROM order_items oi JOIN menu_items i ON i.item_id = oi.item_id JOIN orders o ON o.order_id = oi.order_id
    WHERE date(o.order_time) = ? GROUP BY i.item_id ORDER BY units DESC LIMIT 1`).get(today);
  const days = Array.from({ length: 7 }, (_value, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return date.toISOString().slice(0, 10);
  });
  const daily = days.map((day) => ({ date: day, revenue: db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'success' AND date(paid_at) = ?`).get(day).total }));
  const areas = db.prepare(`SELECT a.area_name AS area, COUNT(*) AS count FROM reservations r
    JOIN dining_tables t ON t.table_id = r.table_id JOIN dining_areas a ON a.area_id = t.area_id
    WHERE r.reservation_date = ? AND r.status != 'cancelled' GROUP BY a.area_id`).all(today);
  const paymentModes = db.prepare(`SELECT payment_mode AS mode, COUNT(*) AS count FROM payments
    WHERE status = 'success' AND date(paid_at) = ? GROUP BY payment_mode`).all(today);
  res.json({ today, reservations, revenue, orders, popular: popular || null, daily, areas, paymentModes });
});

router.get('/reservations', (_req, res) => {
  const rows = db.prepare(`SELECT r.reservation_id AS id, r.reservation_date AS date, r.time_slot AS slot,
    r.guests, r.status, c.name AS customer, c.phone, t.table_id AS tableId, t.table_number AS tableNumber,
    a.area_name AS area FROM reservations r JOIN customers c ON c.customer_id = r.customer_id
    JOIN dining_tables t ON t.table_id = r.table_id JOIN dining_areas a ON a.area_id = t.area_id
    ORDER BY r.reservation_date DESC, r.time_slot LIMIT 200`).all();
  res.json(rows);
});

router.patch('/reservations/:id', (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM reservations WHERE reservation_id = ?').get(id);
  if (!current) return fail(res, 404, 'Reservation not found.');
  const status = req.body.status === undefined ? current.status : clean(req.body.status);
  const tableId = req.body.tableId === undefined ? current.table_id : Number(req.body.tableId);
  const date = req.body.date === undefined ? current.reservation_date : clean(req.body.date);
  const slot = req.body.slot === undefined ? current.time_slot : clean(req.body.slot);
  const guests = req.body.guests === undefined ? current.guests : Number(req.body.guests);
  if (!validStatuses.includes(status) || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !['12:00 PM - 2:00 PM', '2:00 PM - 4:00 PM', '6:00 PM - 8:00 PM', '8:00 PM - 10:00 PM'].includes(slot) ||
      !Number.isInteger(guests) || guests < 1 || guests > 20) return fail(res, 400, 'Check reservation details.');
  const table = db.prepare('SELECT capacity, status FROM dining_tables WHERE table_id = ?').get(tableId);
  if (!table || table.capacity < guests || table.status === 'unavailable') return fail(res, 400, 'Table cannot fit this party.');
  if (status !== 'cancelled') {
    const conflict = db.prepare(`SELECT 1 FROM reservations WHERE table_id = ? AND reservation_date = ?
      AND time_slot = ? AND reservation_id != ? AND status != 'cancelled'`).get(tableId, date, slot, id);
    if (conflict) return fail(res, 409, 'The table is already reserved for this time.');
  }
  try {
    db.prepare(`UPDATE reservations SET status = ?, table_id = ?, reservation_date = ?, time_slot = ?, guests = ?
      WHERE reservation_id = ?`).run(status, tableId, date, slot, guests, id);
    const changed = db.prepare('SELECT reservation_id AS id, status FROM reservations WHERE reservation_id = ?').get(id);
    res.json(changed);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail(res, 409, 'The table is already reserved for this time.');
    throw error;
  }
});

router.get('/tables', (_req, res) => res.json(db.prepare(`SELECT t.table_id AS id, t.table_number AS number,
  t.capacity, t.status, a.area_name AS area FROM dining_tables t
  JOIN dining_areas a ON a.area_id = t.area_id ORDER BY a.area_id, t.table_number`).all()));

router.post('/tables', (req, res, next) => {
  try {
    const number = clean(req.body.number);
    const capacity = Number(req.body.capacity);
    const area = clean(req.body.area);
    if (!number || !Number.isInteger(capacity) || capacity < 1 || capacity > 20 || !['AC', 'Non-AC'].includes(area)) return fail(res, 400, 'Enter a table number, capacity, and dining area.');
    const result = db.prepare(`INSERT INTO dining_tables (table_number, capacity, area_id) VALUES (?, ?, (SELECT area_id FROM dining_areas WHERE area_name = ?))`).run(number, capacity, area);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) { next(error); }
});

router.patch('/tables/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = db.prepare('SELECT * FROM dining_tables WHERE table_id = ?').get(id);
    if (!current) return fail(res, 404, 'Table not found.');
    const number = req.body.number === undefined ? current.table_number : clean(req.body.number);
    const capacity = req.body.capacity === undefined ? current.capacity : Number(req.body.capacity);
    const status = req.body.status === undefined ? current.status : clean(req.body.status);
    const area = req.body.area === undefined ? null : clean(req.body.area);
    if (!number || !Number.isInteger(capacity) || capacity < 1 || capacity > 20 || !validTableStatuses.includes(status) || (area && !['AC', 'Non-AC'].includes(area))) return fail(res, 400, 'Check table details.');
    db.prepare(`UPDATE dining_tables SET table_number = ?, capacity = ?, status = ?,
      area_id = COALESCE((SELECT area_id FROM dining_areas WHERE area_name = ?), area_id) WHERE table_id = ?`)
      .run(number, capacity, status, area, id);
    res.json({ id, status });
  } catch (error) { next(error); }
});

router.delete('/tables/:id', (req, res, next) => {
  try { db.prepare('DELETE FROM dining_tables WHERE table_id = ?').run(Number(req.params.id)); res.json({ deleted: true }); }
  catch (error) { next(error); }
});

router.get('/menu-items', (_req, res) => res.json(db.prepare(`SELECT i.item_id AS id, i.name, i.price,
  i.is_veg AS isVeg, i.image, i.available, c.category_name AS category FROM menu_items i
  JOIN menu_categories c ON c.category_id = i.category_id ORDER BY c.category_id, i.name`).all()));

router.post('/menu-items', (req, res, next) => {
  try {
    const name = clean(req.body.name);
    const price = Number(req.body.price);
    const category = clean(req.body.category);
    if (!name || !Number.isFinite(price) || price < 0 || !category) return fail(res, 400, 'Enter a name, category, and valid price.');
    const result = db.prepare(`INSERT INTO menu_items (name, category_id, price, is_veg, image, available)
      VALUES (?, (SELECT category_id FROM menu_categories WHERE category_name = ?), ?, ?, ?, ?)`)
      .run(name, category, price, req.body.isVeg ? 1 : 0, clean(req.body.image), req.body.available === false ? 0 : 1);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) { next(error); }
});

router.patch('/menu-items/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = db.prepare('SELECT * FROM menu_items WHERE item_id = ?').get(id);
    if (!current) return fail(res, 404, 'Menu item not found.');
    const name = req.body.name === undefined ? current.name : clean(req.body.name);
    const price = req.body.price === undefined ? current.price : Number(req.body.price);
    const isVeg = req.body.isVeg === undefined ? current.is_veg : (req.body.isVeg ? 1 : 0);
    const available = req.body.available === undefined ? current.available : (req.body.available ? 1 : 0);
    const image = req.body.image === undefined ? current.image : clean(req.body.image);
    const category = req.body.category === undefined ? null : clean(req.body.category);
    if (!name || !Number.isFinite(price) || price < 0) return fail(res, 400, 'Check item name and price.');
    db.prepare(`UPDATE menu_items SET name = ?, price = ?, is_veg = ?, available = ?, image = ?,
      category_id = COALESCE((SELECT category_id FROM menu_categories WHERE category_name = ?), category_id)
      WHERE item_id = ?`).run(name, price, isVeg, available, image, category, id);
    res.json({ id, updated: true });
  } catch (error) { next(error); }
});

router.delete('/menu-items/:id', (req, res, next) => {
  try { db.prepare('DELETE FROM menu_items WHERE item_id = ?').run(Number(req.params.id)); res.json({ deleted: true }); }
  catch (error) { next(error); }
});

router.get('/customers', (_req, res) => res.json(db.prepare(`SELECT c.customer_id AS id, c.name, c.phone, c.email,
  c.created_at AS createdAt, COUNT(r.reservation_id) AS visits FROM customers c
  LEFT JOIN reservations r ON r.customer_id = c.customer_id GROUP BY c.customer_id ORDER BY c.created_at DESC`).all()));

router.post('/customers', (req, res, next) => {
  try {
    const name = clean(req.body.name);
    const phone = clean(req.body.phone);
    if (name.length < 2 || !/^\+?[0-9\s()-]{8,18}$/.test(phone)) return fail(res, 400, 'Enter a name and valid phone number.');
    const result = db.prepare('INSERT INTO customers (name, phone, email) VALUES (?, ?, ?)').run(name, phone, clean(req.body.email) || null);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) { next(error); }
});

router.patch('/customers/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = db.prepare('SELECT * FROM customers WHERE customer_id = ?').get(id);
    if (!current) return fail(res, 404, 'Customer not found.');
    const name = req.body.name === undefined ? current.name : clean(req.body.name);
    const phone = req.body.phone === undefined ? current.phone : clean(req.body.phone);
    const email = req.body.email === undefined ? current.email : clean(req.body.email) || null;
    if (name.length < 2 || !/^\+?[0-9\s()-]{8,18}$/.test(phone)) return fail(res, 400, 'Check the name and phone number.');
    db.prepare('UPDATE customers SET name = ?, phone = ?, email = ? WHERE customer_id = ?').run(name, phone, email, id);
    res.json({ id, updated: true });
  } catch (error) { next(error); }
});

router.delete('/customers/:id', (req, res, next) => {
  try { db.prepare('DELETE FROM customers WHERE customer_id = ?').run(Number(req.params.id)); res.json({ deleted: true }); }
  catch (error) { next(error); }
});

router.get('/export/daily-sales.csv', (_req, res) => {
  const rows = db.prepare(`SELECT date(p.paid_at) AS date, COUNT(*) AS transactions,
    ROUND(SUM(p.amount), 2) AS revenue FROM payments p WHERE p.status = 'success'
    GROUP BY date(p.paid_at) ORDER BY date(p.paid_at) DESC LIMIT 90`).all();
  const csv = ['Date,Transactions,Revenue', ...rows.map((row) => `${row.date},${row.transactions},${row.revenue}`)].join('\r\n');
  res.type('text/csv').attachment('daily-sales.csv').send(csv);
});

module.exports = router;