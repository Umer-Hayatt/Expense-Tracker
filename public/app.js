// State
let editingId = null;

function getCurrentLocalMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

let currentBudgetMonth = getCurrentLocalMonth();

// DOM Elements - Form
const formTitle = document.getElementById('formTitle');
const expenseForm = document.getElementById('expenseForm');
const typeInput = document.getElementById('type');
const amountInput = document.getElementById('amount');
const categoryInput = document.getElementById('category');
const dateInput = document.getElementById('date');
const noteInput = document.getElementById('note');
const submitBtn = document.getElementById('submitBtn');
const cancelBtn = document.getElementById('cancelBtn');
const errorBanner = document.getElementById('errorBanner');

// DOM Elements - Summary Cards
const totalIncomeDisplay = document.getElementById('totalIncomeDisplay');
const totalExpensesDisplay = document.getElementById('totalExpensesDisplay');
const balanceDisplay = document.getElementById('balanceDisplay');
const balanceCard = document.getElementById('balanceCard');

// DOM Elements - Essential vs Optional Split
const essentialTotalDisplay = document.getElementById('essentialTotalDisplay');
const optionalTotalDisplay = document.getElementById('optionalTotalDisplay');
const essentialPercent = document.getElementById('essentialPercent');
const optionalPercent = document.getElementById('optionalPercent');

// DOM Elements - Categories Section
const categoriesList = document.getElementById('categoriesList');
const emptyCategories = document.getElementById('emptyCategories');

// DOM Elements - Monthly Budgets Section
const budgetMonthLabel = document.getElementById('budgetMonthLabel');
const prevMonthBtn = document.getElementById('prevMonthBtn');
const nextMonthBtn = document.getElementById('nextMonthBtn');
const budgetForm = document.getElementById('budgetForm');
const budgetCategorySelect = document.getElementById('budgetCategory');
const budgetLimitInput = document.getElementById('budgetLimit');
const setBudgetBtn = document.getElementById('setBudgetBtn');
const budgetsList = document.getElementById('budgetsList');
const emptyBudgets = document.getElementById('emptyBudgets');

// DOM Elements - Filter Bar
const filterForm = document.getElementById('filterForm');
const filterFromInput = document.getElementById('filterFrom');
const filterToInput = document.getElementById('filterTo');
const filterCategorySelect = document.getElementById('filterCategory');
const filterTypeSelect = document.getElementById('filterType');
const resetFilterBtn = document.getElementById('resetFilterBtn');

// DOM Elements - Transactions Table
const transactionsTable = document.getElementById('transactionsTable');
const transactionsBody = document.getElementById('transactionsBody');
const transactionSummary = document.getElementById('transactionSummary');
const emptyState = document.getElementById('emptyState');
const emptyStateDesc = document.getElementById('emptyStateDesc');

// State - Spending Insights
let currentInsightsMonth = getCurrentLocalMonth();
let insightsChartInstance = null;

// DOM Elements - Spending Insights
const prevInsightsMonthBtn = document.getElementById('prevInsightsMonthBtn');
const nextInsightsMonthBtn = document.getElementById('nextInsightsMonthBtn');
const insightsMonthDisplay = document.getElementById('insightsMonthDisplay');
const overallCurrentVal = document.getElementById('overallCurrentVal');
const overallPrevVal = document.getElementById('overallPrevVal');
const overallChangeBadge = document.getElementById('overallChangeBadge');
const overallDiffText = document.getElementById('overallDiffText');
const cutBackList = document.getElementById('cutBackList');
const cutBackEmpty = document.getElementById('cutBackEmpty');
const insightsChartCanvas = document.getElementById('insightsChart');
const chartFallbackMsg = document.getElementById('chartFallbackMsg');
const rankedList = document.getElementById('rankedList');
const emptyRankedList = document.getElementById('emptyRankedList');
const momTable = document.getElementById('momTable');
const momTableBody = document.getElementById('momTableBody');
const emptyMomTable = document.getElementById('emptyMomTable');

/**
 * Returns today's date formatted as YYYY-MM-DD using local time.
 */
function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Formats a YYYY-MM string to human-readable month string (e.g. "October 2026").
 */
function formatMonthLabel(monthStr) {
  const [yearStr, monthNumStr] = monthStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthNumStr, 10);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Adjusts currentBudgetMonth by offset months (+1 or -1).
 */
function adjustBudgetMonth(offset) {
  const [yearStr, monthNumStr] = currentBudgetMonth.split('-');
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthNumStr, 10) + offset;

  if (month < 1) {
    month = 12;
    year -= 1;
  } else if (month > 12) {
    month = 1;
    year += 1;
  }

  currentBudgetMonth = `${year}-${String(month).padStart(2, '0')}`;
  updateBudgetMonthDisplay();
  loadBudgets();
}

function updateBudgetMonthDisplay() {
  budgetMonthLabel.textContent = formatMonthLabel(currentBudgetMonth);
}

/**
 * Displays error message in the error banner.
 */
function showError(message) {
  errorBanner.textContent = message;
  errorBanner.style.display = 'block';
}

/**
 * Clears and hides the error banner.
 */
function clearError() {
  errorBanner.textContent = '';
  errorBanner.style.display = 'none';
}

/**
 * Formats a numeric amount to standard currency string ($X.XX).
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);
}

/**
 * Returns current query string constructed from active filters.
 */
function getFilterQueryString() {
  const params = new URLSearchParams();
  const fromVal = filterFromInput.value.trim();
  const toVal = filterToInput.value.trim();
  const categoryVal = filterCategorySelect.value.trim();
  const typeVal = filterTypeSelect.value.trim();

  if (fromVal) params.append('from', fromVal);
  if (toVal) params.append('to', toVal);
  if (categoryVal) params.append('category', categoryVal);
  if (typeVal) params.append('type', typeVal);

  const str = params.toString();
  return str ? `?${str}` : '';
}

/**
 * Fetches and updates the category filter dropdown, categories toggle list,
 * and the budget category selector.
 */
async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    if (!res.ok) throw new Error('Failed to load categories');
    const categories = await res.json();

    // 1. Update filter dropdown (all categories)
    const currentFilterSelection = filterCategorySelect.value;
    filterCategorySelect.textContent = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'All Categories';
    filterCategorySelect.appendChild(defaultOption);

    let selectionStillExists = false;

    categories.forEach((cat) => {
      const opt = document.createElement('option');
      opt.value = cat.name;
      opt.textContent = cat.name;
      if (currentFilterSelection && cat.name.toLowerCase() === currentFilterSelection.toLowerCase()) {
        opt.selected = true;
        selectionStillExists = true;
      }
      filterCategorySelect.appendChild(opt);
    });

    if (!selectionStillExists) {
      filterCategorySelect.value = '';
    }

    // 2. Filter eligible expense categories (at least 1 expense or no transactions yet)
    const expenseCategories = categories.filter((c) => {
      return c.expense_count > 0 || (c.expense_count === 0 && c.income_count === 0);
    });

    // Render Categories management list
    renderCategoriesList(expenseCategories);

    // 3. Update Budget form category select
    const currentBudgetCat = budgetCategorySelect.value;
    budgetCategorySelect.textContent = '';

    if (expenseCategories.length === 0) {
      const noOpt = document.createElement('option');
      noOpt.value = '';
      noOpt.textContent = 'No eligible categories';
      budgetCategorySelect.appendChild(noOpt);
      setBudgetBtn.disabled = true;
    } else {
      setBudgetBtn.disabled = false;
      expenseCategories.forEach((cat) => {
        const opt = document.createElement('option');
        opt.value = cat.name;
        opt.textContent = cat.name;
        if (currentBudgetCat && cat.name.toLowerCase() === currentBudgetCat.toLowerCase()) {
          opt.selected = true;
        }
        budgetCategorySelect.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Error fetching categories:', err);
  }
}

/**
 * Renders the categories toggle list safely using textContent.
 */
function renderCategoriesList(categories) {
  categoriesList.textContent = '';

  if (!categories || categories.length === 0) {
    categoriesList.style.display = 'none';
    emptyCategories.style.display = 'block';
    return;
  }

  categoriesList.style.display = 'grid';
  emptyCategories.style.display = 'none';

  categories.forEach((cat) => {
    const item = document.createElement('div');
    item.className = 'category-item';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'category-name';
    nameSpan.textContent = cat.name;
    item.appendChild(nameSpan);

    const toggleGroup = document.createElement('div');
    toggleGroup.className = 'toggle-group';

    // Essential button
    const essentialBtn = document.createElement('button');
    essentialBtn.type = 'button';
    essentialBtn.className = `toggle-btn ${cat.kind === 'essential' ? 'active essential' : ''}`;
    essentialBtn.textContent = 'Essential';
    essentialBtn.addEventListener('click', () => updateCategoryKind(cat.id, 'essential'));
    toggleGroup.appendChild(essentialBtn);

    // Optional button
    const optionalBtn = document.createElement('button');
    optionalBtn.type = 'button';
    optionalBtn.className = `toggle-btn ${cat.kind === 'optional' ? 'active optional' : ''}`;
    optionalBtn.textContent = 'Optional';
    optionalBtn.addEventListener('click', () => updateCategoryKind(cat.id, 'optional'));
    toggleGroup.appendChild(optionalBtn);

    item.appendChild(toggleGroup);
    categoriesList.appendChild(item);
  });
}

/**
 * Updates a category's kind via PATCH and updates summary.
 */
async function updateCategoryKind(id, newKind) {
  clearError();
  try {
    const res = await fetch(`/api/categories/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: newKind })
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Failed to update category.');
      return;
    }

    await loadCategories();
    await loadSummary();
    await loadInsights();
  } catch (err) {
    showError(err.message || 'Network error updating category.');
  }
}

/**
 * Fetches and renders monthly budgets for the selected month.
 */
async function loadBudgets() {
  const targetMonth = currentBudgetMonth;
  try {
    const res = await fetch(`/api/budgets?month=${encodeURIComponent(targetMonth)}`);
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to load budgets');
    }
    const budgets = await res.json();

    // Guard against stale asynchronous responses
    if (targetMonth !== currentBudgetMonth) {
      return;
    }

    renderBudgetsList(budgets);
  } catch (err) {
    showError(err.message || 'Unable to load monthly budgets.');
  }
}

/**
 * Renders the budgets list with progress bars, status badges, and details.
 */
function renderBudgetsList(budgets) {
  budgetsList.textContent = '';

  if (!budgets || budgets.length === 0) {
    budgetsList.style.display = 'none';
    emptyBudgets.style.display = 'block';
    return;
  }

  budgetsList.style.display = 'flex';
  emptyBudgets.style.display = 'none';

  budgets.forEach((budget) => {
    const item = document.createElement('div');
    item.className = 'budget-item';

    // Header: category name, badge, and delete button
    const header = document.createElement('div');
    header.className = 'budget-item-header';

    const leftGroup = document.createElement('div');
    leftGroup.className = 'budget-item-left';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'budget-category-name';
    nameSpan.textContent = budget.category;
    leftGroup.appendChild(nameSpan);

    const badge = document.createElement('span');
    badge.className = `budget-status-badge status-${budget.status}`;
    if (budget.status === 'ok') badge.textContent = 'OK';
    else if (budget.status === 'warning') badge.textContent = 'Warning';
    else badge.textContent = 'Over Budget';
    leftGroup.appendChild(badge);

    header.appendChild(leftGroup);

    // Delete budget button
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-action btn-action-delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => handleDeleteBudget(budget));
    header.appendChild(deleteBtn);

    item.appendChild(header);

    // Progress Bar (capped at 100% width)
    const barTrack = document.createElement('div');
    barTrack.className = 'budget-bar-track';

    const barFill = document.createElement('div');
    barFill.className = `budget-bar-fill bar-${budget.status}`;
    const fillWidth = Math.min(100, Math.max(0, budget.percentUsed));
    barFill.style.width = `${fillWidth}%`;
    barTrack.appendChild(barFill);
    item.appendChild(barTrack);

    // Details text
    const details = document.createElement('div');
    details.className = 'budget-details';

    const leftText = document.createElement('span');
    leftText.textContent = `${formatCurrency(budget.spent)} of ${formatCurrency(budget.limit)} (${budget.percentUsed}%)`;
    details.appendChild(leftText);

    const rightText = document.createElement('span');
    if (budget.status === 'over') {
      rightText.className = 'over-text';
      rightText.textContent = `Over by ${formatCurrency(Math.abs(budget.remaining))}`;
    } else {
      rightText.textContent = `${formatCurrency(budget.remaining)} remaining`;
    }
    details.appendChild(rightText);

    item.appendChild(details);
    budgetsList.appendChild(item);
  });
}

/**
 * Handles setting / updating a budget limit.
 */
async function handleBudgetSubmit(event) {
  event.preventDefault();
  clearError();

  const categoryVal = budgetCategorySelect.value.trim();
  const limitVal = budgetLimitInput.value.trim();

  if (!categoryVal) {
    showError('Please select a category.');
    return;
  }

  if (!limitVal || isNaN(Number(limitVal)) || Number(limitVal) <= 0) {
    showError('Please enter a valid positive monthly limit.');
    budgetLimitInput.focus();
    return;
  }

  setBudgetBtn.disabled = true;

  try {
    const res = await fetch('/api/budgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: categoryVal,
        limit: limitVal
      })
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Failed to save budget.');
      return;
    }

    budgetLimitInput.value = '';
    await loadBudgets();
  } catch (err) {
    showError(err.message || 'Network error saving budget.');
  } finally {
    setBudgetBtn.disabled = false;
  }
}

/**
 * Handles deleting a budget.
 */
async function handleDeleteBudget(budget) {
  clearError();
  const confirmed = window.confirm(`Are you sure you want to delete the budget for ${budget.category}?`);
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/budgets/${budget.id}`, {
      method: 'DELETE'
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Failed to delete budget.');
      return;
    }

    await loadBudgets();
  } catch (err) {
    showError(err.message || 'Network error deleting budget.');
  }
}

/**
 * Fetches summary financial metrics from server using active filters.
 */
async function loadSummary() {
  try {
    const queryString = getFilterQueryString();
    const res = await fetch(`/api/summary${queryString}`);
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to load summary');
    }

    const summary = await res.json();
    totalIncomeDisplay.textContent = formatCurrency(summary.totalIncome);
    totalExpensesDisplay.textContent = formatCurrency(summary.totalExpenses);

    // Net balance display & color state
    if (summary.balance < 0) {
      balanceDisplay.textContent = `-${formatCurrency(Math.abs(summary.balance))}`;
      balanceCard.classList.add('balance-negative');
      balanceCard.classList.remove('balance-positive');
    } else {
      balanceDisplay.textContent = formatCurrency(summary.balance);
      balanceCard.classList.add('balance-positive');
      balanceCard.classList.remove('balance-negative');
    }

    // Essential vs Optional Spending Breakdown
    const ess = summary.essentialTotal || 0;
    const opt = summary.optionalTotal || 0;
    essentialTotalDisplay.textContent = formatCurrency(ess);
    optionalTotalDisplay.textContent = formatCurrency(opt);

    if (summary.totalExpenses <= 0) {
      essentialPercent.textContent = 'No spending';
      optionalPercent.textContent = 'No spending';
    } else {
      const essPct = Math.round((ess / summary.totalExpenses) * 100);
      const optPct = Math.round((opt / summary.totalExpenses) * 100);
      essentialPercent.textContent = `${essPct}% of spending`;
      optionalPercent.textContent = `${optPct}% of spending`;
    }
  } catch (err) {
    showError(err.message || 'Unable to update financial summary.');
  }
}

/**
 * Fetches transactions matching active filters and updates the table.
 */
async function loadTransactions() {
  try {
    const queryString = getFilterQueryString();
    const res = await fetch(`/api/transactions${queryString}`);
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to load transactions');
    }
    const transactions = await res.json();
    renderTransactions(transactions);
  } catch (err) {
    showError(err.message || 'Unable to load transactions.');
  }
}

/**
 * Reloads all data (categories, summary cards, transactions table, and budgets).
 */
async function refreshAll() {
  await loadCategories();
  await loadSummary();
  await loadTransactions();
  await loadBudgets();
  await loadInsights();
}

/**
 * Renders transactions list safely using textContent (no innerHTML).
 */
function renderTransactions(transactions) {
  transactionsBody.textContent = '';

  if (!transactions || transactions.length === 0) {
    transactionsTable.style.display = 'none';
    emptyState.style.display = 'block';
    emptyStateDesc.textContent = 'No transactions match the selected filters or none have been added yet.';
    transactionSummary.textContent = '0 transactions';
    return;
  }

  transactionsTable.style.display = 'table';
  emptyState.style.display = 'none';

  transactions.forEach((tx) => {
    const row = document.createElement('tr');

    // Date column
    const dateCell = document.createElement('td');
    dateCell.textContent = tx.date;
    row.appendChild(dateCell);

    // Category column
    const catCell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge-category';
    badge.textContent = tx.category;
    catCell.appendChild(badge);
    row.appendChild(catCell);

    // Note column
    const noteCell = document.createElement('td');
    noteCell.textContent = tx.note || '-';
    row.appendChild(noteCell);

    // Amount column (styled with +/- and distinct colors for income vs expense)
    const amtCell = document.createElement('td');
    amtCell.className = 'text-right';
    const amtSpan = document.createElement('span');

    if (tx.type === 'income') {
      amtSpan.className = 'amount-income';
      amtSpan.textContent = `+${formatCurrency(tx.amount)}`;
    } else {
      amtSpan.className = 'amount-expense';
      amtSpan.textContent = `-${formatCurrency(tx.amount)}`;
    }
    amtCell.appendChild(amtSpan);
    row.appendChild(amtCell);

    // Actions column
    const actionsCell = document.createElement('td');
    actionsCell.className = 'text-right';
    const actionWrapper = document.createElement('div');
    actionWrapper.className = 'actions-cell';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-action btn-action-edit';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => startEdit(tx));
    actionWrapper.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-action btn-action-delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => handleDelete(tx));
    actionWrapper.appendChild(deleteBtn);

    actionsCell.appendChild(actionWrapper);
    row.appendChild(actionsCell);

    transactionsBody.appendChild(row);
  });

  const countText = transactions.length === 1 ? '1 transaction' : `${transactions.length} transactions`;
  transactionSummary.textContent = `Showing ${countText}`;
}

/**
 * Resets form back to Add mode.
 */
function resetFormMode() {
  editingId = null;
  formTitle.textContent = 'Add New Transaction';
  typeInput.value = 'expense';
  submitBtn.querySelector('.btn-text').textContent = 'Add Transaction';
  cancelBtn.style.display = 'none';
  expenseForm.reset();
  typeInput.value = 'expense';
  dateInput.value = getTodayDateString();
}

/**
 * Switches the form into Edit mode for a specific transaction.
 */
function startEdit(tx) {
  clearError();
  editingId = tx.id;
  typeInput.value = tx.type;
  formTitle.textContent = tx.type === 'income' ? 'Edit Income' : 'Edit Expense';
  submitBtn.querySelector('.btn-text').textContent = 'Save changes';
  cancelBtn.style.display = 'inline-block';

  amountInput.value = tx.amount;
  categoryInput.value = tx.category;
  dateInput.value = tx.date;
  noteInput.value = tx.note || '';

  expenseForm.scrollIntoView({ behavior: 'smooth' });
  amountInput.focus();
}

/**
 * Updates form title if user changes type select while in edit mode.
 */
typeInput.addEventListener('change', () => {
  if (editingId !== null) {
    formTitle.textContent = typeInput.value === 'income' ? 'Edit Income' : 'Edit Expense';
  }
});

/**
 * Handles deleting a transaction with user confirmation.
 */
async function handleDelete(tx) {
  clearError();
  const confirmed = window.confirm(`Are you sure you want to delete this ${tx.type} for ${tx.category} ($${tx.amount})?`);
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/transactions/${tx.id}`, {
      method: 'DELETE'
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Failed to delete transaction.');
      if (res.status === 404) {
        if (editingId === tx.id) resetFormMode();
        await refreshAll();
      }
      return;
    }

    if (editingId === tx.id) {
      resetFormMode();
    }

    await refreshAll();
  } catch (err) {
    showError(err.message || 'Network error occurred while deleting.');
  }
}

/**
 * Handles transaction form submission (Create or Update).
 */
async function handleSubmit(event) {
  event.preventDefault();
  clearError();

  const typeVal = typeInput.value.trim();
  const amountVal = amountInput.value.trim();
  const categoryVal = categoryInput.value.trim();
  const dateVal = dateInput.value.trim();
  const noteVal = noteInput.value.trim();

  // Basic client pre-checks
  if (!amountVal || isNaN(Number(amountVal)) || Number(amountVal) <= 0) {
    showError('Please enter a valid positive amount.');
    amountInput.focus();
    return;
  }

  if (!categoryVal) {
    showError('Category is required.');
    categoryInput.focus();
    return;
  }

  if (!dateVal) {
    showError('Date is required.');
    dateInput.focus();
    return;
  }

  const isEditing = editingId !== null;
  submitBtn.disabled = true;
  submitBtn.querySelector('.btn-text').textContent = isEditing ? 'Saving...' : 'Adding...';

  try {
    const payload = {
      type: typeVal,
      amount: amountVal,
      category: categoryVal,
      date: dateVal,
      note: noteVal
    };

    const url = isEditing ? `/api/transactions/${editingId}` : '/api/transactions';
    const method = isEditing ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Failed to save transaction.');
      if (res.status === 404 && isEditing) {
        resetFormMode();
        await refreshAll();
      }
      return;
    }

    resetFormMode();
    await refreshAll();
  } catch (err) {
    showError(err.message || 'Network error occurred while saving.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.querySelector('.btn-text').textContent = editingId !== null ? 'Save changes' : 'Add Transaction';
  }
}

/**
 * Handles applying filters.
 */
filterForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const fromVal = filterFromInput.value.trim();
  const toVal = filterToInput.value.trim();

  if (fromVal && toVal && fromVal > toVal) {
    showError("'From' date cannot be after 'To' date.");
    return;
  }

  await loadSummary();
  await loadTransactions();
});

/**
 * Handles resetting filters.
 */
resetFilterBtn.addEventListener('click', async () => {
  clearError();
  filterFromInput.value = '';
  filterToInput.value = '';
  filterCategorySelect.value = '';
  filterTypeSelect.value = '';
  await loadSummary();
  await loadTransactions();
});

// Cancel button click handler
cancelBtn.addEventListener('click', () => {
  clearError();
  resetFormMode();
});

// Month selector arrow buttons (Budgets)
prevMonthBtn.addEventListener('click', () => adjustBudgetMonth(-1));
nextMonthBtn.addEventListener('click', () => adjustBudgetMonth(1));

// Month selector arrow buttons (Insights)
prevInsightsMonthBtn.addEventListener('click', () => adjustInsightsMonth(-1));
nextInsightsMonthBtn.addEventListener('click', () => adjustInsightsMonth(1));

// Budget form submission
budgetForm.addEventListener('submit', handleBudgetSubmit);

/**
 * Spending Insights - Month adjustment & display
 */
function adjustInsightsMonth(offset) {
  const [yearStr, monthNumStr] = currentInsightsMonth.split('-');
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthNumStr, 10) + offset;

  if (month < 1) {
    month = 12;
    year -= 1;
  } else if (month > 12) {
    month = 1;
    year += 1;
  }

  currentInsightsMonth = `${year}-${String(month).padStart(2, '0')}`;
  updateInsightsMonthDisplay();
  loadInsights();
}

function updateInsightsMonthDisplay() {
  insightsMonthDisplay.textContent = formatMonthLabel(currentInsightsMonth);
}

/**
 * Loads spending insights for the currently selected month.
 * Includes guard against stale responses if the user quickly navigates months.
 */
async function loadInsights() {
  const targetMonth = currentInsightsMonth;
  try {
    const res = await fetch(`/api/insights?month=${encodeURIComponent(targetMonth)}`);
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to load spending insights');
    }
    const data = await res.json();

    // Guard against stale asynchronous responses
    if (data.month !== currentInsightsMonth) {
      return;
    }

    renderInsights(data);
  } catch (err) {
    showError(err.message || 'Unable to load spending insights.');
  }
}

/**
 * Renders all sections of the Spending Insights card.
 */
function renderInsights(data) {
  renderOverallBanner(data);
  renderCutBack(data.topOptional);
  renderInsightsChart(data.byCategory);
  renderRankedList(data.byCategory);
  renderMomTable(data.monthOverMonth);
}

/**
 * Renders the overall month-over-month comparison banner.
 */
function renderOverallBanner(data) {
  overallCurrentVal.textContent = formatCurrency(data.overall.current);
  overallPrevVal.textContent = formatCurrency(data.overall.previous);

  if (data.overall.percentChange === null) {
    if (data.overall.current === 0 && data.overall.previous === 0) {
      overallChangeBadge.className = 'overall-badge badge-neutral';
      overallChangeBadge.textContent = 'No spending';
      overallDiffText.textContent = 'in either month';
    } else {
      overallChangeBadge.className = 'overall-badge badge-increase';
      overallChangeBadge.textContent = 'New spending';
      overallDiffText.textContent = `+$${data.overall.current.toFixed(2)} compared to last month`;
    }
  } else {
    if (data.overall.difference > 0) {
      overallChangeBadge.className = 'overall-badge badge-increase';
      overallChangeBadge.textContent = `+${data.overall.percentChange.toFixed(1)}%`;
      overallDiffText.textContent = `+$${data.overall.difference.toFixed(2)} compared to last month`;
    } else if (data.overall.difference < 0) {
      overallChangeBadge.className = 'overall-badge badge-decrease';
      overallChangeBadge.textContent = `${data.overall.percentChange.toFixed(1)}%`;
      overallDiffText.textContent = `-$${Math.abs(data.overall.difference).toFixed(2)} compared to last month`;
    } else {
      overallChangeBadge.className = 'overall-badge badge-neutral';
      overallChangeBadge.textContent = '0.0%';
      overallDiffText.textContent = 'identical to last month';
    }
  }
}

/**
 * Renders the top optional categories under "Where you could cut back".
 */
function renderCutBack(topOptional) {
  cutBackList.textContent = '';

  if (!topOptional || topOptional.length === 0) {
    cutBackList.style.display = 'none';
    cutBackEmpty.style.display = 'block';
    return;
  }

  cutBackList.style.display = 'grid';
  cutBackEmpty.style.display = 'none';

  topOptional.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'cut-back-card';

    const left = document.createElement('div');
    left.className = 'cut-back-left';

    const rank = document.createElement('span');
    rank.className = 'cut-back-rank';
    rank.textContent = String(index + 1);
    left.appendChild(rank);

    const name = document.createElement('span');
    name.className = 'cut-back-name';
    name.textContent = item.name;
    left.appendChild(name);

    card.appendChild(left);

    const amt = document.createElement('span');
    amt.className = 'cut-back-amt';
    amt.textContent = `${formatCurrency(item.amount)} (${item.percent}%)`;
    card.appendChild(amt);

    cutBackList.appendChild(card);
  });
}

/**
 * Renders the doughnut chart using Chart.js or shows an offline fallback.
 * Groups categories beyond the top 6 into "Other", preserving total 100%.
 */
function renderInsightsChart(byCategory) {
  if (typeof Chart === 'undefined') {
    if (insightsChartCanvas) insightsChartCanvas.style.display = 'none';
    if (chartFallbackMsg) chartFallbackMsg.style.display = 'block';
    return;
  }

  if (chartFallbackMsg) chartFallbackMsg.style.display = 'none';
  if (insightsChartCanvas) insightsChartCanvas.style.display = 'block';

  if (insightsChartInstance) {
    insightsChartInstance.destroy();
    insightsChartInstance = null;
  }

  if (!byCategory || byCategory.length === 0) {
    if (insightsChartCanvas) {
      insightsChartCanvas.style.display = 'none';
      insightsChartCanvas.setAttribute('aria-label', 'No spending recorded for this month');
    }
    if (chartFallbackMsg) {
      chartFallbackMsg.textContent = 'No spending recorded for this month.';
      chartFallbackMsg.style.display = 'block';
    }
    return;
  }

  let labels = [];
  let dataPoints = [];
  const palette = [
    '#0284c7', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#94a3b8'
  ];

  if (byCategory.length <= 6) {
    labels = byCategory.map(c => `${c.name} (${c.percent}%)`);
    dataPoints = byCategory.map(c => c.amount);
  } else {
    const top6 = byCategory.slice(0, 6);
    const rest = byCategory.slice(6);
    const otherAmount = Math.round(rest.reduce((sum, it) => sum + it.amount, 0) * 100) / 100;
    const otherPercent = rest.reduce((sum, it) => sum + it.percent, 0);

    labels = top6.map(c => `${c.name} (${c.percent}%)`);
    dataPoints = top6.map(c => c.amount);

    labels.push(`Other (${otherPercent}%)`);
    dataPoints.push(otherAmount);
  }

  insightsChartCanvas.setAttribute('aria-label', `Spending breakdown: ${labels.join(', ')}`);

  const ctx = insightsChartCanvas.getContext('2d');
  insightsChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: dataPoints,
        backgroundColor: palette.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 12,
            padding: 10,
            font: { family: 'Inter', size: 11 }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const val = Number(context.raw || 0);
              return ` $${val.toFixed(2)}`;
            }
          }
        }
      }
    }
  });
}

/**
 * Renders the ranked list of ALL categories ("Where your money goes").
 */
function renderRankedList(byCategory) {
  rankedList.textContent = '';

  if (!byCategory || byCategory.length === 0) {
    rankedList.style.display = 'none';
    emptyRankedList.style.display = 'block';
    return;
  }

  rankedList.style.display = 'flex';
  emptyRankedList.style.display = 'none';

  byCategory.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'ranked-item';

    const left = document.createElement('div');
    left.className = 'ranked-left';

    const rank = document.createElement('span');
    rank.className = 'ranked-num';
    rank.textContent = String(index + 1);
    left.appendChild(rank);

    const name = document.createElement('span');
    name.className = 'ranked-name';
    name.textContent = item.name;
    left.appendChild(name);

    const kindBadge = document.createElement('span');
    kindBadge.className = `toggle-btn active ${item.kind === 'essential' ? 'essential' : 'optional'}`;
    kindBadge.style.cursor = 'default';
    kindBadge.textContent = item.kind === 'essential' ? 'Essential' : 'Optional';
    left.appendChild(kindBadge);

    row.appendChild(left);

    const right = document.createElement('div');
    right.className = 'ranked-right';

    const amt = document.createElement('span');
    amt.className = 'ranked-amount';
    amt.textContent = formatCurrency(item.amount);
    right.appendChild(amt);

    const pct = document.createElement('span');
    pct.className = 'ranked-pct';
    pct.textContent = `${item.percent}%`;
    right.appendChild(pct);

    row.appendChild(right);

    rankedList.appendChild(row);
  });
}

/**
 * Renders the Month-over-Month comparison table.
 */
function renderMomTable(monthOverMonth) {
  momTableBody.textContent = '';

  if (!monthOverMonth || monthOverMonth.length === 0) {
    momTable.style.display = 'none';
    emptyMomTable.style.display = 'block';
    return;
  }

  momTable.style.display = 'table';
  emptyMomTable.style.display = 'none';

  monthOverMonth.forEach((row) => {
    const tr = document.createElement('tr');

    // Category name (inserted safely with textContent)
    const catTd = document.createElement('td');
    catTd.textContent = row.category;
    tr.appendChild(catTd);

    // Kind badge
    const kindTd = document.createElement('td');
    const kindBadge = document.createElement('span');
    kindBadge.className = `toggle-btn active ${row.kind === 'essential' ? 'essential' : 'optional'}`;
    kindBadge.style.cursor = 'default';
    kindBadge.textContent = row.kind === 'essential' ? 'Essential' : 'Optional';
    kindTd.appendChild(kindBadge);
    tr.appendChild(kindTd);

    // This Month
    const currTd = document.createElement('td');
    currTd.className = 'text-right';
    currTd.textContent = formatCurrency(row.current);
    tr.appendChild(currTd);

    // Last Month
    const prevTd = document.createElement('td');
    prevTd.className = 'text-right';
    prevTd.textContent = formatCurrency(row.previous);
    tr.appendChild(prevTd);

    // Change ($)
    const diffTd = document.createElement('td');
    diffTd.className = 'text-right';
    if (row.difference > 0) {
      diffTd.textContent = `+${formatCurrency(row.difference)}`;
    } else if (row.difference < 0) {
      diffTd.textContent = `-${formatCurrency(Math.abs(row.difference))}`;
    } else {
      diffTd.textContent = '$0.00';
    }
    tr.appendChild(diffTd);

    // Change (%)
    const pctTd = document.createElement('td');
    pctTd.className = 'text-right';
    const pctBadge = document.createElement('span');

    if (row.percentChange === null) {
      pctBadge.className = 'mom-badge mom-new';
      pctBadge.textContent = 'new';
    } else if (row.current === 0) {
      pctBadge.className = 'mom-badge mom-dropped';
      pctBadge.textContent = 'dropped (-100.0%)';
    } else if (row.percentChange > 0) {
      pctBadge.className = 'mom-badge mom-inc';
      pctBadge.textContent = `+${row.percentChange.toFixed(1)}%`;
    } else if (row.percentChange < 0) {
      pctBadge.className = 'mom-badge mom-dec';
      pctBadge.textContent = `${row.percentChange.toFixed(1)}%`;
    } else {
      pctBadge.className = 'mom-badge mom-same';
      pctBadge.textContent = '0.0%';
    }

    pctTd.appendChild(pctBadge);
    tr.appendChild(pctTd);

    momTableBody.appendChild(tr);
  });
}

// Initial setup
dateInput.value = getTodayDateString();
updateBudgetMonthDisplay();
updateInsightsMonthDisplay();
expenseForm.addEventListener('submit', handleSubmit);
refreshAll();

