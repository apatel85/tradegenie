// Sample accounts (for multi-account tracking)
const SAMPLE_ACCOUNTS = [
  { id: 1, name: 'Main Brokerage', broker: 'Interactive Brokers' },
  { id: 2, name: 'FTMO Challenge', broker: 'FTMO' },
  { id: 3, name: 'Roth IRA', broker: 'Fidelity' },
];

// Sample trade data
// id is a stable string (not a per-device counter) so trades can be matched
// across devices when syncing with Google Sheets. entryTime/exitTime are the
// actual wall-clock times the position was opened/closed (HH:MM, 24h).
const SAMPLE_TRADES = [
  { id: 'sample-1', date: '2026-07-01', symbol: 'AAPL', side: 'long', setup: 'breakout', entry: 185.20, exit: 188.50, qty: 100, stop: 183.00, pnl: 330.00, r: 1.5, rating: 4, emotion: 'focused', notes: 'Clean breakout above 9EMA on 5min, held for 20 min.', account: 'Main Brokerage', entryTime: '09:31', exitTime: '09:51', updatedAt: '2026-07-01T09:51:00.000Z' },
  { id: 'sample-2', date: '2026-07-02', symbol: 'SPY', side: 'short', setup: 'reversal', entry: 524.00, exit: 520.80, qty: 50, stop: 526.00, pnl: 160.00, r: 0.8, rating: 3, emotion: 'confident', notes: 'Failed breakout at HOD, reversed hard.', account: 'Main Brokerage', entryTime: '10:05', exitTime: '10:22', updatedAt: '2026-07-02T10:22:00.000Z' },
  { id: 'sample-3', date: '2026-07-03', symbol: 'TSLA', side: 'long', setup: 'momentum', entry: 248.00, exit: 253.50, qty: 80, stop: 245.00, pnl: 440.00, r: 1.83, rating: 5, emotion: 'focused', notes: 'Pre-market catalyst. Held through consolidation.', account: 'Main Brokerage', entryTime: '09:33', exitTime: '10:40', updatedAt: '2026-07-03T10:40:00.000Z' },
  { id: 'sample-4', date: '2026-07-07', symbol: 'NVDA', side: 'long', setup: 'breakout', entry: 480.00, exit: 476.00, qty: 20, stop: 477.00, pnl: -80.00, r: -1.33, rating: 2, emotion: 'anxious', notes: 'Fakeout breakout. Stopped out cleanly.', account: 'FTMO Challenge', entryTime: '09:41', exitTime: '09:47', updatedAt: '2026-07-07T09:47:00.000Z' },
  { id: 'sample-5', date: '2026-07-08', symbol: 'META', side: 'long', setup: 'scalp', entry: 592.00, exit: 594.20, qty: 150, stop: 590.50, pnl: 330.00, r: 1.47, rating: 4, emotion: 'confident', notes: 'Quick scalp off VWAP bounce.', account: 'FTMO Challenge', entryTime: '11:02', exitTime: '11:07', updatedAt: '2026-07-08T11:07:00.000Z' },
  { id: 'sample-6', date: '2026-07-09', symbol: 'AMZN', side: 'short', setup: 'reversal', entry: 215.00, exit: 212.50, qty: 100, stop: 217.00, pnl: 250.00, r: 1.25, rating: 4, emotion: 'focused', notes: 'Double top breakdown near resistance.', account: 'Main Brokerage', entryTime: '13:15', exitTime: '13:38', updatedAt: '2026-07-09T13:38:00.000Z' },
  { id: 'sample-7', date: '2026-07-10', symbol: 'AAPL', side: 'long', setup: 'momentum', entry: 190.00, exit: 186.00, qty: 100, stop: 187.50, pnl: -400.00, r: -1.6, rating: 1, emotion: 'fomo', notes: 'Chased momentum, no setup. FOMO trade.', account: 'Main Brokerage', entryTime: '14:52', exitTime: '14:58', updatedAt: '2026-07-10T14:58:00.000Z' },
  { id: 'sample-8', date: '2026-07-11', symbol: 'QQQ', side: 'long', setup: 'breakout', entry: 490.00, exit: 494.80, qty: 60, stop: 487.50, pnl: 288.00, r: 1.92, rating: 5, emotion: 'focused', notes: 'Textbook ORB. Waited for pullback and held trend.', account: 'Roth IRA', entryTime: '09:46', exitTime: '10:20', updatedAt: '2026-07-11T10:20:00.000Z' },
  { id: 'sample-9', date: '2026-07-14', symbol: 'MSFT', side: 'short', setup: 'scalp', entry: 440.00, exit: 438.50, qty: 120, stop: 441.00, pnl: 180.00, r: 1.5, rating: 3, emotion: 'confident', notes: 'Small scalp. Quick in and out.', account: 'Main Brokerage', entryTime: '10:12', exitTime: '10:15', updatedAt: '2026-07-14T10:15:00.000Z' },
  { id: 'sample-10', date: '2026-07-15', symbol: 'SPY', side: 'long', setup: 'reversal', entry: 518.00, exit: 522.00, qty: 80, stop: 515.50, pnl: 320.00, r: 1.28, rating: 4, emotion: 'focused', notes: 'VWAP reclaim into close. Clean reversal.', account: 'FTMO Challenge', entryTime: '15:38', exitTime: '15:58', updatedAt: '2026-07-15T15:58:00.000Z' },
  { id: 'sample-11', date: '2026-07-16', symbol: 'TSLA', side: 'short', setup: 'momentum', entry: 260.00, exit: 265.00, qty: 50, stop: 263.00, pnl: -250.00, r: -1.67, rating: 2, emotion: 'revenge', notes: 'Revenge trade after morning loss. Lesson learned.', account: 'Main Brokerage', entryTime: '10:48', exitTime: '10:53', updatedAt: '2026-07-16T10:53:00.000Z' },
  { id: 'sample-12', date: '2026-07-17', symbol: 'NVDA', side: 'long', setup: 'breakout', entry: 495.00, exit: 503.00, qty: 40, stop: 491.00, pnl: 320.00, r: 2.0, rating: 5, emotion: 'focused', notes: 'Earnings catalyst follow-through breakout.', account: 'Roth IRA', entryTime: '09:34', exitTime: '10:15', updatedAt: '2026-07-17T10:15:00.000Z' },
];

const SAMPLE_PLAYBOOKS = [
  { name: 'Opening Range Breakout', setup: 'breakout', winRate: 68, trades: 24, pnl: 4200, rr: '2.1R avg', desc: 'Buy/sell break of first 15-min candle with volume confirmation. Hold 30-60 min.' },
  { name: 'VWAP Reversal', setup: 'reversal', winRate: 72, trades: 18, pnl: 2800, rr: '1.8R avg', desc: 'Fade extended moves away from VWAP, enter on reclaim candle with tight stop.' },
  { name: 'Momentum Continuation', setup: 'momentum', winRate: 55, trades: 31, pnl: 1900, rr: '2.4R avg', desc: 'Trade with trend on pullbacks to moving averages after strong impulsive moves.' },
  { name: 'Scalp Off Key Levels', setup: 'scalp', winRate: 78, trades: 45, pnl: 3100, rr: '0.9R avg', desc: 'Quick 1-3 min scalps off round numbers, pre-market highs/lows, and pivot points.' },
];

const SAMPLE_SPACES = [
  { name: 'Futures Traders', emoji: '📈', members: 142, desc: 'Daily futures trade sharing and market commentary. ES, NQ, MES.' },
  { name: 'Options Flow', emoji: '🎯', members: 89, desc: 'Unusual options flow and strategy discussion. Spreads, 0DTE.' },
  { name: 'Prop Firm Warriors', emoji: '🏆', members: 215, desc: 'Pass your challenge together. Tips, rules, and accountability.' },
  { name: 'Swing Traders Hub', emoji: '🌊', members: 67, desc: 'Longer timeframe setups, weekly watchlists, earnings plays.' },
];

const AI_INSIGHTS = [
  { title: '⚠️ Tilt Detection', text: 'You placed 3 revenge trades this month after consecutive losses. These averaged -1.5R. Consider a cooling-off rule after 2 losses in a row.' },
  { title: '✅ Best Setup', text: 'Your Breakout setup has a 68% win rate and 2.1R average. It accounts for 60% of your net P&L — lean into it.' },
  { title: '🕐 Time Pattern', text: 'Trades taken between 9:30–10:15 AM produce 78% of your profits. Trades after 2 PM have a negative expectancy.' },
  { title: '📊 Risk Management', text: 'Average position size is consistent, but your worst losses came from oversizing on FOMO entries. Keep position size fixed.' },
];

const AI_RESPONSES = [
  'Based on your last 30 days, your Breakout setup is your highest edge play with 68% win rate and 2.1R average reward.',
  'I see a pattern: your losses tend to cluster on Tuesdays and after 2 PM. Consider reducing size or stopping trading after your daily target is hit.',
  'Your best emotional state is "Focused" — trades tagged with that emotion show a 74% win rate versus 38% when you are in "FOMO" mode.',
  'Looking at your data, your average hold time on winners is 22 minutes, while losers are cut in 7 minutes. Great discipline on the stop side!',
  'Profit factor this month is 2.14 — that is strong. To push it above 2.5, focus on trimming partial profits at 1R and letting runners go to 2R.',
  'I detected 3 trades this week where you exited before your target. Those trades would have averaged +2.8R. Try setting a limit order at your target immediately after entry.',
];
