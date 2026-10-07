const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

/**
 * Creates and initializes a SQLite database with the required schema and migrations.
 * Ensures data directory exists if a file path is provided.
 */
function createDb(dbPath = path.join(__dirname, 'data', 'app.db')) {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Initialize transactions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense')) DEFAULT 'expense',
      amount REAL NOT NULL CHECK(amount > 0),
      category TEXT NOT NULL,
      note TEXT,
      date TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Initialize categories table (Slice 4)
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE COLLATE NOCASE NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('essential', 'optional')) DEFAULT 'optional'
    );
  `);

  // Idempotent migration: populate categories from existing transactions
  db.exec(`
    INSERT OR IGNORE INTO categories (name, kind)
    SELECT category, 'optional'
    FROM transactions
    WHERE TRIM(category) != ''
    GROUP BY LOWER(category);
  `);

  // Initialize budgets table (Slice 5)
  db.exec(`
    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL UNIQUE COLLATE NOCASE,
      monthly_limit REAL NOT NULL CHECK(monthly_limit > 0),
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  return db;
}

// Default instance for application run
const defaultDb = createDb();

module.exports = defaultDb;
module.exports.createDb = createDb;
