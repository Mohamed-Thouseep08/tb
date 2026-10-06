const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const databasePath = process.env.DB_PATH || path.join(__dirname, 'restaurant.sqlite');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const username = process.env.ADMIN_USERNAME || 'admin';
const password = process.env.ADMIN_PASSWORD || 'admin123';
db.prepare('INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)')
  .run(username, bcrypt.hashSync(password, 10), 'admin');

module.exports = db;