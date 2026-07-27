// INTERACTIVE BROKERS LIVE SYNC (Beta) — auto-pull executed trades
//
// This is a static, backend-less app, so there's no server that can hold an
// IBKR session for you. What CAN work without one: IBKR ships a free local
// program called the "Client Portal Gateway" — you run it on your own
// computer, log into it once (https://localhost:5000 by default), and it
// exposes a local REST API for your own account's data. While this app is
// open in a browser tab, it polls that local API every ibkrPollSeconds for
// today's executions and auto-imports any new ones, reusing the exact same
// FIFO round-trip matcher the manual CSV import uses (see matchExecutionsFIFO
// in js/integrations.js) — same logic, just triggered automatically instead
// of on a file upload.
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
