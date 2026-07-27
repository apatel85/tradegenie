// INTERACTIVE BROKERS LIVE SYNC (Beta) — auto-pull executed trades
//
// This is a static, backend-less app, so there's no server that can hold an
// IBKR session for you. Two ways to poll for trades without one, both
// implemented here and selectable in Settings:
//   1. Client Portal Gateway — a free local program you run on your own
//      computer and log into once (https://localhost:5000 by default).
//   2. Flex Web Service — a plain HTTPS reporting API keyed by a Token +
//      Query ID from Account Management, no local program needed. Routed
//      through a small proxy (see supabase/functions/ibkr-flex-proxy/)
//      since IBKR's endpoint doesn't accept direct browser requests.
// While this app is open in a browser tab, it polls whichever source is
// enabled and auto-imports new executions, reusing the exact same FIFO
// round-trip matcher the manual CSV import uses (see matchExecutionsFIFO in
// js/integrations.js) — same logic, just triggered automatically instead of
// on a file upload.
//
// Real limitations, stated plainly:
//   - Only works while this browser tab is open and the Gateway is running
//     and logged in on the same computer. Close the tab or the Gateway and
//     polling stops — there's no way around that without a backend server.
//   - The Gateway's /iserver/account/trades endpoint returns TODAY's
//     executions, not historical ones — this is for capturing fills as they
//     happen, not backfilling; use the CSV import (Settings) for history.
//   - CORS is a real risk: the Gateway isn't guaranteed to accept requests
//     from a page hosted on a different origin (e.g. GitHub Pages) than
//     https://localhost:5000 itself. "Test Connection" in Settings will
//     surface this immediately with a clear error if it happens — there is
//     no code-level fix for that from this side without a backend proxy.

const IBKR_GATEWAY_DEFAULT_BASE = 'https://localhost:5000/v1/api';

async function ibkrGatewayFetch(baseUrl, path, opts = {}) {
  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, { credentials: 'include', ...opts });
  } catch (e) {
    throw new Error(`Could not reach the IBKR Gateway at "${baseUrl}". Make sure it's running and you're logged in (open its URL directly in another browser tab first) — this can also be a CORS block if the Gateway won't accept requests from this page's origin, which isn't fixable from here without a backend proxy.`);
  }
  if (!res.ok) throw new Error(`IBKR Gateway request to ${path} failed (${res.status}).`);
  return res.json();
}

async function ibkrCheckAuthStatus(baseUrl) {
  const data = await ibkrGatewayFetch(baseUrl, '/iserver/auth/status', { method: 'POST' });
  return !!(data && data.authenticated);
}

async function ibkrFetchAccounts(baseUrl) {
  return ibkrGatewayFetch(baseUrl, '/iserver/accounts');
}

async function ibkrFetchTrades(baseUrl) {
  const data = await ibkrGatewayFetch(baseUrl, '/iserver/account/trades');
  return Array.isArray(data) ? data : [];
}

// Best-effort parse of option/futures-option contract descriptions like
// "AAPL 16JAN26 200 C" into strike/putCall — the Gateway's trades endpoint
// doesn't reliably break these out into their own fields the way a Flex
// Query CSV export does.
function parseIBKRContractDescription(desc) {
  if (!desc) return null;
  const m = String(desc).trim().match(/(\d+(?:\.\d+)?)\s*(C|P|CALL|PUT)\b/i);
  if (!m) return null;
  const strike = parseFloat(m[1]);
  return { strike: isNaN(strike) ? null : strike, optionType: /^C/i.test(m[2]) ? 'call' : 'put' };
}

// Maps Client Portal Gateway trade-execution JSON into the same shape
// js/integrations.js's matchExecutionsFIFO() already consumes for CSV
// imports (symbol, qty, price, date, time, account, securityType,
// tickValue, optionType, strike, commissionPerUnit, companyName), so both
// the manual CSV path and this live-polling path share one FIFO matcher —
// no separate reconciliation logic to keep in sync.
function convertGatewayTradesToExecutions(gatewayTrades) {
  return gatewayTrades.map(t => {
    const symbol = String(t.symbol || t.ticker || '').trim().toUpperCase();
    const sideRaw = String(t.side || '').trim().toUpperCase();
    let qty = parseFloat(t.size ?? t.quantity ?? 0);
    if (sideRaw.startsWith('S') && qty > 0) qty = -qty;
    if (sideRaw.startsWith('B') && qty < 0) qty = -qty;
    const price = parseFloat(t.price ?? 0);
    const secTypeRaw = String(t.sec_type || t.secType || '').trim().toUpperCase();
    const securityType = IBKR_ASSET_CLASS_MAP[secTypeRaw] || 'stock';
    const isOptionType = securityType === 'options' || securityType === 'futureOptions';
    const desc = t.contract_description_1 || t.order_description || '';
    const parsed = isOptionType ? parseIBKRContractDescription(desc) : null;
    const commissionRaw = parseFloat(t.commission ?? 0);
    const commissionPerUnit = (!isNaN(commissionRaw) && qty !== 0) ? Math.abs(commissionRaw) / Math.abs(qty) : 0;
    const tradeTimeMs = Number(t.trade_time_r);
    const tradeTimeR = !isNaN(tradeTimeMs) && tradeTimeMs > 0 ? new Date(tradeTimeMs) : null;
    const date = tradeTimeR ? tradeTimeR.toISOString().split('T')[0] : normalizeIBKRDate(t.trade_time || '');
    const time = tradeTimeR ? tradeTimeR.toISOString().split('T')[1].slice(0, 8) : normalizeIBKRTime(t.trade_time || '');
    return {
      symbol, qty, price, date, time,
      account: String(t.account || '').trim(),
      securityType, tickValue: 1,
      optionType: parsed ? parsed.optionType : '',
      strike: parsed ? parsed.strike : null,
      commissionPerUnit,
      companyName: t.company_name || '',
    };
  }).filter(e => e.symbol && !isNaN(e.qty) && e.qty !== 0 && !isNaN(e.price));
}

// A stable content signature to dedupe against trades already in the
// journal. The Gateway's trades endpoint has no "since last poll" cursor —
// it just returns the whole day's executions every time — so every poll
// re-runs the full day through FIFO matching and only genuinely new
// resulting round-trips get added.
function ibkrTradeSignature(t) {
  return [t.symbol, t.account, t.date, t.entryTime, t.exitTime, t.entry, t.exit, t.qty, t.securityType].join('|');
}

// Returns only the closed round-trip trades that aren't already present in
// existingTrades (by content signature) — the caller decides what to do
// with them (push into `trades`, persist, sync, etc).
async function pollIBKRGateway(baseUrl, existingTrades) {
  const authed = await ibkrCheckAuthStatus(baseUrl);
  if (!authed) throw new Error('Not signed in to the IBKR Gateway — open its URL in another browser tab and log in there, then try again.');
  const gatewayTrades = await ibkrFetchTrades(baseUrl);
  const executions = convertGatewayTradesToExecutions(gatewayTrades);
  executions.sort((a, b) => (a.date + 'T' + (a.time || '00:00')).localeCompare(b.date + 'T' + (b.time || '00:00')));
  const matched = matchExecutionsFIFO(executions);
  const known = new Set(existingTrades.map(ibkrTradeSignature));
  return matched.filter(t => !known.has(ibkrTradeSignature(t)));
}

// ---------- FLEX WEB SERVICE (alternative to the local Gateway above) ----------
// IBKR's Flex Web Service is a plain HTTPS reporting API keyed by a Token +
// Query ID (both from Account Management > Reporting > Flex Queries), and
// needs no local program running — a real advantage over the Gateway path
// above when it works. Two-step flow:
//   1. SendRequest — kicks off report generation, returns a ReferenceCode.
//   2. GetStatement — fetch the finished report by that ReferenceCode; IBKR
//      returns a "still generating" error (code 1019) for a few seconds
//      after SendRequest, so this polls with a short retry/backoff.
//
// Confirmed by a live "Test Connection" failure: IBKR's Flex Web Service
// does not send CORS headers permitting requests from this page's origin,
// so calls are routed through a small stateless Supabase Edge Function
// (see supabase/functions/ibkr-flex-proxy/) that forwards the same two
// calls server-side and adds CORS headers on the way back. It stores
// nothing — the token is passed through per-request from this browser,
// same trust model as every other API key in this app.
//
// IBKR also throttles Flex Web Service calls (repeated rapid requests can
// get a query temporarily locked out), so the UI enforces a much longer
// minimum poll interval here (5 minutes) than the Gateway path (15s).
const FLEX_PROXY_BASE = 'https://iknfvddnevudpjtyxkbh.supabase.co/functions/v1/ibkr-flex-proxy';
const FLEX_STATEMENT_IN_PROGRESS_CODE = '1019';

function parseFlexXML(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('IBKR returned a response that could not be parsed as XML.');
  return doc;
}

async function flexFetchText(action, token, param) {
  const url = `${FLEX_PROXY_BASE}?action=${action}&t=${encodeURIComponent(token)}&q=${encodeURIComponent(param)}`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`Could not reach the IBKR Flex proxy. Check your internet connection and try again.`);
  }
  if (!res.ok) throw new Error(`IBKR Flex Web Service request failed (${res.status}).`);
  return res.text();
}

// Step 1: kick off report generation, return the ReferenceCode to poll for.
async function flexSendRequest(token, queryId) {
  const text = await flexFetchText('send', token, queryId);
  const doc = parseFlexXML(text);
  const status = doc.querySelector('Status')?.textContent;
  if (status !== 'Success') {
    const code = doc.querySelector('ErrorCode')?.textContent;
    const msg = doc.querySelector('ErrorMessage')?.textContent || 'Unknown error';
    throw new Error(`IBKR Flex Web Service rejected the request (${code || '?'}): ${msg}. Double-check the Token and Query ID in Settings.`);
  }
  const refCode = doc.querySelector('ReferenceCode')?.textContent;
  if (!refCode) throw new Error('IBKR did not return a reference code for this Flex Query.');
  return refCode;
}

// Step 2: poll for the finished report, retrying while IBKR is still
// generating it (error code 1019).
async function flexGetStatement(token, referenceCode, { maxAttempts = 6, delayMs = 3000 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const text = await flexFetchText('status', token, referenceCode);
    // A finished Trades report doesn't start with <FlexStatementResponse>,
    // it starts with <FlexQueryResponse> — only the error/in-progress shape
    // uses the former, so check for that before treating it as an error.
    if (!text.trim().startsWith('<FlexStatementResponse')) return text;
    const doc = parseFlexXML(text);
    const code = doc.querySelector('ErrorCode')?.textContent;
    if (code === FLEX_STATEMENT_IN_PROGRESS_CODE) {
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }
    const msg = doc.querySelector('ErrorMessage')?.textContent || 'Unknown error';
    throw new Error(`IBKR Flex Web Service error (${code || '?'}): ${msg}.`);
  }
  throw new Error('IBKR is still generating this Flex report after several attempts — try again in a minute.');
}

// Best-effort strike/putCall from a Trade element's own attributes first
// (Flex XML usually has clean "strike"/"putCall" attributes, unlike the
// Gateway's trades JSON), falling back to the description text.
function flexOptionDetails(el) {
  const strikeAttr = parseFloat(el.getAttribute('strike'));
  const putCallAttr = (el.getAttribute('putCall') || '').trim().toUpperCase();
  if (!isNaN(strikeAttr) && strikeAttr > 0 && putCallAttr) {
    return { strike: strikeAttr, optionType: putCallAttr.startsWith('P') ? 'put' : 'call' };
  }
  return parseIBKRContractDescription(el.getAttribute('description') || '');
}

// Flex XML's tradeTime attribute is a standalone "HHMMSS" string (unlike
// the CSV export's combined "date;time"/"date time" format that
// normalizeIBKRTime in js/integrations.js expects), so it needs its own
// simple parser rather than reusing that one.
function parseFlexTimeAttr(raw) {
  if (!raw) return '';
  const m = String(raw).trim().match(/^(\d{2}):?(\d{2}):?(\d{2})?$/);
  if (!m) return '';
  return `${m[1]}:${m[2]}:${m[3] || '00'}`;
}

// Parses a Flex Query "Trades" report (XML) into the same execution shape
// matchExecutionsFIFO() consumes — mirrors parseIBKRCsv()'s column mapping
// in js/integrations.js, just reading named XML attributes instead of
// guessing CSV column positions (Flex XML attributes are already labeled).
function parseFlexTradesXML(xmlText) {
  const doc = parseFlexXML(xmlText);
  const tradeEls = Array.from(doc.querySelectorAll('Trade'));
  const executions = tradeEls.map(el => {
    const symbol = (el.getAttribute('symbol') || '').trim().toUpperCase();
    let qty = parseFloat(el.getAttribute('quantity') || '0');
    const buySell = (el.getAttribute('buySell') || '').trim().toUpperCase();
    if (buySell.startsWith('S') && qty > 0) qty = -qty;
    if (buySell.startsWith('B') && qty < 0) qty = -qty;
    const price = parseFloat(el.getAttribute('tradePrice') || '0');
    const assetClassRaw = (el.getAttribute('assetCategory') || '').trim().toUpperCase();
    const securityType = IBKR_ASSET_CLASS_MAP[assetClassRaw] || 'stock';
    const isOptionType = securityType === 'options' || securityType === 'futureOptions';
    const opt = isOptionType ? flexOptionDetails(el) : null;
    const multiplierRaw = parseFloat(el.getAttribute('multiplier') || '');
    let tickValue = 1;
    if (!isNaN(multiplierRaw) && multiplierRaw > 0) {
      tickValue = securityType === 'options' ? multiplierRaw / 100 : multiplierRaw;
    }
    const commissionRaw = parseFloat(el.getAttribute('ibCommission') || '0');
    const commissionPerUnit = (!isNaN(commissionRaw) && qty !== 0) ? Math.abs(commissionRaw) / Math.abs(qty) : 0;
    const date = normalizeIBKRDate(el.getAttribute('tradeDate') || '');
    const time = parseFlexTimeAttr(el.getAttribute('tradeTime') || '') || normalizeIBKRTime(el.getAttribute('dateTime') || '');
    return {
      symbol, qty, price, date, time,
      account: (el.getAttribute('accountId') || '').trim(),
      securityType, tickValue,
      optionType: opt ? opt.optionType : '',
      strike: opt ? opt.strike : null,
      commissionPerUnit,
      companyName: (el.getAttribute('description') || '').trim(),
    };
  }).filter(e => e.symbol && !isNaN(e.qty) && e.qty !== 0 && !isNaN(e.price));

  executions.sort((a, b) => (a.date + 'T' + (a.time || '00:00')).localeCompare(b.date + 'T' + (b.time || '00:00')));
  return executions;
}

// Runs the full SendRequest -> poll GetStatement -> parse -> FIFO-match ->
// dedupe pipeline, mirroring pollIBKRGateway()'s shape so js/app.js can
// treat both sources the same way.
async function pollIBKRFlex(token, queryId, existingTrades) {
  if (!token || !queryId) throw new Error('Enter your Flex Web Service Token and Query ID in Settings first.');
  const refCode = await flexSendRequest(token, queryId);
  const xmlText = await flexGetStatement(token, refCode);
  const executions = parseFlexTradesXML(xmlText);
  const matched = matchExecutionsFIFO(executions);
  const known = new Set(existingTrades.map(ibkrTradeSignature));
  return matched.filter(t => !known.has(ibkrTradeSignature(t)));
}
