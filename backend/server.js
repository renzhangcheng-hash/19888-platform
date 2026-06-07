/**
 * 19888 API Server — Express.js (Hardened)
 * Full CRUD: matches, teams, odds, bets, users, wallet auth
 * Storage: JSON files (zero-dependency persistence)
 *
 * Security hardening: helmet, CORS, rate limiting, input validation,
 * structured error handling, request logging.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3088;
const DATA_DIR = path.join(__dirname, 'data');

// ═══════════════════════════════════════════════════
//  MIDDLEWARE STACK
// ═══════════════════════════════════════════════════

// ── Request Logger (timestamped) ──────────────────
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${timestamp}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// ── Security Headers (Helmet) ────────────────────
app.use(helmet({
  contentSecurityPolicy: false,      // allow inline scripts/styles
  crossOriginEmbedderPolicy: false,  // not needed for this app
}));

// ── CORS — allow only localhost:3088 & *.netlify.app ──
const ALLOWED_ORIGINS = [
  'http://localhost:3088',
  'http://127.0.0.1:3088',
];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. Postman, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    if (origin.endsWith('.netlify.app')) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Rate Limiting ─────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 100,                    // 100 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 2, msg: '请求过于频繁，请15分钟后再试' },
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,                      // 5 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 2, msg: '管理接口请求过于频繁，请15分钟后再试' },
});

app.use(generalLimiter);
// Admin routes get stricter limit (must come BEFORE admin route definitions
// but AFTER general limiter — order matters: /api/admin/* matches after general)
app.use('/api/admin', adminLimiter);

// ── Body Parsing ──────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Static Frontend ───────────────────────────────
app.use(express.static(path.join(__dirname, '..')));

// ── Ensure Data Directory ─────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════

// ── JSON File Helpers ─────────────────────────────
function read(name, def = []) {
  const f = path.join(DATA_DIR, name + '.json');
  if (!fs.existsSync(f)) return def;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; }
}
function write(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, name + '.json'), JSON.stringify(data, null, 2));
}

// ── Input Validation Helpers ──────────────────────
function isValidWallet(addr) {
  if (typeof addr !== 'string') return false;
  const a = addr.toLowerCase().trim();
  // Must be 42-char hex string (0x + 40 hex chars)
  return /^0x[0-9a-f]{40}$/.test(a);
}

function isValidAmount(val) {
  const n = Number(val);
  return Number.isFinite(n) && n > 0;
}

function isValidTeamId(val) {
  const n = Number(val);
  return Number.isInteger(n) && n >= 1 && n <= 32;
}

function isValidBetType(val) {
  const n = Number(val);
  return n === 1 || n === 2;
}

// ── Error-handling wrapper ────────────────────────
function asyncHandler(fn) {
  return (req, res, next) => {
    try {
      fn(req, res, next);
    } catch (err) {
      console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err.message);
      res.status(500).json({ code: 99, msg: '服务器内部错误', error: err.message });
    }
  };
}

// ── Auth Helpers ──────────────────────────────────
function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + '19888salt').digest('hex');
}

function verifyPassword(pw, hash) {
  return hashPassword(pw) === hash;
}

// ── Team Logo Helper ──────────────────────────────
function teamLogoUrl(name) {
  const slug = name.replace(/[^a-zA-Z\u4e00-\u9fff]/g, '_').toLowerCase();
  return `/img/teams/${slug}.svg`;
}

// ── 18-Grid Generator ─────────────────────────────
function generate18Grid() {
  const cells = ['0:0','0:1','0:2','0:3','1:0','1:1','1:2','1:3',
                 '2:0','2:1','2:2','2:3','3:0','3:1','3:2','3:3','主4+','客4+'];
  return cells.map(score => ({
    score,
    odds: +(1.5 + Math.random() * 8).toFixed(2),
  }));
}

// ── Seed Data ─────────────────────────────────────
function seed() {
  if (read('matches').length > 0) return;

  const now = new Date();
  const matches = [
    { id:1, league:'法甲', home:'巴黎圣日耳曼', away:'马赛', time: fmt(now,0,1,0), odds_home:1.82, odds_draw:3.50, odds_away:4.20, status:'live' },
    { id:2, league:'英超', home:'曼城', away:'利物浦', time: fmt(now,1,0,30), odds_home:2.10, odds_draw:3.30, odds_away:3.40, status:'upcoming' },
    { id:3, league:'西甲', home:'皇马', away:'巴萨', time: fmt(now,2,4,0), odds_home:2.40, odds_draw:3.20, odds_away:2.90, status:'upcoming' },
    { id:4, league:'意甲', home:'尤文图斯', away:'国米', time: fmt(now,2,2,45), odds_home:2.15, odds_draw:3.10, odds_away:3.50, status:'upcoming' },
    { id:5, league:'德甲', home:'拜仁慕尼黑', away:'多特蒙德', time: fmt(now,3,1,30), odds_home:1.95, odds_draw:3.60, odds_away:3.80, status:'upcoming' },
    { id:6, league:'友谊赛', home:'巴西', away:'阿根廷', time: fmt(now,4,8,0), odds_home:2.50, odds_draw:3.00, odds_away:2.80, status:'upcoming' },
    { id:7, league:'欧冠', home:'拜仁慕尼黑', away:'巴黎圣日耳曼', time: fmt(now,5,3,0), odds_home:2.20, odds_draw:3.40, odds_away:3.10, status:'upcoming' },
    { id:8, league:'英超', home:'阿森纳', away:'切尔西', time: fmt(now,5,0,30), odds_home:2.05, odds_draw:3.25, odds_away:3.60, status:'upcoming' },
  ];
  write('matches', matches);

  const teams = [
    { id:1, name:'巴西', championship_odds:5.50, runner_up_odds:4.20 },
    { id:2, name:'法国', championship_odds:6.00, runner_up_odds:4.50 },
    { id:3, name:'阿根廷', championship_odds:7.50, runner_up_odds:5.50 },
    { id:4, name:'英格兰', championship_odds:8.00, runner_up_odds:5.80 },
    { id:5, name:'西班牙', championship_odds:9.00, runner_up_odds:6.50 },
    { id:6, name:'德国', championship_odds:10.00, runner_up_odds:7.00 },
    { id:7, name:'葡萄牙', championship_odds:12.00, runner_up_odds:8.00 },
    { id:8, name:'荷兰', championship_odds:15.00, runner_up_odds:9.50 },
  ];
  write('champion_teams', teams);

  // Default admin account
  write('admins', [{ username: 'admin', password: hashPassword('19888admin') }]);

  console.log('Seed data created');
}

function fmt(date, addDays, hour, min) {
  const d = new Date(date);
  d.setDate(d.getDate() + addDays);
  d.setHours(hour, min, 0, 0);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

// ═══════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════

// Health check + serve index
app.get('/', asyncHandler((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
}));

app.get('/api/status', asyncHandler((req, res) => {
  res.json({ status:'ok', version:'1.0.0', name:'19888 API' });
}));

// ── Wallet Auth ───────────────────────────────────
app.post('/api/wallet/connect', asyncHandler((req, res) => {
  const { wallet_address } = req.body;

  // Validate input
  if (!wallet_address || !isValidWallet(wallet_address)) {
    return res.status(400).json({ code:1, msg:'无效的钱包地址（需要0x开头的42位十六进制地址）' });
  }

  const addr = wallet_address.toLowerCase().trim();
  const users = read('users');
  let user = users.find(u => u.address.toLowerCase() === addr);
  let type = 'login';

  if (!user) {
    user = { address: addr, balance: 0, created_at: new Date().toISOString(), last_login: new Date().toISOString() };
    users.push(user);
    type = 'register';
  } else {
    user.last_login = new Date().toISOString();
  }
  write('users', users);
  res.json({ code:0, msg: type === 'register' ? '注册成功' : '登录成功', data: { address: addr, type } });
}));

// ── Matches ───────────────────────────────────────
app.get('/api/matches', asyncHandler((req, res) => {
  const matches = read('matches').map(m => ({
    ...m,
    home_logo: teamLogoUrl(m.home),
    away_logo: teamLogoUrl(m.away),
  }));
  res.json({ code:0, data: matches });
}));

app.get('/api/matches/:id', asyncHandler((req, res) => {
  const matchId = parseInt(req.params.id, 10);
  if (isNaN(matchId)) {
    return res.status(400).json({ code:1, msg:'无效的比赛ID' });
  }
  const match = read('matches').find(m => m.id === matchId);
  if (!match) return res.status(404).json({ code:1, msg:'比赛不存在' });
  res.json({ code:0, data: {
    ...match,
    home_logo: teamLogoUrl(match.home),
    away_logo: teamLogoUrl(match.away),
    grid_18: generate18Grid(),
  }});
}));

// ── Champion Bet ──────────────────────────────────
app.get('/api/champion-bet/odds', asyncHandler((req, res) => {
  const teams = read('champion_teams').map(t => ({
    ...t,
    logo: teamLogoUrl(t.name),
  }));
  const bets = read('bets');
  const totalBet = bets.reduce((s, b) => s + (b.amount || 0), 0);
  const totalWin = bets.reduce((s, b) => s + (b.amount || 0) * (b.odds || 0), 0);
  res.json({ code:0, data: { odds: teams, total_bet: totalBet, total_potential_win: +totalWin.toFixed(2) } });
}));

app.post('/api/champion-bet/place', asyncHandler((req, res) => {
  const { team_id, bet_type, amount, wallet_address } = req.body;

  // ── Input Validation ──────────────────────────
  if (!wallet_address || !isValidWallet(wallet_address)) {
    return res.status(400).json({ code:1, msg:'无效的钱包地址（需要0x开头的42位十六进制地址）' });
  }
  if (!team_id || !isValidTeamId(team_id)) {
    return res.status(400).json({ code:1, msg:'球队ID无效（1-32）' });
  }
  if (!bet_type || !isValidBetType(bet_type)) {
    return res.status(400).json({ code:1, msg:'投注类型无效（1=冠军, 2=亚军）' });
  }
  if (!isValidAmount(amount)) {
    return res.status(400).json({ code:1, msg:'投注金额必须是正数' });
  }
  if (Number(amount) < 1) {
    return res.status(400).json({ code:1, msg:'最小投注 1 USDT' });
  }

  const tid = Number(team_id);
  const btype = Number(bet_type);
  const amt = Number(amount);
  const addr = wallet_address.toLowerCase().trim();

  const teams = read('champion_teams');
  const team = teams.find(t => t.id === tid);
  if (!team) return res.status(404).json({ code:1, msg:'球队不存在' });

  const odds = btype === 1 ? team.championship_odds : team.runner_up_odds;
  const bets = read('bets');
  const bet = {
    id: (bets[bets.length - 1]?.id || 0) + 1,
    address: addr,
    team_id: tid,
    team_name: team.name,
    bet_type: btype,
    bet_type_name: btype === 1 ? '冠军' : '亚军',
    amount: amt,
    odds,
    potential_win: +(amt * odds).toFixed(2),
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  bets.push(bet);
  write('bets', bets);

  res.json({ code:0, msg:'投注成功！', data: { bet_id: bet.id, potential_win: bet.potential_win } });
}));

// ── Bets History ──────────────────────────────────
app.get('/api/bets', asyncHandler((req, res) => {
  const addr = (req.query.address || '').toLowerCase().trim();
  if (!isValidWallet(addr)) {
    return res.status(400).json({ code:1, msg:'请提供有效的钱包地址（0x开头42位十六进制）' });
  }

  const bets = read('bets').filter(b => b.address.toLowerCase() === addr).reverse();
  res.json({ code:0, data: bets });
}));

// ── User Balance ──────────────────────────────────
app.get('/api/user/balance', asyncHandler((req, res) => {
  const addr = (req.query.address || '').toLowerCase().trim();
  if (!isValidWallet(addr)) {
    return res.status(400).json({ code:1, msg:'请提供有效的钱包地址（0x开头42位十六进制）' });
  }

  const users = read('users');
  const user = users.find(u => u.address.toLowerCase() === addr);
  res.json({ code:0, data: { address: addr, balance: user?.balance || 0 } });
}));

// ═══════════════════════════════════════════════════
//  ADMIN API (protected by simple token)
// ═══════════════════════════════════════════════════

const ADMIN_SECRET = '19888-admin-secret-token';

function adminAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token || '';
  if (token !== ADMIN_SECRET) {
    return res.status(401).json({ code:1, msg:'未授权' });
  }
  next();
}

// Admin login
app.post('/api/admin/login', asyncHandler((req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ code:1, msg:'请输入用户名和密码' });
  }

  const admins = read('admins');
  const admin = admins.find(a => a.username === username);
  if (!admin || !verifyPassword(password, admin.password)) {
    return res.status(401).json({ code:1, msg:'用户名或密码错误' });
  }
  res.json({ code:0, msg:'登录成功', data: { token: ADMIN_SECRET } });
}));

// ── Admin: Matches CRUD ───────────────────────────
app.get('/api/admin/matches', adminAuth, asyncHandler((req, res) => {
  res.json({ code:0, data: read('matches') });
}));

app.post('/api/admin/matches', adminAuth, asyncHandler((req, res) => {
  const { league, home, away, time, odds_home, odds_draw, odds_away, status } = req.body;

  // Validate required fields
  if (!home || typeof home !== 'string' || home.trim().length === 0) {
    return res.status(400).json({ code:1, msg:'请填写主队名称' });
  }
  if (!away || typeof away !== 'string' || away.trim().length === 0) {
    return res.status(400).json({ code:1, msg:'请填写客队名称' });
  }

  // Validate odds are positive numbers
  const oh = Number(odds_home);
  const od = Number(odds_draw);
  const oa = Number(odds_away);
  if (odds_home !== undefined && (!Number.isFinite(oh) || oh <= 0)) {
    return res.status(400).json({ code:1, msg:'主胜赔率必须是正数' });
  }
  if (odds_draw !== undefined && (!Number.isFinite(od) || od <= 0)) {
    return res.status(400).json({ code:1, msg:'平局赔率必须是正数' });
  }
  if (odds_away !== undefined && (!Number.isFinite(oa) || oa <= 0)) {
    return res.status(400).json({ code:1, msg:'客胜赔率必须是正数' });
  }

  const matches = read('matches');
  const newMatch = {
    id: (matches[matches.length - 1]?.id || 0) + 1,
    league: (league || '联赛').trim(),
    home: home.trim(),
    away: away.trim(),
    time: time || new Date().toISOString().slice(0, 16).replace('T', ' '),
    odds_home: oh || 1.80,
    odds_draw: od || 3.50,
    odds_away: oa || 4.00,
    status: status || 'upcoming',
  };
  matches.push(newMatch);
  write('matches', matches);
  res.json({ code:0, msg:'比赛已添加', data: newMatch });
}));

app.put('/api/admin/matches/:id', adminAuth, asyncHandler((req, res) => {
  const matchId = parseInt(req.params.id, 10);
  if (isNaN(matchId)) {
    return res.status(400).json({ code:1, msg:'无效的比赛ID' });
  }

  const matches = read('matches');
  const idx = matches.findIndex(m => m.id === matchId);
  if (idx === -1) return res.status(404).json({ code:1, msg:'比赛不存在' });

  // Validate odds if provided
  const { odds_home, odds_draw, odds_away } = req.body;
  if (odds_home !== undefined && (!Number.isFinite(Number(odds_home)) || Number(odds_home) <= 0)) {
    return res.status(400).json({ code:1, msg:'主胜赔率必须是正数' });
  }
  if (odds_draw !== undefined && (!Number.isFinite(Number(odds_draw)) || Number(odds_draw) <= 0)) {
    return res.status(400).json({ code:1, msg:'平局赔率必须是正数' });
  }
  if (odds_away !== undefined && (!Number.isFinite(Number(odds_away)) || Number(odds_away) <= 0)) {
    return res.status(400).json({ code:1, msg:'客胜赔率必须是正数' });
  }

  const m = matches[idx];
  ['league','home','away','time','odds_home','odds_draw','odds_away','status'].forEach(k => {
    if (req.body[k] !== undefined) m[k] = k.startsWith('odds_') ? Number(req.body[k]) : req.body[k];
  });
  write('matches', matches);
  res.json({ code:0, msg:'已更新', data: m });
}));

app.delete('/api/admin/matches/:id', adminAuth, asyncHandler((req, res) => {
  const matchId = parseInt(req.params.id, 10);
  if (isNaN(matchId)) {
    return res.status(400).json({ code:1, msg:'无效的比赛ID' });
  }

  let matches = read('matches');
  const before = matches.length;
  matches = matches.filter(m => m.id !== matchId);
  if (matches.length === before) return res.status(404).json({ code:1, msg:'比赛不存在' });
  write('matches', matches);
  res.json({ code:0, msg:'已删除' });
}));

// ── Admin: Champion Teams CRUD ────────────────────
app.get('/api/admin/teams', adminAuth, asyncHandler((req, res) => {
  res.json({ code:0, data: read('champion_teams') });
}));

app.put('/api/admin/teams/:id', adminAuth, asyncHandler((req, res) => {
  const teamId = parseInt(req.params.id, 10);
  if (isNaN(teamId)) {
    return res.status(400).json({ code:1, msg:'无效的球队ID' });
  }

  // Validate odds if provided
  const { championship_odds, runner_up_odds } = req.body;
  if (championship_odds !== undefined && (!Number.isFinite(Number(championship_odds)) || Number(championship_odds) <= 0)) {
    return res.status(400).json({ code:1, msg:'冠军赔率必须是正数' });
  }
  if (runner_up_odds !== undefined && (!Number.isFinite(Number(runner_up_odds)) || Number(runner_up_odds) <= 0)) {
    return res.status(400).json({ code:1, msg:'亚军赔率必须是正数' });
  }

  const teams = read('champion_teams');
  const idx = teams.findIndex(t => t.id === teamId);
  if (idx === -1) return res.status(404).json({ code:1, msg:'球队不存在' });

  const t = teams[idx];
  if (championship_odds !== undefined) t.championship_odds = Number(championship_odds);
  if (runner_up_odds !== undefined) t.runner_up_odds = Number(runner_up_odds);
  write('champion_teams', teams);
  res.json({ code:0, msg:'赔率已更新', data: t });
}));

// ── Admin: Bets ───────────────────────────────────
app.get('/api/admin/bets', adminAuth, asyncHandler((req, res) => {
  const bets = read('bets').reverse();
  res.json({ code:0, data: bets });
}));

app.put('/api/admin/bets/:id/settle', adminAuth, asyncHandler((req, res) => {
  const betId = parseInt(req.params.id, 10);
  if (isNaN(betId)) {
    return res.status(400).json({ code:1, msg:'无效的投注ID' });
  }

  const { result } = req.body;
  if (!result || !['win', 'lost'].includes(result)) {
    return res.status(400).json({ code:1, msg:'结算结果必须是 win 或 lost' });
  }

  const bets = read('bets');
  const bet = bets.find(b => b.id === betId);
  if (!bet) return res.status(404).json({ code:1, msg:'投注不存在' });

  if (bet.status !== 'pending') {
    return res.status(400).json({ code:1, msg:'该投注已结算' });
  }

  bet.status = result === 'win' ? 'won' : 'lost';
  if (bet.status === 'won') {
    // Credit winnings to user
    const users = read('users');
    const user = users.find(u => u.address.toLowerCase() === bet.address.toLowerCase());
    if (user) user.balance = (user.balance || 0) + bet.potential_win;
    write('users', users);
    bet.settled_at = new Date().toISOString();
  }
  write('bets', bets);
  res.json({ code:0, msg: bet.status === 'won' ? '已结算(赢)' : '已结算(输)', data: bet });
}));

// ── Admin: Stats ──────────────────────────────────
app.get('/api/admin/stats', adminAuth, asyncHandler((req, res) => {
  const matches = read('matches');
  const bets = read('bets');
  const users = read('users');
  const totalBets = bets.length;
  const totalVolume = bets.reduce((s, b) => s + (b.amount || 0), 0);
  const totalUsers = users.length;
  res.json({ code:0, data: { totalMatches: matches.length, totalBets, totalVolume: +totalVolume.toFixed(2), totalUsers } });
}));

// ═══════════════════════════════════════════════════
//  GLOBAL ERROR HANDLER (catch-all)
// ═══════════════════════════════════════════════════
app.use((err, req, res, _next) => {
  console.error(`[GLOBAL_ERROR] ${req.method} ${req.originalUrl}:`, err.message);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    code: 99,
    msg: err.message || '服务器内部错误',
  });
});

// ═══════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════
seed();

// Resilience: catch uncaught exceptions to prevent crash
process.on('uncaughtException', (err) => {
    console.error(`[${new Date().toISOString()}] UNCAUGHT: ${err.message}`);
    // Don't exit — keep serving
});
process.on('unhandledRejection', (reason) => {
    console.error(`[${new Date().toISOString()}] UNHANDLED REJECTION: ${reason}`);
});

app.listen(PORT, () => {
  console.log(`\n🔒 19888 API Server (Hardened) running on http://localhost:${PORT}`);
  console.log(`   Frontend:  http://localhost:${PORT}/`);
  console.log(`   Admin:     http://localhost:${PORT}/admin.html`);
  console.log(`   API:       http://localhost:${PORT}/api/status\n`);
});
