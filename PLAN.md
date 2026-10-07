# Feature Slices
Each slice = DB + API + UI + test, ending with a demo. Tick when done.

- [x] **1. Add & list expenses** – project setup, `transactions` table, POST/GET `/api/transactions`, form + table in the page.
  Demo: add 3 expenses, refresh, they're still there.
- [x] **2. Edit & delete** – PUT/DELETE endpoints, edit/delete buttons, delete confirmation.
  Demo: fix a wrong amount, remove an entry.
- [x] **3. Filters & summary** – filter by date range/category/type; cards for income, expenses, balance.
  Demo: filter to one month and see totals change.
- [x] **4. Categories: essential vs optional** – `categories` table, mark each essential/optional, split spending by type.
  Demo: see how much goes to essentials vs optional spending.
  Note: category rename/delete left as a possible later task.
- [x] **5. Budgets & warnings** – `budgets` table, set monthly limit per category, progress bars, warning when near/over.
  Demo: set Food = 200, add expenses until the bar turns red.
- [x] **6. Insights charts** – spending by category (doughnut), top spending areas, month-over-month change.
  Demo: charts and a ranked "where your money goes" list.
- [x] **7. CSV export** – download all transactions as CSV.
  Demo: export and open in a spreadsheet.
