PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  customer_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dining_areas (
  area_id INTEGER PRIMARY KEY,
  area_name TEXT NOT NULL UNIQUE CHECK (area_name IN ('AC', 'Non-AC')),
  surcharge_percent REAL NOT NULL DEFAULT 0 CHECK (surcharge_percent >= 0)
);

CREATE TABLE IF NOT EXISTS dining_tables (
  table_id INTEGER PRIMARY KEY,
  table_number TEXT NOT NULL UNIQUE,
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 20),
  area_id INTEGER NOT NULL REFERENCES dining_areas(area_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'occupied', 'unavailable'))
);

CREATE TABLE IF NOT EXISTS reservations (
  reservation_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  table_id INTEGER NOT NULL REFERENCES dining_tables(table_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  reservation_date TEXT NOT NULL,
  time_slot TEXT NOT NULL,
  guests INTEGER NOT NULL CHECK (guests > 0),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'seated', 'completed', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (table_id, reservation_date, time_slot)
);

CREATE TABLE IF NOT EXISTS menu_categories (
  category_id INTEGER PRIMARY KEY,
  category_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS menu_items (
  item_id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES menu_categories(category_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  name TEXT NOT NULL UNIQUE,
  price REAL NOT NULL CHECK (price >= 0),
  is_veg INTEGER NOT NULL CHECK (is_veg IN (0, 1)),
  image TEXT NOT NULL DEFAULT '',
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1))
);

CREATE TABLE IF NOT EXISTS orders (
  order_id INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(reservation_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  order_time TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'billed', 'paid', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS order_items (
  order_item_id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(order_id) ON UPDATE CASCADE ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES menu_items(item_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL CHECK (unit_price >= 0),
  UNIQUE (order_id, item_id)
);

CREATE TABLE IF NOT EXISTS bills (
  bill_id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(order_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  subtotal REAL NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  gst REAL NOT NULL DEFAULT 0 CHECK (gst >= 0),
  service_charge REAL NOT NULL DEFAULT 0 CHECK (service_charge >= 0),
  ac_charge REAL NOT NULL DEFAULT 0 CHECK (ac_charge >= 0),
  discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
  grand_total REAL NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  payment_id INTEGER PRIMARY KEY,
  bill_id INTEGER NOT NULL REFERENCES bills(bill_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('Cash', 'UPI', 'Card', 'NetBanking')),
  amount REAL NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  transaction_ref TEXT UNIQUE,
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'staff'))
);

CREATE TABLE IF NOT EXISTS coupons (
  coupon_id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  discount_percent REAL NOT NULL CHECK (discount_percent BETWEEN 0 AND 100),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  valid_until TEXT
);

CREATE TABLE IF NOT EXISTS feedback (
  feedback_id INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL UNIQUE REFERENCES reservations(reservation_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reservations_date_slot ON reservations(reservation_date, time_slot, status);
CREATE INDEX IF NOT EXISTS idx_reservations_customer ON reservations(customer_id);
CREATE INDEX IF NOT EXISTS idx_reservations_table ON reservations(table_id);
CREATE INDEX IF NOT EXISTS idx_menu_category_available ON menu_items(category_id, available);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_reservation ON orders(reservation_id);
CREATE INDEX IF NOT EXISTS idx_bills_generated_at ON bills(generated_at);
CREATE INDEX IF NOT EXISTS idx_payments_mode_status ON payments(payment_mode, status);

CREATE VIEW IF NOT EXISTS available_tables_view AS
SELECT t.table_id, t.table_number, t.capacity, t.status, a.area_name, a.surcharge_percent
FROM dining_tables t
JOIN dining_areas a ON a.area_id = t.area_id
WHERE t.status != 'unavailable';

CREATE VIEW IF NOT EXISTS daily_sales_view AS
SELECT date(b.generated_at) AS sale_date,
       COUNT(DISTINCT b.bill_id) AS bills,
       ROUND(SUM(CASE WHEN p.status = 'success' THEN p.amount ELSE 0 END), 2) AS revenue
FROM bills b
LEFT JOIN payments p ON p.bill_id = b.bill_id
GROUP BY date(b.generated_at);

CREATE TRIGGER IF NOT EXISTS trg_reservation_created
AFTER INSERT ON reservations
WHEN NEW.status IN ('confirmed', 'seated')
BEGIN
  UPDATE dining_tables SET status = 'reserved' WHERE table_id = NEW.table_id AND status = 'available';
END;

CREATE TRIGGER IF NOT EXISTS trg_reservation_cancelled
AFTER UPDATE OF status ON reservations
WHEN NEW.status = 'cancelled' AND OLD.status != 'cancelled'
BEGIN
  UPDATE dining_tables
  SET status = 'available'
  WHERE table_id = NEW.table_id AND status = 'reserved'
    AND NOT EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.table_id = NEW.table_id AND r.status IN ('confirmed', 'seated')
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_bill_total_insert
AFTER INSERT ON bills
BEGIN
  UPDATE bills SET grand_total = MAX(0, ROUND(NEW.subtotal + NEW.gst + NEW.service_charge + NEW.ac_charge - NEW.discount, 2))
  WHERE bill_id = NEW.bill_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_bill_total_update
AFTER UPDATE OF subtotal, gst, service_charge, ac_charge, discount ON bills
BEGIN
  UPDATE bills SET grand_total = MAX(0, ROUND(NEW.subtotal + NEW.gst + NEW.service_charge + NEW.ac_charge - NEW.discount, 2))
  WHERE bill_id = NEW.bill_id;
END;

INSERT OR IGNORE INTO dining_areas (area_id, area_name, surcharge_percent) VALUES
  (1, 'AC', 10), (2, 'Non-AC', 0);

INSERT OR IGNORE INTO dining_tables (table_number, capacity, area_id) VALUES
  ('A01', 2, 1), ('A02', 2, 1), ('A03', 4, 1), ('A04', 4, 1), ('A05', 4, 1),
  ('A06', 4, 1), ('A07', 6, 1), ('A08', 6, 1), ('A09', 6, 1), ('A10', 8, 1),
  ('N01', 2, 2), ('N02', 2, 2), ('N03', 4, 2), ('N04', 4, 2), ('N05', 4, 2),
  ('N06', 4, 2), ('N07', 6, 2), ('N08', 6, 2), ('N09', 6, 2), ('N10', 8, 2);

INSERT OR IGNORE INTO customers (name, phone, email) VALUES
  ('Aarav Sharma', '9876501001', 'aarav@example.com'), ('Meera Iyer', '9876501002', 'meera@example.com'),
  ('Kabir Khan', '9876501003', 'kabir@example.com'), ('Ananya Patel', '9876501004', 'ananya@example.com'),
  ('Rohan Nair', '9876501005', 'rohan@example.com'), ('Diya Reddy', '9876501006', 'diya@example.com'),
  ('Arjun Das', '9876501007', 'arjun@example.com'), ('Priya Menon', '9876501008', 'priya@example.com'),
  ('Ishaan Gupta', '9876501009', 'ishaan@example.com'), ('Kavya Rao', '9876501010', 'kavya@example.com');

INSERT OR IGNORE INTO menu_categories (category_id, category_name) VALUES
  (1, 'Starters'), (2, 'Main Course'), (3, 'Biryani'), (4, 'Breads'), (5, 'Desserts'), (6, 'Beverages');

INSERT OR IGNORE INTO menu_items (category_id, name, price, is_veg, image) VALUES
  (1, 'Paneer Tikka', 320, 1, 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?auto=format&fit=crop&w=700&q=80'),
  (1, 'Hara Bhara Kebab', 260, 1, 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=700&q=80'),
  (1, 'Crispy Corn', 240, 1, 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=700&q=80'),
  (1, 'Chicken 65', 340, 0, 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?auto=format&fit=crop&w=700&q=80'),
  (1, 'Tandoori Chicken', 420, 0, 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=700&q=80'),
  (1, 'Fish Amritsari', 390, 0, 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=700&q=80'),
  (2, 'Paneer Butter Masala', 360, 1, 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=700&q=80'),
  (2, 'Dal Makhani', 310, 1, 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=700&q=80'),
  (2, 'Veg Kolhapuri', 320, 1, 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?auto=format&fit=crop&w=700&q=80'),
  (2, 'Chicken Chettinad', 410, 0, 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?auto=format&fit=crop&w=700&q=80'),
  (2, 'Butter Chicken', 430, 0, 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?auto=format&fit=crop&w=700&q=80'),
  (2, 'Mutton Rogan Josh', 490, 0, 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?auto=format&fit=crop&w=700&q=80'),
  (3, 'Hyderabadi Veg Biryani', 340, 1, 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=700&q=80'),
  (3, 'Paneer Dum Biryani', 370, 1, 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=700&q=80'),
  (3, 'Chicken Dum Biryani', 420, 0, 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=700&q=80'),
  (3, 'Mutton Biryani', 520, 0, 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=700&q=80'),
  (3, 'Prawn Biryani', 510, 0, 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=700&q=80'),
  (3, 'Egg Biryani', 360, 0, 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=700&q=80'),
  (4, 'Butter Naan', 70, 1, 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=700&q=80'),
  (4, 'Garlic Naan', 85, 1, 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=700&q=80'),
  (4, 'Tandoori Roti', 45, 1, 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=700&q=80'),
  (4, 'Lachha Paratha', 80, 1, 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=700&q=80'),
  (4, 'Roomali Roti', 55, 1, 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=700&q=80'),
  (5, 'Gulab Jamun', 140, 1, 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=700&q=80'),
  (5, 'Rasmalai', 160, 1, 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=700&q=80'),
  (5, 'Kulfi Falooda', 190, 1, 'https://images.unsplash.com/photo-1488900128323-21503983a07e?auto=format&fit=crop&w=700&q=80'),
  (5, 'Chocolate Brownie', 220, 1, 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=700&q=80'),
  (6, 'Masala Chai', 70, 1, 'https://images.unsplash.com/photo-1571934811356-5cc061b6821f?auto=format&fit=crop&w=700&q=80'),
  (6, 'Fresh Lime Soda', 100, 1, 'https://images.unsplash.com/photo-1571934811356-5cc061b6821f?auto=format&fit=crop&w=700&q=80'),
  (6, 'Mango Lassi', 140, 1, 'https://images.unsplash.com/photo-1570197788417-0e82375c9371?auto=format&fit=crop&w=700&q=80');

INSERT OR IGNORE INTO coupons (code, discount_percent, active, valid_until) VALUES
  ('WELCOME10', 10, 1, NULL), ('FEAST20', 20, 1, NULL);