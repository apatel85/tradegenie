// LOCAL STORAGE PERSISTENCE LAYER
const STORAGE_KEYS = {
  trades: 'tz_trades',
  accounts: 'tz_accounts',
  settings: 'tz_settings',
  nextId: 'tz_nextId',
  nextAccountId: 'tz_nextAccountId',
};

const DEFAULT_SETTINGS = {
  dailyGoal: 300,
  googleClientId: '',
  googleSheetId: '',
  googleSheetUrl: '',
  googleAutoSync: false,
  lastSyncedAt: '',
  finnhubKey: '',
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('Could not save to localStorage', e);
  }
}

function isFirstRun() {
  return localStorage.getItem(STORAGE_KEYS.trades) === null;
}

function loadTrades() {
  return loadJSON(STORAGE_KEYS.trades, null);
}
function saveTrades(trades) {
  saveJSON(STORAGE_KEYS.trades, trades);
}

function loadAccounts() {
  return loadJSON(STORAGE_KEYS.accounts, null);
}
function saveAccounts(accounts) {
  saveJSON(STORAGE_KEYS.accounts, accounts);
}

function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...loadJSON(STORAGE_KEYS.settings, {}) };
}
function saveSettings(settings) {
  saveJSON(STORAGE_KEYS.settings, settings);
}

function loadNextId(fallback) {
  return loadJSON(STORAGE_KEYS.nextId, fallback);
}
function saveNextId(id) {
  saveJSON(STORAGE_KEYS.nextId, id);
}

function loadNextAccountId(fallback) {
  return loadJSON(STORAGE_KEYS.nextAccountId, fallback);
}
function saveNextAccountId(id) {
  saveJSON(STORAGE_KEYS.nextAccountId, id);
}

function resetAllData() {
  localStorage.removeItem(STORAGE_KEYS.trades);
  localStorage.removeItem(STORAGE_KEYS.accounts);
  localStorage.removeItem(STORAGE_KEYS.settings);
  localStorage.removeItem(STORAGE_KEYS.nextId);
  localStorage.removeItem(STORAGE_KEYS.nextAccountId);
}
