# TradeGenie — App Blueprint

## 1. Product Overview

A mobile-friendly, single-page web application inspired by TradeZella that gives traders:
- Automated trade journaling and manual entry
- Real-time analytics and reports
- AI-powered insights and chat
- Playbook strategy management
- Backtesting simulation
- Prop firm rule tracking
- Community spaces

---

## 2. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | Vanilla HTML5 / CSS3 / JS (ES6+) | Zero dependencies, fast load, fully portable |
| Charts | Chart.js (CDN) | Lightweight, responsive chart library |
| Icons | Font Awesome 6 (CDN) | Comprehensive icon set |
| Storage | localStorage (`js/storage.js`) as a per-device cache; a Google Sheet in the signed-in user's own Drive is the **master record** | No backend needed, yet the same data follows you across every device/browser you sign into |
| Auth | Google Identity Services OAuth (`js/auth.js`) — required to reach the app | One Google Cloud OAuth Client ID, hardcoded in `js/auth.js` |
| Hosting | GitHub Pages | Free, instant, no server |

---

## 3. Architecture

```
tradegenie/
├── index.html          # Single-page app shell, all pages as sections
├── css/
│   └── styles.css      # All styles: layout, components, responsive
├── js/
│   ├── data.js         # Sample seed data and constants (opt-in demo data now, see 4.11)
│   ├── storage.js      # localStorage persistence (trades, accounts, settings) — per-device cache
│   ├── auth.js          # Landing page / auth gate lifecycle, Google sign-in, Drive sheet discovery
│   ├── goals.js         # Daily goal assessment + behavioral feedback engine
│   ├── integrations.js  # Google Sheets two-way sync + Interactive Brokers CSV sync
│   ├── marketdata.js    # Finnhub symbol search / company profile / live quote
│   └── app.js          # All app logic, event handlers, renderers (bootApp() called by auth.js)
└── BLUEPRINT.md        # This document
```

### Page Routing
All pages are `<section>` elements with `class="page"`. Navigation toggles `class="active"` — no page reload, no router library needed.

---

## 4. Feature Spec by Page

### 4.1 Dashboard
- **4 stat cards**: Net P&L, Win Rate, Profit Factor, Avg R-Multiple (computed from trade data)
- **Cumulative P&L chart**: Line chart, updates in real-time as trades are added/deleted
- **Recent Trades panel**: Last 5 trades with symbol, setup, P&L
- **Win/Loss by Day bar chart**: Color-coded green/red
- **AI Summary panel**: Dynamic summary paragraph computed from trade stats

### 4.2 Trade Journal
- **Filter bar**: Live search by symbol, filter by Win/Loss, filter by Setup
- **Full data table**: Date, Symbol, Side (tag), Setup (tag), Entry, Exit, P&L, R-Multiple, Star Rating, Edit/Delete actions
- **Add Trade modal**: Full form with all fields, star rating widget, emotional state selector
- **Edit mode**: Pre-fills form with existing trade data
- **Auto-calculated P&L and R**: Computed from entry, exit, qty, stop loss
- **Open positions**: Exit Price can be left blank to log a trade as an open position (shown as an "OPEN" badge, excluded from win rate/P&L/profit factor); editing the trade later to fill in an exit price closes it and computes P&L/R
- **Actual entry/exit timestamps**: Entry Time and Exit Time (HH:MM:SS) are auto-filled with the real wall-clock time when a trade is opened/closed (editable if backfilling), stored and shown alongside the date in the Journal
- **Security type**: Stock, Options, Futures, Future Options, or Crypto, selected per trade. Options and Futures/Future Options reveal a "Tick Value" field (every 1 point = $x, defaults to $1) that drives the P&L formula — stock/crypto use price-diff × qty; options use price-diff × qty × 100 × tick value; futures/future options use price-diff × qty × tick value. A matching "Security" filter and column are in the Journal, and Interactive Brokers CSV import auto-detects the security type from the broker's AssetClass column
- **Options/Future Options details**: Put/Call and Strike Price fields (informational — P&L is driven entirely by premium entry/exit price, which already prices in the call/put payoff, so strike doesn't feed the formula). Side relabels to Buy/Sell for these instruments; "Buy" (long) and "Sell" (short/write) reuse the same price-diff formula as stock long/short, since buying-to-open vs. selling-to-open is exactly a long/short position on the premium
- **Commission**: optional per-trade fee, subtracted from the gross P&L to get the net P&L/R shown everywhere (risk-amount for R stays gross, since commission isn't part of planned risk). Interactive Brokers import reads the broker's commission column and reconstructs it proportionally across FIFO-matched partial fills
- **Signed money formatting**: `formatSignedMoney()`/`formatSignedR()` in app.js are the single source of truth for coloring/parenthesizing P&L everywhere (dashboard, analytics, journal, accounts, goal card) — losses render red and in parentheses (e.g. `($3,000.00)`), gains green with a `+`
- **Market data lookup**: "Look Up" button on the Add Trade form (js/marketdata.js) queries Finnhub (stocks/forex/crypto) for company name/exchange and the current live quote, with a one-click "Use as Entry Price" fill. Futures/Future Options try Twelve Data first (its free Basic plan does *not* include Futures/Commodities — that needs their paid "Grow" plan or higher, so a free key returns "no data" as expected), then automatically fall back to Yahoo Finance's unofficial, no-key chart endpoint (`query1.finance.yahoo.com/v8/finance/chart/`, tries the continuous-futures `SYMBOL=F` form first, e.g. `ES=F`). The Yahoo fallback is undocumented/best-effort — it may not send CORS headers for a given origin, in which case Look Up shows a clear combined error rather than failing silently. All keys are user-supplied and free, Settings > Market Data. None of these expose a historical price for a past trade date, only the current quote — genuinely free point-in-time futures/options data isn't available without a paid provider

### 4.3 Analytics
- **4 stat cards**: Total Trades, Avg Hold Time, Max Drawdown, Best Trade
- **P&L by Setup bar chart**: Compare performance across Breakout, Reversal, Momentum, Scalp
- **P&L by Time of Day line chart**: Best/worst trading hours
- **MFE vs MAE scatter chart**: Color-coded by win/loss
- **Win Rate by Day of Week bar chart**: Identify best trading days

### 4.4 Playbook
- **Strategy cards grid**: Name, setup tag, win rate, trade count, total P&L, avg R, description
- **Add Strategy button**: Placeholder for future strategy builder
- Responsive grid: 1–4 columns based on screen size

### 4.5 AI Insights (Genie AI)
- **Insight cards**: 4 pre-computed insights (Tilt Detection, Best Setup, Time Pattern, Risk Management)
- **AI Chat interface**: User messages + simulated AI responses drawn from trade-data-grounded response bank
- **Typing delay**: 700ms simulated response time for realism

### 4.6 Backtesting
- **Configuration form**: Strategy name, symbol, date range, plain-English entry condition, risk per trade
- **Simulated results**: Win rate, net P&L, profit factor, total trades (Monte Carlo simulation)
- **Equity curve chart**: Line chart showing simulated trade-by-trade equity path

### 4.7 PropFirm Sync
- **Firm cards**: FTMO (connected with rule progress bars), TopStep and Apex (disconnected with connect CTA)
- **Rule progress bars**: Profit Target, Max Daily Drawdown, Max Total Drawdown — color-coded (green/yellow/red)
- **Pass Forecast**: Probability estimate shown for connected accounts

### 4.8 Spaces
- **Space cards grid**: Emoji avatar, name, member count, description
- **Create Space button**: Placeholder CTA

### 4.9 Accounts
- **Account cards grid**: Net P&L, win rate, trade count, profit factor, avg R, win/loss split — computed per account
- Trades carry an `account` field, editable via the Add/Edit Trade modal and filterable in the Journal

### 4.10 Daily Goal (Dashboard)
- **Goal card**: Progress bar of today's P&L vs. the configured daily goal
- **Feedback engine** (`js/goals.js`): reflects on the trailing streak of goal-met days and a "reserve" (cumulative surplus above goal pace) to:
  - Encourage stopping once the goal is hit (tames overtrading)
  - Reassure on a losing day after 3+ consecutive goal-hit days, or when banked reserve covers the loss (tames revenge trading)
  - Warn plainly when a losing day has no streak or reserve cushion
- Last-7-day dot history for quick visual streak reference

### 4.11 Sign-in & Onboarding (js/auth.js)
Google sign-in is **required** to reach the app — there's no more anonymous/local-only mode. The flow:
1. **Landing page** (`#landing-page`): marketing page shown when there's no cached session. "Sign In" / "Get Started" both open the auth gate.
2. **Auth gate** (`#auth-gate`): one "Continue with Google" button requests identity + Sheets + Drive scopes together in a single OAuth popup (`openid email profile https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file`). `drive.file` (not `drive.readonly`) is used deliberately — it only grants access to files this app's own OAuth client created, which is exactly the "TradeGenie Journal — Master" sheet the app creates, avoiding Google's stricter "sensitive scope" verification requirements with no loss of functionality.
3. **Drive auto-discovery**: `findExistingSheetInDrive()` (js/integrations.js) searches the signed-in account's Drive for a spreadsheet named "TradeGenie Journal" with at least one `Trades <year>` tab, reusing the existing `getSpreadsheetTabs()` sync-engine plumbing.
   - **Found** + this device has unsynced local trades → asks "merge with this device's trades, or use the cloud copy only?" before proceeding (never silently discards data).
   - **Found**, no local trades → loads it immediately, no prompt.
   - **Not found** → asks "create a new spreadsheet?" before creating one (never auto-creates without asking on an interactive sign-in).
4. **Session cache**: identity (`{email, name}`) is cached in localStorage for 24h so a page refresh skips the landing page — the access token itself is never stored, it's silently re-derived (`prompt:'none'`) via `requestAuthTokenSilent()` on every load. If that silent reconnect fails (third-party cookies blocked, Incognito, revoked consent), the auth gate reappears for one more manual click rather than the old approach of failing invisibly.
5. **Unlock**: once a sheet is resolved, `completeUnlock()` runs the existing two-way `syncAllWithGoogleSheets()` engine (unchanged — see 4.11.1 below) and calls `bootApp()` in js/app.js, which now only runs once auth resolves rather than unconditionally on page load.
6. **Sign out** (sidebar button): clears the cached session and reloads the page back to the landing page. Data is untouched in the Sheet — signing back in restores it.

One app-wide Google OAuth **Client ID** is hardcoded in `js/auth.js` (`GOOGLE_CLIENT_ID`) rather than pasted per-browser in Settings — it's a public identifier, safe to commit, but does require its own Google Cloud project (Sheets API + Drive API enabled, Authorized JavaScript origins covering the deployed URL).

### 4.11.1 Google Sheets sync engine (js/integrations.js, unchanged by the auth rework)
- **Updates**: editing a trade/account updates that same row (matched by a stable UUID `id`, newest `updatedAt` wins).
- **Deletes propagate**: deleting a trade/account writes a tombstone (`{type, id, deletedAt}` in the "Tombstones" tab); the next sync on any device removes that row everywhere instead of it reappearing.
- **Per-year tabs, full history**: trades are written to one tab per calendar year ("Trades 2026", "Trades 2027", ...) to keep each tab a manageable size, but the app always reads every year back in, so Analytics/Dashboard cover full history across years.
- **Conflict detection**: if the same trade/account changed on two devices since the last sync (tracked via a per-id `syncSnapshot`), the newer edit wins automatically (sync always completes) but it's surfaced in a "Sync Conflicts" panel showing exactly which fields differed, with buttons to keep either version.
- **Accounts + Settings sync too**: Accounts get their own "Accounts" tab; only non-secret preferences (Daily Goal) sync via a "Settings" tab — market-data API keys (Finnhub, Twelve Data) always stay local to each browser.
- **Demo data never syncs**: the opt-in sample trades/accounts (`SAMPLE_TRADES`/`SAMPLE_ACCOUNTS` in js/data.js, loaded via Settings > "Load Sample Data") carry stable `sample-`/`sample-acc-` id prefixes and are filtered out via `isRealId()` at every sync entry point, so demo data never gets pushed into the shared master sheet.

### 4.12 Settings
- **Daily Goal**: set/update the target used by the goal card
- **Manage Accounts**: add/remove trading accounts, plus an opt-in "Load Sample Data" button (see 4.11.1 — no longer auto-seeded on first run, since first run now always goes through sign-in)
- **Google Sheets (Master Record)**: shows the signed-in account and linked sheet (both read-only — resolved during sign-in, not typed in). "Sync Now" / "Push Only" as before; "Open Sheet" / "Use a Different Sheet" (manual override if Drive auto-discovery ever picks the wrong file, or to switch sheets)
- **Sync from Interactive Brokers**: upload a Flex Query/Activity Statement "Trades" CSV; executions are FIFO-matched per symbol+account into round-trip trades (`js/integrations.js`)
- **Clear Local Cache**: (formerly "Reset Data") clears this browser's local copy and immediately re-pulls fresh from the Google Sheet — the cloud data is never touched, since the sheet is the master record now

---

## 5. Design System

### Color Palette
| Token | Hex | Usage |
|---|---|---|
| `--bg` | `#0f1117` | Page background |
| `--bg2` | `#1a1d2e` | Card / sidebar background |
| `--bg3` | `#242840` | Hover states, table headers |
| `--accent` | `#6c63ff` | Primary brand color, active nav |
| `--accent2` | `#00d4aa` | Secondary accent, logo icon |
| `--green` | `#22c55e` | Positive P&L, wins |
| `--red` | `#ef4444` | Negative P&L, losses |
| `--yellow` | `#f59e0b` | Warnings, star ratings |
| `--blue` | `#3b82f6` | Info states |

### Typography
- Font: `Segoe UI`, `system-ui`, `sans-serif`
- Sizes: 0.75rem (labels) → 1.7rem (stat values)
- Weights: 400 body, 600 headers, 700 stats

### Spacing
- Border radius: 12px (cards), 8px (buttons, inputs), 20px (tags/badges)
- Gaps: 12–24px grid gaps, 16–28px page padding

---

## 6. Responsiveness

| Breakpoint | Layout |
|---|---|---|
| > 900px | Sidebar visible, 2–4 column grids |
| ≤ 900px | Sidebar hidden (hamburger menu), full-width content |
| ≤ 600px | 2-column stats grid, single-column dashboard |
| ≤ 400px | Single-column stats grid |

---

## 7. Component Inventory

| Component | Type | Location |
|---|---|---|
| Sidebar nav | Persistent | All pages |
| Mobile topbar | Fixed, mobile-only | All pages |
| Stat card | Display | Dashboard, Analytics, Backtest |
| Chart card | Visualization | Dashboard, Analytics, Backtest |
| Trade row | List item | Dashboard, Journal |
| Trade modal | Form dialog | Journal |
| Filter bar | Input group | Journal |
| Data table | Tabular | Journal |
| Playbook card | Display card | Playbook |
| Insight card | Display card | AI Insights |
| Chat interface | Input/output | AI Insights |
| PropFirm card | Display card | PropFirm Sync |
| Progress bar | Visual indicator | PropFirm Sync |
| Space card | Display card | Spaces |
| Star rating widget | Input | Trade Modal |

---

## 8. Data Model

### Trade Object
```json
{
  "id": 1,
  "date": "2026-07-01",
  "symbol": "AAPL",
  "side": "long | short",
  "setup": "breakout | reversal | momentum | scalp",
  "entry": 185.20,
  "exit": 188.50,
  "qty": 100,
  "stop": 183.00,
  "pnl": 330.00,
  "r": 1.5,
  "rating": 4,
  "emotion": "focused | confident | anxious | fomo | revenge",
  "notes": "string"
}
```

### Playbook Object
```json
{
  "name": "Opening Range Breakout",
  "setup": "breakout",
  "winRate": 68,
  "trades": 24,
  "pnl": 4200,
  "rr": "2.1R avg",
  "desc": "string"
}
```

---

## 9. Future Enhancements (v2 Roadmap)

1. ~~Persistent storage~~ — done via `js/storage.js` (localStorage)
2. ~~CSV import~~ — done for Interactive Brokers via `js/integrations.js`; other brokers (TD Ameritrade, etc.) still TODO
3. **Real AI integration**: Connect to OpenAI/Claude API for genuine Genie AI responses
4. **Trade screenshot upload**: Attach chart images to trade entries
5. **Calendar view**: Monthly P&L calendar heatmap
6. **Risk management alerts**: Client-side daily drawdown rules with browser notifications
7. **Dark/light mode toggle**: CSS custom property swap
8. **PWA**: Add manifest.json + service worker for offline use and home screen install
9. **Backend + auth**: Node.js/Supabase backend with user accounts, so Google Sheets export and IBKR sync don't rely on per-browser localStorage and user-supplied OAuth credentials
10. **Live broker sync**: a backend-proxied IBKR Client Portal API session (the CSV sync is a client-only stopgap since IBKR has no browser-callable live API)

---

## 10. Testing Checklist

- [x] Navigation between all 8 pages works
- [x] Add trade form validates required fields
- [x] P&L and R auto-calculated correctly on save
- [x] Edit trade pre-fills form correctly
- [x] Delete trade removes from table and updates dashboard
- [x] Journal filters (search, win/loss, setup) work independently and combined
- [x] All 7 charts render on first load
- [x] Backtest runs and renders equity curve chart
- [x] AI chat sends and receives messages
- [x] Mobile hamburger menu opens/closes sidebar
- [x] Overlay closes sidebar on click
- [x] Modal closes on Cancel and X button
- [x] Star rating widget highlights and saves correctly
- [x] Responsive layout tested at 400px, 600px, 900px, 1200px
- [x] No console errors on load
- [x] Landing page shown with no cached session; auth gate reachable via Sign In/Get Started
- [x] Drive auto-discovery: found+has-local-trades shows merge prompt; found+no-local-trades unlocks directly; not-found shows create prompt
- [x] Session TTL boundary (valid at 23h59m, expired at 24h01m)
- [x] `bootApp()` only runs after unlock, not on raw page load
