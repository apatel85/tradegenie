// STATE
let trades = [];
let accounts = [];
let settings = DEFAULT_SETTINGS;
let tombstones = []; // {type:'trade'|'account', id, deletedAt} — see js/integrations.js sync engine
let syncSnapshot = { trades: {}, accounts: {} };
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

// Accounting-style formatting for signed dollar amounts: losses in red and
// parentheses (e.g. "($3,000.00)"), gains in green with a "+", zero neutral.
// Returns { text, color } — callers set textContent + style.color from it.
function formatSignedMoney(amount) {
  const n = Number(amount) || 0;
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n < 0) return { text: `($${abs})`, color: 'var(--red)' };
  if (n > 0) return { text: `+$${abs}`, color: 'var(--green)' };
  return { text: `$${abs}`, color: 'var(--text)' };
}

function formatSignedR(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n).toFixed(2);
  if (n < 0) return { text: `(${abs}R)`, color: 'var(--red)' };
  if (n > 0) return { text: `+${abs}R`, color: 'var(--green)' };
  return { text: `${abs}R`, color: 'var(--text)' };
}

// Applies formatSignedMoney()/formatSignedR() to an element's text + color.
function setSignedText(elId, formatted) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = formatted.text;
  el.style.color = formatted.color;
}

// STATE LOAD / PERSIST

// Older local data may have numeric/missing ids or no updatedAt — backfill
// so every trade has a stable string id and a comparable timestamp for sync.
function migrateTradeIds(list) {
  let changed = false;
  list.forEach(t => {
    if (!t.id || typeof t.id !== 'string') { t.id = generateSyncId(); changed = true; }
    if (!t.updatedAt) { t.updatedAt = (t.date ? t.date + 'T00:00:00.000Z' : new Date().toISOString()); changed = true; }
    if (!t.securityType) { t.securityType = 'stock'; changed = true; }
    if (!t.tickValue) { t.tickValue = 1; changed = true; }
    if (t.commission === undefined || t.commission === null) { t.commission = 0; changed = true; }
    if (t.optionType === undefined) { t.optionType = ''; changed = true; }
    if (t.strike === undefined) { t.strike = null; changed = true; }
  });
  return changed;
}

// Same idea as migrateTradeIds: accounts also need a stable string id (not a
// per-device counter) plus updatedAt, so they can be synced/merged/deleted
// across devices the same way trades are.
function migrateAccountIds(list) {
  let changed = false;
  list.forEach(a => {
    if (!a.id || typeof a.id !== 'string') { a.id = generateSyncId(); changed = true; }
    if (!a.updatedAt) { a.updatedAt = new Date().toISOString(); changed = true; }
  });
  return changed;
}

function loadState() {
  if (isFirstRun()) {
    trades = [...SAMPLE_TRADES];
    accounts = SAMPLE_ACCOUNTS.map(a => ({ ...a, id: generateSyncId(), updatedAt: new Date().toISOString() }));
    settings = { ...DEFAULT_SETTINGS };
    tombstones = [];
    syncSnapshot = { trades: {}, accounts: {} };
    persistAll();
  } else {
    trades = loadTrades() || [...SAMPLE_TRADES];
    accounts = loadAccounts() || SAMPLE_ACCOUNTS.map(a => ({ ...a, id: generateSyncId(), updatedAt: new Date().toISOString() }));
    settings = loadSettings();
    tombstones = loadTombstones();
    syncSnapshot = loadSyncSnapshot();
    let changed = migrateTradeIds(trades);
    if (migrateAccountIds(accounts)) { saveAccounts(accounts); changed = true; }
    if (changed) persistTrades();
  }
}

function recordTombstone(type, id) {
  tombstones.push({ type, id, deletedAt: new Date().toISOString() });
  persistTombstones();
}

function persistTrades() { saveTrades(trades); }
function persistAccounts() { saveAccounts(accounts); }
function persistSettings() { saveSettings(settings); }
function persistTombstones() { saveTombstones(tombstones); }
function persistSyncSnapshot() { saveSyncSnapshot(syncSnapshot); }
function persistAll() { persistTrades(); persistAccounts(); persistSettings(); persistTombstones(); persistSyncSnapshot(); }

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
  // Give the Google Identity Services script (loaded async) a moment before
  // trying a silent, no-popup sync attempt.
  setTimeout(attemptSilentAutoSync, 1200);
  window.addEventListener('storage', handleCrossTabStorageChange);
});

// Keeps every open tab in sync: if trades/accounts/settings change in
// localStorage from another tab (e.g. a Reset Data there), pick up the
// change here too instead of showing stale data.
function handleCrossTabStorageChange(e) {
  if (!e.key || ![STORAGE_KEYS.trades, STORAGE_KEYS.accounts, STORAGE_KEYS.settings, STORAGE_KEYS.tombstones].includes(e.key)) return;
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
  document.getElementById('f-securityType').addEventListener('change', updateSecurityDependentFields);
  document.getElementById('lookupSymbolBtn').addEventListener('click', handleSymbolLookup);
  // Filters
  document.getElementById('searchTrades').addEventListener('input', renderJournal);
  document.getElementById('filterResult').addEventListener('change', renderJournal);
  document.getElementById('filterSetup').addEventListener('change', renderJournal);
  document.getElementById('filterAccount').addEventListener('change', renderJournal);
  document.getElementById('filterSecurity').addEventListener('change', renderJournal);
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
  document.getElementById('syncSheetsBtn').addEventListener('click', () => handleSyncSheets());
  document.getElementById('exportSheetsBtn').addEventListener('click', handleExportToSheets);
  document.getElementById('exportCsvBtn').addEventListener('click', () => exportTradesToCSV(trades));
  // Settings: Interactive Brokers
  document.getElementById('ibkrImportBtn').addEventListener('click', handleIBKRImport);
  // Settings: market data
  document.getElementById('set-finnhubKey').addEventListener('change', () => {
    settings.finnhubKey = document.getElementById('set-finnhubKey').value.trim();
    persistSettings();
  });
  document.getElementById('set-twelveDataKey').addEventListener('change', () => {
    settings.twelveDataKey = document.getElementById('set-twelveDataKey').value.trim();
    persistSettings();
  });
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
  accounts.push({ id: generateSyncId(), name, broker, updatedAt: new Date().toISOString() });
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
  recordTombstone('account', id);
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
        <button class="icon-btn del" onclick="deleteAccount('${a.id}')" title="Delete Account"><i class="fa fa-trash"></i></button>
      </div>
      <div class="account-stats-grid">
        <div class="account-stat"><span class="account-stat-label">Net P&L</span><span class="account-stat-value" style="color:${formatSignedMoney(s.pnl).color}">${formatSignedMoney(s.pnl).text}</span></div>
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
  renderLastSyncStatus();
  const finnhubInput = document.getElementById('set-finnhubKey');
  if (finnhubInput) finnhubInput.value = settings.finnhubKey || '';
  const twelveDataInput = document.getElementById('set-twelveDataKey');
  if (twelveDataInput) twelveDataInput.value = settings.twelveDataKey || '';

  const list = document.getElementById('settingsAccountsList');
  if (list) {
    list.innerHTML = accounts.map(a => `
      <div class="settings-account-row">
        <span><strong>${a.name}</strong> <span class="account-broker">· ${a.broker}</span></span>
        <button class="icon-btn del" onclick="deleteAccount('${a.id}')" title="Delete"><i class="fa fa-trash"></i></button>
      </div>`).join('');
  }
}

function saveGoalSetting() {
  const val = parseFloat(document.getElementById('set-dailyGoal').value);
  if (isNaN(val) || val <= 0) { alert('Enter a valid daily goal amount greater than 0.'); return; }
  settings.dailyGoal = val;
  settings.dailyGoalUpdatedAt = new Date().toISOString();
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
  const dots = a.recentDays.map(d => `<span class="goal-dot ${d.met ? 'met' : 'miss'}" title="${d.date}: ${formatSignedMoney(d.pnl).text}"></span>`).join('');

  body.innerHTML = `
    <div class="goal-progress-row">
      <div class="goal-progress-text">
        <span>Today: <strong style="color:${formatSignedMoney(a.todayPnl).color}">${formatSignedMoney(a.todayPnl).text}</strong></span>
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
      <div class="goal-meta"><span class="goal-meta-label">Reserve</span><span class="goal-meta-value" style="color:${formatSignedMoney(a.reserve).color}">${formatSignedMoney(a.reserve).text}</span></div>
      <div class="goal-dots">${dots}</div>
    </div>
  `;
}

// GOOGLE SHEETS SYNC
function readGoogleSettingsFromForm() {
  settings.googleClientId = document.getElementById('set-googleClientId').value.trim();
  settings.googleSheetId = document.getElementById('set-googleSheetId').value.trim();
  persistSettings();
}

// Ensures every account name referenced by (possibly remote) trades exists
// locally — a safety net for old data or CSV imports, not the normal sync
// path (accounts sync as their own entity now, see syncAllWithGoogleSheets).
function ensureAccountsForTrades(tradeList) {
  const known = new Set(accounts.map(a => a.name));
  let changed = false;
  tradeList.forEach(t => {
    const name = (t.account || '').trim();
    if (name && !known.has(name)) {
      accounts.push({ id: generateSyncId(), name, broker: 'Synced', updatedAt: new Date().toISOString() });
      known.add(name);
      changed = true;
    }
  });
  if (changed) persistAccounts();
}

function renderLastSyncStatus() {
  const el = document.getElementById('sheetsLastSync');
  if (!el) return;
  el.textContent = settings.lastSyncedAt ? `Last synced: ${new Date(settings.lastSyncedAt).toLocaleString()}` : '';
  el.className = 'settings-status';
}

function refreshAllViews() {
  populateAccountSelects();
  renderJournal();
  renderRecentTrades();
  updateDashboardStats();
  renderDashboardCharts();
  renderAnalyticsStats();
  renderAnalyticsCharts();
  renderAccountsPage();
  renderSettingsPage();
  renderGoalCard();
}

// Bundles everything that syncs into the shape the Sheets engine expects.
function buildSyncState() {
  return {
    trades,
    accounts,
    tombstones,
    syncSnapshot,
    settingsMap: {
      dailyGoal: { value: String(settings.dailyGoal), updatedAt: settings.dailyGoalUpdatedAt || '' },
    },
  };
}

// Push-only: overwrites the Sheet with exactly what's on this device (all
// years, accounts, settings, tombstones). Use "Sync Now" instead for
// keeping multiple devices lined up — this doesn't pull anything down.
async function handleExportToSheets() {
  readGoogleSettingsFromForm();
  const status = document.getElementById('sheetsStatus');
  status.textContent = 'Connecting to Google...';
  status.className = 'settings-status pending';
  try {
    const result = await exportTradesToGoogleSheets(buildSyncState(), settings, {
      onStatus: (msg) => { status.textContent = msg; },
    });
    settings.googleSheetId = result.sheetId;
    settings.googleSheetUrl = result.sheetUrl;
    settings.lastSyncedAt = new Date().toISOString();
    persistSettings();
    document.getElementById('set-googleSheetId').value = result.sheetId;
    status.innerHTML = `Pushed ${trades.length} trades, ${accounts.length} accounts (overwrote the sheet). <a href="${result.sheetUrl}" target="_blank" rel="noopener">Open Sheet</a>`;
    status.className = 'settings-status success';
    renderLastSyncStatus();
  } catch (err) {
    status.textContent = err.message || 'Export failed.';
    status.className = 'settings-status error';
  }
}

// Two-way sync: pulls every year's trades + accounts + settings from the
// master sheet, merges with what's on this device (applying deletions both
// ways, flagging genuine conflicts), and pushes the merged result back so
// every device converges. Run this on every device you use — the sheet is
// the master copy other devices read from.
async function handleSyncSheets({ interactive = true, silent = false } = {}) {
  readGoogleSettingsFromForm();
  const status = document.getElementById('sheetsStatus');
  if (!silent) { status.textContent = 'Connecting to Google...'; status.className = 'settings-status pending'; }
  try {
    const result = await syncAllWithGoogleSheets(buildSyncState(), settings, {
      onStatus: (msg) => { if (!silent) status.textContent = msg; },
      interactive,
    });
    trades = result.trades;
    accounts = result.accounts;
    tombstones = result.tombstones;
    syncSnapshot = result.syncSnapshot;
    if (result.dailyGoal && result.dailyGoal.value !== undefined) {
      settings.dailyGoal = parseFloat(result.dailyGoal.value) || settings.dailyGoal;
      settings.dailyGoalUpdatedAt = result.dailyGoal.updatedAt || settings.dailyGoalUpdatedAt;
    }
    ensureAccountsForTrades(trades);
    persistTrades();
    persistAccounts();
    persistTombstones();
    persistSyncSnapshot();
    settings.googleSheetId = result.sheetId;
    settings.googleSheetUrl = result.sheetUrl;
    settings.googleAutoSync = true;
    settings.lastSyncedAt = new Date().toISOString();
    persistSettings();
    document.getElementById('set-googleSheetId').value = result.sheetId;
    refreshAllViews();
    renderLastSyncStatus();
    renderSyncConflicts(result.conflicts);
    if (!silent) {
      const conflictNote = result.conflicts.length ? ` — ${result.conflicts.length} conflict${result.conflicts.length === 1 ? '' : 's'} found, see below.` : '';
      status.innerHTML = `Synced — pulled ${result.added} new / updated ${result.updated} from the sheet.${conflictNote} <a href="${result.sheetUrl}" target="_blank" rel="noopener">Open Sheet</a>`;
      status.className = result.conflicts.length ? 'settings-status pending' : 'settings-status success';
    }
  } catch (err) {
    if (!silent) { status.textContent = err.message || 'Sync failed.'; status.className = 'settings-status error'; }
  }
}

// Best-effort silent sync on load: only succeeds if this browser already has
// a live Google grant (no popup), so it never surprises the user. This is
// what makes the Google sign-in a one-time thing per device — after the
// first manual "Sync Now" click, every later visit tries this silently.
function attemptSilentAutoSync() {
  if (!settings.googleAutoSync || !settings.googleClientId || !settings.googleSheetId) return;
  if (!gisReady()) return;
  handleSyncSheets({ interactive: false, silent: true });
}

// Shows any genuine conflicts (both this device and the sheet changed the
// same trade/account since the last successful sync). The newer edit was
// already kept automatically so sync always completes — this panel just
// lets you review and override that choice if the auto-pick was wrong.
function renderSyncConflicts(conflicts) {
  const panel = document.getElementById('syncConflictsPanel');
  if (!panel) return;
  if (!conflicts || !conflicts.length) { panel.innerHTML = ''; return; }
  panel.innerHTML = `
    <div class="conflict-panel-title"><i class="fa fa-triangle-exclamation"></i> ${conflicts.length} Sync Conflict${conflicts.length === 1 ? '' : 's'}</div>
    <p class="settings-desc">These changed on both this device and the sheet since your last sync. The newer edit (by timestamp) was kept automatically — pick a side below if that's not what you want.</p>
    ${conflicts.map((c, i) => `
      <div class="conflict-card">
        <div class="conflict-card-title">${c.description.title}</div>
        <ul class="conflict-diff-list">${c.description.diffs.map(d => `<li>${d}</li>`).join('') || '<li>Values differ.</li>'}</ul>
        <div class="conflict-kept">Kept: <strong>${c.kept === 'remote' ? 'Sheet version' : 'This device\'s version'}</strong></div>
        <div class="conflict-actions">
          <button class="btn-outline" onclick="resolveSyncConflict(${i}, 'local')">Use This Device's Version</button>
          <button class="btn-outline" onclick="resolveSyncConflict(${i}, 'remote')">Use Sheet's Version</button>
        </div>
      </div>`).join('')}
  `;
  panel.dataset.conflicts = JSON.stringify(conflicts);
}

// Overriding a conflict just re-saves the chosen side with a fresh
// updatedAt, so it wins on the next sync (no separate "force push" concept
// needed — the same newest-wins rule handles it).
function resolveSyncConflict(index, which) {
  const conflicts = JSON.parse(document.getElementById('syncConflictsPanel').dataset.conflicts || '[]');
  const c = conflicts[index];
  if (!c) return;
  const chosen = { ...(which === 'local' ? c.local : c.remote), updatedAt: new Date().toISOString() };
  if (chosen.entry !== undefined) { // trade
    const idx = trades.findIndex(t => t.id === c.id);
    if (idx !== -1) trades[idx] = chosen; else trades.push(chosen);
    persistTrades();
  } else { // account
    const idx = accounts.findIndex(a => a.id === c.id);
    if (idx !== -1) accounts[idx] = chosen; else accounts.push(chosen);
    persistAccounts();
  }
  conflicts.splice(index, 1);
  renderSyncConflicts(conflicts);
  refreshAllViews();
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
          accounts.push({ id: generateSyncId(), name: accountName, broker: 'Interactive Brokers', updatedAt: new Date().toISOString() });
          accountNames.add(accountName);
        }
        const securityType = t.securityType || 'stock';
        const tickValue = t.tickValue || 1;
        const multiplier = computeTradeMultiplier(securityType, tickValue);
        // Risk amount is gross (planned stop distance) — commission is a
        // realized cost, not part of the planned risk, so it's excluded here.
        const riskAmount = Math.abs(t.entry - t.stop) * t.qty * multiplier;
        const r = riskAmount > 0 ? parseFloat((t.pnl / riskAmount).toFixed(2)) : 0;
        trades.push({
          id: generateSyncId(), date: t.date, symbol: t.symbol, companyName: t.companyName || '', side: t.side, setup: 'other',
          securityType, tickValue, optionType: t.optionType || '', strike: t.strike ?? null, commission: t.commission || 0,
          entry: t.entry, exit: t.exit, qty: t.qty, stop: t.stop, pnl: t.pnl, r,
          rating: 3, emotion: 'focused', notes: 'Imported from Interactive Brokers CSV sync.',
          account: accountName, entryTime: t.entryTime || '', exitTime: t.exitTime || '',
          updatedAt: new Date().toISOString(),
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
  if (!confirm('This will permanently delete all trades, accounts, and settings from this browser and start you with a completely blank journal. Continue?')) return;
  resetAllData();
  // Set a truly blank state directly, rather than calling loadState() —
  // loadState() treats an empty localStorage as a first-ever visit and
  // reseeds the sample demo trades, which defeats the point of "reset".
  trades = [];
  accounts = [{ id: generateSyncId(), name: 'Main Account', broker: 'Manual', updatedAt: new Date().toISOString() }];
  settings = { ...DEFAULT_SETTINGS };
  tombstones = [];
  syncSnapshot = { trades: {}, accounts: {} };
  persistAll();
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
  renderSyncConflicts([]);
  alert('All data has been cleared. You are starting fresh.');
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
      document.getElementById('f-securityType').value = t.securityType || 'stock';
      document.getElementById('f-tickValue').value = t.tickValue || 1;
      document.getElementById('f-optionType').value = t.optionType || 'call';
      document.getElementById('f-strike').value = t.strike === null || t.strike === undefined ? '' : t.strike;
      document.getElementById('f-commission').value = t.commission || 0;
      document.getElementById('f-entry').value = t.entry;
      document.getElementById('f-exit').value = t.exit === null || t.exit === undefined ? '' : t.exit;
      document.getElementById('f-qty').value = t.qty;
      document.getElementById('f-stop').value = t.stop;
      document.getElementById('f-notes').value = t.notes;
      document.getElementById('f-emotion').value = t.emotion;
      document.getElementById('f-entryTime').value = t.entryTime || nowTimeHHMMSS();
      // Default the exit-time field to "now" when there's no exit price yet,
      // so closing the position later captures an accurate close timestamp.
      document.getElementById('f-exitTime').value = t.exitTime || nowTimeHHMMSS();
      if (t.account) document.getElementById('f-account').value = t.account;
      setRating(t.rating);
    }
  } else {
    document.getElementById('f-symbol').value = '';
    document.getElementById('f-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('f-side').value = 'long';
    document.getElementById('f-setup').value = 'breakout';
    document.getElementById('f-securityType').value = 'stock';
    document.getElementById('f-tickValue').value = 1;
    document.getElementById('f-optionType').value = 'call';
    document.getElementById('f-strike').value = '';
    document.getElementById('f-commission').value = 0;
    document.getElementById('f-entry').value = '';
    document.getElementById('f-exit').value = '';
    document.getElementById('f-qty').value = '';
    document.getElementById('f-stop').value = '';
    document.getElementById('f-notes').value = '';
    document.getElementById('f-emotion').value = 'focused';
    document.getElementById('f-entryTime').value = nowTimeHHMMSS();
    document.getElementById('f-exitTime').value = nowTimeHHMMSS();
    if (accounts.length) document.getElementById('f-account').value = accounts[0].name;
    setRating(3);
  }
  document.getElementById('symbolLookupResult').innerHTML = '';
  document.getElementById('symbolLookupResult').className = 'symbol-lookup-result';
  updateSecurityDependentFields();
  tradeModal.classList.add('active');
}

function nowTimeHHMMSS() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
}

// Tick Value only applies to multiplier-based instruments (options/futures).
// Shows/hides Tick Value, Put/Call, and Strike based on Security type, and
// relabels the Side selector (Buy/Sell for options contracts, Long/Short for
// stock/crypto/futures — see saveTrade() for why "buy to open"/"sell to
// open" reuse the exact same long/short P&L math as stock).
function updateSecurityDependentFields() {
  const type = document.getElementById('f-securityType').value;
  const needsTickValue = type === 'options' || type === 'futures' || type === 'futureOptions';
  const isOption = type === 'options' || type === 'futureOptions';
  document.getElementById('tickValueGroup').style.display = needsTickValue ? '' : 'none';
  document.getElementById('optionTypeGroup').style.display = isOption ? '' : 'none';
  document.getElementById('strikeGroup').style.display = isOption ? '' : 'none';

  document.getElementById('sideLabel').textContent = isOption ? 'Side (Buy/Sell)' : 'Side';
  document.getElementById('sideOptLong').textContent = isOption ? 'Buy (Long)' : 'Long';
  document.getElementById('sideOptShort').textContent = isOption ? 'Sell (Short)' : 'Short';
}

function closeModal() {
  tradeModal.classList.remove('active');
  editingId = null;
}

// "Look Up" button on the Add Trade modal: fetches company info + a live
// quote from Finnhub. See js/marketdata.js — only the *current* price is
// available on the free tier, not a historical price for a past trade date.
let lastLookupPrice = null;
async function handleSymbolLookup() {
  const symbol = document.getElementById('f-symbol').value.trim();
  const resultEl = document.getElementById('symbolLookupResult');
  resultEl.className = 'symbol-lookup-result has-content';
  resultEl.textContent = 'Looking up...';
  try {
    const securityType = document.getElementById('f-securityType').value;
    const info = await lookupSymbolInfo({ finnhubKey: settings.finnhubKey, twelveDataKey: settings.twelveDataKey }, symbol, securityType);
    document.getElementById('f-symbol').value = info.symbol;
    lastLookupPrice = info.currentPrice;
    const priceLine = info.currentPrice != null
      ? `Live price: <strong>$${info.currentPrice.toFixed(2)}</strong> <button type="button" class="btn-outline" id="useLivePriceBtn">Use as Entry Price</button>`
      : 'No live price available for this symbol on the free tier.';
    resultEl.innerHTML = `
      <div class="company-name">${info.companyName || info.symbol}</div>
      ${info.exchange ? `<div>${info.exchange}</div>` : ''}
      <div>${priceLine}</div>
    `;
    const useBtn = document.getElementById('useLivePriceBtn');
    if (useBtn) useBtn.addEventListener('click', () => {
      document.getElementById('f-entry').value = lastLookupPrice.toFixed(2);
    });
  } catch (err) {
    resultEl.textContent = err.message || 'Lookup failed.';
  }
}

function saveTrade() {
  const symbol = document.getElementById('f-symbol').value.trim().toUpperCase();
  const date = document.getElementById('f-date').value;
  const side = document.getElementById('f-side').value;
  const setup = document.getElementById('f-setup').value;
  const securityType = document.getElementById('f-securityType').value;
  const tickValue = parseFloat(document.getElementById('f-tickValue').value) || 1;
  const isOptionType = securityType === 'options' || securityType === 'futureOptions';
  const optionType = isOptionType ? document.getElementById('f-optionType').value : '';
  const strikeRaw = document.getElementById('f-strike').value.trim();
  const strike = isOptionType && strikeRaw !== '' ? parseFloat(strikeRaw) : null;
  const commission = parseFloat(document.getElementById('f-commission').value) || 0;
  const entry = parseFloat(document.getElementById('f-entry').value);
  const exitRaw = document.getElementById('f-exit').value.trim();
  const exit = exitRaw === '' ? null : parseFloat(exitRaw);
  const qty = parseInt(document.getElementById('f-qty').value) || 100;
  const stop = parseFloat(document.getElementById('f-stop').value) || (side === 'long' ? entry - 2 : entry + 2);
  const notes = document.getElementById('f-notes').value;
  const emotion = document.getElementById('f-emotion').value;
  const rating = parseInt(document.getElementById('f-rating').value);
  const account = document.getElementById('f-account').value || (accounts[0] && accounts[0].name) || 'Main';
  const entryTime = document.getElementById('f-entryTime').value || nowTimeHHMMSS();
  const exitTimeRaw = document.getElementById('f-exitTime').value;

  if (!symbol || !date || isNaN(entry) || (exit !== null && isNaN(exit))) {
    alert('Please fill in required fields: Symbol, Date, Entry Price. Exit Price can be left blank to keep the position open.');
    return;
  }

  let pnl = null, r = null;
  // The actual wall-clock time this trade was closed — captured automatically
  // (the field defaults to "now", editable if you're logging after the fact).
  const exitTime = exit !== null ? (exitTimeRaw || nowTimeHHMMSS()) : '';
  if (exit !== null) {
    // Stock/crypto: price-diff * qty. Options: price-diff * qty * 100 * tick
    // value. Futures/future options: price-diff * qty * tick value. This is
    // the same formula for a Call or a Put, and for Buy-to-open ("long") or
    // Sell-to-open/write ("short") — the option's premium (what you actually
    // entered as Entry/Exit) already prices in the call/put payoff, so the
    // P&L only ever depends on premium-in vs. premium-out, not the strike.
    const multiplier = computeTradeMultiplier(securityType, tickValue);
    const grossPnl = (side === 'long' ? (exit - entry) : (entry - exit)) * qty * multiplier;
    pnl = grossPnl - commission;
    const riskAmount = Math.abs(entry - stop) * qty * multiplier;
    r = riskAmount > 0 ? parseFloat((pnl / riskAmount).toFixed(2)) : 0;
    pnl = parseFloat(pnl.toFixed(2));
  }

  const updatedAt = new Date().toISOString();
  if (editingId) {
    const idx = trades.findIndex(t => t.id === editingId);
    if (idx !== -1) trades[idx] = { ...trades[idx], symbol, date, side, setup, securityType, tickValue, optionType, strike, commission, entry, exit, qty, stop, pnl, r, notes, emotion, rating, account, entryTime, exitTime, updatedAt };
  } else {
    trades.push({ id: generateSyncId(), symbol, date, side, setup, securityType, tickValue, optionType, strike, commission, entry, exit, qty, stop, pnl, r, notes, emotion, rating, account, entryTime, exitTime, updatedAt });
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
  recordTombstone('trade', id);
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
        ? `<div class="trade-pnl" style="color:${formatSignedMoney(t.pnl).color}">${formatSignedMoney(t.pnl).text}</div>`
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

  setSignedText('stat-pnl', formatSignedMoney(pnl));
  document.getElementById('stat-pnl-sub').textContent = `${total} closed trade${total === 1 ? '' : 's'}`;
  document.getElementById('stat-winrate').textContent = total ? Math.round((wins.length/total)*100) + '%' : '0%';
  document.getElementById('stat-winrate-sub').textContent = `${wins.length} of ${total} closed trades`;
  document.getElementById('stat-pf').textContent = isFinite(profitFactor) ? profitFactor.toFixed(2) : '∞';
  setSignedText('stat-avgr', formatSignedR(avgR));
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

  // Seed with -Infinity (not 0) so "best trade" is correct even when every
  // closed trade lost money — otherwise it would wrongly show $0.00.
  const best = closed.length ? closed.reduce((m, t) => Math.max(m, t.pnl), -Infinity) : 0;
  setSignedText('an-best', formatSignedMoney(best));

  const sorted = [...closed].sort((a, b) => a.date.localeCompare(b.date));
  let cum = 0, peak = 0, maxDD = 0;
  sorted.forEach(t => {
    cum += t.pnl;
    peak = Math.max(peak, cum);
    maxDD = Math.min(maxDD, cum - peak);
  });
  setSignedText('an-drawdown', formatSignedMoney(maxDD));
}

// JOURNAL
const SECURITY_LABELS = { stock: 'Stock', options: 'Options', futures: 'Futures', futureOptions: 'Future Options', crypto: 'Crypto' };

function renderJournal() {
  const search = document.getElementById('searchTrades').value.toLowerCase();
  const result = document.getElementById('filterResult').value;
  const setup = document.getElementById('filterSetup').value;
  const account = document.getElementById('filterAccount').value;
  const security = document.getElementById('filterSecurity').value;
  let filtered = trades.filter(t => {
    const closed = isClosedTrade(t);
    if (search && !t.symbol.toLowerCase().includes(search)) return false;
    if (result === 'win' && !(closed && t.pnl > 0)) return false;
    if (result === 'loss' && !(closed && t.pnl < 0)) return false;
    if (result === 'open' && closed) return false;
    if (setup !== 'all' && t.setup !== setup) return false;
    if (account !== 'all' && t.account !== account) return false;
    if (security !== 'all' && (t.securityType || 'stock') !== security) return false;
    return true;
  });
  const tbody = document.getElementById('tradeBody');
  tbody.innerHTML = filtered.map(t => {
    const closed = isClosedTrade(t);
    const securityType = t.securityType || 'stock';
    const isOptionType = securityType === 'options' || securityType === 'futureOptions';
    const pnlFmt = formatSignedMoney(t.pnl);
    const rFmt = formatSignedR(t.r);
    const pnlCell = closed
      ? `<td style="font-weight:700;color:${pnlFmt.color}">${pnlFmt.text}${t.commission ? `<div class="cell-subtext">net of $${t.commission.toFixed(2)} comm.</div>` : ''}</td>`
      : `<td><span class="tag open-position">OPEN</span></td>`;
    const rCell = closed
      ? `<td style="color:${rFmt.color}">${rFmt.text}</td>`
      : `<td>—</td>`;
    const optionDetail = isOptionType
      ? `<div class="cell-subtext">${(t.optionType || 'call').toUpperCase()}${t.strike ? ' $' + t.strike.toFixed(2) : ''}</div>`
      : '';
    const sideLabel = isOptionType ? (t.side === 'long' ? 'BUY' : 'SELL') : t.side.toUpperCase();
    return `
    <tr>
      <td>${t.date}${t.entryTime ? `<div class="cell-subtext">${t.entryTime}</div>` : ''}</td>
      <td><strong>${t.symbol}</strong>${optionDetail}</td>
      <td><span class="tag ${securityType}">${SECURITY_LABELS[securityType] || securityType}</span></td>
      <td><span class="tag ${t.side}">${sideLabel}</span></td>
      <td><span class="tag ${t.setup}">${t.setup}</span></td>
      <td>${t.account || ''}</td>
      <td>$${t.entry.toFixed(2)}</td>
      <td>${closed ? '$' + t.exit.toFixed(2) + (t.exitTime ? `<div class="cell-subtext">${t.exitTime}</div>` : '') : '—'}</td>
      ${pnlCell}
      ${rCell}
      <td>${'★'.repeat(t.rating)}${'☆'.repeat(5-t.rating)}</td>
      <td>
        <button class="icon-btn" onclick="openAddTradeModal('${t.id}')" title="${closed ? 'Edit' : 'Edit / Close Position'}"><i class="fa fa-edit"></i></button>
        <button class="icon-btn del" onclick="deleteTrade('${t.id}')" title="Delete"><i class="fa fa-trash"></i></button>
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
  const riskData = closed.map(t => ({ x: parseFloat((Math.abs(t.entry - t.stop) * t.qty * computeTradeMultiplier(t.securityType, t.tickValue)).toFixed(2)), y: t.pnl }));
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
