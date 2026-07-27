// LOCAL STORAGE PERSISTENCE LAYER
const STORAGE_KEYS = {
  trades: 'tz_trades',
  accounts: 'tz_accounts',
  settings: 'tz_settings',
  tombstones: 'tz_tombstones',
  syncSnapshot: 'tz_syncSnapshot',
};

const DEFAULT_SETTINGS = {
  dailyGoal: 300,
  dailyGoalUpdatedAt: '',
  googleSheetId: '',
  googleSheetUrl: '',
  googleAutoSync: false,
  lastSyncedAt: '',
  lastSilentSyncError: '',
  finnhubKey: '',
  twelveDataKey: '',
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

// Tombstones: records of deleted trades/accounts ({type: 'trade'|'account',
// id, deletedAt}) so a deletion made on one device propagates to the Google
// Sheet and to every other device on their next sync, instead of the row
// silently reappearing.
function loadTombstones() {
  return loadJSON(STORAGE_KEYS.tombstones, []);
}
function saveTombstones(list) {
  saveJSON(STORAGE_KEYS.tombstones, list);
}

// Snapshot of {id: updatedAt} as of the last successful sync, used to tell
// "only one side changed" (simple update) apart from "both sides changed
// since we last agreed" (a real conflict) — see mergeWithConflictDetection.
function loadSyncSnapshot() {
  return loadJSON(STORAGE_KEYS.syncSnapshot, { trades: {}, accounts: {} });
}
function saveSyncSnapshot(snapshot) {
  saveJSON(STORAGE_KEYS.syncSnapshot, snapshot);
}

function resetAllData() {
  localStorage.removeItem(STORAGE_KEYS.trades);
  localStorage.removeItem(STORAGE_KEYS.accounts);
  localStorage.removeItem(STORAGE_KEYS.settings);
  localStorage.removeItem(STORAGE_KEYS.tombstones);
  localStorage.removeItem(STORAGE_KEYS.syncSnapshot);
}
