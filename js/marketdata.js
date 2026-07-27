// MARKET DATA: symbol search, company info, and live quote via Finnhub's
// free REST API (https://finnhub.io/docs/api). No backend involved — calls
// go straight from this browser to Finnhub using the user's own free API
// key (Settings > Market Data). CORS-friendly, so it works from a static
// page, but the free tier only exposes the *current* quote, not a
// historical price for a past date/time.

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

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

// Combines search + profile + quote into one call for the Add Trade modal's
// "Look Up" button. Company profile lookup only applies to plain stocks —
// Finnhub's profile2 endpoint doesn't resolve option/futures contract symbols.
async function lookupSymbolInfo(apiKey, rawSymbol) {
  if (!apiKey) throw new Error('Add your Finnhub API key in Settings > Market Data first.');
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) throw new Error('Enter a symbol first.');

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
    description: (match && match.description) || '',
    companyName: profile ? profile.name : (match && match.description) || '',
    exchange: profile ? profile.exchange : '',
    currentPrice: quote ? quote.current : null,
  };
}
