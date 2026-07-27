// TradeGenie IBKR Flex Web Service proxy.
//
// IBKR's Flex Web Service (ndcdyn.interactivebrokers.com) is a server-to-
// server reporting API and does not send CORS headers permitting requests
// from a browser page on a different origin (confirmed by a live "Test
// Connection" failure in TradeGenie). This function is a thin, stateless
// pass-through: it forwards the same two Flex Web Service calls
// server-side (where CORS doesn't apply) and adds CORS headers on the way
// back, so TradeGenie's static frontend can reach it.
//
// It stores nothing. The IBKR token is passed through per-request from the
// browser (same trust model as every other API key in TradeGenie — it
// lives in the user's own browser storage, never here) and is never
// logged or persisted by this function.
//
// Deployed to the "CSO-Inventory-Tracker" Supabase project as
// ibkr-flex-proxy, with verify_jwt disabled (it needs to be reachable from
// a static page with no Supabase auth flow of its own — the IBKR token
// itself is the credential that matters here, this function gains no new
// privilege by skipping JWT verification). See js/ibkrLive.js for the
// client side of this — FLEX_PROXY_BASE points at the deployed URL.

const IBKR_BASE = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action"); // "send" | "status"
  const t = url.searchParams.get("t");
  const q = url.searchParams.get("q");

  if (!action || !t || !q) {
    return new Response("Missing required query params: action, t, q", {
      status: 400,
      headers: CORS_HEADERS,
    });
  }
  if (action !== "send" && action !== "status") {
    return new Response('Invalid "action" — must be "send" or "status".', {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  const path = action === "send" ? "SendRequest" : "GetStatement";
  const upstreamUrl = `${IBKR_BASE}/${path}?t=${encodeURIComponent(t)}&q=${encodeURIComponent(q)}&v=3`;

  try {
    const upstreamRes = await fetch(upstreamUrl);
    const text = await upstreamRes.text();
    return new Response(text, {
      status: upstreamRes.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/xml; charset=utf-8" },
    });
  } catch (e) {
    return new Response(`Proxy could not reach IBKR: ${e instanceof Error ? e.message : String(e)}`, {
      status: 502,
      headers: CORS_HEADERS,
    });
  }
});
