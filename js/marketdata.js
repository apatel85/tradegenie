// MARKET DATA: symbol search, company info, and live quote via two free
// REST APIs — no backend involved, calls go straight from this browser
// using the user's own free API keys (Settings > Market Data):
//   Finnhub (https://finnhub.io/docs/api) — stocks, forex, crypto.
//   Twelve Data (https://twelvedata.com/docs) — used for Futures/Future
//   Options, since Finnhub's free tier barely covers futures at all.
// Both are CORS-friendly (work from a static page), but both free tiers
// only expose the *current* quote, not a historical price for a past
// date/time — genuinely free point-in-time futures/options data isn't
// available anywhere without a paid provider, since exchanges license it.

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const TWELVE_DATA_BASE = 'https://api.twelvedata.com';

async function finnhubRequest(path, apiKey) {
  const url = `${FINNHUB_BASE}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(apiKey)}`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error('Could not reach Finnhub — check your internet connection (or an ad/privacy blocker may be blocking the request).');
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('Finnhub rejected this API key. Check it was pasted correctly in Settings.');
  }
  if (res.status === 429) {
    throw new Error('Finnhub rate limit hit — free tier is capped per minute. Wait a moment and try again.');
  }
  if (!res.ok) {
    throw new Error(`Finnhub request failed (${res.status}).`);
  }
  return res.json();
}

// Returns the best-matching symbol result for a free-text query.
async function finnhubSymbolSearch(apiKey, query) {
  const data = await finnhubRequest(`/search?q=${encodeURIComponent(query)}`, apiKey);
  const results = (data && data.result) || [];
  // Prefer an exact ticker match (e.g. "AAPL") over fuzzy name matches.
  const exact = results.find(r => (r.symbol || '').toUpperCase() === query.trim().toUpperCase());
  return exact || results[0] || null;
}

async function finnhubCompanyProfile(apiKey, symbol) {
  const data = await finnhubRequest(`/stock/profile2?symbol=${encodeURIComponent(symbol)}`, apiKey);
  if (!data || !data.name) return null;
  return { name: data.name, exchange: data.exchange || '', currency: data.currency || '' };
}

async function finnhubQuote(apiKey, symbol) {
  const data = await finnhubRequest(`/quote?symbol=${encodeURIComponent(symbol)}`, apiKey);
  if (!data || (data.c === undefined)) return null;
  return { current: data.c, prevClose: data.pc, high: data.h, low: data.l, timestamp: data.t };
}

async function lookupSymbolInfoFinnhub(apiKey, symbol) {
  if (!apiKey) throw new Error('Add your Finnhub API key in Settings > Market Data first.');
  const match = await finnhubSymbolSearch(apiKey, symbol);
  const resolvedSymbol = (match && match.symbol) || symbol;

  const [profile, quote] = await Promise.all([
    finnhubCompanyProfile(apiKey, resolvedSymbol).catch(() => null),
    finnhubQuote(apiKey, resolvedSymbol).catch(() => null),
  ]);

  if (!profile && !quote) {
    throw new Error(`No data found for "${symbol}". Free-tier lookups work best for US-listed stocks.`);
  }

  return {
    symbol: resolvedSymbol,
    companyName: profile ? profile.name : (match && match.description) || '',
    exchange: profile ? profile.exchange : '',
    currentPrice: quote ? quote.current : null,
  };
}

async function twelveDataRequest(path, apiKey) {
  const url = `${TWELVE_DATA_BASE}${path}${path.includes('?') ? '&' : '?'}apikey=${encodeURIComponent(apiKey)}`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error('Could not reach Twelve Data — check your internet connection (or an ad/privacy blocker may be blocking the request).');
  }
  if (!res.ok) throw new Error(`Twelve Data request failed (${res.status}).`);
  const data = await res.json();
  if (data && data.status === 'error') {
    throw new Error(data.message || 'Twelve Data rejected this request — check the API key and symbol.');
  }
  return data;
}

async function lookupSymbolInfoTwelveData(apiKey, symbol) {
  if (!apiKey) throw new Error('Add your Twelve Data API key in Settings > Market Data first (used for Futures/Future Options).');
  const quote = await twelveDataRequest(`/quote?symbol=${encodeURIComponent(symbol)}`, apiKey);
  const price = quote && (quote.close !== undefined) ? parseFloat(quote.close) : null;
  if (price === null && !quote.name) {
    throw new Error(`No data found for "${symbol}" on Twelve Data. Continuous futures symbols (e.g. "CL", "ES", "GC") work best on the free tier — specific expiry contracts usually aren't covered.`);
  }
  return {
    symbol: (quote && quote.symbol) || symbol,
    companyName: (quote && quote.name) || symbol,
    exchange: (quote && quote.exchange) || '',
    currentPrice: isNaN(price) ? null : price,
  };
}

// Combines search + profile + quote into one call for the Add Trade modal's
// "Look Up" button, routed by security type: Futures/Future Options use
// Twelve Data (better futures coverage), everything else uses Finnhub.
async function lookupSymbolInfo(apiKeys, rawSymbol, securityType) {
  const symbol = (rawSymbol || '').trim().toUpperCase();
  if (!symbol) throw new Error('Enter a symbol first.');
  const useFutures = securityType === 'futures' || securityType === 'futureOptions';
  return useFutures
    ? lookupSymbolInfoTwelveData(apiKeys.twelveDataKey, symbol)
    : lookupSymbolInfoFinnhub(apiKeys.finnhubKey, symbol);
}
