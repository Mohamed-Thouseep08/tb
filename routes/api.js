const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');

const router = express.Router();
const TIME_SLOTS = ['12:00 PM - 2:00 PM', '2:00 PM - 4:00 PM', '6:00 PM - 8:00 PM', '8:00 PM - 10:00 PM'];
const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const clean = (value) => typeof value === 'string' ? value.trim() : '';
const fail = (res, status, error) => res.status(status).json({ error });

router.get('/config', (_req, res) => res.json({
  restaurant: 'Saffron & Ember',
  currency: 'INR',
  timeSlots: TIME_SLOTS,
  gstPercent: 5,
  servicePercent: 5,
  acSurchargePercent: 10
}));

router.get('/tables', (req, res) => {
  const { date, slot, area, guests } = req.query;
  if (!date || !TIME_SLOTS.includes(slot) || !['AC', 'Non-AC'].includes(area) || !Number(guests)) {
    return fail(res, 400, 'Choose a date, time, dining area, and guest count.');
  }
  const tables = db.prepare(`
    SELECT t.table_id AS id, t.table_number AS number, t.capacity, t.status,
           a.area_name AS area, a.surcharge_percent AS surchargePercent,
           CASE WHEN EXISTS (
             SELECT 1 FROM reservations r WHERE r.table_id = t.table_id
               AND r.reservation_date = ? AND r.time_slot = ? AND r.status != 'cancelled'
           ) THEN 1 ELSE 0 END AS booked
    FROM dining_tables t JOIN dining_areas a ON a.area_id = t.area_id
    WHERE a.area_name = ? AND t.capacity >= ? AND t.status NOT IN ('occupied', 'unavailable')
    ORDER BY t.capacity, t.table_number
  `).all(date, slot, area, Number(guests));
  res.json(tables.map((table) => ({ ...table, available: table.booked === 0 })));
});

router.get('/menu', (req, res) => {
  const conditions = ['i.available = 1'];
  const values = [];
  if (req.query.category && req.query.category !== 'All') {
    conditions.push('c.category_name = ?');
    values.push(req.query.category);
  }
  if (req.query.veg === '1') conditions.push('i.is_veg = 1');
  if (req.query.veg === '0') conditions.push('i.is_veg = 0');
  if (req.query.q) {
    conditions.push('(i.name LIKE ? OR c.category_name LIKE ?)');
    values.push(`%${req.query.q}%`, `%${req.query.q}%`);
  }
  const items = db.prepare(`
    SELECT i.item_id AS id, i.name, i.price, i.is_veg AS isVeg, i.image,
           c.category_name AS category
    FROM menu_items i JOIN menu_categories c ON c.category_id = i.category_id
    WHERE ${conditions.join(' AND ')} ORDER BY c.category_id, i.name
  `).all(...values);
  const categories = db.prepare('SELECT category_name AS name FROM menu_categories ORDER BY category_id').all();
  res.json({ categories: categories.map((category) => category.name), items });
});

router.post('/reservations', (req, res, next) => {
  try {
    const name = clean(req.body.name);
    const phone = clean(req.body.phone);
    const email = clean(req.body.email) || null;
    const { date, slot, area, tableId } = req.body;
    const guests = Number(req.body.guests);
    if (name.length < 2 || !/^\+?[0-9\s()-]{8,18}$/.test(phone)) return fail(res, 400, 'Enter a name and a valid phone number.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date < new Date().toISOString().slice(0, 10)) return fail(res, 400, 'Choose today or a future date.');
    if (!TIME_SLOTS.includes(slot) || !['AC', 'Non-AC'].includes(area) || !Number.isInteger(guests) || guests < 1 || guests > 20) {
      return fail(res, 400, 'Check the date, time, dining area, and guest count.');
    }

    const createReservation = db.transaction(() => {
      const table = db.prepare(`
        SELECT t.table_id, t.capacity, t.status, a.area_name
        FROM dining_tables t JOIN dining_areas a ON a.area_id = t.area_id
        WHERE t.table_id = ?
      `).get(Number(tableId));
      if (!table || table.area_name !== area || table.capacity < guests || ['occupied', 'unavailable'].includes(table.status)) {
        throw Object.assign(new Error('This table cannot fit your party. Choose another table.'), { status: 409 });
      }
      const occupied = db.prepare(`SELECT 1 FROM reservations WHERE table_id = ? AND reservation_date = ?
        AND time_slot = ? AND status != 'cancelled'`).get(Number(tableId), date, slot);
      if (occupied) throw Object.assign(new Error('That table was just reserved. Please choose another.'), { status: 409 });

      db.prepare(`INSERT INTO customers (name, phone, email) VALUES (?, ?, ?)
        ON CONFLICT(phone) DO UPDATE SET name = excluded.name, email = COALESCE(excluded.email, customers.email)`)
        .run(name, phone, email);
      const customer = db.prepare('SELECT customer_id FROM customers WHERE phone = ?').get(phone);
      const result = db.prepare(`INSERT INTO reservations
        (customer_id, table_id, reservation_date, time_slot, guests) VALUES (?, ?, ?, ?, ?)`)
        .run(customer.customer_id, Number(tableId), date, slot, guests);
      return db.prepare(`SELECT r.reservation_id AS id, r.reservation_date AS date, r.time_slot AS slot,
        r.guests, r.status, c.name, c.phone, t.table_number AS tableNumber, a.area_name AS area
        FROM reservations r JOIN customers c ON c.customer_id = r.customer_id
        JOIN dining_tables t ON t.table_id = r.table_id JOIN dining_areas a ON a.area_id = t.area_id
        WHERE r.reservation_id = ?`).get(result.lastInsertRowid);
    });
    res.status(201).json(createReservation());
  } catch (error) {
    if (error.status) return fail(res, error.status, error.message);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail(res, 409, 'That table was just reserved. Please choose another.');
    next(error);
  }
});

router.get('/reservations/:id', (req, res) => {
  const reservation = db.prepare(`SELECT r.reservation_id AS id, r.reservation_date AS date, r.time_slot AS slot,
    r.guests, r.status, c.name, c.phone, t.table_number AS tableNumber, a.area_name AS area
    FROM reservations r JOIN customers c ON c.customer_id = r.customer_id
    JOIN dining_tables t ON t.table_id = r.table_id JOIN dining_areas a ON a.area_id = t.area_id
    WHERE r.reservation_id = ?`).get(Number(req.params.id));
  if (!reservation) return fail(res, 404, 'Reservation not found.');
  res.json(reservation);
});

router.post('/coupons/validate', (req, res) => {
  const code = clean(req.body.code).toUpperCase();
  if (!code) return fail(res, 400, 'Enter a coupon code.');
  const coupon = db.prepare(`SELECT code, discount_percent AS discountPercent FROM coupons
    WHERE code = ? COLLATE NOCASE AND active = 1 AND (valid_until IS NULL OR valid_until >= date('now'))`).get(code);
  if (!coupon) return fail(res, 404, 'That coupon is invalid or expired.');
  res.json(coupon);
});

router.post('/bills', (req, res, next) => {
  try {
    const reservationId = Number(req.body.reservationId);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!Number.isInteger(reservationId) || items.length === 0 || items.length > 50) return fail(res, 400, 'Add a reservation and at least one menu item.');
    const normalized = new Map();
    for (const line of items) {
      const itemId = Number(line.itemId);
      const quantity = Number(line.quantity);
      if (!Number.isInteger(itemId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) return fail(res, 400, 'Check item quantities.');
      normalized.set(itemId, (normalized.get(itemId) || 0) + quantity);
    }

    const createBill = db.transaction(() => {
      const reservation = db.prepare(`SELECT r.status, a.area_name, a.surcharge_percent
        FROM reservations r JOIN dining_tables t ON t.table_id = r.table_id
        JOIN dining_areas a ON a.area_id = t.area_id WHERE r.reservation_id = ?`).get(reservationId);
      if (!reservation || !['confirmed', 'seated'].includes(reservation.status)) throw Object.assign(new Error('This reservation cannot accept an order.'), { status: 404 });

      const lookup = db.prepare('SELECT item_id, price FROM menu_items WHERE item_id = ? AND available = 1');
      const pricedItems = [...normalized].map(([itemId, quantity]) => {
        const item = lookup.get(itemId);
        if (!item) throw Object.assign(new Error('One of the selected menu items is unavailable.'), { status: 409 });
        return { itemId, quantity, price: item.price };
      });
      const subtotal = money(pricedItems.reduce((sum, item) => sum + item.price * item.quantity, 0));
      let discountPercent = 0;
      const couponCode = clean(req.body.couponCode);
      if (couponCode) {
        const coupon = db.prepare(`SELECT discount_percent FROM coupons WHERE code = ? COLLATE NOCASE
          AND active = 1 AND (valid_until IS NULL OR valid_until >= date('now'))`).get(couponCode);
        if (!coupon) throw Object.assign(new Error('Coupon is invalid or expired.'), { status: 400 });
        discountPercent = coupon.discount_percent;
      }
      const gst = money(subtotal * 0.05);
      const serviceCharge = money(subtotal * 0.05);
      const acCharge = reservation.area_name === 'AC' ? money(subtotal * reservation.surcharge_percent / 100) : 0;
      const discount = money(subtotal * discountPercent / 100);
      const order = db.prepare('INSERT INTO orders (reservation_id) VALUES (?)').run(reservationId);
      const addItem = db.prepare('INSERT INTO order_items (order_id, item_id, quantity, unit_price) VALUES (?, ?, ?, ?)');
      pricedItems.forEach((item) => addItem.run(order.lastInsertRowid, item.itemId, item.quantity, item.price));
      const bill = db.prepare(`INSERT INTO bills (order_id, subtotal, gst, service_charge, ac_charge, discount)
        VALUES (?, ?, ?, ?, ?, ?)`).run(order.lastInsertRowid, subtotal, gst, serviceCharge, acCharge, discount);
      db.prepare("UPDATE orders SET status = 'billed' WHERE order_id = ?").run(order.lastInsertRowid);
      return db.prepare('SELECT * FROM bills WHERE bill_id = ?').get(bill.lastInsertRowid);
    });
    res.status(201).json(createBill());
  } catch (error) {
    if (error.status) return fail(res, error.status, error.message);
    next(error);
  }
});

router.get('/bill-history', (req, res) => {
  const reservationId = Number(req.query.reservationId);
  if (!Number.isInteger(reservationId) || reservationId < 1) return fail(res, 400, 'Enter a valid reservation ID.');
  const reservation = db.prepare('SELECT 1 FROM reservations WHERE reservation_id = ?').get(reservationId);
  if (!reservation) return fail(res, 404, 'Reservation not found.');
  const bills = db.prepare(`SELECT b.bill_id AS id, b.grand_total AS grandTotal, b.generated_at AS generatedAt,
    COALESCE((SELECT p.status FROM payments p WHERE p.bill_id = b.bill_id ORDER BY p.payment_id DESC LIMIT 1), 'unpaid') AS paymentStatus
    FROM bills b JOIN orders o ON o.order_id = b.order_id WHERE o.reservation_id = ? ORDER BY b.generated_at DESC`).all(reservationId);
  res.json(bills);
});

router.get('/bills/:id', (req, res) => {
  const bill = db.prepare(`SELECT b.bill_id AS id, b.order_id AS orderId, b.subtotal, b.gst,
    b.service_charge AS serviceCharge, b.ac_charge AS acCharge, b.discount, b.grand_total AS grandTotal,
    b.generated_at AS generatedAt, o.reservation_id AS reservationId, r.reservation_date AS reservationDate,
    c.name AS customerName, c.phone, t.table_number AS tableNumber, a.area_name AS area
    FROM bills b JOIN orders o ON o.order_id = b.order_id
    JOIN reservations r ON r.reservation_id = o.reservation_id
    JOIN customers c ON c.customer_id = r.customer_id
    JOIN dining_tables t ON t.table_id = r.table_id JOIN dining_areas a ON a.area_id = t.area_id
    WHERE b.bill_id = ?`).get(Number(req.params.id));
  if (!bill) return fail(res, 404, 'Bill not found.');
  bill.items = db.prepare(`SELECT i.name, i.is_veg AS isVeg, oi.quantity, oi.unit_price AS unitPrice
    FROM order_items oi JOIN menu_items i ON i.item_id = oi.item_id WHERE oi.order_id = ?`).all(bill.orderId);
  bill.payments = db.prepare(`SELECT payment_mode AS mode, amount, status, transaction_ref AS transactionRef, paid_at AS paidAt
    FROM payments WHERE bill_id = ? ORDER BY payment_id DESC`).all(bill.id);
  res.json(bill);
});

router.post('/payments', (req, res, next) => {
  try {
    const billId = Number(req.body.billId);
    const mode = clean(req.body.mode);
    const allowedModes = ['Cash', 'UPI', 'Card', 'NetBanking'];
    if (!Number.isInteger(billId) || !allowedModes.includes(mode)) return fail(res, 400, 'Choose a valid payment method.');
    const bill = db.prepare(`SELECT b.grand_total, b.order_id FROM bills b WHERE b.bill_id = ?`).get(billId);
    if (!bill) return fail(res, 404, 'Bill not found.');
    if (db.prepare("SELECT 1 FROM payments WHERE bill_id = ? AND status = 'success'").get(billId)) return fail(res, 409, 'This bill has already been paid.');
    const received = mode === 'Cash' ? Number(req.body.received) : bill.grand_total;
    if (!Number.isFinite(received) || received < bill.grand_total) return fail(res, 400, 'Amount received must cover the full bill.');
    const succeeded = mode === 'Cash' || req.body.success === true;
    const transactionRef = `${mode.slice(0, 3).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const recordPayment = db.transaction(() => {
      db.prepare(`INSERT INTO payments (bill_id, payment_mode, amount, status, transaction_ref, paid_at)
        VALUES (?, ?, ?, ?, ?, CASE WHEN ? = 'success' THEN datetime('now') ELSE NULL END)`)
        .run(billId, mode, succeeded ? bill.grand_total : 0, succeeded ? 'success' : 'failed', transactionRef, succeeded ? 'success' : 'failed');
      if (succeeded) db.prepare("UPDATE orders SET status = 'paid' WHERE order_id = ?").run(bill.order_id);
    });
    recordPayment();
    res.status(201).json({ status: succeeded ? 'success' : 'failed', transactionRef,
      amount: succeeded ? bill.grand_total : 0, change: mode === 'Cash' && succeeded ? money(received - bill.grand_total) : 0 });
  } catch (error) { next(error); }
});

router.post('/feedback', (req, res, next) => {
  try {
    const reservationId = Number(req.body.reservationId);
    const rating = Number(req.body.rating);
    const comment = clean(req.body.comment).slice(0, 500) || null;
    if (!Number.isInteger(reservationId) || !Number.isInteger(rating) || rating < 1 || rating > 5) return fail(res, 400, 'Choose a rating from 1 to 5.');
    const paid = db.prepare(`SELECT 1 FROM reservations r JOIN orders o ON o.reservation_id = r.reservation_id
      JOIN bills b ON b.order_id = o.order_id JOIN payments p ON p.bill_id = b.bill_id
      WHERE r.reservation_id = ? AND p.status = 'success'`).get(reservationId);
    if (!paid) return fail(res, 403, 'Feedback is available after payment.');
    const result = db.prepare('INSERT INTO feedback (reservation_id, rating, comment) VALUES (?, ?, ?)').run(reservationId, rating, comment);
    res.status(201).json({ id: result.lastInsertRowid, message: 'Thank you for your feedback.' });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail(res, 409, 'Feedback has already been submitted for this visit.');
    next(error);
  }
});

module.exports = router;