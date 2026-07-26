# TradeZella Clone — App Blueprint

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
| Storage | In-memory + localStorage (future) | No backend needed for MVP |
| Hosting | GitHub Pages | Free, instant, no server |

---

## 3. Architecture

```
tradezella-clone/
├── index.html          # Single-page app shell, all pages as sections
├── css/
│   └── styles.css      # All styles: layout, components, responsive
├── js/
│   ├── data.js         # Sample seed data and constants
│   └── app.js          # All app logic, event handlers, renderers
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

### 4.5 AI Insights (Zella AI)
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

1. **Persistent storage**: localStorage or IndexedDB so trades survive page refresh
2. **CSV import**: Parse broker trade exports (TD Ameritrade, Interactive Brokers format)
3. **Real AI integration**: Connect to OpenAI API for genuine Zella AI responses
4. **Trade screenshot upload**: Attach chart images to trade entries
5. **Calendar view**: Monthly P&L calendar heatmap
6. **Risk management alerts**: Client-side daily drawdown rules with browser notifications
7. **Dark/light mode toggle**: CSS custom property swap
8. **PWA**: Add manifest.json + service worker for offline use and home screen install
9. **Backend + auth**: Node.js/Supabase backend with user accounts
10. **Real broker sync**: OAuth integrations with broker APIs

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
