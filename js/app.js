// STATE
let trades = [];
let accounts = [];
let settings = DEFAULT_SETTINGS;
let nextId = 1;
let nextAccountId = 1;
let editingId = null;
let selectedRating = 3;
let btChartInstance = null;
let pnlChartInstance = null;
let dayChartInstance = null;
let setupChartInstance = null;
let timeChartInstance = null;
let mfeChartInstance = null;
let weekChartInstance = null;

// DOM REFS
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const hamburger = document.getElementById('hamburger');
const closeSidebarBtn = document.getElementById('closeSidebar');
const tradeModal = document.getElementById('tradeModal');
const pages = document.querySelectorAll('.page');
const navItems = document.querySelectorAll('.nav-item[data-page]');

// A trade is "open" (position still live) when it has no exit price yet.
function isClosedTrade(t) { return t.pnl !== null && t.pnl !== undefined; }
function closedTrades() { return trades.filter(isClosedTrade); }

// STATE LOAD / PERSIST
function loadState() {
  if (isFirstRun()) {
    trades = [...SAMPLE_TRADES];
    accounts = [...SAMPLE_ACCOUNTS];
    settings = { ...DEFAULT_SETTINGS };
    nextId = trades.length + 1;
    nextAccountId = accounts.length + 1;
    persistAll();
  } else {
    trades = loadTrades() || [...SAMPLE_TRADES];
    accounts = loadAccounts() || [...SAMPLE_ACCOUNTS];
    settings = loadSettings();
    nextId = loadNextId(trades.reduce((m, t) => Math.max(m, t.id), 0) + 1);
    nextAccountId = loadNextAccountId(accounts.reduce((m, a) => Math.max(m, a.id), 0) + 1);
  }
}

function persistTrades() { saveTrades(trades); saveNextId(nextId); }
function persistAccounts() { saveAccounts(accounts); saveNextAccountId(nextAccountId); }
function persistSettings() { saveSettings(settings); }
function persistAll() { persistTrades(); persistAccounts(); persistSettings(); }

// INIT
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  document.getElementById('currentDate').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  document.getElementById('f-date').value = new Date().toISOString().split('T')[0];
  populateAccountSelects();
  renderRecentTrades();
  renderAISummary();
  renderJournal();
  renderPlaybook();
  renderAIInsights();
  renderSpaces();
  renderAccountsPage();
  renderSettingsPage();
  renderGoalCard();
  updateDashboardStats();
  renderAnalyticsStats();
  initStars();
  setupEventListeners();
  setTimeout(() => {
    renderDashboardCharts();
    renderAnalyticsCharts();
  }, 100);
  window.addEventListener('storage', handleCrossTabStorageChange);
});

// Keeps every open tab in sync: if trades/accounts/settings change in
// localStorage from another tab (e.g. a Reset Data there), pick up the
// change here too instead of showing stale data.
function handleCrossTabStorageChange(e) {
  if (!e.key || ![STORAGE_KEYS.trades, STORAGE_KEYS.accounts, STORAGE_KEYS.settings].includes(e.key)) return;
  loadState();
  document.getElementById('searchTrades').value = '';
  document.getElementById('filterResult').value = 'all';
  document.getElementById('filterSetup').value = 'all';
  populateAccountSelects();
  renderRecentTrades();
  renderJournal();
  updateDashboardStats();
  renderDashboardCharts();
  renderAnalyticsStats();
  renderAnalyticsCharts();
  renderAccountsPage();
  renderSettingsPage();
  renderGoalCard();
}

// NAV
function navigateTo(pageId) {
  pages.forEach(p => p.classList.remove('active'));
  navItems.forEach(n => n.classList.remove('active'));
  const target = document.getElementById('page-' + pageId);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-item[data-page="' + pageId + '"]').forEach(n => n.classList.add('active'));
  closeMobileMenu();
  if (pageId === 'analytics') { renderAnalyticsStats(); setTimeout(renderAnalyticsCharts, 100); }
  if (pageId === 'accounts') renderAccountsPage();
  if (pageId === 'settings') renderSettingsPage();
}

function setupEventListeners() {
  // Nav
  navItems.forEach(item => {
    item.addEventListener('click', (e) => { e.preventDefault(); navigateTo(item.dataset.page); });
  });
  // Mobile menu
  hamburger.addEventListener('click', openMobileMenu);
  closeSidebarBtn.addEventListener('click', closeMobileMenu);
  overlay.addEventListener('click', closeMobileMenu);
  // Trade modal triggers
  document.getElementById('addTradeBtn').addEventListener('click', () => openAddTradeModal());
  document.getElementById('journalAddBtn').addEventListener('click', () => openAddTradeModal());
  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('cancelModal').addEventListener('click', closeModal);
  document.getElementById('saveTradeBtn').addEventListener('click', saveTrade);
  // Filters
  document.getElementById('searchTrades').addEventListener('input', renderJournal);
  document.getElementById('filterResult').addEventListener('change', renderJournal);
  document.getElementById('filterSetup').addEventListener('change', renderJournal);
  document.getElementById('filterAccount').addEventListener('change', renderJournal);
  // AI Chat
  document.getElementById('chatSendBtn').addEventListener('click', sendAIMessage);
  document.getElementById('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendAIMessage(); });
  // Backtest
  document.getElementById('runBacktestBtn').addEventListener('click', runBacktest);
  // Playbook add
  document.getElementById('addPlaybookBtn').addEventListener('click', () => alert('Strategy builder coming soon!'));
  // Accounts
  document.getElementById('addAccountBtn').addEventListener('click', () => { navigateTo('settings'); document.getElementById('new-account-name').focus(); });
  document.getElementById('addAccountInlineBtn').addEventListener('click', addAccount);
  // Settings: daily goal
  document.getElementById('saveGoalBtn').addEventListener('click', saveGoalSetting);
  // Settings: Google Sheets
  document.getElementById('exportSheetsBtn').addEventListener('click', handleExportToSheets);
  document.getElementById('exportCsvBtn').addEventListener('click', () => exportTradesToCSV(trades));
  // Settings: Interactive Brokers
  document.getElementById('ibkrImportBtn').addEventListener('click', handleIBKRImport);
  // Settings: reset
  document.getElementById('resetDataBtn').addEventListener('click', handleResetData);
}

function openMobileMenu() {
  sidebar.classList.add('open');
  overlay.classList.add('active');
}
function closeMobileMenu() {
  sidebar.classList.remove('open');
  overlay.classList.remove('active');
}

// ACCOUNTS
function populateAccountSelects() {
  const names = accounts.map(a => a.name);
  const fAccount = document.getElementById('f-account');
  const currentF = fAccount.value;
  fAccount.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
  if (names.includes(currentF)) fAccount.value = currentF;

  const filterAccount = document.getElementById('filterAccount');
  const currentFilter = filterAccount.value;
  filterAccount.innerHTML = `<option value="all">All Accounts</option>` + names.map(n => `<option value="${n}">${n}</option>`).join('');
  filterAccount.value = names.includes(currentFilter) ? currentFilter : 'all';
}

function addAccount() {
  const name = document.getElementById('new-account-name').value.trim();
  const broker = document.getElementById('new-account-broker').value.trim() || 'Manual';
  if (!name) { alert('Enter an account name.'); return; }
  if (accounts.some(a => a.name.toLowerCase() === name.toLowerCase())) { alert('An account with that name already exists.'); return; }
  accounts.push({ id: nextAccountId++, name, broker });
  persistAccounts();
  document.getElementById('new-account-name').value = '';
  document.getElementById('new-account-broker').value = '';
  populateAccountSelects();
  renderSettingsPage();
  renderAccountsPage();
}

function deleteAccount(id) {
  const acc = accounts.find(a => a.id === id);
  if (!acc) return;
  const inUse = trades.some(t => t.account === acc.name);
  if (inUse && !confirm(`"${acc.name}" has trades logged against it. Delete the account anyway? Trades will keep the account name as a label.`)) return;
  if (accounts.length === 1) { alert('You need at least one account.'); return; }
  accounts = accounts.filter(a => a.id !== id);
  persistAccounts();
  populateAccountSelects();
  renderSettingsPage();
  renderAccountsPage();
}

function computeAccountStats(accountName) {
  const accTrades = trades.filter(t => t.account === accountName);
  const closed = accTrades.filter(isClosedTrade);
  const open = accTrades.length - closed.length;
  const total = closed.length;
  const wins = closed.filter(t => t.pnl > 0);
  const losses = closed.filter(t => t.pnl < 0);
  const pnl = closed.reduce((s, t) => s + t.pnl, 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss) : (grossWin > 0 ? Infinity : 0);
  const avgR = total ? closed.reduce((s, t) => s + (t.r || 0), 0) / total : 0;
  return {
    total, open, wins: wins.length, losses: losses.length,
    winRate: total ? Math.round((wins.length / total) * 100) : 0,
    pnl: parseFloat(pnl.toFixed(2)),
    profitFactor: isFinite(profitFactor) ? parseFloat(profitFactor.toFixed(2)) : '∞',
    avgR: parseFloat(avgR.toFixed(2)),
  };
}

function renderAccountsPage() {
  const grid = document.getElementById('accountsGrid');
  if (!grid) return;
  grid.innerHTML = accounts.map(a => {
    const s = computeAccountStats(a.name);
    return `
    <div class="card account-card">
      <div class="account-card-header">
        <div>
          <div class="account-name">${a.name}</div>
          <div class="account-broker">${a.broker}</div>
        </div>
        <button class="icon-btn del" onclick="deleteAccount(${a.id})" title="Delete Account"><i class="fa fa-trash"></i></button>
      </div>
      <div class="account-stats-grid">
        <div class="account-stat"><span class="account-stat-label">Net P&L</span><span class="account-stat-value" style="color:${s.pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${s.pnl >= 0 ? '+' : ''}$${Math.abs(s.pnl).toFixed(2)}</span></div>
        <div class="account-stat"><span class="account-stat-label">Win Rate</span><span class="account-stat-value">${s.winRate}%</span></div>
        <div class="account-stat"><span class="account-stat-label">Closed Trades</span><span class="account-stat-value">${s.total}</span></div>
        <div class="account-stat"><span class="account-stat-label">Open</span><span class="account-stat-value">${s.open}</span></div>
        <div class="account-stat"><span class="account-stat-label">Profit Factor</span><span class="account-stat-value">${s.profitFactor}</span></div>
        <div class="account-stat"><span class="account-stat-label">Avg R</span><span class="account-stat-value">${s.avgR}R</span></div>
        <div class="account-stat"><span class="account-stat-label">W / L</span><span class="account-stat-value">${s.wins} / ${s.losses}</span></div>
      </div>
    </div>`;
  }).join('') || '<p class="page-sub">No accounts yet — add one in Settings.</p>';
}

// SETTINGS PAGE
function renderSettingsPage() {
  const goalInput = document.getElementById('set-dailyGoal');
  if (goalInput) goalInput.value = settings.dailyGoal || '';
  const clientIdInput = document.getElementById('set-googleClientId');
  if (clientIdInput) clientIdInput.value = settings.googleClientId || '';
  const sheetIdInput = document.getElementById('set-googleSheetId');
  if (sheetIdInput) sheetIdInput.value = settings.googleSheetId || '';

  const list = document.getElementById('settingsAccountsList');
  if (list) {
    list.innerHTML = accounts.map(a => `
      <div class="settings-account-row">
        <span><strong>${a.name}</strong> <span class="account-broker">· ${a.broker}</span></span>
        <button class="icon-btn del" onclick="deleteAccount(${a.id})" title="Delete"><i class="fa fa-trash"></i></button>
      </div>`).join('');
  }
}

function saveGoalSetting() {
  const val = parseFloat(document.getElementById('set-dailyGoal').value);
  if (isNaN(val) || val <= 0) { alert('Enter a valid daily goal amount greater than 0.'); return; }
  settings.dailyGoal = val;
  persistSettings();
  renderGoalCard();
  alert('Daily goal saved.');
}

// DAILY GOAL CARD
function renderGoalCard() {
  const body = document.getElementById('goalCardBody');
  if (!body) return;
  const today = new Date().toISOString().split('T')[0];
  const a = computeGoalAssessment(trades, settings.dailyGoal, today);

  if (!a.hasGoal) {
    body.innerHTML = `<p class="ai-summary">No daily goal set yet. <a href="#" class="nav-item link-action" data-page="settings">Set one in Settings</a> to get personalized end-of-day feedback.</p>`;
    document.querySelectorAll('#goalCardBody .link-action').forEach(el => el.addEventListener('click', (e) => { e.preventDefault(); navigateTo('settings'); }));
    return;
  }

  const toneClass = { success: 'goal-success', encourage: 'goal-encourage', warning: 'goal-warning', neutral: 'goal-neutral' }[a.tone] || 'goal-neutral';
  const barColor = a.tone === 'success' ? 'var(--green)' : a.tone === 'warning' ? 'var(--red)' : a.tone === 'encourage' ? 'var(--blue)' : 'var(--accent)';
  const dots = a.recentDays.map(d => `<span class="goal-dot ${d.met ? 'met' : 'miss'}" title="${d.date}: ${d.pnl >= 0 ? '+' : ''}$${d.pnl.toFixed(2)}"></span>`).join('');

  body.innerHTML = `
    <div class="goal-progress-row">
      <div class="goal-progress-text">
        <span>Today: <strong style="color:${a.todayPnl >= 0 ? 'var(--green)' : 'var(--red)'}">${a.todayPnl >= 0 ? '+' : ''}$${Math.abs(a.todayPnl).toFixed(2)}</strong></span>
        <span>Goal: <strong>$${a.dailyGoal.toFixed(2)}</strong></span>
      </div>
      <div class="goal-bar"><div class="goal-bar-fill" style="width:${a.progressPct}%; background:${barColor}"></div></div>
    </div>
    <div class="goal-feedback ${toneClass}">
      <div class="goal-feedback-title">${a.title}</div>
      <div class="goal-feedback-text">${a.message}</div>
    </div>
    <div class="goal-meta-row">
      <div class="goal-meta"><span class="goal-meta-label">Streak</span><span class="goal-meta-value">${a.streak} day${a.streak === 1 ? '' : 's'}</span></div>
      <div class="goal-meta"><span class="goal-meta-label">Reserve</span><span class="goal-meta-value" style="color:${a.reserve >= 0 ? 'var(--green)' : 'var(--red)'}">${a.reserve >= 0 ? '+' : ''}$${Math.abs(a.reserve).toFixed(2)}</span></div>
      <div class="goal-dots">${dots}</div>
    </div>
  `;
}

// GOOGLE SHEETS EXPORT
async function handleExportToSheets() {
  settings.googleClientId = document.getElementById('set-googleClientId').value.trim();
  settings.googleSheetId = document.getElementById('set-googleSheetId').value.trim();
  persistSettings();
  const status = document.getElementById('sheetsStatus');
  status.textContent = 'Connecting to Google...';
  status.className = 'settings-status pending';
  try {
    const result = await exportTradesToGoogleSheets(trades, settings, {
      onStatus: (msg) => { status.textContent = msg; },
    });
    settings.googleSheetId = result.sheetId;
    settings.googleSheetUrl = result.sheetUrl;
    persistSettings();
    document.getElementById('set-googleSheetId').value = result.sheetId;
    status.innerHTML = `Exported ${trades.length} trades. <a href="${result.sheetUrl}" target="_blank" rel="noopener">Open Sheet</a>`;
    status.className = 'settings-status success';
  } catch (err) {
    status.textContent = err.message || 'Export failed.';
    status.className = 'settings-status error';
  }
}

// INTERACTIVE BROKERS CSV IMPORT
function handleIBKRImport() {
  const fileInput = document.getElementById('ibkrFileInput');
  const status = document.getElementById('ibkrStatus');
  const file = fileInput.files[0];
  if (!file) { status.textContent = 'Choose a CSV file first.'; status.className = 'settings-status error'; return; }
  status.textContent = 'Reading file...';
  status.className = 'settings-status pending';
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = parseIBKRCsv(reader.result);
      if (!imported.length) throw new Error('No round-trip trades could be matched from this file.');
      const accountNames = new Set(accounts.map(a => a.name));
      imported.forEach(t => {
        const accountName = t.account && t.account.trim() ? t.account.trim() : accounts[0].name;
        if (!accountNames.has(accountName)) {
          accounts.push({ id: nextAccountId++, name: accountName, broker: 'Interactive Brokers' });
          accountNames.add(accountName);
        }
        const riskPerShare = Math.abs(t.entry - t.stop);
        const r = riskPerShare > 0 ? parseFloat((t.pnl / (riskPerShare * t.qty)).toFixed(2)) : 0;
        trades.push({
          id: nextId++, date: t.date, symbol: t.symbol, side: t.side, setup: 'other',
          entry: t.entry, exit: t.exit, qty: t.qty, stop: t.stop, pnl: t.pnl, r,
          rating: 3, emotion: 'focused', notes: 'Imported from Interactive Brokers CSV sync.',
          account: accountName,
        });
      });
      trades.sort((a, b) => b.date.localeCompare(a.date));
      persistTrades();
      persistAccounts();
      populateAccountSelects();
      renderJournal();
      renderRecentTrades();
      updateDashboardStats();
      renderDashboardCharts();
      renderAnalyticsStats();
      renderAnalyticsCharts();
      renderAccountsPage();
      renderGoalCard();
      status.textContent = `Imported ${imported.length} trade${imported.length === 1 ? '' : 's'} from Interactive Brokers.`;
      status.className = 'settings-status success';
      fileInput.value = '';
    } catch (err) {
      status.textContent = err.message || 'Could not parse this CSV file.';
      status.className = 'settings-status error';
    }
  };
  reader.onerror = () => { status.textContent = 'Could not read the file.'; status.className = 'settings-status error'; };
  reader.readAsText(file);
}

// RESET DATA
function handleResetData() {
  if (!confirm('This will permanently delete all trades, accounts, and settings from this browser and restore the sample data. Continue?')) return;
  resetAllData();
  loadState();
  document.getElementById('searchTrades').value = '';
  document.getElementById('filterResult').value = 'all';
  document.getElementById('filterSetup').value = 'all';
  populateAccountSelects();
  renderRecentTrades();
  renderJournal();
  updateDashboardStats();
  renderDashboardCharts();
  renderAnalyticsStats();
  renderAnalyticsCharts();
  renderAccountsPage();
  renderSettingsPage();
  renderGoalCard();
  document.getElementById('sheetsStatus').textContent = '';
  document.getElementById('ibkrStatus').textContent = '';
  alert('All data has been reset.');
}

// MODAL
function openAddTradeModal(tradeId = null) {
  editingId = tradeId;
  document.getElementById('modalTitle').textContent = tradeId ? 'Edit Trade' : 'Add Trade';
  if (tradeId) {
    const t = trades.find(x => x.id === tradeId);
    if (t) {
      document.getElementById('f-symbol').value = t.symbol;
      document.getElementById('f-date').value = t.date;
      document.getElementById('f-side').value = t.side;
      document.getElementById('f-setup').value = t.setup;
      document.getElementById('f-entry').value = t.entry;
      document.getElementById('f-exit').value = t.exit === null || t.exit === undefined ? '' : t.exit;
      document.getElementById('f-qty').value = t.qty;
      document.getElementById('f-stop').value = t.stop;
      document.getElementById('f-notes').value = t.notes;
      document.getElementById('f-emotion').value = t.emotion;
      if (t.account) document.getElementById('f-account').value = t.account;
      setRating(t.rating);
    }
  } else {
    document.getElementById('f-symbol').value = '';
    document.getElementById('f-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('f-side').value = 'long';
    document.getElementById('f-setup').value = 'breakout';
    document.getElementById('f-entry').value = '';
    document.getElementById('f-exit').value = '';
    document.getElementById('f-qty').value = '';
    document.getElementById('f-stop').value = '';
    document.getElementById('f-notes').value = '';
    document.getElementById('f-emotion').value = 'focused';
    if (accounts.length) document.getElementById('f-account').value = accounts[0].name;
    setRating(3);
  }
  tradeModal.classList.add('active');
}

function closeModal() {
  tradeModal.classList.remove('active');
  editingId = null;
}

function saveTrade() {
  const symbol = document.getElementById('f-symbol').value.trim().toUpperCase();
  const date = document.getElementById('f-date').value;
  const side = document.getElementById('f-side').value;
  const setup = document.getElementById('f-setup').value;
  const entry = parseFloat(document.getElementById('f-entry').value);
  const exitRaw = document.getElementById('f-exit').value.trim();
  const exit = exitRaw === '' ? null : parseFloat(exitRaw);
  const qty = parseInt(document.getElementById('f-qty').value) || 100;
  const stop = parseFloat(document.getElementById('f-stop').value) || (side === 'long' ? entry - 2 : entry + 2);
  const notes = document.getElementById('f-notes').value;
  const emotion = document.getElementById('f-emotion').value;
  const rating = parseInt(document.getElementById('f-rating').value);
  const account = document.getElementById('f-account').value || (accounts[0] && accounts[0].name) || 'Main';

  if (!symbol || !date || isNaN(entry) || (exit !== null && isNaN(exit))) {
    alert('Please fill in required fields: Symbol, Date, Entry Price. Exit Price can be left blank to keep the position open.');
    return;
  }

  let pnl = null, r = null;
  if (exit !== null) {
    pnl = side === 'long' ? (exit - entry) * qty : (entry - exit) * qty;
    const riskPerShare = Math.abs(entry - stop);
    r = riskPerShare > 0 ? parseFloat((pnl / (riskPerShare * qty)).toFixed(2)) : 0;
    pnl = parseFloat(pnl.toFixed(2));
  }

  if (editingId) {
    const idx = trades.findIndex(t => t.id === editingId);
    if (idx !== -1) trades[idx] = { ...trades[idx], symbol, date, side, setup, entry, exit, qty, stop, pnl, r, notes, emotion, rating, account };
  } else {
    trades.push({ id: nextId++, symbol, date, side, setup, entry, exit, qty, stop, pnl, r, notes, emotion, rating, account });
  }
  trades.sort((a, b) => b.date.localeCompare(a.date));
  persistTrades();
  closeModal();
  renderJournal();
  renderRecentTrades();
  updateDashboardStats();
  renderDashboardCharts();
  renderAnalyticsStats();
  renderAnalyticsCharts();
  renderAccountsPage();
  renderGoalCard();
}

function deleteTrade(id) {
  if (!confirm('Delete this trade?')) return;
  trades = trades.filter(t => t.id !== id);
  persistTrades();
  renderJournal();
  renderRecentTrades();
  updateDashboardStats();
  renderDashboardCharts();
  renderAnalyticsStats();
  renderAnalyticsCharts();
  renderAccountsPage();
  renderGoalCard();
}

// STAR RATING
function initStars() {
  const stars = document.querySelectorAll('.star');
  stars.forEach(star => {
    star.addEventListener('click', () => setRating(parseInt(star.dataset.val)));
    star.addEventListener('mouseover', () => highlightStars(parseInt(star.dataset.val)));
    star.addEventListener('mouseout', () => setRating(selectedRating));
  });
}
function setRating(val) {
  selectedRating = val;
  document.getElementById('f-rating').value = val;
  highlightStars(val);
}
function highlightStars(val) {
  document.querySelectorAll('.star').forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.val) <= val);
  });
}

// RENDER RECENT TRADES
function renderRecentTrades() {
  const container = document.getElementById('recentTrades');
  const recent = trades.slice(0, 5);
  container.innerHTML = recent.map(t => `
    <div class="trade-row">
      <div>
        <div class="trade-symbol">${t.symbol}</div>
        <div class="trade-setup">${t.setup} · ${t.side} · ${t.account || ''}</div>
      </div>
      ${isClosedTrade(t)
        ? `<div class="trade-pnl ${t.pnl >= 0 ? 'pos' : 'neg'}">${t.pnl >= 0 ? '+' : ''}$${Math.abs(t.pnl).toFixed(2)}</div>`
        : `<span class="tag open-position">OPEN</span>`}
    </div>`).join('');
}

// AI SUMMARY
function renderAISummary() {
  const closed = closedTrades();
  const wins = closed.filter(t => t.pnl > 0).length;
  const total = closed.length;
  const pnl = closed.reduce((s, t) => s + t.pnl, 0);
  document.getElementById('aiSummary').innerHTML = `
    <p>You have taken <strong>${total} closed trade${total === 1 ? '' : 's'}</strong> with a <strong>${total ? Math.round((wins/total)*100) : 0}% win rate</strong> and <strong>$${pnl.toFixed(2)} net P&L</strong>.</p>
    <br/>
    <p>🏆 Your best setup is <strong>Breakout</strong> with 68% win rate. Your FOMO trades are hurting you — they average <strong>-1.5R</strong>. Consider a rule: no trades after 2 losses in a row.</p>
  `;
}

function updateDashboardStats() {
  const closed = closedTrades();
  const openCount = trades.length - closed.length;
  const wins = closed.filter(t => t.pnl > 0);
  const losses = closed.filter(t => t.pnl < 0);
  const total = closed.length;
  const pnl = closed.reduce((s, t) => s + t.pnl, 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss) : (grossWin > 0 ? Infinity : 0);
  const avgR = total ? closed.reduce((s, t) => s + (t.r || 0), 0) / total : 0;

  document.getElementById('stat-pnl').textContent = (pnl >= 0 ? '+' : '') + '$' + Math.abs(pnl).toFixed(2);
  document.getElementById('stat-pnl-sub').textContent = `${total} closed trade${total === 1 ? '' : 's'}`;
  document.getElementById('stat-winrate').textContent = total ? Math.round((wins.length/total)*100) + '%' : '0%';
  document.getElementById('stat-winrate-sub').textContent = `${wins.length} of ${total} closed trades`;
  document.getElementById('stat-pf').textContent = isFinite(profitFactor) ? profitFactor.toFixed(2) : '∞';
  document.getElementById('stat-avgr').textContent = (avgR >= 0 ? '' : '') + avgR.toFixed(2) + 'R';
  document.getElementById('stat-open-sub').textContent = `${openCount} open position${openCount === 1 ? '' : 's'}`;
  renderAISummary();
}

// ANALYTICS STAT CARDS (independent of Chart.js so they always update)
function renderAnalyticsStats() {
  const totalEl = document.getElementById('an-total');
  if (!totalEl) return;
  const closed = closedTrades();
  const openCount = trades.length - closed.length;

  totalEl.textContent = trades.length;
  document.getElementById('an-open').textContent = openCount;

  const best = closed.reduce((m, t) => Math.max(m, t.pnl), 0);
  document.getElementById('an-best').textContent = (best >= 0 ? '+' : '') + '$' + Math.abs(best).toFixed(2);

  const sorted = [...closed].sort((a, b) => a.date.localeCompare(b.date));
  let cum = 0, peak = 0, maxDD = 0;
  sorted.forEach(t => {
    cum += t.pnl;
    peak = Math.max(peak, cum);
    maxDD = Math.min(maxDD, cum - peak);
  });
  document.getElementById('an-drawdown').textContent = (maxDD < 0 ? '-' : '') + '$' + Math.abs(maxDD).toFixed(2);
}

// JOURNAL
function renderJournal() {
  const search = document.getElementById('searchTrades').value.toLowerCase();
  const result = document.getElementById('filterResult').value;
  const setup = document.getElementById('filterSetup').value;
  const account = document.getElementById('filterAccount').value;
  let filtered = trades.filter(t => {
    const closed = isClosedTrade(t);
    if (search && !t.symbol.toLowerCase().includes(search)) return false;
    if (result === 'win' && !(closed && t.pnl > 0)) return false;
    if (result === 'loss' && !(closed && t.pnl < 0)) return false;
    if (result === 'open' && closed) return false;
    if (setup !== 'all' && t.setup !== setup) return false;
    if (account !== 'all' && t.account !== account) return false;
    return true;
  });
  const tbody = document.getElementById('tradeBody');
  tbody.innerHTML = filtered.map(t => {
    const closed = isClosedTrade(t);
    const pnlCell = closed
      ? `<td style="font-weight:700;color:${t.pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${t.pnl >= 0 ? '+' : ''}$${Math.abs(t.pnl).toFixed(2)}</td>`
      : `<td><span class="tag open-position">OPEN</span></td>`;
    const rCell = closed
      ? `<td style="color:${t.r >= 0 ? 'var(--green)' : 'var(--red)'}">${t.r >= 0 ? '+' : ''}${t.r}R</td>`
      : `<td>—</td>`;
    return `
    <tr>
      <td>${t.date}</td>
      <td><strong>${t.symbol}</strong></td>
      <td><span class="tag ${t.side}">${t.side.toUpperCase()}</span></td>
      <td><span class="tag ${t.setup}">${t.setup}</span></td>
      <td>${t.account || ''}</td>
      <td>$${t.entry.toFixed(2)}</td>
      <td>${closed ? '$' + t.exit.toFixed(2) : '—'}</td>
      ${pnlCell}
      ${rCell}
      <td>${'★'.repeat(t.rating)}${'☆'.repeat(5-t.rating)}</td>
      <td>
        <button class="icon-btn" onclick="openAddTradeModal(${t.id})" title="${closed ? 'Edit' : 'Edit / Close Position'}"><i class="fa fa-edit"></i></button>
        <button class="icon-btn del" onclick="deleteTrade(${t.id})" title="Delete"><i class="fa fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

// PLAYBOOK
function renderPlaybook() {
  const grid = document.getElementById('playbookGrid');
  grid.innerHTML = SAMPLE_PLAYBOOKS.map(p => `
    <div class="playbook-card">
      <div class="pb-name"><span class="tag ${p.setup}">${p.setup}</span> &nbsp;${p.name}</div>
      <div class="pb-stats">
        <div class="pb-stat">Win Rate: <span>${p.winRate}%</span></div>
        <div class="pb-stat">Trades: <span>${p.trades}</span></div>
        <div class="pb-stat">P&L: <span style="color:var(--green)">+$${p.pnl.toLocaleString()}</span></div>
      </div>
      <div class="pb-stat" style="margin-bottom:8px">Avg: <span>${p.rr}</span></div>
      <div class="pb-desc">${p.desc}</div>
    </div>`).join('');
}

// AI INSIGHTS
function renderAIInsights() {
  const container = document.getElementById('aiInsightsCards');
  container.innerHTML = AI_INSIGHTS.map(i => `
    <div class="insight-card">
      <div class="insight-title">${i.title}</div>
      <div class="insight-text">${i.text}</div>
    </div>`).join('');
  const chatMessages = document.getElementById('chatMessages');
  chatMessages.innerHTML = `<div class="chat-msg ai">Hi! I'm Genie AI. Ask me anything about your trades — patterns, setups, risk, or performance.</div>`;
}

function sendAIMessage() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  const chatMessages = document.getElementById('chatMessages');
  chatMessages.innerHTML += `<div class="chat-msg user">${msg}</div>`;
  input.value = '';
  setTimeout(() => {
    const response = AI_RESPONSES[Math.floor(Math.random() * AI_RESPONSES.length)];
    chatMessages.innerHTML += `<div class="chat-msg ai">${response}</div>`;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }, 700);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// SPACES
function renderSpaces() {
  const grid = document.getElementById('spacesGrid');
  grid.innerHTML = SAMPLE_SPACES.map(s => `
    <div class="space-card">
      <div class="space-avatar">${s.emoji}</div>
      <div class="space-name">${s.name}</div>
      <div class="space-members"><i class="fa fa-users"></i> ${s.members} members</div>
      <div class="space-desc">${s.desc}</div>
    </div>`).join('');
}

// BACKTEST
function runBacktest() {
  const name = document.getElementById('bt-name').value || 'My Strategy';
  const risk = parseFloat(document.getElementById('bt-risk').value) || 100;
  const results = document.getElementById('backtestResults');
  results.style.display = 'block';
  const wr = Math.floor(Math.random() * 25 + 50);
  const pf = (Math.random() * 1.5 + 1.2).toFixed(2);
  const totalTrades = Math.floor(Math.random() * 50 + 30);
  const netPnl = (totalTrades * wr / 100 * risk * 2.1 - totalTrades * (1 - wr/100) * risk).toFixed(0);
  document.getElementById('btStatsGrid').innerHTML = `
    <div class="stat-card blue"><div class="stat-label">Win Rate</div><div class="stat-value">${wr}%</div></div>
    <div class="stat-card green"><div class="stat-label">Net P&L</div><div class="stat-value">+$${parseInt(netPnl).toLocaleString()}</div></div>
    <div class="stat-card purple"><div class="stat-label">Profit Factor</div><div class="stat-value">${pf}</div></div>
    <div class="stat-card orange"><div class="stat-label">Total Trades</div><div class="stat-value">${totalTrades}</div></div>`;
  renderBacktestChart(totalTrades, risk, wr);
}

// CHARTS
function getChartDefaults() {
  return { color: 'rgba(108,99,255,0.85)', grid: 'rgba(255,255,255,0.06)', text: '#94a3b8' };
}

// Parsed as local midnight (not UTC) so the weekday matches the date as typed.
function weekdayOf(dateStr) {
  return new Date(dateStr + 'T00:00:00').getDay();
}

function renderDashboardCharts() {
  if (typeof Chart === 'undefined') { console.warn('Chart.js failed to load; skipping chart rendering.'); return; }
  const closed = closedTrades();
  const sortedTrades = [...closed].sort((a, b) => a.date.localeCompare(b.date));
  let cum = 0;
  const labels = sortedTrades.map(t => t.date.slice(5));
  const data = sortedTrades.map(t => { cum += t.pnl; return parseFloat(cum.toFixed(2)); });
  const c = getChartDefaults();

  if (pnlChartInstance) pnlChartInstance.destroy();
  pnlChartInstance = new Chart(document.getElementById('pnlChart'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Cum P&L', data, borderColor: '#6c63ff', backgroundColor: 'rgba(108,99,255,0.15)', fill: true, tension: 0.3, pointRadius: 3 }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: c.text, maxTicksLimit: 8 }, grid: { color: c.grid } }, y: { ticks: { color: c.text }, grid: { color: c.grid } } }, responsive: true }
  });

  const dayNames = ['Mon','Tue','Wed','Thu','Fri'];
  const dayIndexes = [1, 2, 3, 4, 5]; // Date.getDay(): Sun=0 ... Sat=6
  const dayPnl = dayIndexes.map(idx => closed.filter(t => weekdayOf(t.date) === idx).reduce((s, t) => s + t.pnl, 0));
  if (dayChartInstance) dayChartInstance.destroy();
  dayChartInstance = new Chart(document.getElementById('dayChart'), {
    type: 'bar',
    data: { labels: dayNames, datasets: [{ label: 'P&L by Day', data: dayPnl, backgroundColor: dayPnl.map(v => v >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)') }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: c.text }, grid: { color: c.grid } }, y: { ticks: { color: c.text }, grid: { color: c.grid } } }, responsive: true }
  });
}

function renderAnalyticsCharts() {
  if (typeof Chart === 'undefined') { console.warn('Chart.js failed to load; skipping chart rendering.'); return; }
  const c = getChartDefaults();
  const closed = closedTrades();
  const setups = ['breakout','reversal','momentum','scalp'];
  const setupPnl = setups.map(s => closed.filter(t => t.setup === s).reduce((sum, t) => sum + t.pnl, 0));

  if (setupChartInstance) setupChartInstance.destroy();
  setupChartInstance = new Chart(document.getElementById('setupChart'), {
    type: 'bar',
    data: { labels: setups, datasets: [{ data: setupPnl, backgroundColor: ['rgba(59,130,246,0.7)','rgba(108,99,255,0.7)','rgba(245,158,11,0.7)','rgba(0,212,170,0.7)'] }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: c.text }, grid: { color: c.grid } }, y: { ticks: { color: c.text }, grid: { color: c.grid } } }, responsive: true }
  });

  // P&L by Symbol: real totals from closed trades, top 8 by absolute impact.
  const bySymbol = {};
  closed.forEach(t => { bySymbol[t.symbol] = (bySymbol[t.symbol] || 0) + t.pnl; });
  const symbolEntries = Object.entries(bySymbol).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8);
  if (timeChartInstance) timeChartInstance.destroy();
  timeChartInstance = new Chart(document.getElementById('timeChart'), {
    type: 'bar',
    data: { labels: symbolEntries.map(e => e[0]), datasets: [{ label: 'P&L by Symbol', data: symbolEntries.map(e => parseFloat(e[1].toFixed(2))), backgroundColor: symbolEntries.map(e => e[1] >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)') }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: c.text }, grid: { color: c.grid } }, y: { ticks: { color: c.text }, grid: { color: c.grid } } }, responsive: true }
  });

  // Risk ($ at stop) vs realized P&L — real data, no fabricated MFE/MAE.
  const riskData = closed.map(t => ({ x: parseFloat((Math.abs(t.entry - t.stop) * t.qty).toFixed(2)), y: t.pnl }));
  if (mfeChartInstance) mfeChartInstance.destroy();
  mfeChartInstance = new Chart(document.getElementById('mfeChart'), {
    type: 'scatter',
    data: { datasets: [{ label: 'Risk vs P&L', data: riskData, backgroundColor: closed.map(t => t.pnl >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)'), pointRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: 'Risk at Stop ($)', color: c.text }, ticks: { color: c.text }, grid: { color: c.grid } }, y: { title: { display: true, text: 'P&L ($)', color: c.text }, ticks: { color: c.text }, grid: { color: c.grid } } }, responsive: true }
  });

  const weekDays = ['Mon','Tue','Wed','Thu','Fri'];
  const weekIndexes = [1, 2, 3, 4, 5];
  const weekWR = weekIndexes.map(idx => {
    const dayTrades = closed.filter(t => weekdayOf(t.date) === idx);
    if (!dayTrades.length) return 0;
    const wins = dayTrades.filter(t => t.pnl > 0).length;
    return Math.round((wins / dayTrades.length) * 100);
  });
  if (weekChartInstance) weekChartInstance.destroy();
  weekChartInstance = new Chart(document.getElementById('weekChart'), {
    type: 'bar',
    data: { labels: weekDays, datasets: [{ data: weekWR, backgroundColor: weekWR.map(v => v >= 60 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)') }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: c.text }, grid: { color: c.grid } }, y: { ticks: { color: c.text }, grid: { color: c.grid } }, max: 100 }, responsive: true }
  });
}

function renderBacktestChart(totalTrades, risk, wr) {
  if (typeof Chart === 'undefined') { console.warn('Chart.js failed to load; skipping chart rendering.'); return; }
  const labels = Array.from({ length: totalTrades }, (_, i) => `T${i+1}`);
  let cum = 0;
  const data = labels.map(() => {
    const win = Math.random() < wr / 100;
    cum += win ? risk * 2.1 : -risk;
    return parseFloat(cum.toFixed(2));
  });
  if (btChartInstance) btChartInstance.destroy();
  const c = getChartDefaults();
  btChartInstance = new Chart(document.getElementById('btChart'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Backtest Equity Curve', data, borderColor: '#6c63ff', backgroundColor: 'rgba(108,99,255,0.15)', fill: true, tension: 0.3, pointRadius: 0 }] },
    options: { plugins: { legend: { labels: { color: c.text } } }, scales: { x: { ticks: { color: c.text, maxTicksLimit: 10 }, grid: { color: c.grid } }, y: { ticks: { color: c.text }, grid: { color: c.grid } } }, responsive: true }
  });
}
