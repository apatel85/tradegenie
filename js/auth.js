// GOOGLE SIGN-IN + LANDING PAGE + DRIVE-BACKED MASTER DATA
//
// TradeGenie now requires Google sign-in to reach the app: the landing page
// is shown first, "Continue with Google" opens the auth gate, and once
// signed in this app looks for (or creates) a spreadsheet in the user's own
// Google Drive and treats it as the master copy of their journal. Every
// device/browser signed into the same Google account converges on that same
// sheet — see js/integrations.js for the actual sync engine (unchanged),
// this file owns the sign-in/landing/auth-gate lifecycle around it.

// ── IMPORTANT: replace with your own Google Cloud OAuth Client ID ──
// Console: https://console.cloud.google.com/apis/credentials
// Requirements: a "Web application" OAuth Client ID, with the Sheets API and
// Drive API enabled on the project, and this app's deployed origin (e.g.
// https://apatel85.github.io) added under "Authorized JavaScript origins".
// This value is public (it identifies the app, not a secret) and is safe to
// commit — see https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow
const GOOGLE_CLIENT_ID = 319401977574-ldicfj8e93m040t42vnjboq7mmmo00ro.apps.googleusercontent.com;

// Identity (email/name) + Sheets read/write + Drive discovery, requested
// together in one popup. drive.file (not drive.readonly) deliberately —
// it only grants access to files this app's own OAuth client created,
// which is exactly the "TradeGenie Journal — Master" sheet ensureSpreadsheet()
// produces, so cross-device discovery still works but with a much narrower
// (non-"sensitive") scope that avoids Google's stricter verification flow.
const AUTH_SCOPES = 'openid email profile https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';

const AUTH_SESSION_KEY = 'tz_auth_session_v1';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h — re-confirm identity daily

let authUser = null;   // { email, name, cachedAt }
let authToken = null;  // current access token (Sheets + Drive scoped)
let _pendingSheetInfo = null;

function clientIdConfigured() {
  return !!GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.includes('PASTE_YOUR');
}

// ── Session cache (identity only — the token itself is never stored, it's
// re-derived silently via requestAuthTokenSilent on every load) ──
function loadCachedSession() {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const sess = JSON.parse(raw);
    if (!sess || !sess.email || !sess.cachedAt) return null;
    if (Date.now() - sess.cachedAt > SESSION_TTL_MS) { localStorage.removeItem(AUTH_SESSION_KEY); return null; }
    return sess;
  } catch (e) { return null; }
}
function saveCachedSession(user) {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ email: user.email, name: user.name, cachedAt: Date.now() }));
}
function clearCachedSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
}

// ── UI plumbing ──
function showLandingPage() {
  document.getElementById('landing-page').style.display = '';
  document.getElementById('auth-gate').style.display = 'none';
  document.getElementById('app-shell').style.display = 'none';
}
function showAuthGate() {
  document.getElementById('landing-page').style.display = 'none';
  document.getElementById('auth-gate').style.display = 'flex';
  document.getElementById('app-shell').style.display = 'none';
}
function showAppShell() {
  document.getElementById('landing-page').style.display = 'none';
  document.getElementById('auth-gate').style.display = 'none';
  document.getElementById('app-shell').style.display = '';
}
function goToSignIn() { showAuthGate(); showAuthPanel('signin'); }

function showAuthPanel(name) {
  ['signin', 'progress', 'restore', 'create', 'error'].forEach(p => {
    const el = document.getElementById('auth-panel-' + p);
    if (el) el.style.display = p === name ? 'block' : 'none';
  });
}
function setAuthStatus(msg) {
  const el = document.getElementById('auth-progress-label');
  if (el) el.textContent = msg || '';
}
function setAuthError(msg) {
  const el = document.getElementById('auth-error-msg');
  if (el) el.textContent = msg;
  showAuthPanel('error');
}

// ── Init on page load: decide landing page vs. silent reconnect ──
function initAuth() {
  loadState(); // pick up whatever's on this device (or blank) — js/app.js
  if (!clientIdConfigured()) {
    showAuthGate();
    showAuthPanel('error');
    setAuthError('This app is missing its Google OAuth Client ID (GOOGLE_CLIENT_ID in js/auth.js) — sign-in cannot work until that is configured.');
    return;
  }
  const cached = loadCachedSession();
  if (!cached) { showLandingPage(); return; }
  authUser = cached;
  showAuthGate();
  showAuthPanel('progress');
  setAuthStatus('Reconnecting to Google...');
  requestAuthTokenSilent(cached.email)
    .then(token => { authToken = token; return resolveSheetAndUnlock(token, cached, { silent: true }); })
    .catch(() => {
      // Silent reconnect failed (3rd-party cookies blocked, revoked
      // consent, Incognito, etc.) — fall back to one manual click instead
      // of silently stranding the user. Their data is safe in the sheet
      // either way, so this is a minor speed bump, not a data-loss risk.
      showAuthPanel('error');
      setAuthError('Could not silently reconnect to Google (often caused by blocked third-party cookies or an Incognito/Private window). Click below to sign in again.');
    });
}

function requestAuthTokenSilent(emailHint) {
  return new Promise((resolve, reject) => {
    if (!gisReady()) { reject(new Error('gis-not-loaded')); return; }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: AUTH_SCOPES,
      hint: emailHint || undefined,
      callback: (resp) => {
        if (resp.error || !resp.access_token) reject(new Error(resp.error || 'no-token'));
        else resolve(resp.access_token);
      },
    });
    client.requestAccessToken({ prompt: 'none' });
  });
}

// ── Interactive sign-in (button click) ──
function authSignIn() {
  if (!clientIdConfigured()) { setAuthError('This app is missing its Google OAuth Client ID. Ask the app owner to configure GOOGLE_CLIENT_ID in js/auth.js.'); return; }
  if (!gisReady()) { setAuthError('Google sign-in is not loaded yet — check your internet connection and try again.'); return; }
  showAuthPanel('progress');
  setAuthStatus('Opening Google sign-in...');
  const client = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: AUTH_SCOPES,
    callback: async (resp) => {
      if (resp.error || !resp.access_token) {
        setAuthError(resp.error === 'access_denied' ? 'Sign-in was cancelled. Click "Continue with Google" to try again.' : 'Google sign-in failed: ' + (resp.error || 'unknown error') + '. Please try again.');
        return;
      }
      authToken = resp.access_token;
      try {
        setAuthStatus('Fetching your profile...');
        const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + authToken } });
        const profile = await profileRes.json();
        authUser = { email: profile.email, name: profile.name || profile.email };
        await resolveSheetAndUnlock(authToken, authUser, { silent: false });
      } catch (e) {
        setAuthError('Could not complete sign-in: ' + e.message);
      }
    },
  });
  client.requestAccessToken();
}

// ── Core: find-or-create the Drive spreadsheet, merge/restore, unlock ──
async function resolveSheetAndUnlock(token, user, { silent } = {}) {
  try {
    // Already resolved on this device (the normal repeat-visit case) — no
    // need to search Drive again, just reuse the known sheet.
    if (settings.googleSheetId) {
      await completeUnlock(token, user, { sheetId: settings.googleSheetId, sheetUrl: settings.googleSheetUrl }, { discardLocal: false });
      return;
    }

    if (!silent) { showAuthPanel('progress'); setAuthStatus('Looking for your TradeGenie data in Google Drive...'); }
    const found = await findExistingSheetInDrive(token);
    const hasLocalTrades = (trades || []).some(t => isRealId(t.id));

    if (found) {
      _pendingSheetInfo = found;
      if (hasLocalTrades && !silent) { showRestoreMergePrompt(found); return; }
      await completeUnlock(token, user, found, { discardLocal: false });
      return;
    }

    // No existing sheet found in Drive.
    if (silent) {
      // Don't surprise a returning user with a "create?" prompt on a
      // background reconnect (this should be rare — a returning device
      // normally already has settings.googleSheetId set locally).
      showAuthPanel('error');
      setAuthError('Signed in, but no TradeGenie spreadsheet was found in your Drive. Click below to create one.');
      return;
    }
    showAuthPanel('create');
  } catch (e) {
    setAuthError('Could not reach Google: ' + e.message);
  }
}

function showRestoreMergePrompt(sheetInfo) {
  showAuthPanel('restore');
  document.getElementById('auth-restore-msg').textContent =
    `We found "${sheetInfo.name}" in your Google Drive, last updated ${new Date(sheetInfo.modifiedTime).toLocaleString()}. This device also has trades that aren't in it yet — merge them together, or use the cloud copy only?`;
}
async function confirmRestoreMerge(mergeLocal) {
  showAuthPanel('progress');
  setAuthStatus(mergeLocal ? 'Merging your data...' : 'Loading your data from Google Sheets...');
  await completeUnlock(authToken, authUser, _pendingSheetInfo, { discardLocal: !mergeLocal });
}

async function confirmCreateSheet(create) {
  if (!create) {
    showAuthPanel('signin');
    setAuthError('');
    return;
  }
  showAuthPanel('progress');
  setAuthStatus('Creating your TradeGenie spreadsheet...');
  await completeUnlock(authToken, authUser, null, { discardLocal: false });
}

// Pulls (or pushes, for a brand-new sheet) via the existing sync engine in
// js/integrations.js, then boots the app UI.
async function completeUnlock(token, user, sheetInfo, { discardLocal }) {
  try {
    if (discardLocal) {
      trades = [];
      accounts = [];
      tombstones = [];
      syncSnapshot = { trades: {}, accounts: {} };
      persistAll();
    }
    settings.googleSheetId = sheetInfo ? sheetInfo.sheetId : '';
    settings.googleSheetUrl = sheetInfo ? sheetInfo.sheetUrl : '';
    persistSettings();

    const result = await syncAllWithGoogleSheets(buildSyncState(), settings, {
      onStatus: (msg) => setAuthStatus(msg),
      preAuthorizedToken: token,
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
    if (!accounts.length) accounts.push({ id: generateSyncId(), name: 'Main Account', broker: 'Manual', updatedAt: new Date().toISOString() });
    persistTrades(); persistAccounts(); persistTombstones(); persistSyncSnapshot();
    settings.googleSheetId = result.sheetId;
    settings.googleSheetUrl = result.sheetUrl;
    settings.googleAutoSync = true;
    settings.lastSyncedAt = new Date().toISOString();
    settings.lastSilentSyncError = '';
    persistSettings();

    saveCachedSession(user);
    unlockApp(user);
    renderSyncConflicts(result.conflicts);
  } catch (e) {
    showAuthPanel('error');
    setAuthError('Could not load your data: ' + e.message);
  }
}

function unlockApp(user) {
  showAppShell();
  bootApp(); // js/app.js — renders every page, wires up events
  const emailEl = document.getElementById('userAccountEmail');
  if (emailEl) emailEl.textContent = user ? user.email : '';
}

// ── Sign out ──
function authSignOut() {
  if (!confirm('Sign out of TradeGenie? Your data stays safe in your Google Sheet — sign back in anytime to pick up where you left off.')) return;
  clearCachedSession();
  // Full reload rather than just swapping views back to the landing page —
  // clears all in-memory state (trades/accounts/tokens) so a later sign-in
  // starts clean instead of re-running setupEventListeners() on top of
  // itself and re-using a stale token client bound to the previous account.
  location.reload();
}

// ── "Use a different sheet" override (Settings) — in case Drive
// auto-discovery ever picks the wrong file, or the user wants to switch. ──
function changeLinkedSheet() {
  const input = prompt('Paste the Google Sheet URL or ID to use instead:');
  if (!input) return;
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const id = match ? match[1] : input.trim();
  if (!id || id.length < 10) { alert('That doesn\'t look like a valid Sheet URL or ID.'); return; }
  settings.googleSheetId = id;
  settings.googleSheetUrl = `https://docs.google.com/spreadsheets/d/${id}/edit`;
  persistSettings();
  handleSyncSheets({ interactive: false, silent: false });
}

document.addEventListener('DOMContentLoaded', initAuth);
