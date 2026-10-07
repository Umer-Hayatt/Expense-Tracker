const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('../db');
const { createApp, isValidDate, parseTransactionId, computeBudgetStatus, isValidMonth, getPreviousMonth, calculateLargestRemainderPercentages, formatCsvField, getLocalDateString } = require('../server');

describe('Expense Tracker API - Slice 1 & 2', () => {
  let server;
  let baseUrl;
  let testDb;

  before(async () => {
    // In-memory isolated database for tests so data/app.db is untouched
    testDb = createDb(':memory:');
    const app = createApp(testDb);

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (testDb) {
      testDb.close();
    }
  });

  test('Calendar date validation helper handles real and impossible dates', () => {
    assert.strictEqual(isValidDate('2026-01-15'), true);
    assert.strictEqual(isValidDate('2024-02-29'), true); // Leap year
    assert.strictEqual(isValidDate('2026-02-31'), false); // Impossible February date
    assert.strictEqual(isValidDate('2025-02-29'), false); // Non-leap year February 29
    assert.strictEqual(isValidDate('2026-04-31'), false); // April has 30 days
    assert.strictEqual(isValidDate('2026-13-01'), false); // Month 13
    assert.strictEqual(isValidDate('invalid-date'), false);
    assert.strictEqual(isValidDate(null), false);
  });

  test('Strict ID parsing rejects non-positive-integers and strings with characters or decimals', () => {
    assert.strictEqual(parseTransactionId('1'), 1);
    assert.strictEqual(parseTransactionId('42'), 42);
    assert.strictEqual(parseTransactionId(10), 10);
    assert.strictEqual(parseTransactionId('1abc'), null);
    assert.strictEqual(parseTransactionId('1.5'), null);
    assert.strictEqual(parseTransactionId('-5'), null);
    assert.strictEqual(parseTransactionId('0'), null);
    assert.strictEqual(parseTransactionId('abc'), null);
    assert.strictEqual(parseTransactionId(''), null);
    assert.strictEqual(parseTransactionId(null), null);
  });

  test('GET /api/transactions returns empty array initially', async () => {
    const res = await fetch(`${baseUrl}/api/transactions`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.deepStrictEqual(data, []);
  });

  test('POST /api/transactions creates a valid expense transaction', async () => {
    const payload = {
      amount: '45.50',
      category: '  Groceries  ',
      note: '  Weekly supermarket run  ',
      date: '2026-10-07'
    };

    const res = await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.id, 1);
    assert.strictEqual(data.type, 'expense');
    assert.strictEqual(data.amount, 45.50);
    assert.strictEqual(data.category, 'Groceries'); // trimmed
    assert.strictEqual(data.note, 'Weekly supermarket run'); // trimmed
    assert.strictEqual(data.date, '2026-10-07');
    assert.ok(data.created_at);
  });

  test('POST /api/transactions accepts income type', async () => {
    const payload = {
      amount: 1500,
      category: 'Salary',
      type: 'income',
      date: '2026-10-01'
    };

    const res = await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.id, 2);
    assert.strictEqual(data.type, 'income');
    assert.strictEqual(data.amount, 1500);
  });

  test('POST /api/transactions rejects invalid amount values', async () => {
    const badAmounts = [0, -10, 'abc', Infinity, NaN, null, undefined, 1000000001];

    for (const badAmount of badAmounts) {
      const res = await fetch(`${baseUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: badAmount,
          category: 'Food',
          date: '2026-10-07'
        })
      });

      assert.strictEqual(res.status, 400, `Expected 400 for amount: ${badAmount}`);
      const body = await res.json();
      assert.ok(body.error);
    }
  });

  test('POST /api/transactions rounds amount to 2 decimals', async () => {
    const res = await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 12.3456,
        category: 'Coffee',
        date: '2026-10-07'
      })
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.amount, 12.35);
  });

  test('POST /api/transactions validates category requirements and length limit', async () => {
    let res = await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 10,
        category: '   ',
        date: '2026-10-07'
      })
    });
    assert.strictEqual(res.status, 400);

    res = await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 10,
        category: 'A'.repeat(51),
        date: '2026-10-07'
      })
    });
    assert.strictEqual(res.status, 400);
  });

  test('POST /api/transactions enforces note length limit', async () => {
    const res = await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 10,
        category: 'Snacks',
        note: 'N'.repeat(201),
        date: '2026-10-07'
      })
    });
    assert.strictEqual(res.status, 400);
  });

  test('POST /api/transactions rejects impossible dates', async () => {
    const res = await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 25,
        category: 'Dining',
        date: '2026-02-31'
      })
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error, 'A valid calendar date in YYYY-MM-DD format is required.');
  });

  // --- Slice 2 Tests: PUT & DELETE ---

  test('PUT /api/transactions/:id updates transaction fields successfully', async () => {
    const updatePayload = {
      amount: '52.75',
      category: 'Supermarket',
      note: 'Updated weekly groceries',
      date: '2026-10-06'
    };

    const res = await fetch(`${baseUrl}/api/transactions/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload)
    });

    assert.strictEqual(res.status, 200);
    const updated = await res.json();
    assert.strictEqual(updated.id, 1);
    assert.strictEqual(updated.amount, 52.75);
    assert.strictEqual(updated.category, 'Supermarket');
    assert.strictEqual(updated.note, 'Updated weekly groceries');
    assert.strictEqual(updated.date, '2026-10-06');
    assert.strictEqual(updated.type, 'expense'); // preserved
  });

  test('PUT /api/transactions/:id preserves existing row type when body has no type', async () => {
    // Transaction ID 2 was created as type 'income'
    const updatePayload = {
      amount: '1600.00',
      category: 'Bonus & Salary',
      date: '2026-10-02'
      // note and type omitted
    };

    const res = await fetch(`${baseUrl}/api/transactions/2`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload)
    });

    assert.strictEqual(res.status, 200);
    const updated = await res.json();
    assert.strictEqual(updated.id, 2);
    assert.strictEqual(updated.amount, 1600.00);
    assert.strictEqual(updated.category, 'Bonus & Salary');
    assert.strictEqual(updated.type, 'income'); // Preserved income, did not silently default to expense!
  });

  test('PUT /api/transactions/:id validates inputs using shared validation', async () => {
    // Invalid impossible date
    let res = await fetch(`${baseUrl}/api/transactions/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 20,
        category: 'Food',
        date: '2026-02-31'
      })
    });
    assert.strictEqual(res.status, 400);

    // Negative amount
    res = await fetch(`${baseUrl}/api/transactions/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: -15,
        category: 'Food',
        date: '2026-10-07'
      })
    });
    assert.strictEqual(res.status, 400);

    // Empty category
    res = await fetch(`${baseUrl}/api/transactions/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 15,
        category: '   ',
        date: '2026-10-07'
      })
    });
    assert.strictEqual(res.status, 400);
  });

  test('PUT /api/transactions/:id returns 404 with error for non-existent id', async () => {
    const res = await fetch(`${baseUrl}/api/transactions/99999`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 50,
        category: 'Test',
        date: '2026-10-07'
      })
    });

    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.strictEqual(body.error, 'Transaction not found.');
  });

  test('PUT /api/transactions/:id returns 400 for invalid id formats', async () => {
    const invalidIds = ['1abc', '1.5', '-1', '0', 'abc'];

    for (const badId of invalidIds) {
      const res = await fetch(`${baseUrl}/api/transactions/${badId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 50,
          category: 'Test',
          date: '2026-10-07'
        })
      });

      assert.strictEqual(res.status, 400, `Expected 400 for bad id: ${badId}`);
      const body = await res.json();
      assert.strictEqual(body.error, 'Invalid transaction ID.');
    }
  });

  test('DELETE /api/transactions/:id removes transaction', async () => {
    // Delete transaction 1
    const res = await fetch(`${baseUrl}/api/transactions/1`, {
      method: 'DELETE'
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.message, 'Transaction deleted successfully.');

    // Confirm it's gone from GET list
    const getRes = await fetch(`${baseUrl}/api/transactions`);
    const transactions = await getRes.json();
    assert.ok(!transactions.some(tx => tx.id === 1));
  });

  test('DELETE /api/transactions/:id returns 404 for non-existent id', async () => {
    const res = await fetch(`${baseUrl}/api/transactions/99999`, {
      method: 'DELETE'
    });

    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.strictEqual(body.error, 'Transaction not found.');
  });

  test('DELETE /api/transactions/:id returns 400 for invalid id formats', async () => {
    const invalidIds = ['1abc', '1.5', '-1', '0', 'abc'];

    for (const badId of invalidIds) {
      const res = await fetch(`${baseUrl}/api/transactions/${badId}`, {
        method: 'DELETE'
      });

      assert.strictEqual(res.status, 400, `Expected 400 for bad id: ${badId}`);
      const body = await res.json();
      assert.strictEqual(body.error, 'Invalid transaction ID.');
    }
  });

  // --- Slice 3 Tests: Filters & Summary ---

  test('GET /api/categories returns distinct categories sorted case-insensitively', async () => {
    // Add distinct categories with varied casing
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 10, category: 'books', date: '2026-10-01' })
    });
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 15, category: 'Books', date: '2026-10-02' })
    });
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 20, category: 'Apples', date: '2026-10-03' })
    });

    const res = await fetch(`${baseUrl}/api/categories`);
    assert.strictEqual(res.status, 200);
    const categories = await res.json();
    assert.ok(Array.isArray(categories));
    // Verify case-insensitive de-duplication: 'books' / 'Books' should only appear once
    const booksOccurrences = categories.filter(c => c.name.toLowerCase() === 'books');
    assert.strictEqual(booksOccurrences.length, 1);
    // Verify sorting
    assert.strictEqual(categories[0].name.toLowerCase(), 'apples');
  });

  test('GET /api/transactions and /api/summary reject bad filter parameters with 400', async () => {
    // Bad date format
    let res = await fetch(`${baseUrl}/api/transactions?from=invalid-date`);
    assert.strictEqual(res.status, 400);
    let body = await res.json();
    assert.ok(body.error);

    // from > to
    res = await fetch(`${baseUrl}/api/transactions?from=2026-10-10&to=2026-10-01`);
    assert.strictEqual(res.status, 400);
    body = await res.json();
    assert.strictEqual(body.error, "'from' date cannot be after 'to' date.");

    // Summary endpoint with from > to
    res = await fetch(`${baseUrl}/api/summary?from=2026-10-10&to=2026-10-01`);
    assert.strictEqual(res.status, 400);
    body = await res.json();
    assert.strictEqual(body.error, "'from' date cannot be after 'to' date.");

    // Invalid type filter
    res = await fetch(`${baseUrl}/api/transactions?type=other`);
    assert.strictEqual(res.status, 400);
    body = await res.json();
    assert.strictEqual(body.error, "Type filter must be 'income' or 'expense'.");
  });

  test('GET /api/transactions date range filters are inclusive', async () => {
    // Insert known dates
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100, category: 'RangeTest', date: '2026-05-10' })
    });
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100, category: 'RangeTest', date: '2026-05-15' })
    });
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100, category: 'RangeTest', date: '2026-05-20' })
    });

    // Query exactly from 2026-05-10 to 2026-05-20: both boundary dates should be included
    const res = await fetch(`${baseUrl}/api/transactions?category=RangeTest&from=2026-05-10&to=2026-05-20`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.length, 3);
    const dates = data.map(d => d.date);
    assert.ok(dates.includes('2026-05-10'));
    assert.ok(dates.includes('2026-05-20'));
  });

  test('GET /api/transactions category filter is case-insensitive', async () => {
    const res = await fetch(`${baseUrl}/api/transactions?category=bOoKs`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.length >= 2);
    assert.ok(data.every(tx => tx.category.toLowerCase() === 'books'));
  });

  test('GET /api/transactions filters combine with AND', async () => {
    const res = await fetch(`${baseUrl}/api/transactions?category=books&type=expense&from=2026-10-01&to=2026-10-01`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.length, 1);
    assert.strictEqual(data[0].date, '2026-10-01');
    assert.strictEqual(data[0].category.toLowerCase(), 'books');
    assert.strictEqual(data[0].type, 'expense');
  });

  test('GET /api/summary calculates income, expenses, net balance, and count in SQL', async () => {
    // Current state includes:
    // Bonus & Salary: +1600.00
    // Various expenses: books (10, 15), Apples (20), RangeTest (100, 100, 100) = 345
    const res = await fetch(`${baseUrl}/api/summary`);
    assert.strictEqual(res.status, 200);
    const summary = await res.json();

    assert.strictEqual(typeof summary.totalIncome, 'number');
    assert.strictEqual(typeof summary.totalExpenses, 'number');
    assert.strictEqual(typeof summary.balance, 'number');
    assert.strictEqual(typeof summary.count, 'number');

    assert.strictEqual(summary.balance, Math.round((summary.totalIncome - summary.totalExpenses) * 100) / 100);
    assert.strictEqual(summary.totalIncome, 1600.00);
    assert.ok(summary.totalExpenses > 0);
  });

  test('GET /api/summary returns zero values when filters match nothing', async () => {
    const res = await fetch(`${baseUrl}/api/summary?category=NonExistentCategory999`);
    assert.strictEqual(res.status, 200);
    const summary = await res.json();

    assert.strictEqual(summary.totalIncome, 0);
    assert.strictEqual(summary.totalExpenses, 0);
    assert.strictEqual(summary.balance, 0);
    assert.strictEqual(summary.count, 0);
  });

  test('GET /api/summary calculates negative balance when expenses exceed income', async () => {
    // Querying with type=expense gives totalIncome=0, totalExpenses > 0, balance < 0
    const res = await fetch(`${baseUrl}/api/summary?type=expense`);
    assert.strictEqual(res.status, 200);
    const summary = await res.json();

    assert.strictEqual(summary.totalIncome, 0);
    assert.ok(summary.totalExpenses > 0);
    assert.strictEqual(summary.balance, -summary.totalExpenses);
  });

  // --- Slice 4 Tests: Categories (Essential vs Optional) ---

  test('Database startup migration creates categories idempotently from transactions', () => {
    const customDb = createDb(':memory:');
    // Pre-insert transactions directly
    customDb.prepare(`
      INSERT INTO transactions (type, amount, category, note, date)
      VALUES 
        ('expense', 50, 'Groceries', '', '2026-10-01'),
        ('expense', 30, 'groceries', '', '2026-10-02'),
        ('income', 2000, 'Salary', '', '2026-10-01')
    `).run();

    // Re-run migration SQL
    customDb.exec(`
      INSERT OR IGNORE INTO categories (name, kind)
      SELECT category, 'optional'
      FROM transactions
      WHERE TRIM(category) != ''
      GROUP BY LOWER(category);
    `);

    const cats = customDb.prepare('SELECT * FROM categories ORDER BY name ASC').all();
    // Unique case-insensitive: 'Groceries' and 'Salary'
    assert.strictEqual(cats.length, 2);
    assert.strictEqual(cats.every(c => c.kind === 'optional'), true);

    // Re-running migration again (idempotency check)
    customDb.exec(`
      INSERT OR IGNORE INTO categories (name, kind)
      SELECT category, 'optional'
      FROM transactions
      WHERE TRIM(category) != ''
      GROUP BY LOWER(category);
    `);
    const catsAfter = customDb.prepare('SELECT * FROM categories').all();
    assert.strictEqual(catsAfter.length, 2);
    customDb.close();
  });

  test('Transaction creation auto-creates category and preserves canonical name', async () => {
    // 1. Create with "Coffee"
    const res1 = await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 5, category: 'Coffee', date: '2026-10-07' })
    });
    assert.strictEqual(res1.status, 201);
    const tx1 = await res1.json();
    assert.strictEqual(tx1.category, 'Coffee');

    // 2. Create another transaction with "coffee" (lowercase)
    const res2 = await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 6, category: 'coffee', date: '2026-10-07' })
    });
    assert.strictEqual(res2.status, 201);
    const tx2 = await res2.json();
    // Must be assigned the canonical "Coffee" name
    assert.strictEqual(tx2.category, 'Coffee');

    // Check categories list has single 'Coffee' entry
    const catRes = await fetch(`${baseUrl}/api/categories`);
    const categories = await catRes.json();
    const coffeeCats = categories.filter(c => c.name.toLowerCase() === 'coffee');
    assert.strictEqual(coffeeCats.length, 1);
    assert.strictEqual(coffeeCats[0].name, 'Coffee');
    assert.strictEqual(coffeeCats[0].kind, 'optional');
  });

  test('PATCH /api/categories/:id toggles category kind and validates input', async () => {
    const catRes = await fetch(`${baseUrl}/api/categories`);
    const categories = await catRes.json();
    const coffeeCat = categories.find(c => c.name.toLowerCase() === 'coffee');
    assert.ok(coffeeCat);

    // Toggle to essential
    let res = await fetch(`${baseUrl}/api/categories/${coffeeCat.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'essential' })
    });
    assert.strictEqual(res.status, 200);
    let updated = await res.json();
    assert.strictEqual(updated.kind, 'essential');

    // Toggle back to optional
    res = await fetch(`${baseUrl}/api/categories/${coffeeCat.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'optional' })
    });
    assert.strictEqual(res.status, 200);
    updated = await res.json();
    assert.strictEqual(updated.kind, 'optional');

    // Invalid kind
    res = await fetch(`${baseUrl}/api/categories/${coffeeCat.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'invalid_kind' })
    });
    assert.strictEqual(res.status, 400);
    let errBody = await res.json();
    assert.strictEqual(errBody.error, "Kind must be 'essential' or 'optional'.");

    // 404 for non-existent category ID
    res = await fetch(`${baseUrl}/api/categories/99999`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'essential' })
    });
    assert.strictEqual(res.status, 404);

    // 400 for bad ID format
    res = await fetch(`${baseUrl}/api/categories/1abc`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'essential' })
    });
    assert.strictEqual(res.status, 400);
  });

  test('GET /api/summary calculates essential vs optional totals and satisfies the split invariant', async () => {
    // Find Coffee category and mark it as essential
    const catRes = await fetch(`${baseUrl}/api/categories`);
    const categories = await catRes.json();
    const coffeeCat = categories.find(c => c.name.toLowerCase() === 'coffee');

    await fetch(`${baseUrl}/api/categories/${coffeeCat.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'essential' })
    });

    const sumRes = await fetch(`${baseUrl}/api/summary`);
    assert.strictEqual(sumRes.status, 200);
    const summary = await sumRes.json();

    assert.strictEqual(typeof summary.essentialTotal, 'number');
    assert.strictEqual(typeof summary.optionalTotal, 'number');

    // Coffee had 5 + 6 = 11, which was marked essential
    assert.ok(summary.essentialTotal >= 11);

    // INVARIANT: essentialTotal + optionalTotal === totalExpenses
    const sumSplit = Math.round((summary.essentialTotal + summary.optionalTotal) * 100) / 100;
    assert.strictEqual(sumSplit, summary.totalExpenses);

    // Check with filter (e.g. category=Coffee)
    const filteredRes = await fetch(`${baseUrl}/api/summary?category=Coffee`);
    const filteredSum = await filteredRes.json();
    assert.strictEqual(filteredSum.essentialTotal, filteredSum.totalExpenses);
    assert.strictEqual(filteredSum.optionalTotal, 0);
    assert.strictEqual(filteredSum.essentialTotal + filteredSum.optionalTotal, filteredSum.totalExpenses);
  });

  test('Editing a transaction category updates category linkage and toggle still works', async () => {
    // Create new transaction with "Snacks"
    const postRes = await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 12, category: 'Snacks', date: '2026-10-07' })
    });
    const tx = await postRes.json();

    // Edit it to change category to "Desserts"
    const putRes = await fetch(`${baseUrl}/api/transactions/${tx.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 15, category: 'Desserts', date: '2026-10-07' })
    });
    assert.strictEqual(putRes.status, 200);

    // Categories list now contains "Desserts"
    const catRes = await fetch(`${baseUrl}/api/categories`);
    const categories = await catRes.json();
    const dessertCat = categories.find(c => c.name.toLowerCase() === 'desserts');
    assert.ok(dessertCat);

    // Toggle Desserts to essential
    const patchRes = await fetch(`${baseUrl}/api/categories/${dessertCat.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'essential' })
    });
    assert.strictEqual(patchRes.status, 200);
    const updated = await patchRes.json();
    assert.strictEqual(updated.kind, 'essential');
  });

  // --- Slice 5 Tests: Budgets & Warnings ---

  test('Status computation handles exact cents boundaries correctly', () => {
    // Exact cent comparisons on limit = 100.00
    // 79.99 is strictly below 80% -> 'ok'
    assert.strictEqual(computeBudgetStatus(79.99, 100.00), 'ok');
    // 80.00 is exactly 80% -> 'warning'
    assert.strictEqual(computeBudgetStatus(80.00, 100.00), 'warning');
    // 100.00 is exactly 100% -> 'warning'
    assert.strictEqual(computeBudgetStatus(100.00, 100.00), 'warning');
    // 100.01 is above 100% -> 'over'
    assert.strictEqual(computeBudgetStatus(100.01, 100.00), 'over');

    // Float-precision edge case (e.g. 123.45 * 0.8 = 98.76)
    assert.strictEqual(computeBudgetStatus(98.76, 123.45), 'warning');
  });

  test('isValidMonth validates YYYY-MM correctly', () => {
    assert.strictEqual(isValidMonth('2026-03'), true);
    assert.strictEqual(isValidMonth('2026-12'), true);
    assert.strictEqual(isValidMonth('2026-00'), false);
    assert.strictEqual(isValidMonth('2026-13'), false);
    assert.strictEqual(isValidMonth('2026'), false);
    assert.strictEqual(isValidMonth('invalid'), false);
  });

  test('POST /api/budgets validates input, rejects income-only categories, and upserts', async () => {
    // 1. Missing / invalid limit
    let res = await fetch(`${baseUrl}/api/budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'Coffee', limit: -50 })
    });
    assert.strictEqual(res.status, 400);

    // 2. Non-existent category
    res = await fetch(`${baseUrl}/api/budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'NonExistentCategory999', limit: 100 })
    });
    assert.strictEqual(res.status, 404);

    // 3. Income-only category (has income transactions and 0 expense transactions)
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'income', amount: 3000, category: 'IncomeOnlyCat', date: '2026-10-01' })
    });

    res = await fetch(`${baseUrl}/api/budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'IncomeOnlyCat', limit: 1000 })
    });
    assert.strictEqual(res.status, 400);
    const errBody = await res.json();
    assert.strictEqual(errBody.error, 'Budgets can only be set for expense categories.');

    // 4. Successful insert
    res = await fetch(`${baseUrl}/api/budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'Coffee', limit: 100 })
    });
    assert.strictEqual(res.status, 200);
    const saved1 = await res.json();
    assert.strictEqual(saved1.category, 'Coffee');
    assert.strictEqual(saved1.limit, 100);

    // 5. Successful upsert (update existing limit with lowercase category)
    res = await fetch(`${baseUrl}/api/budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'coffee', limit: 150 })
    });
    assert.strictEqual(res.status, 200);
    const saved2 = await res.json();
    assert.strictEqual(saved2.id, saved1.id); // Same row updated
    assert.strictEqual(saved2.limit, 150);
  });

  test('GET /api/budgets isolates by month, ignores other months, and excludes income', async () => {
    // Set a budget on "Dining" for 200
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 10, category: 'Dining', date: '2026-03-01' })
    });

    await fetch(`${baseUrl}/api/budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'Dining', limit: 200 })
    });

    // Add March 2026 expense: 50.00
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 50, category: 'Dining', date: '2026-03-15' })
    });

    // Add March 2026 income for "Dining": 300.00 (must be ignored)
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'income', amount: 300, category: 'Dining', date: '2026-03-20' })
    });

    // Add April 2026 expense: 75.00 (must be ignored for March)
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 75, category: 'Dining', date: '2026-04-10' })
    });

    // Query March 2026: total expenses for Dining in March = 10 + 50 = 60
    let res = await fetch(`${baseUrl}/api/budgets?month=2026-03`);
    assert.strictEqual(res.status, 200);
    let budgets = await res.json();
    let diningBudget = budgets.find(b => b.category.toLowerCase() === 'dining');
    assert.ok(diningBudget);
    assert.strictEqual(diningBudget.limit, 200);
    assert.strictEqual(diningBudget.spent, 60);
    assert.strictEqual(diningBudget.remaining, 140);
    assert.strictEqual(diningBudget.percentUsed, 30);
    assert.strictEqual(diningBudget.status, 'ok');

    // Query April 2026: total expenses for Dining in April = 75
    res = await fetch(`${baseUrl}/api/budgets?month=2026-04`);
    assert.strictEqual(res.status, 200);
    budgets = await res.json();
    diningBudget = budgets.find(b => b.category.toLowerCase() === 'dining');
    assert.ok(diningBudget);
    assert.strictEqual(diningBudget.spent, 75);
    assert.strictEqual(diningBudget.remaining, 125);
    assert.strictEqual(diningBudget.status, 'ok');

    // Query missing or bad month
    res = await fetch(`${baseUrl}/api/budgets`);
    assert.strictEqual(res.status, 400);
    res = await fetch(`${baseUrl}/api/budgets?month=2026-15`);
    assert.strictEqual(res.status, 400);
  });

  test('DELETE /api/budgets/:id removes budget and validates id', async () => {
    // Create a temporary budget
    const postRes = await fetch(`${baseUrl}/api/budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'Desserts', limit: 80 })
    });
    const created = await postRes.json();

    // Delete it
    let res = await fetch(`${baseUrl}/api/budgets/${created.id}`, {
      method: 'DELETE'
    });
    assert.strictEqual(res.status, 200);
    const delBody = await res.json();
    assert.strictEqual(delBody.message, 'Budget deleted successfully.');

    // Second delete returns 404
    res = await fetch(`${baseUrl}/api/budgets/${created.id}`, {
      method: 'DELETE'
    });
    assert.strictEqual(res.status, 404);

    // Bad ID returns 400
    res = await fetch(`${baseUrl}/api/budgets/bad_id`, {
      method: 'DELETE'
    });
    assert.strictEqual(res.status, 400);
  });

  // --- Slice 6 Tests: Insights Charts & Comparisons ---

  test('getPreviousMonth computes previous month and handles January -> December year rollover', () => {
    assert.strictEqual(getPreviousMonth('2026-03'), '2026-02');
    assert.strictEqual(getPreviousMonth('2026-12'), '2026-11');
    assert.strictEqual(getPreviousMonth('2026-01'), '2025-12'); // January rollover
    assert.strictEqual(getPreviousMonth('2025-01'), '2024-12');
  });

  test('calculateLargestRemainderPercentages breaks ties deterministically with exact 100% sum', () => {
    // 3 equal categories of 1000 cents ($10.00 each)
    const items = [
      { name: 'Category C', cents: 1000 },
      { name: 'Category A', cents: 1000 },
      { name: 'Category B', cents: 1000 }
    ];

    const result = calculateLargestRemainderPercentages(items);
    // Quotient for each is floor(1000 * 100 / 3000) = 33%
    // Remainder for each is 1000 * 100 % 3000 = 1000
    // Remainder tie-breaker: same cents (1000), so name A to Z: 'Category A' gets +1 -> 34%
    assert.strictEqual(result.length, 3);
    const catA = result.find(c => c.name === 'Category A');
    const catB = result.find(c => c.name === 'Category B');
    const catC = result.find(c => c.name === 'Category C');

    assert.strictEqual(catA.percent, 34);
    assert.strictEqual(catB.percent, 33);
    assert.strictEqual(catC.percent, 33);
    assert.strictEqual(catA.percent + catB.percent + catC.percent, 100);
  });

  test('GET /api/insights calculates category totals, essential tagging, topOptional, and exact 100% sum', async () => {
    // Use fixed month 2026-07
    // Add essential expense: Groceries 60.00
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 60, category: 'Groceries', date: '2026-07-10' })
    });

    // Mark Groceries as essential
    const catRes = await fetch(`${baseUrl}/api/categories`);
    const categories = await catRes.json();
    const groc = categories.find(c => c.name.toLowerCase() === 'groceries');
    await fetch(`${baseUrl}/api/categories/${groc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'essential' })
    });

    // Add optional expenses: Entertainment 25.00, Hobbies 15.00
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 25, category: 'Entertainment', date: '2026-07-15' })
    });
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 15, category: 'Hobbies', date: '2026-07-20' })
    });

    // Add income row: Salary 3000.00 in 2026-07 (must be excluded from spending insights)
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'income', amount: 3000, category: 'Salary', date: '2026-07-01' })
    });

    const res = await fetch(`${baseUrl}/api/insights?month=2026-07`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(data.month, '2026-07');
    assert.strictEqual(data.previousMonth, '2026-06');

    // byCategory check
    assert.strictEqual(data.byCategory.length, 3);
    assert.strictEqual(data.byCategory[0].name, 'Groceries');
    assert.strictEqual(data.byCategory[0].amount, 60);
    assert.strictEqual(data.byCategory[0].kind, 'essential');

    assert.strictEqual(data.byCategory[1].name, 'Entertainment');
    assert.strictEqual(data.byCategory[1].amount, 25);
    assert.strictEqual(data.byCategory[1].kind, 'optional');

    assert.strictEqual(data.byCategory[2].name, 'Hobbies');
    assert.strictEqual(data.byCategory[2].amount, 15);
    assert.strictEqual(data.byCategory[2].kind, 'optional');

    // Invariant: percentages sum to exactly 100
    const sumPct = data.byCategory.reduce((sum, c) => sum + c.percent, 0);
    assert.strictEqual(sumPct, 100);

    // topOptional check: Entertainment (25), Hobbies (15)
    assert.strictEqual(data.topOptional.length, 2);
    assert.strictEqual(data.topOptional[0].name, 'Entertainment');
    assert.strictEqual(data.topOptional[1].name, 'Hobbies');
  });

  test('GET /api/insights month-over-month per category handles dropped categories and null percent on previous=0', async () => {
    // Fixed test months: 2025-12 and 2026-01 (tests January -> December rollover in actual data)
    // 2025-12: WinterCoat 100.00, Coffee 30.00
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100, category: 'WinterCoat', date: '2025-12-10' })
    });
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 30, category: 'Coffee', date: '2025-12-15' })
    });

    // 2026-01: Coffee 45.00, Gym 50.00
    // (WinterCoat dropped to 0 in 2026-01; Gym is brand new in 2026-01)
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 45, category: 'Coffee', date: '2026-01-05' })
    });
    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 50, category: 'Gym', date: '2026-01-10' })
    });

    const res = await fetch(`${baseUrl}/api/insights?month=2026-01`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(data.month, '2026-01');
    assert.strictEqual(data.previousMonth, '2025-12');

    // 1. Gym: new in 2026-01, previous=0 -> percentChange must be null
    const gym = data.monthOverMonth.find(c => c.category === 'Gym');
    assert.ok(gym);
    assert.strictEqual(gym.current, 50);
    assert.strictEqual(gym.previous, 0);
    assert.strictEqual(gym.difference, 50);
    assert.strictEqual(gym.percentChange, null); // rule: previous=0 gives null!

    // 2. Coffee: 30 -> 45 (+15, +50.0%)
    const coffee = data.monthOverMonth.find(c => c.category === 'Coffee');
    assert.ok(coffee);
    assert.strictEqual(coffee.current, 45);
    assert.strictEqual(coffee.previous, 30);
    assert.strictEqual(coffee.difference, 15);
    assert.strictEqual(coffee.percentChange, 50.0);

    // 3. WinterCoat: existed only last month -> current=0, difference=-100, percentChange=-100.0%
    const coat = data.monthOverMonth.find(c => c.category === 'WinterCoat');
    assert.ok(coat);
    assert.strictEqual(coat.current, 0);
    assert.strictEqual(coat.previous, 100);
    assert.strictEqual(coat.difference, -100);
    assert.strictEqual(coat.percentChange, -100.0);

    // 4. Overall total: 130 in 2025-12 vs 95 in 2026-01 -> diff -35, change -26.9%
    assert.strictEqual(data.overall.current, 95);
    assert.strictEqual(data.overall.previous, 130);
    assert.strictEqual(data.overall.difference, -35);
    assert.strictEqual(data.overall.percentChange, -26.9);
  });

  test('GET /api/insights handles empty month and invalid month validation', async () => {
    // Empty month 2020-01
    const res = await fetch(`${baseUrl}/api/insights?month=2020-01`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.byCategory.length, 0);
    assert.strictEqual(data.topOptional.length, 0);
    assert.strictEqual(data.monthOverMonth.length, 0);
    assert.strictEqual(data.overall.current, 0);
    assert.strictEqual(data.overall.previous, 0);
    assert.strictEqual(data.overall.percentChange, null);

    // Bad month formats
    let badRes = await fetch(`${baseUrl}/api/insights`);
    assert.strictEqual(badRes.status, 400);

    badRes = await fetch(`${baseUrl}/api/insights?month=2026-15`);
    assert.strictEqual(badRes.status, 400);
  });

  test('calculateLargestRemainderPercentages breaks ties by higher amount first when remainders tie', () => {
    // Total cents = 200
    // Item A: 51 cents -> quotient 25, remainder 100
    // Item B: 71 cents -> quotient 35, remainder 100
    // Item C: 78 cents -> quotient 39, remainder 0
    // Sum quotients = 99, leftover = 1.
    // Both A and B have remainder 100. Item B has higher cents (71 > 51), so B must get the +1.
    const items = [
      { name: 'Item A', cents: 51 },
      { name: 'Item B', cents: 71 },
      { name: 'Item C', cents: 78 }
    ];
    const result = calculateLargestRemainderPercentages(items);
    assert.strictEqual(result.length, 3);
    const itemA = result.find(c => c.name === 'Item A');
    const itemB = result.find(c => c.name === 'Item B');
    const itemC = result.find(c => c.name === 'Item C');

    assert.strictEqual(itemA.percent, 25);
    assert.strictEqual(itemB.percent, 36); // received +1 because 71 cents > 51 cents
    assert.strictEqual(itemC.percent, 39);
    assert.strictEqual(itemA.percent + itemB.percent + itemC.percent, 100);
  });

  test('GET /api/insights handles more than 6 categories with Other grouping totaling 100%', async () => {
    // Month 2027-02: Insert 8 distinct categories
    const categories = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
    for (let i = 0; i < categories.length; i++) {
      await fetch(`${baseUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 10 + i * 5, category: categories[i], date: '2027-02-10' })
      });
    }

    const res = await fetch(`${baseUrl}/api/insights?month=2027-02`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(data.byCategory.length, 8);
    // Invariant: sum of all 8 category percentages is exactly 100
    const sumAllPct = data.byCategory.reduce((sum, c) => sum + c.percent, 0);
    assert.strictEqual(sumAllPct, 100);

    // Verify consistency when client groups categories beyond top 6 into "Other"
    const top6 = data.byCategory.slice(0, 6);
    const otherMembers = data.byCategory.slice(6);
    assert.strictEqual(top6.length, 6);
    assert.strictEqual(otherMembers.length, 2);

    const top6PctSum = top6.reduce((sum, c) => sum + c.percent, 0);
    const otherPctSum = otherMembers.reduce((sum, c) => sum + c.percent, 0);
    assert.strictEqual(top6PctSum + otherPctSum, 100);
  });

  test('GET /api/insights treats a category with no row in categories table as optional', async () => {
    // Insert a transaction directly into transactions table with category that does NOT exist in categories table
    testDb.prepare(`
      INSERT INTO transactions (type, amount, category, note, date)
      VALUES ('expense', 75, 'OrphanCatWithoutRow', 'no category row', '2027-04-12')
    `).run();

    // Verify no row in categories table
    const catRow = testDb.prepare("SELECT * FROM categories WHERE name = 'OrphanCatWithoutRow' COLLATE NOCASE").get();
    assert.strictEqual(catRow, undefined);

    const res = await fetch(`${baseUrl}/api/insights?month=2027-04`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    const orphan = data.byCategory.find(c => c.name === 'OrphanCatWithoutRow');
    assert.ok(orphan);
    assert.strictEqual(orphan.kind, 'optional'); // Must default to 'optional'
    assert.strictEqual(orphan.amount, 75);

    // It should also appear in topOptional
    const topOpt = data.topOptional.find(c => c.name === 'OrphanCatWithoutRow');
    assert.ok(topOpt);
    assert.strictEqual(topOpt.kind, 'optional');
  });

  // --- Slice 7 Tests: CSV Export ---

  test('formatCsvField unit test handles exact quotes, formula injection order of operations, and non-text columns', () => {
    // 1. Escaping example: He said "Hi" must be exactly "He said ""Hi"""
    assert.strictEqual(formatCsvField('He said "Hi"', true), '"He said ""Hi"""');

    // 2. Order of operations: formula prefix first, then RFC 4180 quoting
    // =SUM(1,2) -> prefixed to '=SUM(1,2) -> comma forces quoting -> "'=SUM(1,2)"
    assert.strictEqual(formatCsvField('=SUM(1,2)', true), '"\'=SUM(1,2)"');

    // 3. Formula triggers without comma/quotes get prefixed only
    assert.strictEqual(formatCsvField('+cmd', true), '\'+cmd');
    assert.strictEqual(formatCsvField('-minus', true), '\'-minus');
    assert.strictEqual(formatCsvField('@calc', true), '\'@calc');
    assert.strictEqual(formatCsvField('\tindented', true), '\'\tindented');

    // 4. Carriage return trigger: gets prefix and is also quoted per RFC 4180
    assert.strictEqual(formatCsvField('\rreturn', true), '"\'\rreturn"');

    // 5. Non-text columns (amount, date) do NOT get formula-injection prefixing
    assert.strictEqual(formatCsvField(-5.50, false), '-5.5');
    assert.strictEqual(formatCsvField('+10.00', false), '+10.00');
    assert.strictEqual(formatCsvField('2026-10-07', false), '2026-10-07');

    // 6. Null or undefined returns empty string
    assert.strictEqual(formatCsvField(null, true), '');
    assert.strictEqual(formatCsvField(undefined, true), '');
    assert.strictEqual(formatCsvField('', true), '');
  });

  test('getLocalDateString unit test produces YYYY-MM-DD using local time', () => {
    const localDate = getLocalDateString();
    assert.match(localDate, /^\d{4}-\d{2}-\d{2}$/);
    const now = new Date();
    assert.strictEqual(localDate.startsWith(String(now.getFullYear())), true);
  });

  test('GET /api/export.csv returns 200, correct headers, no-store cache, and local date filename pattern', async () => {
    const res = await fetch(`${baseUrl}/api/export.csv`);
    assert.strictEqual(res.status, 200);

    // Headers check
    assert.strictEqual(res.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('cache-control'), 'no-store');

    // Filename pattern check: expense-tracker-\d{4}-\d{2}-\d{2}\.csv
    const disposition = res.headers.get('content-disposition');
    assert.ok(disposition);
    assert.match(disposition, /^attachment; filename="expense-tracker-\d{4}-\d{2}-\d{2}\.csv"$/);

    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    // Starts with UTF-8 BOM bytes 0xEF, 0xBB, 0xBF
    assert.strictEqual(bytes[0], 0xEF);
    assert.strictEqual(bytes[1], 0xBB);
    assert.strictEqual(bytes[2], 0xBF);

    // Header row
    const text = new TextDecoder('utf-8').decode(bytes);
    assert.ok(text.startsWith('date,type,category,note,amount\r\n'));
  });

  test('GET /api/export.csv on empty database returns exactly BOM + headerRow + CRLF with no extra blank line', async () => {
    const emptyDb = createDb(':memory:');
    const emptyApp = createApp(emptyDb);
    let emptyServer;
    await new Promise((resolve) => {
      emptyServer = emptyApp.listen(0, '127.0.0.1', resolve);
    });
    const emptyPort = emptyServer.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${emptyPort}/api/export.csv`);
      assert.strictEqual(res.status, 200);
      const buffer = await res.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      // UTF-8 BOM bytes
      assert.strictEqual(bytes[0], 0xEF);
      assert.strictEqual(bytes[1], 0xBB);
      assert.strictEqual(bytes[2], 0xBF);

      const text = new TextDecoder('utf-8').decode(bytes);
      // Exactly header + CRLF, no trailing blank line
      assert.strictEqual(text, 'date,type,category,note,amount\r\n');
    } finally {
      emptyServer.close();
      emptyDb.close();
    }
  });

  test('GET /api/export.csv formats amounts, preserves non-ASCII text, null notes, and ignores query params', async () => {
    // Isolated database for deterministic test
    const customDb = createDb(':memory:');
    const customApp = createApp(customDb);
    let customServer;
    await new Promise((resolve) => {
      customServer = customApp.listen(0, '127.0.0.1', resolve);
    });
    const customUrl = `http://127.0.0.1:${customServer.address().port}`;

    try {
      // 1. Amount 5 -> 5.00
      await fetch(`${customUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 5, category: 'Coffee', note: '', date: '2026-01-01' })
      });

      // 2. Amount 5.1 -> 5.10
      await fetch(`${customUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 5.1, category: 'Tea', note: null, date: '2026-01-02' })
      });

      // 3. Amount 1234.5 -> 1234.50 (no thousands separator, no $)
      await fetch(`${customUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 1234.5, category: 'Rent', note: 'Monthly rent', date: '2026-01-03' })
      });

      // 4. Non-ASCII note: café, 日本語
      await fetch(`${customUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 20.00, category: 'Bakery', note: 'café, 日本語', date: '2026-01-04' })
      });

      // Query with active filter parameters that match nothing: export must IGNORE filters and return all 4 rows
      const res = await fetch(`${customUrl}/api/export.csv?from=2099-01-01&to=2099-12-31&category=NonExistent&type=income`);
      assert.strictEqual(res.status, 200);

      const buffer = await res.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      // Check BOM bytes
      assert.strictEqual(bytes[0], 0xEF);
      assert.strictEqual(bytes[1], 0xBB);
      assert.strictEqual(bytes[2], 0xBF);

      const text = new TextDecoder('utf-8').decode(bytes);

      // Verify amounts formatted strictly with 2 decimals, no $, no comma separator
      assert.ok(text.includes(',5.00\r\n'));
      assert.ok(text.includes(',5.10\r\n'));
      assert.ok(text.includes(',1234.50\r\n'));

      // Verify non-ASCII note preserved byte-for-byte (and quoted due to comma in note)
      assert.ok(text.includes('"café, 日本語"'));

      // Check lines split by CRLF
      const lines = text.split('\r\n').filter(l => l.length > 0);
      assert.strictEqual(lines.length, 5); // 1 header + 4 rows

      // Verify null/empty note rows have exactly 5 columns
      const row1Cols = lines[1].split(',');
      assert.strictEqual(row1Cols.length, 5);
      assert.strictEqual(row1Cols[3], ''); // empty note
      assert.strictEqual(row1Cols[4], '5.00');

      const row2Cols = lines[2].split(',');
      assert.strictEqual(row2Cols.length, 5);
      assert.strictEqual(row2Cols[3], ''); // null note becomes empty
      assert.strictEqual(row2Cols[4], '5.10');
    } finally {
      customServer.close();
      customDb.close();
    }
  });

  test('GET /api/export.csv round-trip parses CSV and validates all original fields and chronological sorting', async () => {
    // Tiny RFC 4180 parser
    function parseCsv(csvText) {
      const rows = [];
      let currentRow = [];
      let currentField = '';
      let inQuotes = false;
      let i = 0;

      while (i < csvText.length) {
        const char = csvText[i];
        const nextChar = csvText[i + 1];

        if (inQuotes) {
          if (char === '"' && nextChar === '"') {
            currentField += '"';
            i += 2;
          } else if (char === '"') {
            inQuotes = false;
            i++;
          } else {
            currentField += char;
            i++;
          }
        } else {
          if (char === '"') {
            inQuotes = true;
            i++;
          } else if (char === ',') {
            currentRow.push(currentField);
            currentField = '';
            i++;
          } else if (char === '\r' && nextChar === '\n') {
            currentRow.push(currentField);
            rows.push(currentRow);
            currentRow = [];
            currentField = '';
            i += 2;
          } else if (char === '\n') {
            currentRow.push(currentField);
            rows.push(currentRow);
            currentRow = [];
            currentField = '';
            i++;
          } else {
            currentField += char;
            i++;
          }
        }
      }
      if (currentField !== '' || currentRow.length > 0) {
        currentRow.push(currentField);
        rows.push(currentRow);
      }
      return rows;
    }

    const customDb = createDb(':memory:');
    const customApp = createApp(customDb);
    let customServer;
    await new Promise((resolve) => {
      customServer = customApp.listen(0, '127.0.0.1', resolve);
    });
    const customUrl = `http://127.0.0.1:${customServer.address().port}`;

    try {
      // Insert in reverse date order to verify export sorts date ASC, id ASC
      await fetch(`${customUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 99.99, category: 'Tricky3', note: 'He said "Hi"', date: '2026-03-01' })
      });
      await fetch(`${customUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 42.00, category: 'Tricky2', note: '=SUM(1,2)', date: '2026-02-01' })
      });
      await fetch(`${customUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 15.50, category: 'Tricky1', note: 'Line 1\r\nLine 2', date: '2026-01-01' })
      });

      const res = await fetch(`${customUrl}/api/export.csv`);
      const buffer = await res.arrayBuffer();
      const csvText = new TextDecoder('utf-8').decode(new Uint8Array(buffer));
      const rows = parseCsv(csvText);

      // Header row
      assert.deepStrictEqual(rows[0], ['date', 'type', 'category', 'note', 'amount']);

      // 3 data rows sorted chronologically: 2026-01-01, 2026-02-01, 2026-03-01
      assert.strictEqual(rows.length, 4);

      // Row 1: 2026-01-01, Line 1\r\nLine 2
      assert.strictEqual(rows[1][0], '2026-01-01');
      assert.strictEqual(rows[1][2], 'Tricky1');
      assert.strictEqual(rows[1][3], 'Line 1\r\nLine 2');
      assert.strictEqual(rows[1][4], '15.50');

      // Row 2: 2026-02-01, '=SUM(1,2) (formula injection prefix preserved)
      assert.strictEqual(rows[2][0], '2026-02-01');
      assert.strictEqual(rows[2][2], 'Tricky2');
      assert.strictEqual(rows[2][3], "'=SUM(1,2)");
      assert.strictEqual(rows[2][4], '42.00');

      // Row 3: 2026-03-01, He said "Hi"
      assert.strictEqual(rows[3][0], '2026-03-01');
      assert.strictEqual(rows[3][2], 'Tricky3');
      assert.strictEqual(rows[3][3], 'He said "Hi"');
      assert.strictEqual(rows[3][4], '99.99');
    } finally {
      customServer.close();
      customDb.close();
    }
  });
});




