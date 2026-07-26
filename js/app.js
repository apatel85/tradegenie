// STATE
let trades = [...SAMPLE_TRADES];
let nextId = trades.length + 1;
let editingId = null;
let selectedRating = 3;
let btChartInstance = null;
let pnlChartInstance = null;
let dayChartInstance = null;
let setupChartInstance = null;
let timeChartInstance = null;
let mfeChartInstance = null;
let weekChartInstance = null;

// DOM REFS
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const hamburger = document.getElementById('hamburger');
const closeSidebarBtn = document.getElementById('closeSidebar');
const tradeModal = document.getElementById('tradeModal');
const pages = document.querySelectorAll('.page');
const navItems = document.querySelectorAll('.nav-item[data-page]');

// INIT
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('currentDate').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  document.getElementById('f-date').value = new Date().toISOString().split('T')[0];
  renderRecentTrades();
  renderAISummary();
  renderJournal();
  renderPlaybook();
  renderAIInsights();
  renderSpaces();
  initStars();
  setupEventListeners();
  setTimeout(() => {
    renderDashboardCharts();
    renderAnalyticsCharts();
  }, 100);
});

// NAV
function navigateTo(pageId) {
  pages.forEach(p => p.classList.remove('active'));
  navItems.forEach(n => n.classList.remove('active'));
  const target = document.getElementById('page-' + pageId);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-item[data-page="' + pageId + '"]').forEach(n => n.classList.add('active'));
  closeMobileMenu();
  if (pageId === 'analytics') setTimeout(renderAnalyticsCharts, 100);
}

function setupEventListeners() {
  // Nav
  navItems.forEach(item => {
    item.addEventListener('click', (e) => { e.preventDefault(); navigateTo(item.dataset.page); });
  });
  // Mobile menu
  hamburger.addEventListener('click', openMobileMenu);
  closeSidebarBtn.addEventListener('click', closeMobileMenu);
  overlay.addEventListener('click', closeMobileMenu);
  // Trade modal triggers
  document.getElementById('addTradeBtn').addEventListener('click', openAddTradeModal);
  document.getElementById('journalAddBtn').addEventListener('click', openAddTradeModal);
  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('cancelModal').addEventListener('click', closeModal);
  document.getElementById('saveTradeBtn').addEventListener('click', saveTrade);
  // Filters
  document.getElementById('searchTrades').addEventListener('input', renderJournal);
  document.getElementById('filterResult').addEventListener('change', renderJournal);
  document.getElementById('filterSetup').addEventListener('change', renderJournal);
  // AI Chat
  document.getElementById('chatSendBtn').addEventListener('click', sendAIMessage);
  document.getElementById('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendAIMessage(); });
  // Backtest
  document.getElementById('runBacktestBtn').addEventListener('click', runBacktest);
  // Playbook add
  document.getElementById('addPlaybookBtn').addEventListener('click', () => alert('Strategy builder coming soon!'));
}

function openMobileMenu() {
  sidebar.classList.add('open');
  overlay.classList.add('active');
}
function closeMobileMenu() {
  sidebar.classList.remove('open');
  overlay.classList.remove('active');
}

// MODAL
function openAddTradeModal(tradeId = null) {
  editingId = tradeId;
  document.getElementById('modalTitle').textContent = tradeId ? 'Edit Trade' : 'Add Trade';
  if (tradeId) {
    const t = trades.find(x => x.id === tradeId);
    if (t) {
      document.getElementById('f-symbol').value = t.symbol;
      document.getElementById('f-date').value = t.date;
      document.getElementById('f-side').value = t.side;
      document.getElementById('f-setup').value = t.setup;
      document.getElementById('f-entry').value = t.entry;
      document.getElementById('f-exit').value = t.exit;
      document.getElementById('f-qty').value = t.qty;
      document.getElementById('f-stop').value = t.stop;
      document.getElementById('f-notes').value = t.notes;
      document.getElementById('f-emotion').value = t.emotion;
      setRating(t.rating);
    }
  } else {
    document.getElementById('f-symbol').value = '';
    document.getElementById('f-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('f-side').value = 'long';
    document.getElementById('f-setup').value = 'breakout';
    document.getElementById('f-entry').value = '';
    document.getElementById('f-exit').value = '';
    document.getElementById('f-qty').value = '';
    document.getElementById('f-stop').value = '';
    document.getElementById('f-notes').value = '';
    document.getElementById('f-emotion').value = 'focused';
    setRating(3);
  }
  tradeModal.classList.add('active');
}

function closeModal() {
  tradeModal.classList.remove('active');
  editingId = null;
}

function saveTrade() {
  const symbol = document.getElementById('f-symbol').value.trim().toUpperCase();
  const date = document.getElementById('f-date').value;
  const side = document.getElementById('f-side').value;
  const setup = document.getElementById('f-setup').value;
  const entry = parseFloat(document.getElementById('f-entry').value);
  const exit = parseFloat(document.getElementById('f-exit').value);
  const qty = parseInt(document.getElementById('f-qty').value) || 100;
  const stop = parseFloat(document.getElementById('f-stop').value) || (side === 'long' ? entry - 2 : entry + 2);
  const notes = document.getElementById('f-notes').value;
  const emotion = document.getElementById('f-emotion').value;
  const rating = parseInt(document.getElementById('f-rating').value);

  if (!symbol || !date || isNaN(entry) || isNaN(exit)) {
    alert('Please fill in required fields: Symbol, Date, Entry Price, Exit Price.');
    return;
  }

  const pnl = side === 'long' ? (exit - entry) * qty : (entry - exit) * qty;
  const riskPerShare = Math.abs(entry - stop);
  const r = riskPerShare > 0 ? parseFloat((pnl / (riskPerShare * qty)).toFixed(2)) : 0;

  if (editingId) {
    const idx = trades.findIndex(t => t.id === editingId);
    if (idx !== -1) trades[idx] = { ...trades[idx], symbol, date, side, setup, entry, exit, qty, stop, pnl: parseFloat(pnl.toFixed(2)), r, notes, emotion, rating };
  } else {
    trades.push({ id: nextId++, symbol, date, side, setup, entry, exit, qty, stop, pnl: parseFloat(pnl.toFixed(2)), r, notes, emotion, rating });
  }
  trades.sort((a, b) => b.date.localeCompare(a.date));
  closeModal();
  renderJournal();
  renderRecentTrades();
  updateDashboardStats();
  renderDashboardCharts();
}

function deleteTrade(id) {
  if (!confirm('Delete this trade?')) return;
  trades = trades.filter(t => t.id !== id);
  renderJournal();
  renderRecentTrades();
  updateDashboardStats();
  renderDashboardCharts();
}

// STAR RATING
function initStars() {
  const stars = document.querySelectorAll('.star');
  stars.forEach(star => {
    star.addEventListener('click', () => setRating(parseInt(star.dataset.val)));
    star.addEventListener('mouseover', () => highlightStars(parseInt(star.dataset.val)));
    star.addEventListener('mouseout', () => setRating(selectedRating));
  });
}
function setRating(val) {
  selectedRating = val;
  document.getElementById('f-rating').value = val;
  highlightStars(val);
}
function highlightStars(val) {
  document.querySelectorAll('.star').forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.val) <= val);
  });
}

// RENDER RECENT TRADES
function renderRecentTrades() {
  const container = document.getElementById('recentTrades');
  const recent = trades.slice(0, 5);
  container.innerHTML = recent.map(t => `
    <div class="trade-row">
      <div>
        <div class="trade-symbol">${t.symbol}</div>
        <div class="trade-setup">${t.setup} · ${t.side}</div>
      </div>
      <div class="trade-pnl ${t.pnl >= 0 ? 'pos' : 'neg'}">${t.pnl >= 0 ? '+' : ''}$${Math.abs(t.pnl).toFixed(2)}</div>
    </div>`).join('');
}

// AI SUMMARY
function renderAISummary() {
  const wins = trades.filter(t => t.pnl > 0).length;
  const total = trades.length;
  const pnl = trades.reduce((s, t) => s + t.pnl, 0);
  document.getElementById('aiSummary').innerHTML = `
    <p>You have taken <strong>${total} trades</strong> with a <strong>${Math.round((wins/total)*100)}% win rate</strong> and <strong>$${pnl.toFixed(2)} net P&L</strong>.</p>
    <br/>
    <p>🏆 Your best setup is <strong>Breakout</strong> with 68% win rate. Your FOMO trades are hurting you — they average <strong>-1.5R</strong>. Consider a rule: no trades after 2 losses in a row.</p>
  `;
}

function updateDashboardStats() {
  const wins = trades.filter(t => t.pnl > 0).length;
  const total = trades.length;
  const pnl = trades.reduce((s, t) => s + t.pnl, 0);
  document.getElementById('stat-pnl').textContent = (pnl >= 0 ? '+' : '') + '$' + Math.abs(pnl).toFixed(2);
  document.getElementById('stat-winrate').textContent = total ? Math.round((wins/total)*100) + '%' : '0%';
  renderAISummary();
}

// JOURNAL
function renderJournal() {
  const search = document.getElementById('searchTrades').value.toLowerCase();
  const result = document.getElementById('filterResult').value;
  const setup = document.getElementById('filterSetup').value;
  let filtered = trades.filter(t => {
    if (search && !t.symbol.toLowerCase().includes(search)) return false;
    if (result === 'win' && t.pnl <= 0) return false;
    if (result === 'loss' && t.pnl >= 0) return false;
    if (setup !== 'all' && t.setup !== setup) return false;
    return true;
  });
  const tbody = document.getElementById('tradeBody');
  tbody.innerHTML = filtered.map(t => `
    <tr>
      <td>${t.date}</td>
      <td><strong>${t.symbol}</strong></td>
      <td><span class="tag ${t.side}">${t.side.toUpperCase()}</span></td>
      <td><span class="tag ${t.setup}">${t.setup}</span></td>
      <td>$${t.entry.toFixed(2)}</td>
      <td>$${t.exit.toFixed(2)}</td>
      <td class="${t.pnl >= 0 ? 'pos' : 'neg'}" style="font-weight:700;color:${t.pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${t.pnl >= 0 ? '+' : ''}$${Math.abs(t.pnl).toFixed(2)}</td>
      <td style="color:${t.r >= 0 ? 'var(--green)' : 'var(--red)'}">${t.r >= 0 ? '+' : ''}${t.r}R</td>
      <td>${'★'.repeat(t.rating)}${'☆'.repeat(5-t.rating)}</td>
      <td>
        <button class="icon-btn" onclick="openAddTradeModal(${t.id})" title="Edit"><i class="fa fa-edit"></i></button>
        <button class="icon-btn del" onclick="deleteTrade(${t.id})" title="Delete"><i class="fa fa-trash"></i></button>
      </td>
    </tr>`).join('');
}

// PLAYBOOK
function renderPlaybook() {
  const grid = document.getElementById('playbookGrid');
  grid.innerHTML = SAMPLE_PLAYBOOKS.map(p => `
    <div class="playbook-card">
      <div class="pb-name"><span class="tag ${p.setup}">${p.setup}</span> &nbsp;${p.name}</div>
      <div class="pb-stats">
        <div class="pb-stat">Win Rate: <span>${p.winRate}%</span></div>
        <div class="pb-stat">Trades: <span>${p.trades}</span></div>
        <div class="pb-stat">P&L: <span style="color:var(--green)">+$${p.pnl.toLocaleString()}</span></div>
      </div>
      <div class="pb-stat" style="margin-bottom:8px">Avg: <span>${p.rr}</span></div>
      <div class="pb-desc">${p.desc}</div>
    </div>`).join('');
}

// AI INSIGHTS
function renderAIInsights() {
  const container = document.getElementById('aiInsightsCards');
  container.innerHTML = AI_INSIGHTS.map(i => `
    <div class="insight-card">
      <div class="insight-title">${i.title}</div>
      <div class="insight-text">${i.text}</div>
    </div>`).join('');
  const chatMessages = document.getElementById('chatMessages');
  chatMessages.innerHTML = `<div class="chat-msg ai">Hi! I'm Zella AI. Ask me anything about your trades — patterns, setups, risk, or performance.</div>`;
}

function sendAIMessage() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  const chatMessages = document.getElementById('chatMessages');
  chatMessages.innerHTML += `<div class="chat-msg user">${msg}</div>`;
  input.value = '';
  setTimeout(() => {
    const response = AI_RESPONSES[Math.floor(Math.random() * AI_RESPONSES.length)];
    chatMessages.innerHTML += `<div class="chat-msg ai">${response}</div>`;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }, 700);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// SPACES
function renderSpaces() {
  const grid = document.getElementById('spacesGrid');
  grid.innerHTML = SAMPLE_SPACES.map(s => `
    <div class="space-card">
      <div class="space-avatar">${s.emoji}</div>
      <div class="space-name">${s.name}</div>
      <div class="space-members"><i class="fa fa-users"></i> ${s.members} members</div>
      <div class="space-desc">${s.desc}</div>
    </div>`).join('');
}

// BACKTEST
function runBacktest() {
  const name = document.getElementById('bt-name').value || 'My Strategy';
  const risk = parseFloat(document.getElementById('bt-risk').value) || 100;
  const results = document.getElementById('backtestResults');
  results.style.display = 'block';
  const wr = Math.floor(Math.random() * 25 + 50);
  const pf = (Math.random() * 1.5 + 1.2).toFixed(2);
  const totalTrades = Math.floor(Math.random() * 50 + 30);
  const netPnl = (totalTrades * wr / 100 * risk * 2.1 - totalTrades * (1 - wr/100) * risk).toFixed(0);
  document.getElementById('btStatsGrid').innerHTML = `
    <div class="stat-card blue"><div class="stat-label">Win Rate</div><div class="stat-value">${wr}%</div></div>
    <div class="stat-card green"><div class="stat-label">Net P&L</div><div class="stat-value">+$${parseInt(netPnl).toLocaleString()}</div></div>
    <div class="stat-card purple"><div class="stat-label">Profit Factor</div><div class="stat-value">${pf}</div></div>
    <div class="stat-card orange"><div class="stat-label">Total Trades</div><div class="stat-value">${totalTrades}</div></div>`;
  renderBacktestChart(totalTrades, risk, wr);
}

// CHARTS
function getChartDefaults() {
  return { color: 'rgba(108,99,255,0.85)', grid: 'rgba(255,255,255,0.06)', text: '#94a3b8' };
}

function renderDashboardCharts() {
  const sortedTrades = [...trades].sort((a, b) => a.date.localeCompare(b.date));
  let cum = 0;
  const labels = sortedTrades.map(t => t.date.slice(5));
  const data = sortedTrades.map(t => { cum += t.pnl; return parseFloat(cum.toFixed(2)); });
  const c = getChartDefaults();

  if (pnlChartInstance) pnlChartInstance.destroy();
  pnlChartInstance = new Chart(document.getElementById('pnlChart'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Cum P&L', data, borderColor: '#6c63ff', backgroundColor: 'rgba(108,99,255,0.15)', fill: true, tension: 0.3, pointRadius: 3 }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: c.text, maxTicksLimit: 8 }, grid: { color: c.grid } }, y: { ticks: { color: c.text }, grid: { color: c.grid } } }, responsive: true }
  });

  const days = ['Mon','Tue','Wed','Thu','Fri'];
  const dayPnl = days.map((d, i) => trades.filter((t, j) => j % 5 === i).reduce((s, t) => s + t.pnl, 0));
  if (dayChartInstance) dayChartInstance.destroy();
  dayChartInstance = new Chart(document.getElementById('dayChart'), {
    type: 'bar',
    data: { labels: days, datasets: [{ label: 'P&L by Day', data: dayPnl, backgroundColor: dayPnl.map(v => v >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)') }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: c.text }, grid: { color: c.grid } }, y: { ticks: { color: c.text }, grid: { color: c.grid } } }, responsive: true }
  });
}

function renderAnalyticsCharts() {
  const c = getChartDefaults();
  const setups = ['breakout','reversal','momentum','scalp'];
  const setupPnl = setups.map(s => trades.filter(t => t.setup === s).reduce((sum, t) => sum + t.pnl, 0));

  if (setupChartInstance) setupChartInstance.destroy();
  setupChartInstance = new Chart(document.getElementById('setupChart'), {
    type: 'bar',
    data: { labels: setups, datasets: [{ data: setupPnl, backgroundColor: ['rgba(59,130,246,0.7)','rgba(108,99,255,0.7)','rgba(245,158,11,0.7)','rgba(0,212,170,0.7)'] }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: c.text }, grid: { color: c.grid } }, y: { ticks: { color: c.text }, grid: { color: c.grid } } }, responsive: true }
  });

  const hours = ['9:30','10:00','10:30','11:00','12:00','13:00','14:00','15:00'];
  const timePnl = [420, 680, 290, -80, 110, -200, 150, 340];
  if (timeChartInstance) timeChartInstance.destroy();
  timeChartInstance = new Chart(document.getElementById('timeChart'), {
    type: 'line',
    data: { labels: hours, datasets: [{ label: 'Avg P&L', data: timePnl, borderColor: '#00d4aa', backgroundColor: 'rgba(0,212,170,0.12)', fill: true, tension: 0.3 }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: c.text }, grid: { color: c.grid } }, y: { ticks: { color: c.text }, grid: { color: c.grid } } }, responsive: true }
  });

  const mfeData = trades.map(t => ({ x: Math.abs(t.pnl) * 0.4 + Math.random()*50, y: t.pnl }));
  if (mfeChartInstance) mfeChartInstance.destroy();
  mfeChartInstance = new Chart(document.getElementById('mfeChart'), {
    type: 'scatter',
    data: { datasets: [{ label: 'MFE vs P&L', data: mfeData, backgroundColor: trades.map(t => t.pnl >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)'), pointRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: 'MFE ($)', color: c.text }, ticks: { color: c.text }, grid: { color: c.grid } }, y: { title: { display: true, text: 'P&L ($)', color: c.text }, ticks: { color: c.text }, grid: { color: c.grid } } }, responsive: true }
  });

  const weekDays = ['Mon','Tue','Wed','Thu','Fri'];
  const weekWR = [72, 58, 65, 45, 80];
  if (weekChartInstance) weekChartInstance.destroy();
  weekChartInstance = new Chart(document.getElementById('weekChart'), {
    type: 'bar',
    data: { labels: weekDays, datasets: [{ data: weekWR, backgroundColor: weekWR.map(v => v >= 60 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)') }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: c.text }, grid: { color: c.grid } }, y: { ticks: { color: c.text }, grid: { color: c.grid } }, max: 100 }, responsive: true }
  });
}

function renderBacktestChart(totalTrades, risk, wr) {
  const labels = Array.from({ length: totalTrades }, (_, i) => `T${i+1}`);
  let cum = 0;
  const data = labels.map(() => {
    const win = Math.random() < wr / 100;
    cum += win ? risk * 2.1 : -risk;
    return parseFloat(cum.toFixed(2));
  });
  if (btChartInstance) btChartInstance.destroy();
  const c = getChartDefaults();
  btChartInstance = new Chart(document.getElementById('btChart'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Backtest Equity Curve', data, borderColor: '#6c63ff', backgroundColor: 'rgba(108,99,255,0.15)', fill: true, tension: 0.3, pointRadius: 0 }] },
    options: { plugins: { legend: { labels: { color: c.text } } }, scales: { x: { ticks: { color: c.text, maxTicksLimit: 10 }, grid: { color: c.grid } }, y: { ticks: { color: c.text }, grid: { color: c.grid } } }, responsive: true }
  });
}
