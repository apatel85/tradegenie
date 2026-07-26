// GOOGLE SHEETS EXPORT + INTERACTIVE BROKERS CSV SYNC

const TRADE_EXPORT_COLUMNS = ['date', 'symbol', 'side', 'setup', 'entry', 'exit', 'qty', 'stop', 'pnl', 'r', 'rating', 'emotion', 'account', 'notes'];

function tradesToRows(tradeList) {
  const header = ['Date', 'Symbol', 'Side', 'Setup', 'Entry', 'Exit', 'Qty', 'Stop', 'P&L', 'R', 'Rating', 'Emotion', 'Account', 'Notes'];
  const rows = tradeList.map(t => TRADE_EXPORT_COLUMNS.map(c => t[c] === undefined || t[c] === null ? '' : t[c]));
  return [header, ...rows];
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

// ---------- GOOGLE SHEETS EXPORT (OAuth via Google Identity Services) ----------
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

async function exportTradesToGoogleSheets(tradeList, settings, { onStatus } = {}) {
  const clientId = (settings.googleClientId || '').trim();
  if (!clientId) {
    throw new Error('Add your Google OAuth Client ID in Settings first (see instructions below the field).');
  }

  const token = await new Promise((resolve, reject) => {
    try {
      const client = ensureGisTokenClient(clientId, (accessToken, err) => {
        if (err || !accessToken) reject(new Error('Google sign-in was cancelled or failed.'));
        else resolve(accessToken);
      });
      client.requestAccessToken({ prompt: gisAccessToken ? '' : 'consent' });
    } catch (e) {
      reject(e);
    }
  });

  onStatus && onStatus('Signed in. Preparing spreadsheet...');

  const rows = tradesToRows(tradeList);
  let sheetId = (settings.googleSheetId || '').trim();
  let sheetUrl = settings.googleSheetUrl || '';

  if (!sheetId) {
    onStatus && onStatus('Creating a new Google Sheet...');
    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { title: `TradeZella Journal Export — ${new Date().toLocaleDateString()}` } }),
    });
    if (!createRes.ok) throw new Error(`Could not create spreadsheet (${createRes.status}). Check the OAuth Client ID and that the Sheets API is enabled.`);
    const created = await createRes.json();
    sheetId = created.spreadsheetId;
    sheetUrl = created.spreadsheetUrl;
  }

  onStatus && onStatus('Writing trade data...');
  const range = `A1:${String.fromCharCode(64 + rows[0].length)}${rows.length}`;
  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ range, majorDimension: 'ROWS', values: rows }),
    }
  );
  if (!updateRes.ok) throw new Error(`Could not write to spreadsheet (${updateRes.status}). Your saved Sheet ID may be invalid or you no longer have edit access.`);

  if (!sheetUrl) sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
  return { sheetId, sheetUrl };
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
};

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
    const account = cols.account !== -1 ? (r[cols.account] || '').trim() : '';
    executions.push({ symbol, qty, price, date, account });
  }

  executions.sort((a, b) => (a.date || '').localeCompare(b.date || '') || 0);
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

// FIFO-match buy/sell executions per symbol+account into closed round-trip trades.
function matchExecutionsFIFO(executions) {
  const groups = {};
  executions.forEach(e => {
    const key = `${e.symbol}::${e.account || 'default'}`;
    (groups[key] = groups[key] || []).push(e);
  });

  const closedTrades = [];
  Object.values(groups).forEach(execs => {
    const openLots = []; // { qty (signed), price, date }
    execs.forEach(exec => {
      let remaining = exec.qty;
      while (remaining !== 0 && openLots.length && Math.sign(openLots[0].qty) !== Math.sign(remaining)) {
        const lot = openLots[0];
        const closeQty = Math.min(Math.abs(lot.qty), Math.abs(remaining));
        const side = lot.qty > 0 ? 'long' : 'short';
        const entry = lot.price, exit = exec.price;
        const pnl = side === 'long' ? (exit - entry) * closeQty : (entry - exit) * closeQty;
        const riskPerShare = 0; // unknown from broker export; leave stop blank
        closedTrades.push({
          symbol: exec.symbol,
          side,
          date: exec.date,
          entry,
          exit,
          qty: closeQty,
          stop: side === 'long' ? entry - Math.abs(entry * 0.01) : entry + Math.abs(entry * 0.01),
          pnl: parseFloat(pnl.toFixed(2)),
          account: exec.account,
        });
        lot.qty += lot.qty > 0 ? -closeQty : closeQty;
        remaining += remaining > 0 ? -closeQty : closeQty;
        if (lot.qty === 0) openLots.shift();
      }
      if (remaining !== 0) openLots.push({ qty: remaining, price: exec.price, date: exec.date });
    });
  });

  closedTrades.sort((a, b) => a.date.localeCompare(b.date));
  return closedTrades;
}
