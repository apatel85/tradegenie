// GOOGLE SHEETS SYNC + INTERACTIVE BROKERS CSV SYNC

function generateSyncId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Column order doubles as the Google Sheet schema — importTradesFromGoogleSheets
// reads these same header labels back out, so keep the two in sync.
const TRADE_EXPORT_COLUMNS = ['id', 'date', 'entryTime', 'symbol', 'companyName', 'securityType', 'optionType', 'strike', 'side', 'setup', 'entry', 'exit', 'exitTime', 'qty', 'tickValue', 'stop', 'commission', 'pnl', 'r', 'rating', 'emotion', 'account', 'notes', 'updatedAt'];
const TRADE_EXPORT_HEADER = ['Trade ID', 'Date', 'Entry Time', 'Symbol', 'Company', 'Security', 'Put/Call', 'Strike', 'Side', 'Setup', 'Entry', 'Exit', 'Exit Time', 'Qty', 'Tick Value', 'Stop', 'Commission', 'P&L', 'R', 'Rating', 'Emotion', 'Account', 'Notes', 'Updated At'];
const TRADE_NUMERIC_COLUMNS = new Set(['entry', 'exit', 'qty', 'tickValue', 'stop', 'strike', 'commission', 'pnl', 'r', 'rating']);
// These must always be a number (never null) — exit/pnl/r/strike stay nullable.
const TRADE_REQUIRED_NUMERIC_DEFAULTS = { entry: 0, qty: 1, tickValue: 1, stop: 0, commission: 0, rating: 3 };

// Security-type multiplier shared by the trade form (js/app.js) and the IBKR
// importer: stock/crypto P&L is price-diff * qty; options add the standard
// 100-shares-per-contract multiplier on top of tick value; futures/future
// options use tick value alone (it already encodes $ per point for that
// contract, e.g. $5/pt for MES, $50/pt for ES).
function computeTradeMultiplier(securityType, tickValue) {
  const tv = (typeof tickValue === 'number' && !isNaN(tickValue) && tickValue > 0) ? tickValue : 1;
  if (securityType === 'options') return 100 * tv;
  if (securityType === 'futures' || securityType === 'futureOptions') return tv;
  return 1; // stock, crypto
}

function tradesToRows(tradeList) {
  const rows = tradeList.map(t => TRADE_EXPORT_COLUMNS.map(c => t[c] === undefined || t[c] === null ? '' : t[c]));
  return [TRADE_EXPORT_HEADER, ...rows];
}

// Reverse of tradesToRows: parse a Sheets values grid (header + data rows)
// back into trade objects. Matches columns by header text (case-insensitive)
// so a reordered or partially-edited sheet still imports correctly.
function rowsToTrades(values) {
  if (!values || values.length < 2) return [];
  const header = values[0].map(h => String(h || '').trim().toLowerCase());
  const colIndex = TRADE_EXPORT_HEADER.map(h => header.indexOf(h.toLowerCase()));
  const trades = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row || !row.length) continue;
    const t = {};
    TRADE_EXPORT_COLUMNS.forEach((key, ci) => {
      const idx = colIndex[ci];
      let raw = idx === -1 || idx >= row.length ? '' : row[idx];
      if (raw === '' || raw === undefined) {
        t[key] = TRADE_NUMERIC_COLUMNS.has(key) ? (TRADE_REQUIRED_NUMERIC_DEFAULTS[key] ?? null) : '';
        return;
      }
      t[key] = TRADE_NUMERIC_COLUMNS.has(key) ? parseFloat(raw) : String(raw);
    });
    if (!t.symbol || !t.date) continue;
    if (!t.id) t.id = generateSyncId();
    if (!t.securityType) t.securityType = 'stock';
    if (!t.updatedAt) t.updatedAt = t.date + 'T00:00:00.000Z';
    trades.push(t);
  }
  return trades;
}

// ---------- CSV EXPORT (always available, no setup required) ----------
function exportTradesToCSV(tradeList) {
  const rows = tradesToRows(tradeList);
  const csv = rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trades-export-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(val) {
  const s = String(val);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ---------- GOOGLE SHEETS SYNC (OAuth via Google Identity Services) ----------
// This is a static, backend-less app, so there is no server to hold a
// long-lived refresh token — each browser/device has to sign in with Google
// at least once (a popup), after which its own access token is reused for
// the rest of that session. That one-time sign-in per device is what makes
// the shared Sheet the actual source of truth across desktop and mobile.
let gisTokenClient = null;
let gisAccessToken = null;

function gisReady() {
  return typeof google !== 'undefined' && google.accounts && google.accounts.oauth2;
}

function ensureGisTokenClient(clientId, onToken) {
  if (!gisReady()) {
    throw new Error('Google Identity Services script has not loaded yet. Check your connection and try again.');
  }
  gisTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    callback: (resp) => {
      if (resp.error) {
        onToken(null, resp);
        return;
      }
      gisAccessToken = resp.access_token;
      onToken(gisAccessToken, null);
    },
  });
  return gisTokenClient;
}

// interactive=true may show a Google sign-in popup; interactive=false only
// succeeds if this browser already has a live grant (used for silent
// auto-sync on load, so we never surprise-popup the user).
function getGoogleAccessToken(clientId, interactive) {
  return new Promise((resolve, reject) => {
    try {
      const client = ensureGisTokenClient(clientId, (accessToken, err) => {
        if (err || !accessToken) reject(new Error('Google sign-in was cancelled, failed, or requires interaction.'));
        else resolve(accessToken);
      });
      client.requestAccessToken({ prompt: gisAccessToken ? '' : (interactive ? 'consent' : '') });
    } catch (e) {
      reject(e);
    }
  });
}

async function ensureSpreadsheet(token, settings, onStatus) {
  let sheetId = (settings.googleSheetId || '').trim();
  let sheetUrl = settings.googleSheetUrl || '';
  if (!sheetId) {
    onStatus && onStatus('Creating a new Google Sheet...');
    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { title: `TradeGenie Journal — ${new Date().toLocaleDateString()}` } }),
    });
    if (!createRes.ok) throw new Error(`Could not create spreadsheet (${createRes.status}). Check the OAuth Client ID and that the Sheets API is enabled.`);
    const created = await createRes.json();
    sheetId = created.spreadsheetId;
    sheetUrl = created.spreadsheetUrl;
  }
  if (!sheetUrl) sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
  return { sheetId, sheetUrl };
}

async function writeTradesToSheet(token, sheetId, tradeList) {
  const rows = tradesToRows(tradeList);
  const range = `A1:${String.fromCharCode(64 + rows[0].length)}${Math.max(rows.length, 2)}`;
  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ range, majorDimension: 'ROWS', values: rows }),
    }
  );
  if (!updateRes.ok) throw new Error(`Could not write to spreadsheet (${updateRes.status}). Your saved Sheet ID may be invalid or you no longer have edit access.`);
}

async function readTradesFromSheet(token, sheetId) {
  const range = `A1:${String.fromCharCode(64 + TRADE_EXPORT_HEADER.length)}100000`;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Could not read the spreadsheet (${res.status}). Check the Sheet ID and that you have access to it.`);
  const data = await res.json();
  return rowsToTrades(data.values || []);
}

async function exportTradesToGoogleSheets(tradeList, settings, { onStatus } = {}) {
  const clientId = (settings.googleClientId || '').trim();
  if (!clientId) {
    throw new Error('Add your Google OAuth Client ID in Settings first (see instructions below the field).');
  }
  const token = await getGoogleAccessToken(clientId, true);
  onStatus && onStatus('Signed in. Preparing spreadsheet...');
  const { sheetId, sheetUrl } = await ensureSpreadsheet(token, settings, onStatus);
  onStatus && onStatus('Writing trade data...');
  await writeTradesToSheet(token, sheetId, tradeList);
  return { sheetId, sheetUrl };
}

// Merges a remote trade set (pulled from Sheets) into a local one, keyed by
// trade id, newest updatedAt wins on conflicts. Trades that exist only
// locally are kept as-is (they'll go up on the next push). Note: this does
// not sync deletions — deleting a trade on one device and then pulling from
// another will bring it back, since there's no tombstone record.
function mergeTradeSets(localTrades, remoteTrades) {
  const byId = new Map();
  localTrades.forEach(t => byId.set(t.id, t));
  let added = 0, updated = 0;
  remoteTrades.forEach(rt => {
    const lt = byId.get(rt.id);
    if (!lt) {
      byId.set(rt.id, rt);
      added++;
    } else if ((rt.updatedAt || '') > (lt.updatedAt || '')) {
      byId.set(rt.id, rt);
      updated++;
    }
  });
  return { merged: Array.from(byId.values()), added, updated };
}

async function importTradesFromGoogleSheets(settings, { onStatus } = {}) {
  const clientId = (settings.googleClientId || '').trim();
  const sheetId = (settings.googleSheetId || '').trim();
  if (!clientId) throw new Error('Add your Google OAuth Client ID in Settings first.');
  if (!sheetId) throw new Error('No Sheet ID saved yet — run a Sync (or Export) once first to create/link a sheet.');
  const token = await getGoogleAccessToken(clientId, true);
  onStatus && onStatus('Reading trade data from Google Sheets...');
  return readTradesFromSheet(token, sheetId);
}

// Full two-way sync: pull remote rows, merge with local trades (newest wins
// per trade), then push the merged set back so the Sheet and this device
// end up consistent. Run this on every device you use — the first time on
// a new device it will require a Google sign-in popup.
async function syncTradesWithGoogleSheets(localTrades, settings, { onStatus, interactive = true } = {}) {
  const clientId = (settings.googleClientId || '').trim();
  if (!clientId) throw new Error('Add your Google OAuth Client ID in Settings first (see instructions below the field).');
  const token = await getGoogleAccessToken(clientId, interactive);
  onStatus && onStatus('Signed in. Preparing spreadsheet...');
  const { sheetId, sheetUrl } = await ensureSpreadsheet(token, settings, onStatus);

  onStatus && onStatus('Pulling trades from Google Sheets...');
  const remoteTrades = await readTradesFromSheet(token, sheetId);
  const { merged, added, updated } = mergeTradeSets(localTrades, remoteTrades);
  merged.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  onStatus && onStatus('Pushing merged trades back to Google Sheets...');
  await writeTradesToSheet(token, sheetId, merged);

  return { merged, sheetId, sheetUrl, added, updated };
}

// ---------- INTERACTIVE BROKERS CSV SYNC ----------
// Accepts an IBKR Flex Query / Activity Statement "Trades" CSV export (or any
// CSV with similar columns) and reconstructs round-trip trades via FIFO
// position matching, since raw broker exports are execution-by-execution.

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const IBKR_COLUMN_ALIASES = {
  symbol: ['symbol', 'ticker', 'underlyingsymbol'],
  datetime: ['date/time', 'datetime', 'tradedate', 'date', 'orderTime'.toLowerCase()],
  side: ['buy/sell', 'side', 'action'],
  qty: ['quantity', 'qty', 'shares'],
  price: ['tradeprice', 'price', 'execprice'],
  account: ['clientaccountid', 'account', 'accountid'],
  assetClass: ['assetclass', 'assetcategory', 'securitytype', 'secType'.toLowerCase()],
  multiplier: ['multiplier'],
  putCall: ['put/call', 'putcall', 'right'],
  strike: ['strike', 'strikeprice'],
  commission: ['ibcommission', 'commission', 'commfee', 'comm/fee'],
  description: ['description', 'securitydescription'],
};

// IBKR's AssetClass/AssetCategory values map onto our security types.
const IBKR_ASSET_CLASS_MAP = {
  STK: 'stock', STOCK: 'stock', CASH: 'crypto', CRYPTO: 'crypto',
  OPT: 'options', OPTION: 'options',
  FUT: 'futures', FUTURE: 'futures',
  FOP: 'futureOptions',
};

// Best-effort parse of an OCC-style option symbol (e.g. "AAPL 260116C00200000"
// or "AAPL260116C00200000") into put/call + strike, used as a fallback when
// the CSV doesn't have separate Put/Call and Strike columns.
function parseOccOptionSymbol(symbol) {
  const cleaned = symbol.replace(/\s+/g, '');
  const m = cleaned.match(/^([A-Z]{1,6})\d{6}([CP])(\d{8})$/);
  if (!m) return null;
  return { putCall: m[2] === 'C' ? 'CALL' : 'PUT', strike: parseInt(m[3], 10) / 1000 };
}

function findColumn(header, aliases) {
  const lower = header.map(h => h.trim().toLowerCase().replace(/\s+/g, ''));
  for (const alias of aliases) {
    const idx = lower.indexOf(alias.replace(/\s+/g, ''));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseIBKRCsv(text) {
  const rows = parseCSV(text).filter(r => r.length > 1);
  if (!rows.length) throw new Error('The CSV file appears to be empty.');
  const header = rows[0];
  const cols = {};
  for (const key in IBKR_COLUMN_ALIASES) {
    cols[key] = findColumn(header, IBKR_COLUMN_ALIASES[key]);
  }
  if (cols.symbol === -1 || cols.qty === -1 || cols.price === -1) {
    throw new Error('Could not find Symbol / Quantity / Price columns. Export the "Trades" section of an IBKR Flex Query or Activity Statement as CSV.');
  }

  const executions = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const symbol = (r[cols.symbol] || '').trim().toUpperCase();
    if (!symbol) continue;
    let qty = parseFloat((r[cols.qty] || '0').replace(/,/g, ''));
    const price = parseFloat((r[cols.price] || '0').replace(/,/g, ''));
    if (!symbol || isNaN(qty) || isNaN(price) || qty === 0) continue;
    if (cols.side !== -1) {
      const sideVal = (r[cols.side] || '').trim().toUpperCase();
      if (sideVal.startsWith('S') && qty > 0) qty = -qty; // Sell -> negative
      if (sideVal.startsWith('B') && qty < 0) qty = -qty; // Buy -> positive
    }
    const rawDate = cols.datetime !== -1 ? (r[cols.datetime] || '') : '';
    const date = normalizeIBKRDate(rawDate);
    const time = normalizeIBKRTime(rawDate);
    const account = cols.account !== -1 ? (r[cols.account] || '').trim() : '';
    const assetClassRaw = cols.assetClass !== -1 ? (r[cols.assetClass] || '').trim().toUpperCase() : '';
    const securityType = IBKR_ASSET_CLASS_MAP[assetClassRaw] || 'stock';
    const multiplierRaw = cols.multiplier !== -1 ? parseFloat((r[cols.multiplier] || '').replace(/,/g, '')) : NaN;
    // IBKR's option "Multiplier" is typically 100 already baked in — divide
    // it back out since our options formula applies its own *100.
    let tickValue = 1;
    if (!isNaN(multiplierRaw) && multiplierRaw > 0) {
      tickValue = securityType === 'options' ? multiplierRaw / 100 : multiplierRaw;
    }

    const isOptionType = securityType === 'options' || securityType === 'futureOptions';
    let putCall = cols.putCall !== -1 ? (r[cols.putCall] || '').trim().toUpperCase() : '';
    let strike = cols.strike !== -1 ? parseFloat((r[cols.strike] || '').replace(/,/g, '')) : NaN;
    if (isOptionType && (!putCall || isNaN(strike))) {
      const occ = parseOccOptionSymbol(symbol);
      if (occ) { putCall = putCall || occ.putCall; if (isNaN(strike)) strike = occ.strike; }
    }
    const optionType = putCall.startsWith('P') ? 'put' : putCall.startsWith('C') ? 'call' : '';

    const commissionRaw = cols.commission !== -1 ? parseFloat((r[cols.commission] || '0').replace(/,/g, '')) : 0;
    // Spread the per-execution commission evenly across its shares/contracts
    // so a partial FIFO fill only carries its proportional share of the fee.
    const commissionPerUnit = (!isNaN(commissionRaw) && qty !== 0) ? Math.abs(commissionRaw) / Math.abs(qty) : 0;

    const companyName = cols.description !== -1 ? (r[cols.description] || '').trim() : '';

    executions.push({ symbol, qty, price, date, time, account, securityType, tickValue, optionType, strike: isNaN(strike) ? null : strike, commissionPerUnit, companyName });
  }

  executions.sort((a, b) => (a.date + 'T' + (a.time || '00:00')).localeCompare(b.date + 'T' + (b.time || '00:00')));
  return matchExecutionsFIFO(executions);
}

function normalizeIBKRDate(raw) {
  if (!raw) return new Date().toISOString().split('T')[0];
  const cleaned = raw.trim().split(';')[0].split(' ')[0].split(',')[0];
  const m1 = cleaned.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  const m2 = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`;
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return new Date().toISOString().split('T')[0];
}

// IBKR Flex/Activity exports commonly separate date and time with a
// semicolon ("20260722;093500") or a space ("2026-07-22 09:35:00").
function normalizeIBKRTime(raw) {
  if (!raw) return '';
  const parts = raw.trim().split(/[;,]/).map(s => s.trim());
  const timePart = parts.length > 1 ? parts[1] : (raw.includes(' ') ? raw.trim().split(/\s+/)[1] : '');
  const m = (timePart || '').match(/^(\d{1,2}):?(\d{2}):?(\d{2})?/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}:${(m[3] || '00').padStart(2, '0')}`;
  return '';
}

// FIFO-match buy/sell executions per symbol+account into closed round-trip trades.
function matchExecutionsFIFO(executions) {
  const groups = {};
  executions.forEach(e => {
    const key = `${e.symbol}::${e.account || 'default'}`;
    (groups[key] = groups[key] || []).push(e);
  });

  const closedTrades = [];
  Object.values(groups).forEach(execs => {
    const openLots = []; // { qty (signed), price, date, time, securityType, tickValue, optionType, strike, commissionPerUnit, companyName }
    execs.forEach(exec => {
      let remaining = exec.qty;
      while (remaining !== 0 && openLots.length && Math.sign(openLots[0].qty) !== Math.sign(remaining)) {
        const lot = openLots[0];
        const closeQty = Math.min(Math.abs(lot.qty), Math.abs(remaining));
        const side = lot.qty > 0 ? 'long' : 'short';
        const entry = lot.price, exit = exec.price;
        const multiplier = computeTradeMultiplier(lot.securityType, lot.tickValue);
        const commission = parseFloat(((lot.commissionPerUnit + exec.commissionPerUnit) * closeQty).toFixed(2));
        const grossPnl = (side === 'long' ? (exit - entry) : (entry - exit)) * closeQty * multiplier;
        const pnl = grossPnl - commission;
        closedTrades.push({
          id: generateSyncId(),
          symbol: exec.symbol,
          companyName: lot.companyName || exec.companyName || '',
          side,
          date: lot.date,
          entryTime: lot.time || '',
          entry,
          exit,
          exitTime: exec.time || '',
          qty: closeQty,
          securityType: lot.securityType,
          tickValue: lot.tickValue,
          optionType: lot.optionType || '',
          strike: lot.strike,
          commission,
          stop: side === 'long' ? entry - Math.abs(entry * 0.01) : entry + Math.abs(entry * 0.01),
          pnl: parseFloat(pnl.toFixed(2)),
          account: exec.account,
          updatedAt: new Date().toISOString(),
        });
        lot.qty += lot.qty > 0 ? -closeQty : closeQty;
        remaining += remaining > 0 ? -closeQty : closeQty;
        if (lot.qty === 0) openLots.shift();
      }
      if (remaining !== 0) openLots.push({ qty: remaining, price: exec.price, date: exec.date, time: exec.time, securityType: exec.securityType, tickValue: exec.tickValue, optionType: exec.optionType, strike: exec.strike, commissionPerUnit: exec.commissionPerUnit, companyName: exec.companyName });
    });
  });

  closedTrades.sort((a, b) => a.date.localeCompare(b.date));
  return closedTrades;
}
