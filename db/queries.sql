-- 1. Reservations with customer, table and dining area.
SELECT r.reservation_id, c.name, c.phone, t.table_number, a.area_name,
       r.reservation_date, r.time_slot, r.guests, r.status
FROM reservations r
JOIN customers c ON c.customer_id = r.customer_id
JOIN dining_tables t ON t.table_id = r.table_id
JOIN dining_areas a ON a.area_id = t.area_id
ORDER BY r.reservation_date DESC, r.time_slot;

-- 2. Available tables for one area, date and slot (bind the three parameters).
SELECT t.table_id, t.table_number, t.capacity
FROM dining_tables t
JOIN dining_areas a ON a.area_id = t.area_id
WHERE a.area_name = ? AND t.capacity >= ? AND t.status != 'unavailable'
  AND NOT EXISTS (
    SELECT 1 FROM reservations r
    WHERE r.table_id = t.table_id AND r.reservation_date = ?
      AND r.time_slot = ? AND r.status != 'cancelled'
  )
ORDER BY t.capacity, t.table_number;

-- 3. Total successful sales by day.
SELECT date(p.paid_at) AS sale_date, ROUND(SUM(p.amount), 2) AS revenue
FROM payments p WHERE p.status = 'success'
GROUP BY date(p.paid_at) ORDER BY sale_date DESC;

-- 4. Order count and revenue by menu category.
SELECT c.category_name, COUNT(DISTINCT o.order_id) AS orders,
       SUM(oi.quantity) AS units, ROUND(SUM(oi.quantity * oi.unit_price), 2) AS sales
FROM order_items oi
JOIN menu_items i ON i.item_id = oi.item_id
JOIN menu_categories c ON c.category_id = i.category_id
JOIN orders o ON o.order_id = oi.order_id
GROUP BY c.category_id ORDER BY sales DESC;

-- 5. Most ordered dishes.
SELECT i.name, SUM(oi.quantity) AS units_ordered
FROM order_items oi JOIN menu_items i ON i.item_id = oi.item_id
GROUP BY i.item_id ORDER BY units_ordered DESC LIMIT 10;

-- 6. Average spend per customer (successful payments only).
SELECT c.customer_id, c.name, COUNT(DISTINCT b.bill_id) AS bills,
       ROUND(AVG(b.grand_total), 2) AS average_bill
FROM customers c
JOIN reservations r ON r.customer_id = c.customer_id
JOIN orders o ON o.reservation_id = r.reservation_id
JOIN bills b ON b.order_id = o.order_id
JOIN payments p ON p.bill_id = b.bill_id AND p.status = 'success'
GROUP BY c.customer_id ORDER BY average_bill DESC;

-- 7. AC versus Non-AC reservation usage.
SELECT a.area_name, COUNT(*) AS reservations, SUM(r.guests) AS guests
FROM reservations r
JOIN dining_tables t ON t.table_id = r.table_id
JOIN dining_areas a ON a.area_id = t.area_id
WHERE r.status != 'cancelled'
GROUP BY a.area_id ORDER BY reservations DESC;

-- 8. Revenue split by payment mode.
SELECT payment_mode, COUNT(*) AS transactions, ROUND(SUM(amount), 2) AS revenue
FROM payments WHERE status = 'success' GROUP BY payment_mode ORDER BY revenue DESC;

-- 9. Bills with their itemized contents.
SELECT b.bill_id, o.order_id, i.name, oi.quantity, oi.unit_price,
       ROUND(oi.quantity * oi.unit_price, 2) AS line_total, b.grand_total
FROM bills b JOIN orders o ON o.order_id = b.order_id
JOIN order_items oi ON oi.order_id = o.order_id
JOIN menu_items i ON i.item_id = oi.item_id
ORDER BY b.bill_id DESC, i.name;

-- 10. Customers who have never made a reservation.
SELECT c.customer_id, c.name, c.phone FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.customer_id = c.customer_id);

-- 11. Menu items priced above their category average.
SELECT i.name, c.category_name, i.price
FROM menu_items i JOIN menu_categories c ON c.category_id = i.category_id
WHERE i.price > (SELECT AVG(i2.price) FROM menu_items i2 WHERE i2.category_id = i.category_id)
ORDER BY c.category_name, i.price DESC;

-- 12. Unpaid bills and remaining balance.
SELECT b.bill_id, b.grand_total,
       ROUND(b.grand_total - COALESCE(SUM(CASE WHEN p.status = 'success' THEN p.amount ELSE 0 END), 0), 2) AS balance
FROM bills b LEFT JOIN payments p ON p.bill_id = b.bill_id
GROUP BY b.bill_id HAVING balance > 0 ORDER BY b.generated_at;

-- 13. Reservation occupancy by day and time slot.
SELECT reservation_date, time_slot, COUNT(*) AS tables_booked, SUM(guests) AS guests
FROM reservations WHERE status IN ('confirmed', 'seated')
GROUP BY reservation_date, time_slot ORDER BY reservation_date, time_slot;

-- 14. Menu items that have never been ordered.
SELECT i.item_id, i.name, c.category_name FROM menu_items i
JOIN menu_categories c ON c.category_id = i.category_id
LEFT JOIN order_items oi ON oi.item_id = i.item_id
WHERE oi.item_id IS NULL ORDER BY c.category_name, i.name;

-- 15. Feedback summary by rating.
SELECT rating, COUNT(*) AS responses FROM feedback GROUP BY rating ORDER BY rating DESC;