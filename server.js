const express = require('express');
const path = require('path');
const defaultDb = require('./db');

const WARNING_THRESHOLD_PERCENT = 80;

/**
 * Validates whether a date string is in YYYY-MM-DD format and corresponds
 * to a real calendar date (e.g. rejects impossible dates like 2026-02-31).
 */
function isValidDate(dateStr) {
  if (typeof dateStr !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return false;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dateObj = new Date(year, month - 1, day);
  return (
    dateObj.getFullYear() === year &&
    dateObj.getMonth() === month - 1 &&
    dateObj.getDate() === day
  );
}

/**
 * Validates whether a month string is in YYYY-MM format.
 */
function isValidMonth(monthStr) {
  if (typeof monthStr !== 'string') return false;
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(monthStr);
}

/**
 * Strictly parses an ID parameter.
 * Must match /^\d+$/ and be greater than 0 (rejects "1abc", "1.5", "-1", etc.).
 */
function parseTransactionId(param) {
  if (typeof param !== 'string' && typeof param !== 'number') return null;
  const str = String(param).trim();
  if (!/^\d+$/.test(str)) return null;
  const id = parseInt(str, 10);
  if (id <= 0) return null;
  return id;
}

/**
 * Computes budget status ('ok', 'warning', 'over') using exact integer cents.
 * Warning threshold: >= 80% and <= 100%. Over: > 100%. Exactly 100% is 'warning'.
 */
function computeBudgetStatus(spent, limit) {
  const spentCents = Math.round(spent * 100);
  const limitCents = Math.round(limit * 100);

  if (spentCents > limitCents) {
    return 'over';
  }
  if (spentCents * 100 >= limitCents * WARNING_THRESHOLD_PERCENT && spentCents <= limitCents) {
    return 'warning';
  }
  return 'ok';
}

/**
 * Computes the previous calendar month from a YYYY-MM string using pure integer arithmetic.
 * Handles the January -> previous December year rollover cleanly.
 */
function getPreviousMonth(monthStr) {
  const [yearStr, monthNumStr] = monthStr.split('-');
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthNumStr, 10);
  if (month === 1) {
    year -= 1;
    month = 12;
  } else {
    month -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Calculates integer percentages using the Largest Remainder (Hamilton) method.
 * Guarantees that percentages sum to exactly 100% using integer arithmetic on cents.
 * Ties are broken deterministically: higher cents first, then category name A to Z.
 */
function calculateLargestRemainderPercentages(items) {
  if (!items || items.length === 0) return [];
  const totalCents = items.reduce((sum, it) => sum + it.cents, 0);
  if (totalCents <= 0) {
    return items.map((it) => ({ ...it, percent: 0 }));
  }

  const calculated = items.map((it, index) => {
    const quotient = Math.floor((it.cents * 100) / totalCents);
    const remainder = (it.cents * 100) % totalCents;
    return {
      ...it,
      originalIndex: index,
      percent: quotient,
      remainder
    };
  });

  const sumQuotients = calculated.reduce((sum, it) => sum + it.percent, 0);
  const leftover = 100 - sumQuotients;

  if (leftover > 0) {
    // Sort deterministically: remainder DESC, cents DESC, name A-Z (case-insensitive)
    const sortedForTieBreaker = [...calculated].sort((a, b) => {
      if (b.remainder !== a.remainder) return b.remainder - a.remainder;
      if (b.cents !== a.cents) return b.cents - a.cents;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    for (let i = 0; i < leftover; i++) {
      sortedForTieBreaker[i].percent += 1;
    }
  }

  // Restore original sort order and strip internal calculation fields
  calculated.sort((a, b) => a.originalIndex - b.originalIndex);
  return calculated.map(({ originalIndex, remainder, cents, ...rest }) => rest);
}

/**
 * Returns current local date as YYYY-MM-DD.
 * Uses local getters (getFullYear, getMonth, getDate) to avoid UTC rollover bugs.
 */
function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Formats and escapes a single field for CSV per RFC 4180.
 *
 * Security (Formula / CSV Injection):
 * If a text field (category, note) begins with =, +, -, @, \t, or \r, it is prefixed
 * with a single quote (') so spreadsheets (e.g. Excel) treat it as plain text rather
 * than executing dangerous formulas or DDE macros.
 *
 * Why not apply formula prefixing to amount or date?
 * Amount is strictly a validated non-negative number formatted as digits with two decimals
 * (e.g. '12.50'), and date is strictly formatted as 'YYYY-MM-DD' digits. Neither column
 * can contain formula execution trigger characters.
 *
 * RFC 4180 Escaping:
 * If the resulting string contains a comma (,), double-quote ("), newline (\n),
 * or carriage return (\r), internal double-quotes are doubled (" -> "") and the whole
 * value is enclosed in double-quotes.
 */
function formatCsvField(value, isTextField = false) {
  if (value === null || value === undefined) {
    return '';
  }

  let str = String(value);

  // 1. Formula injection prefix (text columns only)
  if (isTextField && str.length > 0) {
    const firstChar = str[0];
    if (
      firstChar === '=' ||
      firstChar === '+' ||
      firstChar === '-' ||
      firstChar === '@' ||
      firstChar === '\t' ||
      firstChar === '\r'
    ) {
      str = `'${str}`;
    }
  }

  // 2. RFC 4180 quoting
  if (
    str.includes(',') ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r')
  ) {
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return str;
}

/**
 * Parses and validates query filters (from, to, category, type).
 * Filters combine with AND. Case-insensitive category match.
 * Column names are prefixed with tableAlias (e.g. 't.date').
 */
function parseAndValidateFilters(query = {}, tableAlias = 't') {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  const { from, to, category, type } = query;
  const conditions = [];
  const params = [];

  if (from !== undefined && from !== '') {
    if (!isValidDate(from)) {
      return { error: "Invalid 'from' date format. Expected YYYY-MM-DD." };
    }
  }

  if (to !== undefined && to !== '') {
    if (!isValidDate(to)) {
      return { error: "Invalid 'to' date format. Expected YYYY-MM-DD." };
    }
  }

  if (from && to && from > to) {
    return { error: "'from' date cannot be after 'to' date." };
  }

  if (from && from !== '') {
    conditions.push(`${prefix}date >= ?`);
    params.push(from);
  }

  if (to && to !== '') {
    conditions.push(`${prefix}date <= ?`);
    params.push(to);
  }

  if (category !== undefined && String(category).trim() !== '') {
    conditions.push(`${prefix}category = ? COLLATE NOCASE`);
    params.push(String(category).trim());
  }

  if (type !== undefined && String(type).trim() !== '') {
    const lowerType = String(type).trim().toLowerCase();
    if (lowerType !== 'expense' && lowerType !== 'income') {
      return { error: "Type filter must be 'income' or 'expense'." };
    }
    conditions.push(`${prefix}type = ?`);
    params.push(lowerType);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

/**
 * Validates transaction fields for POST and PUT without duplicating logic.
 */
function validateTransactionInput(body, defaultType = 'expense') {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be a JSON object.' };
  }

  const { amount, category, date, note, type } = body;

  // Validate type (default to defaultType if not provided)
  let transactionType;
  if (type !== undefined && type !== null) {
    transactionType = String(type).trim().toLowerCase();
    if (transactionType !== 'expense' && transactionType !== 'income') {
      return { error: "Type must be either 'expense' or 'income'." };
    }
  } else {
    transactionType = defaultType;
  }

  // Validate amount
  if (amount === undefined || amount === null || typeof amount === 'boolean') {
    return { error: 'Amount is required.' };
  }
  const parsedAmount = Number(amount);
  if (Number.isNaN(parsedAmount) || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return { error: 'Amount must be a positive number.' };
  }
  const MAX_AMOUNT = 1000000000; // 1 billion
  if (parsedAmount > MAX_AMOUNT) {
    return { error: 'Amount exceeds maximum allowed limit.' };
  }
  const roundedAmount = Math.round(parsedAmount * 100) / 100;
  if (roundedAmount <= 0) {
    return { error: 'Amount must be at least 0.01.' };
  }

  // Validate category (required, trim, max 50 chars)
  if (typeof category !== 'string' || !category.trim()) {
    return { error: 'Category is required.' };
  }
  const trimmedCategory = category.trim();
  if (trimmedCategory.length > 50) {
    return { error: 'Category must not exceed 50 characters.' };
  }

  // Validate note (optional, trim, max 200 chars)
  let trimmedNote = '';
  if (note !== undefined && note !== null) {
    if (typeof note !== 'string') {
      return { error: 'Note must be a string.' };
    }
    trimmedNote = note.trim();
    if (trimmedNote.length > 200) {
      return { error: 'Note must not exceed 200 characters.' };
    }
  }

  // Validate date (valid real calendar date YYYY-MM-DD)
  if (!isValidDate(date)) {
    return { error: 'A valid calendar date in YYYY-MM-DD format is required.' };
  }

  return {
    value: {
      type: transactionType,
      amount: roundedAmount,
      category: trimmedCategory,
      note: trimmedNote,
      date
    }
  };
}

/**
 * Resolves or auto-creates a category in the categories table atomically,
 * returning the existing canonical name (e.g. preserves "Coffee" if user types "coffee").
 */
function resolveCategory(db, rawCategory) {
  const existing = db.prepare('SELECT name FROM categories WHERE name = ? COLLATE NOCASE').get(rawCategory);
  if (existing) {
    return existing.name;
  }
  db.prepare("INSERT OR IGNORE INTO categories (name, kind) VALUES (?, 'optional')").run(rawCategory);
  return rawCategory;
}

/**
 * Creates Express app given a SQLite database instance.
 */
function createApp(db = defaultDb) {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // GET /api/categories - list categories with their kind and expense/income counts
  app.get('/api/categories', (req, res) => {
    try {
      const stmt = db.prepare(`
        SELECT 
          c.id, 
          c.name, 
          c.kind,
          (SELECT COUNT(*) FROM transactions t WHERE t.category = c.name COLLATE NOCASE AND t.type = 'expense') AS expense_count,
          (SELECT COUNT(*) FROM transactions t WHERE t.category = c.name COLLATE NOCASE AND t.type = 'income') AS income_count
        FROM categories c
        ORDER BY c.name COLLATE NOCASE ASC
      `);
      const rows = stmt.all();
      res.json(rows);
    } catch (err) {
      console.error('Error fetching categories:', err);
      res.status(500).json({ error: 'Failed to retrieve categories.' });
    }
  });

  // PATCH /api/categories/:id - toggle / update category kind ('essential' | 'optional')
  app.patch('/api/categories/:id', (req, res) => {
    const id = parseTransactionId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid category ID.' });
    }

    const { kind } = req.body || {};
    if (typeof kind !== 'string' || (kind !== 'essential' && kind !== 'optional')) {
      return res.status(400).json({ error: "Kind must be 'essential' or 'optional'." });
    }

    try {
      const category = db.prepare('SELECT id, name, kind FROM categories WHERE id = ?').get(id);
      if (!category) {
        return res.status(404).json({ error: 'Category not found.' });
      }

      db.prepare('UPDATE categories SET kind = ? WHERE id = ?').run(kind, id);
      const updated = db.prepare('SELECT id, name, kind FROM categories WHERE id = ?').get(id);
      res.json(updated);
    } catch (err) {
      console.error('Error updating category kind:', err);
      res.status(500).json({ error: 'Failed to update category.' });
    }
  });

  // GET /api/transactions - list transactions with optional filters
  app.get('/api/transactions', (req, res) => {
    const filterResult = parseAndValidateFilters(req.query, 't');
    if (filterResult.error) {
      return res.status(400).json({ error: filterResult.error });
    }

    const { whereClause, params } = filterResult;
    try {
      const stmt = db.prepare(`
        SELECT t.id, t.type, t.amount, t.category, t.note, t.date, t.created_at
        FROM transactions t
        ${whereClause}
        ORDER BY t.date DESC, t.id DESC
      `);
      const rows = stmt.all(...params);
      res.json(rows);
    } catch (err) {
      console.error('Error fetching transactions:', err);
      res.status(500).json({ error: 'Failed to retrieve transactions.' });
    }
  });

  // GET /api/summary - compute totals (income, expenses, balance, count, essentialTotal, optionalTotal)
  app.get('/api/summary', (req, res) => {
    const filterResult = parseAndValidateFilters(req.query, 't');
    if (filterResult.error) {
      return res.status(400).json({ error: filterResult.error });
    }

    const { whereClause, params } = filterResult;
    try {
      const stmt = db.prepare(`
        SELECT
          COALESCE(ROUND(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 2), 0) AS totalIncome,
          COALESCE(ROUND(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 2), 0) AS totalExpenses,
          COALESCE(ROUND(SUM(CASE WHEN t.type = 'expense' AND c.kind = 'essential' THEN t.amount ELSE 0 END), 2), 0) AS essentialTotal,
          COALESCE(ROUND(SUM(CASE WHEN t.type = 'expense' AND (c.kind = 'optional' OR c.kind IS NULL) THEN t.amount ELSE 0 END), 2), 0) AS optionalTotal,
          COUNT(*) AS count
        FROM transactions t
        LEFT JOIN categories c ON t.category = c.name COLLATE NOCASE
        ${whereClause}
      `);
      const row = stmt.get(...params);
      const totalIncome = Math.round(row.totalIncome * 100) / 100;
      const totalExpenses = Math.round(row.totalExpenses * 100) / 100;
      const essentialTotal = Math.round(row.essentialTotal * 100) / 100;
      const optionalTotal = Math.round(row.optionalTotal * 100) / 100;
      const balance = Math.round((totalIncome - totalExpenses) * 100) / 100;

      res.json({
        totalIncome,
        totalExpenses,
        essentialTotal,
        optionalTotal,
        balance,
        count: row.count
      });
    } catch (err) {
      console.error('Error calculating summary:', err);
      res.status(500).json({ error: 'Failed to calculate summary.' });
    }
  });

  // GET /api/budgets?month=YYYY-MM - list budgets with monthly spending and status
  app.get('/api/budgets', (req, res) => {
    const { month } = req.query;
    if (!month || !isValidMonth(month)) {
      return res.status(400).json({ error: 'A valid month parameter (YYYY-MM) is required.' });
    }

    try {
      const stmt = db.prepare(`
        SELECT 
          b.id,
          b.category,
          b.monthly_limit AS "limit",
          COALESCE(ROUND(SUM(CASE 
            WHEN t.type = 'expense' AND strftime('%Y-%m', t.date) = ? 
            THEN t.amount ELSE 0 END), 2), 0) AS spent
        FROM budgets b
        LEFT JOIN transactions t 
          ON b.category = t.category COLLATE NOCASE
        GROUP BY b.id, b.category, b.monthly_limit
        ORDER BY b.category COLLATE NOCASE ASC
      `);
      const rows = stmt.all(month);

      const result = rows.map((row) => {
        const limit = Math.round(row.limit * 100) / 100;
        const spent = Math.round(row.spent * 100) / 100;
        const remaining = Math.round((limit - spent) * 100) / 100;
        const percentUsed = limit > 0 ? Math.round((spent / limit) * 1000) / 10 : 0;
        const status = computeBudgetStatus(spent, limit);

        return {
          id: row.id,
          category: row.category,
          limit,
          spent,
          remaining,
          percentUsed,
          status
        };
      });

      res.json(result);
    } catch (err) {
      console.error('Error fetching budgets:', err);
      res.status(500).json({ error: 'Failed to retrieve budgets.' });
    }
  });

  // POST /api/budgets - upsert budget for a category
  app.post('/api/budgets', (req, res) => {
    const { category, limit } = req.body || {};

    if (typeof category !== 'string' || !category.trim()) {
      return res.status(400).json({ error: 'Category is required.' });
    }
    const trimmedCategory = category.trim();

    // Check category exists and check eligibility rule
    const catRow = db.prepare(`
      SELECT 
        c.id, 
        c.name,
        (SELECT COUNT(*) FROM transactions t WHERE t.category = c.name COLLATE NOCASE AND t.type = 'expense') AS expense_count,
        (SELECT COUNT(*) FROM transactions t WHERE t.category = c.name COLLATE NOCASE AND t.type = 'income') AS income_count
      FROM categories c
      WHERE c.name = ? COLLATE NOCASE
    `).get(trimmedCategory);

    if (!catRow) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    // Server-side category rule: reject income-only categories
    if (catRow.income_count > 0 && catRow.expense_count === 0) {
      return res.status(400).json({ error: 'Budgets can only be set for expense categories.' });
    }

    // Validate limit
    if (limit === undefined || limit === null || typeof limit === 'boolean') {
      return res.status(400).json({ error: 'Limit is required.' });
    }
    const parsedLimit = Number(limit);
    if (Number.isNaN(parsedLimit) || !Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      return res.status(400).json({ error: 'Limit must be a positive number.' });
    }
    const MAX_LIMIT = 1000000000;
    if (parsedLimit > MAX_LIMIT) {
      return res.status(400).json({ error: 'Limit exceeds maximum allowed amount.' });
    }
    const roundedLimit = Math.round(parsedLimit * 100) / 100;
    if (roundedLimit <= 0) {
      return res.status(400).json({ error: 'Limit must be at least 0.01.' });
    }

    try {
      const stmt = db.prepare(`
        INSERT INTO budgets (category, monthly_limit)
        VALUES (?, ?)
        ON CONFLICT(category) DO UPDATE SET monthly_limit = excluded.monthly_limit
      `);
      stmt.run(catRow.name, roundedLimit);

      const saved = db.prepare('SELECT id, category, monthly_limit AS "limit" FROM budgets WHERE category = ? COLLATE NOCASE').get(catRow.name);
      res.status(200).json(saved);
    } catch (err) {
      console.error('Error saving budget:', err);
      res.status(500).json({ error: 'Failed to save budget.' });
    }
  });

  // DELETE /api/budgets/:id - delete a budget
  app.delete('/api/budgets/:id', (req, res) => {
    const id = parseTransactionId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid budget ID.' });
    }

    try {
      const stmt = db.prepare('DELETE FROM budgets WHERE id = ?');
      const result = stmt.run(id);

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Budget not found.' });
      }

      res.json({ message: 'Budget deleted successfully.' });
    } catch (err) {
      console.error('Error deleting budget:', err);
      res.status(500).json({ error: 'Failed to delete budget.' });
    }
  });

  // GET /api/insights?month=YYYY-MM - comprehensive category & month-over-month insights
  app.get('/api/insights', (req, res) => {
    const { month } = req.query;
    if (!month || !isValidMonth(month)) {
      return res.status(400).json({ error: 'A valid month parameter (YYYY-MM) is required.' });
    }

    const prevMonth = getPreviousMonth(month);

    try {
      // 1. Current month expenses by category
      const currentStmt = db.prepare(`
        SELECT 
          COALESCE(c.name, t.category) AS name,
          COALESCE(c.kind, 'optional') AS kind,
          COALESCE(ROUND(SUM(t.amount), 2), 0) AS amount
        FROM transactions t
        LEFT JOIN categories c ON t.category = c.name COLLATE NOCASE
        WHERE t.type = 'expense' AND strftime('%Y-%m', t.date) = ?
        GROUP BY COALESCE(c.name, t.category) COLLATE NOCASE
      `);
      const currentRows = currentStmt.all(month);

      // 2. Previous month expenses by category
      const prevStmt = db.prepare(`
        SELECT 
          COALESCE(c.name, t.category) AS name,
          COALESCE(c.kind, 'optional') AS kind,
          COALESCE(ROUND(SUM(t.amount), 2), 0) AS amount
        FROM transactions t
        LEFT JOIN categories c ON t.category = c.name COLLATE NOCASE
        WHERE t.type = 'expense' AND strftime('%Y-%m', t.date) = ?
        GROUP BY COALESCE(c.name, t.category) COLLATE NOCASE
      `);
      const prevRows = prevStmt.all(prevMonth);

      // Map previous month expenses
      const prevMap = new Map();
      let totalPrevCents = 0;
      prevRows.forEach((row) => {
        const cents = Math.round(row.amount * 100);
        totalPrevCents += cents;
        prevMap.set(row.name.toLowerCase(), { name: row.name, kind: row.kind, cents, amount: row.amount });
      });

      // Map current month expenses
      let totalCurrentCents = 0;
      const currentMap = new Map();
      const byCategoryItems = currentRows.map((row) => {
        const cents = Math.round(row.amount * 100);
        totalCurrentCents += cents;
        currentMap.set(row.name.toLowerCase(), { name: row.name, kind: row.kind, cents, amount: row.amount });
        return {
          name: row.name,
          kind: row.kind,
          amount: row.amount,
          cents
        };
      });

      // Sort byCategory: amount descending, then name A to Z (case-insensitive)
      byCategoryItems.sort((a, b) => {
        if (b.cents !== a.cents) return b.cents - a.cents;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });

      // Calculate percentages using integer largest remainder method
      const byCategory = calculateLargestRemainderPercentages(byCategoryItems);

      // Top 3 optional categories by spending (> 0)
      const topOptional = byCategory
        .filter((cat) => cat.kind === 'optional' && cat.amount > 0)
        .slice(0, 3);

      // 3. Month over Month per category
      const allCategoryKeys = new Set([...currentMap.keys(), ...prevMap.keys()]);
      const momItems = [];

      allCategoryKeys.forEach((key) => {
        const curr = currentMap.get(key);
        const prev = prevMap.get(key);
        const name = curr ? curr.name : prev.name;
        const kind = curr ? curr.kind : prev.kind;
        const currCents = curr ? curr.cents : 0;
        const prevCents = prev ? prev.cents : 0;

        // Skip category if $0 in both months
        if (currCents === 0 && prevCents === 0) return;

        const currentAmount = currCents / 100;
        const previousAmount = prevCents / 100;
        const diffCents = currCents - prevCents;
        const difference = diffCents / 100;

        let percentChange = null;
        if (prevCents > 0) {
          percentChange = Math.round(((currCents - prevCents) / prevCents) * 1000) / 10;
        }

        momItems.push({
          category: name,
          kind,
          current: currentAmount,
          previous: previousAmount,
          difference,
          percentChange,
          currCents,
          prevCents
        });
      });

      // Sort monthOverMonth: current amount descending, then previous amount descending, name A-Z
      momItems.sort((a, b) => {
        if (b.currCents !== a.currCents) return b.currCents - a.currCents;
        if (b.prevCents !== a.prevCents) return b.prevCents - a.prevCents;
        return a.category.localeCompare(b.category, undefined, { sensitivity: 'base' });
      });

      const monthOverMonth = momItems.map(({ currCents, prevCents, ...rest }) => rest);

      // Overall total comparison
      const totalCurrent = totalCurrentCents / 100;
      const totalPrevious = totalPrevCents / 100;
      const totalDifference = (totalCurrentCents - totalPrevCents) / 100;
      let totalPercentChange = null;
      if (totalPrevCents > 0) {
        totalPercentChange = Math.round(((totalCurrentCents - totalPrevCents) / totalPrevCents) * 1000) / 10;
      }

      res.json({
        month,
        previousMonth: prevMonth,
        byCategory,
        topOptional,
        monthOverMonth,
        overall: {
          current: totalCurrent,
          previous: totalPrevious,
          difference: totalDifference,
          percentChange: totalPercentChange
        }
      });
    } catch (err) {
      console.error('Error fetching insights:', err);
      res.status(500).json({ error: 'Failed to retrieve insights.' });
    }
  });

  // POST /api/transactions - add a new transaction with atomic category creation & canonical naming
  app.post('/api/transactions', (req, res) => {
    const validation = validateTransactionInput(req.body, 'expense');
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const { type, amount, category, note, date } = validation.value;

    try {
      const executeInsert = db.transaction(() => {
        const canonicalCat = resolveCategory(db, category);
        const stmt = db.prepare(`
          INSERT INTO transactions (type, amount, category, note, date)
          VALUES (?, ?, ?, ?, ?)
        `);
        const info = stmt.run(type, amount, canonicalCat, note, date);
        return db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid);
      });

      const created = executeInsert();
      res.status(201).json(created);
    } catch (err) {
      console.error('Error inserting transaction:', err);
      res.status(500).json({ error: 'Failed to create transaction.' });
    }
  });

  // PUT /api/transactions/:id - update an existing transaction with atomic category creation & canonical naming
  app.put('/api/transactions/:id', (req, res) => {
    const id = parseTransactionId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid transaction ID.' });
    }

    const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Transaction not found.' });
    }

    // Keep existing type if not specified in request body
    const validation = validateTransactionInput(req.body, existing.type);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const { type, amount, category, note, date } = validation.value;

    try {
      const executeUpdate = db.transaction(() => {
        const canonicalCat = resolveCategory(db, category);
        const stmt = db.prepare(`
          UPDATE transactions
          SET type = ?, amount = ?, category = ?, note = ?, date = ?
          WHERE id = ?
        `);
        stmt.run(type, amount, canonicalCat, note, date, id);
        return db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
      });

      const updated = executeUpdate();
      res.json(updated);
    } catch (err) {
      console.error('Error updating transaction:', err);
      res.status(500).json({ error: 'Failed to update transaction.' });
    }
  });

  // DELETE /api/transactions/:id - delete a transaction
  app.delete('/api/transactions/:id', (req, res) => {
    const id = parseTransactionId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid transaction ID.' });
    }

    try {
      const stmt = db.prepare('DELETE FROM transactions WHERE id = ?');
      const result = stmt.run(id);

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Transaction not found.' });
      }

      res.json({ message: 'Transaction deleted successfully.' });
    } catch (err) {
      console.error('Error deleting transaction:', err);
      res.status(500).json({ error: 'Failed to delete transaction.' });
    }
  });

  // GET /api/export.csv - export ALL transactions as RFC 4180 CSV with UTF-8 BOM
  app.get('/api/export.csv', (req, res) => {
    try {
      // Always exports all transactions in chronological order (date ASC, id ASC), ignoring filters
      const stmt = db.prepare(`
        SELECT t.date, t.type, t.category, t.note, t.amount
        FROM transactions t
        ORDER BY t.date ASC, t.id ASC
      `);
      const rows = stmt.all();

      const localDate = getLocalDateString();
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="expense-tracker-${localDate}.csv"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');

      const headerRow = 'date,type,category,note,amount';
      const UTF8_BOM = '\uFEFF';

      if (rows.length === 0) {
        // Empty database: exactly BOM + headerRow + CRLF, with no extra lines
        return res.send(`${UTF8_BOM}${headerRow}\r\n`);
      }

      const csvLines = rows.map((row) => {
        const dateField = formatCsvField(row.date, false);
        const typeField = formatCsvField(row.type, false);
        const catField = formatCsvField(row.category, true);
        const noteField = formatCsvField(row.note || '', true);
        const amtField = Number(row.amount).toFixed(2);
        return `${dateField},${typeField},${catField},${noteField},${amtField}`;
      });

      const body = `${UTF8_BOM}${headerRow}\r\n${csvLines.join('\r\n')}\r\n`;
      res.send(body);
    } catch (err) {
      console.error('Error exporting CSV:', err);
      res.status(500).json({ error: 'Failed to export transactions.' });
    }
  });

  return app;
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = {
  createApp,
  isValidDate,
  isValidMonth,
  computeBudgetStatus,
  getPreviousMonth,
  calculateLargestRemainderPercentages,
  parseTransactionId,
  parseAndValidateFilters,
  validateTransactionInput,
  resolveCategory,
  formatCsvField,
  getLocalDateString
};
