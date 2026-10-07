# Expense Tracker – Project Context

A web app where a user records income/expenses, stores them in a database,
and gets summaries to plan their budget. No AI. One project, one server.

## Stack (keep it minimal)
- Node.js 20 + Express (serves the API *and* the frontend)
- SQLite via `better-sqlite3` (file: `data/app.db`)
- Frontend: plain HTML/CSS/JS in `/public` (no framework), Chart.js via CDN
- Tests: built-in `node --test` (no test framework dependency)

## Structure
```
server.js          Express app + routes
db.js              SQLite connection + schema
/public            index.html, app.js, style.css
/tests             API tests
PLAN.md            feature slices (the roadmap)
```
Keep it flat. Don't create new folders or files unless a slice needs it.

## Data model (SQLite)
transactions(id INTEGER PK, type 'income'|'expense', amount REAL > 0,
category TEXT, note TEXT, date TEXT 'YYYY-MM-DD', created_at TEXT)
categories(id, name UNIQUE, kind 'essential'|'optional')   -- added in slice 4
budgets(id, category, monthly_limit)                       -- added in slice 5

## Commands
`npm install` · `npm start` (http://localhost:3000) · `npm test`

## How we work: vertical slices
- Build ONE feature at a time, end to end: DB change → API endpoint → UI → test.
- Never build a whole layer (all backend or all frontend) ahead of features.
- Every slice must end in a working demo the user can click through.
- Work from PLAN.md in order. Use the `/build-slice` workflow.

## Rules
- Validate input on the server (amount > 0, valid date, category required); show errors in the UI.
- Use parameterized SQL only; never string-concatenate queries.
- Insert user text with `textContent`, never `innerHTML`.
- Ask before adding any dependency or file beyond the structure above.
- Keep code simple and commented where non-obvious; explain briefly, beginner-friendly.
