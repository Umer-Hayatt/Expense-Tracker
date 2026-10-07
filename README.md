# Expense Tracker

A lightweight, minimal web application to record income and expenses, track monthly budgets, and analyze spending patterns. Built with Node.js, Express, SQLite, and vanilla frontend technologies without heavyweight frameworks or AI dependencies.

## Tech Stack
- **Backend**: Node.js + Express
- **Database**: SQLite via `better-sqlite3` (stored in `data/app.db`)
- **Frontend**: Plain HTML5, CSS3, JavaScript (`/public`), Chart.js via CDN
- **Testing**: Built-in `node --test` runner (no external test framework)

## Getting Started

### Installation
```bash
npm install
```

### Running Locally
```bash
npm start
```
Open [http://localhost:3000](http://localhost:3000) in your browser. The SQLite database (`data/app.db`) and its schema will be initialized automatically on startup.

### Running Tests
```bash
npm test
```

## Features (7 Slices)
1. **Transaction Recording**: Add income and expense entries with amounts, categories, dates, and optional notes.
2. **Editing & Deletion**: Update transaction details with form pre-fill or delete transactions with confirmation.
3. **Filtering & Summaries**: Filter by date range, category, and transaction type. Live summary cards compute total income, total expenses, and net balance.
4. **Essential vs Optional Categorization**: Tag categories as essential or optional to monitor discretionary spending.
5. **Budgets & Warnings**: Set monthly category spending limits. Progress bars visually track usage with warning (≥80%) and over-budget (>100%) badges.
6. **Spending Insights**: Doughnut chart distribution, "Where you could cut back" recommendations, ranked category spending, and month-over-month comparison.
7. **CSV Export**: One-click download (`/api/export.csv`) of all transactions in RFC 4180 CSV with UTF-8 BOM and formula-injection security.

## Known Limitations
- **Single User**: Designed for personal local use with no multi-tenancy or user accounts.
- **No Authentication**: Runs directly without login or permission boundaries.
- **Category Management**: Categories are automatically created from transactions and can have their kind toggled (Essential/Optional), but cannot be manually renamed or deleted.
