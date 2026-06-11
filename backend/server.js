/**
 * 19888 API Server — Express.js (lucky944-compatible)
 * Full CRUD: matches, teams, odds, bets, users, wallet auth, AI托管
 * Storage: JSON files (zero-dependency persistence)
 *
 * Endpoints match lucky944 API structure:
 *   GET  /api/user/balance     → {available, frozen_bet, frozen_ai}
 *   GET  /api/user/profile     → {nickname, avatar, address, ...}
 *   POST /api/user/profile     → update nickname/avatar
 *   GET  /api/ai-hosting/status → AI托管 status & settings
 *   POST /api/ai-hosting/activate
 *   POST /api/ai-hosting/deactivate
 *   GET  /api/ai-hosting/history
 *   GET  /api/bet-records      → paginated, filterable bet history
 *   GET  /api/teams             → all teams with stats
 *   GET  /api/teams/:id         → team detail
 *   GET  /api/teams/:id/stats   → team performance stats
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
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// ── CORS — allow localhost, *.netlify.app, and 19888.asia ──
const ALLOWED_ORIGINS = [
  'http://localhost:3088',
  'http://127.0.0.1:3088',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
const ALLOWED_ORIGIN_SUFFIXES = [
  '.netlify.app',
  '19888.asia',
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    if (ALLOWED_ORIGIN_SUFFIXES.some(s => origin.endsWith(s))) return callback(null, true);
    // Return 403 instead of crashing the middleware with 500
    callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Rate Limiting ─────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 2, msg: '请求过于频繁，请15分钟后再试' },
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 2, msg: '管理接口请求过于频繁，请15分钟后再试' },
});

app.use(generalLimiter);
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

function isValidPage(val) {
  const n = parseInt(val, 10);
  return Number.isInteger(n) && n >= 1;
}

function isValidPageSize(val) {
  const n = parseInt(val, 10);
  return Number.isInteger(n) && n >= 1 && n <= 100;
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

// ── Get user by address ──────────────────────────
function getUser(addr) {
  const users = read('users');
  return users.find(u => u.address.toLowerCase() === addr.toLowerCase());
}

// ── Get or create user ───────────────────────────
function getOrCreateUser(addr) {
  const users = read('users');
  let user = users.find(u => u.address.toLowerCase() === addr.toLowerCase());
  if (!user) {
    user = {
      address: addr.toLowerCase(),
      nickname: '用户' + addr.slice(2, 8).toUpperCase(),
      avatar: '',
      balance: 0,
      frozen_bet: 0,
      frozen_ai: 0,
      ai_hosting_active: false,
      ai_hosting_settings: {
        max_bet_per_match: 100,
        max_daily_bet: 500,
        risk_level: 'medium',       // low | medium | high
        auto_settle: true,
        preferred_matches: 'all',   // all | league_only | custom
      },
      ai_hosting_since: null,
      created_at: new Date().toISOString(),
      last_login: new Date().toISOString(),
    };
    users.push(user);
    write('users', users);
  }
  return user;
}

// ── Helper: compute user's balance breakdown ──────
function computeBalance(user) {
  const available = Math.max(0, (user.balance || 0) - (user.frozen_bet || 0) - (user.frozen_ai || 0));
  return {
    available: +available.toFixed(4),
    frozen_bet: +(user.frozen_bet || 0).toFixed(4),
    frozen_ai: +(user.frozen_ai || 0).toFixed(4),
    total: +(user.balance || 0).toFixed(4),
  };
}

// ── Team Logo Helper ──────────────────────────────
function teamLogoUrl(name) {
  const slug = name.replace(/[^a-zA-Z\u4e00-\u9fff]/g, '_').toLowerCase();
  return `/img/teams/${slug}.png`;
}

// ── 18-Grid Generator (probability-based) ─────────
// Real football score distribution probabilities
const SCORE_PROBS = {
  '0:0': 0.07, '0:1': 0.04, '0:2': 0.03, '0:3': 0.015,
  '1:0': 0.10, '1:1': 0.15, '1:2': 0.06, '1:3': 0.02,
  '2:0': 0.08, '2:1': 0.12, '2:2': 0.05, '2:3': 0.02,
  '3:0': 0.03, '3:1': 0.04, '3:2': 0.03, '3:3': 0.01,
  '主4+': 0.005, '客4+': 0.003,
};
const HOUSE_EDGE_ANTI = 0.15;

function generate18Grid() {
  const cells = ['0:0','0:1','0:2','0:3','1:0','1:1','1:2','1:3',
                 '2:0','2:1','2:2','2:3','3:0','3:1','3:2','3:3','主4+','客4+'];
  return cells.map(score => {
    const prob = SCORE_PROBS[score] || 0.01;
    const odds = +((1 / (1 - prob)) * (1 - HOUSE_EDGE_ANTI)).toFixed(2);
    return { score, odds: Math.max(1.01, odds) };
  });
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

  // Seed AI托管 pool
  write('ai_pool', { total_frozen: 0, active_users: 0 });

  console.log('Seed data created');
}

function fmt(date, addDays, hour, min) {
  const d = new Date(date);
  d.setDate(d.getDate() + addDays);
  d.setHours(hour, min, 0, 0);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

// ═══════════════════════════════════════════════════
//  PUBLIC API — Health & Status
// ═══════════════════════════════════════════════════

app.get('/', asyncHandler((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
}));

app.get('/api/status', asyncHandler((req, res) => {
  res.json({ status:'ok', version:'2.0.0', name:'19888 API (lucky944-compatible)' });
}));

// ═══════════════════════════════════════════════════
//  WALLET AUTH
// ═══════════════════════════════════════════════════

app.post('/api/wallet/connect', asyncHandler((req, res) => {
  const { wallet_address } = req.body;

  if (!wallet_address || !isValidWallet(wallet_address)) {
    return res.status(400).json({ code:1, msg:'无效的钱包地址（需要0x开头的42位十六进制地址）' });
  }

  const addr = wallet_address.toLowerCase().trim();
  const users = read('users');
  let user = users.find(u => u.address.toLowerCase() === addr);
  let type = 'login';

  if (!user) {
    user = {
      address: addr,
      nickname: '用户' + addr.slice(2, 8).toUpperCase(),
      avatar: '',
      balance: 0,
      frozen_bet: 0,
      frozen_ai: 0,
      ai_hosting_active: false,
      ai_hosting_settings: {
        max_bet_per_match: 100,
        max_daily_bet: 500,
        risk_level: 'medium',
        auto_settle: true,
        preferred_matches: 'all',
      },
      ai_hosting_since: null,
      created_at: new Date().toISOString(),
      last_login: new Date().toISOString(),
    };
    users.push(user);
    type = 'register';
  } else {
    user.last_login = new Date().toISOString();
  }
  write('users', users);
  res.json({
    code: 0,
    msg: type === 'register' ? '注册成功' : '登录成功',
    data: { address: addr, type }
  });
}));

// ═══════════════════════════════════════════════════
//  USER BALANCE (lucky944 format)
// ═══════════════════════════════════════════════════

// GET /api/user/balance?address=0x...
// Returns: {code, data: {available, frozen_bet, frozen_ai, total}}
app.get('/api/user/balance', asyncHandler((req, res) => {
  const addr = (req.query.address || '').toLowerCase().trim();
  if (!isValidWallet(addr)) {
    return res.status(400).json({ code:1, msg:'请提供有效的钱包地址（0x开头42位十六进制）' });
  }

  const user = getUser(addr);
  if (!user) {
    return res.json({ code:0, data: { available: 0, frozen_bet: 0, frozen_ai: 0, total: 0 } });
  }

  res.json({ code:0, data: computeBalance(user) });
}));

// ═══════════════════════════════════════════════════
//  USER PROFILE (lucky944 format)
// ═══════════════════════════════════════════════════

// GET /api/user/profile?address=0x...
app.get('/api/user/profile', asyncHandler((req, res) => {
  const addr = (req.query.address || '').toLowerCase().trim();
  if (!isValidWallet(addr)) {
    return res.status(400).json({ code:1, msg:'请提供有效的钱包地址（0x开头42位十六进制）' });
  }

  const user = getOrCreateUser(addr);
  const balance = computeBalance(user);

  res.json({
    code: 0,
    data: {
      address: user.address,
      nickname: user.nickname || '',
      avatar: user.avatar || '',
      balance: balance,
      ai_hosting_active: !!user.ai_hosting_active,
      ai_hosting_settings: user.ai_hosting_settings || null,
      created_at: user.created_at,
      last_login: user.last_login,
    }
  });
}));

// POST /api/user/profile — update nickname/avatar
app.post('/api/user/profile', asyncHandler((req, res) => {
  const { wallet_address, nickname, avatar } = req.body;

  if (!wallet_address || !isValidWallet(wallet_address)) {
    return res.status(400).json({ code:1, msg:'无效的钱包地址' });
  }

  const addr = wallet_address.toLowerCase().trim();
  const users = read('users');
  const user = users.find(u => u.address.toLowerCase() === addr);
  if (!user) {
    return res.status(404).json({ code:1, msg:'用户不存在，请先连接钱包' });
  }

  if (nickname !== undefined) {
    const n = String(nickname).trim();
    if (n.length < 1 || n.length > 30) {
      return res.status(400).json({ code:1, msg:'昵称长度必须在1-30个字符之间' });
    }
    // Prevent injection
    if (/[<>]/.test(n)) {
      return res.status(400).json({ code:1, msg:'昵称包含非法字符' });
    }
    user.nickname = n;
  }

  if (avatar !== undefined) {
    const av = String(avatar).trim();
    if (av.length > 500) {
      return res.status(400).json({ code:1, msg:'头像URL过长' });
    }
    user.avatar = av;
  }

  write('users', users);

  const balance = computeBalance(user);
  res.json({
    code: 0,
    msg: '资料更新成功',
    data: {
      address: user.address,
      nickname: user.nickname,
      avatar: user.avatar,
      balance: balance,
    }
  });
}));

// ═══════════════════════════════════════════════════
//  AI托管 (AI HOSTING) — lucky944 style
// ═══════════════════════════════════════════════════

// GET /api/ai-hosting/status?address=0x...
app.get('/api/ai-hosting/status', asyncHandler((req, res) => {
  const addr = (req.query.address || '').toLowerCase().trim();
  if (!isValidWallet(addr)) {
    return res.status(400).json({ code:1, msg:'请提供有效的钱包地址' });
  }

  const user = getUser(addr);
  if (!user) {
    return res.json({ code:0, data: { active: false, frozen_ai: 0 } });
  }

  // Get AI hosting history (bet records made by AI托管)
  const aiHistory = read('ai_bets').filter(b => b.address.toLowerCase() === addr).reverse();

  res.json({
    code: 0,
    data: {
      active: !!user.ai_hosting_active,
      frozen_ai: +(user.frozen_ai || 0).toFixed(4),
      settings: user.ai_hosting_settings || {
        max_bet_per_match: 100,
        max_daily_bet: 500,
        risk_level: 'medium',
        auto_settle: true,
        preferred_matches: 'all',
      },
      since: user.ai_hosting_since || null,
      stats: {
        total_bets: aiHistory.length,
        total_wagered: +aiHistory.reduce((s, b) => s + (b.amount || 0), 0).toFixed(4),
        total_won: +aiHistory.filter(b => b.status === 'won').reduce((s, b) => s + (b.potential_win || 0), 0).toFixed(4),
        total_lost: +aiHistory.filter(b => b.status === 'lost').reduce((s, b) => s + (b.amount || 0), 0).toFixed(4),
        win_rate: aiHistory.length > 0
          ? +((aiHistory.filter(b => b.status === 'won').length / aiHistory.length) * 100).toFixed(1)
          : 0,
      }
    }
  });
}));

// POST /api/ai-hosting/activate
app.post('/api/ai-hosting/activate', asyncHandler((req, res) => {
  const { wallet_address, freeze_amount, settings } = req.body;

  if (!wallet_address || !isValidWallet(wallet_address)) {
    return res.status(400).json({ code:1, msg:'无效的钱包地址' });
  }

  const addr = wallet_address.toLowerCase().trim();
  const users = read('users');
  const user = users.find(u => u.address.toLowerCase() === addr);
  if (!user) {
    return res.status(404).json({ code:1, msg:'用户不存在，请先连接钱包' });
  }

  if (user.ai_hosting_active) {
    return res.status(400).json({ code:1, msg:'AI托管已经激活，请先停用后再重新激活' });
  }

  const freezeAmt = freeze_amount !== undefined ? Number(freeze_amount) : 100;
  if (!Number.isFinite(freezeAmt) || freezeAmt < 10) {
    return res.status(400).json({ code:1, msg:'冻结金额最少为 10 USDT' });
  }

  const available = (user.balance || 0) - (user.frozen_bet || 0) - (user.frozen_ai || 0);
  if (freezeAmt > available) {
    return res.status(400).json({ code:1, msg:`余额不足，可用余额: ${available.toFixed(2)} USDT` });
  }

  user.ai_hosting_active = true;
  user.frozen_ai = (user.frozen_ai || 0) + freezeAmt;
  user.ai_hosting_since = new Date().toISOString();

  // Apply custom settings if provided
  if (settings && typeof settings === 'object') {
    user.ai_hosting_settings = {
      max_bet_per_match: settings.max_bet_per_match || 100,
      max_daily_bet: settings.max_daily_bet || 500,
      risk_level: ['low','medium','high'].includes(settings.risk_level) ? settings.risk_level : 'medium',
      auto_settle: settings.auto_settle !== false,
      preferred_matches: settings.preferred_matches || 'all',
    };
  }

  write('users', users);

  // Update AI pool stats
  const aiPool = read('ai_pool', { total_frozen: 0, active_users: 0 });
  aiPool.total_frozen = +((aiPool.total_frozen || 0) + freezeAmt).toFixed(4);
  const activeCount = users.filter(u => u.ai_hosting_active).length;
  aiPool.active_users = activeCount;
  write('ai_pool', aiPool);

  res.json({
    code: 0,
    msg: 'AI托管已激活',
    data: {
      frozen_ai: +(user.frozen_ai).toFixed(4),
      settings: user.ai_hosting_settings,
      since: user.ai_hosting_since,
    }
  });
}));

// POST /api/ai-hosting/deactivate
app.post('/api/ai-hosting/deactivate', asyncHandler((req, res) => {
  const { wallet_address } = req.body;

  if (!wallet_address || !isValidWallet(wallet_address)) {
    return res.status(400).json({ code:1, msg:'无效的钱包地址' });
  }

  const addr = wallet_address.toLowerCase().trim();
  const users = read('users');
  const user = users.find(u => u.address.toLowerCase() === addr);
  if (!user) {
    return res.status(404).json({ code:1, msg:'用户不存在' });
  }

  if (!user.ai_hosting_active) {
    return res.status(400).json({ code:1, msg:'AI托管未激活' });
  }

  // Unfreeze all AI funds back to available
  const unfrozen = user.frozen_ai || 0;

  user.ai_hosting_active = false;
  user.frozen_ai = 0;
  user.ai_hosting_since = null;

  write('users', users);

  // Update AI pool stats
  const aiPool = read('ai_pool', { total_frozen: 0, active_users: 0 });
  aiPool.total_frozen = Math.max(0, (aiPool.total_frozen || 0) - unfrozen);
  const activeCount = users.filter(u => u.ai_hosting_active).length;
  aiPool.active_users = activeCount;
  write('ai_pool', aiPool);

  // Log deactivation
  const aiLogs = read('ai_logs');
  aiLogs.push({
    address: addr,
    action: 'deactivate',
    unfrozen_amount: unfrozen,
    time: new Date().toISOString(),
  });
  write('ai_logs', aiLogs);

  res.json({
    code: 0,
    msg: 'AI托管已停用，资金已解冻',
    data: {
      unfrozen: +unfrozen.toFixed(4),
      balance: computeBalance(user),
    }
  });
}));

// GET /api/ai-hosting/history?address=0x...&page=1&page_size=20
app.get('/api/ai-hosting/history', asyncHandler((req, res) => {
  const addr = (req.query.address || '').toLowerCase().trim();
  if (!isValidWallet(addr)) {
    return res.status(400).json({ code:1, msg:'请提供有效的钱包地址' });
  }

  const page = isValidPage(req.query.page) ? parseInt(req.query.page, 10) : 1;
  const pageSize = isValidPageSize(req.query.page_size) ? parseInt(req.query.page_size, 10) : 20;
  const statusFilter = req.query.status || ''; // pending | won | lost

  let records = read('ai_bets').filter(b => b.address.toLowerCase() === addr).reverse();

  if (statusFilter && ['pending','won','lost'].includes(statusFilter)) {
    records = records.filter(b => b.status === statusFilter);
  }

  const total = records.length;
  const totalPages = Math.ceil(total / pageSize);
  const startIdx = (page - 1) * pageSize;
  const pageData = records.slice(startIdx, startIdx + pageSize);

  res.json({
    code: 0,
    data: {
      list: pageData,
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: totalPages,
      }
    }
  });
}));

// POST /api/ai-hosting/settings — update AI hosting settings
app.post('/api/ai-hosting/settings', asyncHandler((req, res) => {
  const { wallet_address, settings } = req.body;

  if (!wallet_address || !isValidWallet(wallet_address)) {
    return res.status(400).json({ code:1, msg:'无效的钱包地址' });
  }
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ code:1, msg:'请提供有效的设置参数' });
  }

  const addr = wallet_address.toLowerCase().trim();
  const users = read('users');
  const user = users.find(u => u.address.toLowerCase() === addr);
  if (!user) return res.status(404).json({ code:1, msg:'用户不存在' });

  user.ai_hosting_settings = {
    max_bet_per_match: settings.max_bet_per_match || user.ai_hosting_settings?.max_bet_per_match || 100,
    max_daily_bet: settings.max_daily_bet || user.ai_hosting_settings?.max_daily_bet || 500,
    risk_level: ['low','medium','high'].includes(settings.risk_level) ? settings.risk_level : (user.ai_hosting_settings?.risk_level || 'medium'),
    auto_settle: settings.auto_settle !== undefined ? settings.auto_settle : (user.ai_hosting_settings?.auto_settle !== false),
    preferred_matches: settings.preferred_matches || user.ai_hosting_settings?.preferred_matches || 'all',
  };

  write('users', users);
  res.json({ code:0, msg:'AI托管设置已更新', data: { settings: user.ai_hosting_settings } });
}));

// ═══════════════════════════════════════════════════
//  BET RECORDS (lucky944 format — paginated)
// ═══════════════════════════════════════════════════

// GET /api/bet-records?address=0x...&page=1&page_size=20&status=pending&type=champion&from=...&to=...
app.get('/api/bet-records', asyncHandler((req, res) => {
  const addr = (req.query.address || '').toLowerCase().trim();
  if (!isValidWallet(addr)) {
    return res.status(400).json({ code:1, msg:'请提供有效的钱包地址（0x开头42位十六进制）' });
  }

  const page = isValidPage(req.query.page) ? parseInt(req.query.page, 10) : 1;
  const pageSize = isValidPageSize(req.query.page_size) ? parseInt(req.query.page_size, 10) : 20;
  const statusFilter = req.query.status || '';
  const typeFilter = req.query.type || '';    // champion | anti-score | score
  const fromDate = req.query.from || '';
  const toDate = req.query.to || '';

  let records = read('bets').filter(b => b.address.toLowerCase() === addr).reverse();

  // Apply filters
  if (statusFilter && ['pending','won','lost'].includes(statusFilter)) {
    records = records.filter(b => b.status === statusFilter);
  }

  if (typeFilter) {
    const typeMap = {
      'champion': 'champion',
      'anti-score': 'anti-score',
      'score': 'score',
    };
    const mapped = typeMap[typeFilter];
    if (mapped) {
      if (mapped === 'champion') {
        records = records.filter(b => !b.game_type || b.game_type === 'champion');
      } else {
        records = records.filter(b => b.game_type === mapped);
      }
    }
  }

  if (fromDate) {
    records = records.filter(b => new Date(b.created_at) >= new Date(fromDate));
  }
  if (toDate) {
    records = records.filter(b => new Date(b.created_at) <= new Date(toDate));
  }

  const total = records.length;
  const totalPages = Math.ceil(total / pageSize);
  const startIdx = (page - 1) * pageSize;
  const pageData = records.slice(startIdx, startIdx + pageSize);

  // Compute summary stats
  const stats = {
    total_bets: records.length,
    total_wagered: +records.reduce((s, b) => s + (b.amount || 0), 0).toFixed(4),
    total_won: +records.filter(b => b.status === 'won').reduce((s, b) => s + (b.potential_win || 0), 0).toFixed(4),
    total_lost: +records.filter(b => b.status === 'lost').reduce((s, b) => s + (b.amount || 0), 0).toFixed(4),
    pending_count: records.filter(b => b.status === 'pending').length,
    win_rate: records.filter(b => b.status !== 'pending').length > 0
      ? +((records.filter(b => b.status === 'won').length / records.filter(b => b.status !== 'pending').length) * 100).toFixed(1)
      : 0,
  };

  res.json({
    code: 0,
    data: {
      list: pageData,
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: totalPages,
      },
      stats,
    }
  });
}));

// ═══════════════════════════════════════════════════
//  TEAMS (lucky944 format)
// ═══════════════════════════════════════════════════

// GET /api/teams — all teams with stats
app.get('/api/teams', asyncHandler((req, res) => {
  const teams = read('champion_teams').map(t => {
    // Compute team stats from bets
    const allBets = read('bets');
    const teamBets = allBets.filter(b => b.team_id === t.id);
    const totalBets = teamBets.length;
    const totalVolume = teamBets.reduce((s, b) => s + (b.amount || 0), 0);
    const wonBets = teamBets.filter(b => b.status === 'won').length;

    return {
      ...t,
      logo: teamLogoUrl(t.name),
      stats: {
        total_bets: totalBets,
        total_volume: +totalVolume.toFixed(2),
        won_bets: wonBets,
        win_rate: totalBets > 0 ? +((wonBets / totalBets) * 100).toFixed(1) : 0,
      }
    };
  });

  res.json({ code: 0, data: teams });
}));

// GET /api/teams/:id — team detail
app.get('/api/teams/:id', asyncHandler((req, res) => {
  const teamId = parseInt(req.params.id, 10);
  if (isNaN(teamId)) {
    return res.status(400).json({ code:1, msg:'无效的球队ID' });
  }

  const teams = read('champion_teams');
  const team = teams.find(t => t.id === teamId);
  if (!team) return res.status(404).json({ code:1, msg:'球队不存在' });

  // Get matches involving this team
  const matches = read('matches').filter(m =>
    m.home === team.name || m.away === team.name
  );

  // Get recent bets on this team
  const allBets = read('bets');
  const teamBets = allBets.filter(b => b.team_id === teamId).reverse().slice(0, 20);
  const totalBets = allBets.filter(b => b.team_id === teamId).length;
  const totalVolume = allBets.filter(b => b.team_id === teamId).reduce((s, b) => s + (b.amount || 0), 0);

  res.json({
    code: 0,
    data: {
      ...team,
      logo: teamLogoUrl(team.name),
      matches: matches.slice(0, 10),
      recent_bets: teamBets,
      stats: {
        total_bets: totalBets,
        total_volume: +totalVolume.toFixed(2),
        upcoming_matches: matches.filter(m => m.status === 'upcoming').length,
        live_matches: matches.filter(m => m.status === 'live').length,
        finished_matches: matches.filter(m => m.status === 'finished').length,
      }
    }
  });
}));

// GET /api/teams/:id/stats — team performance stats
app.get('/api/teams/:id/stats', asyncHandler((req, res) => {
  const teamId = parseInt(req.params.id, 10);
  if (isNaN(teamId)) {
    return res.status(400).json({ code:1, msg:'无效的球队ID' });
  }

  const teams = read('champion_teams');
  const team = teams.find(t => t.id === teamId);
  if (!team) return res.status(404).json({ code:1, msg:'球队不存在' });

  // Compute performance stats
  const allBets = read('bets').filter(b => b.team_id === teamId);
  const totalBets = allBets.length;
  const totalVolume = allBets.reduce((s, b) => s + (b.amount || 0), 0);
  const won = allBets.filter(b => b.status === 'won');
  const lost = allBets.filter(b => b.status === 'lost');
  const pending = allBets.filter(b => b.status === 'pending');

  // Champion vs Runner-up breakdown
  const championBets = allBets.filter(b => b.bet_type === 1);
  const runnerUpBets = allBets.filter(b => b.bet_type === 2);

  res.json({
    code: 0,
    data: {
      team_id: team.id,
      team_name: team.name,
      championship_odds: team.championship_odds,
      runner_up_odds: team.runner_up_odds,
      betting_stats: {
        total_bets: totalBets,
        total_volume: +totalVolume.toFixed(2),
        won_count: won.length,
        lost_count: lost.length,
        pending_count: pending.length,
        total_won_amount: +won.reduce((s, b) => s + (b.potential_win || 0), 0).toFixed(2),
        total_lost_amount: +lost.reduce((s, b) => s + (b.amount || 0), 0).toFixed(2),
        champion_bets: championBets.length,
        champion_volume: +championBets.reduce((s, b) => s + (b.amount || 0), 0).toFixed(2),
        runner_up_bets: runnerUpBets.length,
        runner_up_volume: +runnerUpBets.reduce((s, b) => s + (b.amount || 0), 0).toFixed(2),
      }
    }
  });
}));

// ═══════════════════════════════════════════════════
//  MATCHES (existing — backward compat)
// ═══════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════
//  CHAMPION BET (existing — backward compat)
// ═══════════════════════════════════════════════════

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

  // Check user balance
  const users = read('users');
  const user = users.find(u => u.address.toLowerCase() === addr);
  if (!user) return res.status(404).json({ code:1, msg:'用户不存在，请先连接钱包' });
  const balance = computeBalance(user);
  if (amt > balance.available) {
    return res.status(400).json({ code:1, msg:`余额不足，可用: ${balance.available.toFixed(2)} USDT` });
  }

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

  // Deduct from available balance (freeze for bet)
  user.balance = (user.balance || 0) - amt;
  user.frozen_bet = (user.frozen_bet || 0) + amt;
  write('users', users);

  res.json({ code:0, msg:'投注成功！', data: { bet_id: bet.id, potential_win: bet.potential_win } });
}));

// ═══════════════════════════════════════════════════
//  ANTI-SCORE BETS (existing — backward compat)
// ═══════════════════════════════════════════════════

app.post('/api/anti-bet/place', asyncHandler((req, res) => {
  const { match_id, cell_score, amount, wallet_address } = req.body;

  if (!wallet_address || !isValidWallet(wallet_address)) {
    return res.status(400).json({ code:1, msg:'无效的钱包地址（需要0x开头的42位十六进制地址）' });
  }
  if (!match_id || !Number.isInteger(Number(match_id)) || Number(match_id) < 1) {
    return res.status(400).json({ code:1, msg:'无效的比赛ID' });
  }
  if (!cell_score || typeof cell_score !== 'string' || cell_score.trim().length === 0) {
    return res.status(400).json({ code:1, msg:'请选择反波膽比分格' });
  }
  if (!isValidAmount(amount)) {
    return res.status(400).json({ code:1, msg:'投注金额必须是正数' });
  }
  if (Number(amount) < 1) {
    return res.status(400).json({ code:1, msg:'最小投注 1 USDT' });
  }

  const mid = Number(match_id);
  const amt = Number(amount);
  const addr = wallet_address.toLowerCase().trim();
  const cell = cell_score.trim();

  const matches = read('matches');
  const match = matches.find(m => m.id === mid);
  if (!match) return res.status(404).json({ code:1, msg:'比赛不存在' });

  // Check user balance
  const users = read('users');
  const user = users.find(u => u.address.toLowerCase() === addr);
  if (!user) return res.status(404).json({ code:1, msg:'用户不存在，请先连接钱包' });
  const balance = computeBalance(user);
  if (amt > balance.available) {
    return res.status(400).json({ code:1, msg:`余额不足，可用: ${balance.available.toFixed(2)} USDT` });
  }

  const grid = generate18Grid();
  const cellData = grid.find(c => c.score === cell);
  const odds = cellData ? cellData.odds : 1.85;

  const bets = read('bets');
  const bet = {
    id: (bets[bets.length - 1]?.id || 0) + 1,
    address: addr,
    match_id: mid,
    match_name: match.home + ' vs ' + match.away,
    game_type: 'anti-score',
    cell_score: cell,
    amount: amt,
    odds: +odds.toFixed(2),
    potential_win: +(amt * odds).toFixed(2),
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  bets.push(bet);
  write('bets', bets);

  // Deduct from available balance
  user.balance = (user.balance || 0) - amt;
  user.frozen_bet = (user.frozen_bet || 0) + amt;
  write('users', users);

  res.json({ code:0, msg:'反波膽投注成功！', data: { bet_id: bet.id, potential_win: bet.potential_win } });
}));

// ═══════════════════════════════════════════════════
//  SCORE BETS (existing — backward compat)
// ═══════════════════════════════════════════════════

app.post('/api/score-bet/place', asyncHandler((req, res) => {
  const { match_id, cell_score, amount, wallet_address } = req.body;

  if (!wallet_address || !isValidWallet(wallet_address)) {
    return res.status(400).json({ code:1, msg:'无效的钱包地址（需要0x开头的42位十六进制地址）' });
  }
  if (!match_id || !Number.isInteger(Number(match_id)) || Number(match_id) < 1) {
    return res.status(400).json({ code:1, msg:'无效的比赛ID' });
  }
  if (!cell_score || typeof cell_score !== 'string' || cell_score.trim().length === 0) {
    return res.status(400).json({ code:1, msg:'请选择正波膽比分格' });
  }
  if (!isValidAmount(amount)) {
    return res.status(400).json({ code:1, msg:'投注金额必须是正数' });
  }
  if (Number(amount) < 1) {
    return res.status(400).json({ code:1, msg:'最小投注 1 USDT' });
  }

  const mid = Number(match_id);
  const amt = Number(amount);
  const addr = wallet_address.toLowerCase().trim();
  const cell = cell_score.trim();

  const matches = read('matches');
  const match = matches.find(m => m.id === mid);
  if (!match) return res.status(404).json({ code:1, msg:'比赛不存在' });

  // Check user balance
  const users = read('users');
  const user = users.find(u => u.address.toLowerCase() === addr);
  if (!user) return res.status(404).json({ code:1, msg:'用户不存在，请先连接钱包' });
  const balance = computeBalance(user);
  if (amt > balance.available) {
    return res.status(400).json({ code:1, msg:`余额不足，可用: ${balance.available.toFixed(2)} USDT` });
  }

  const grid = generate18Grid();
  const cellData = grid.find(c => c.score === cell);
  const antiOdds = cellData ? cellData.odds : 1.85;
  const scoreOdds = +(Math.max(1.01, (1 / (1 - 1/antiOdds)) * 0.7)).toFixed(2);

  const bets = read('bets');
  const bet = {
    id: (bets[bets.length - 1]?.id || 0) + 1,
    address: addr,
    match_id: mid,
    match_name: match.home + ' vs ' + match.away,
    game_type: 'score',
    cell_score: cell,
    amount: amt,
    odds: scoreOdds,
    potential_win: +(amt * scoreOdds).toFixed(2),
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  bets.push(bet);
  write('bets', bets);

  // Deduct from available balance
  user.balance = (user.balance || 0) - amt;
  user.frozen_bet = (user.frozen_bet || 0) + amt;
  write('users', users);

  res.json({ code:0, msg:'正波膽投注成功！', data: { bet_id: bet.id, potential_win: bet.potential_win } });
}));

// ═══════════════════════════════════════════════════
//  BETS HISTORY (existing — backward compat)
// ═══════════════════════════════════════════════════

app.get('/api/bets', asyncHandler((req, res) => {
  const addr = (req.query.address || '').toLowerCase().trim();
  if (!isValidWallet(addr)) {
    return res.status(400).json({ code:1, msg:'请提供有效的钱包地址（0x开头42位十六进制）' });
  }

  const bets = read('bets').filter(b => b.address.toLowerCase() === addr).reverse();
  res.json({ code:0, data: bets });
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

  if (!home || typeof home !== 'string' || home.trim().length === 0) {
    return res.status(400).json({ code:1, msg:'请填写主队名称' });
  }
  if (!away || typeof away !== 'string' || away.trim().length === 0) {
    return res.status(400).json({ code:1, msg:'请填写客队名称' });
  }

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

  const users = read('users');
  const user = users.find(u => u.address.toLowerCase() === bet.address.toLowerCase());

  bet.status = result === 'win' ? 'won' : 'lost';
  if (bet.status === 'won') {
    if (user) {
      user.balance = (user.balance || 0) + bet.potential_win;
    }
    bet.settled_at = new Date().toISOString();
  }

  // Always unfreeze bet amount
  if (user) {
    user.frozen_bet = Math.max(0, (user.frozen_bet || 0) - (bet.amount || 0));
  }

  write('bets', bets);
  write('users', users);
  res.json({ code:0, msg: bet.status === 'won' ? '已结算(赢)' : '已结算(输)', data: bet });
}));

// ── Admin: Users ──────────────────────────────────
app.get('/api/admin/users', adminAuth, asyncHandler((req, res) => {
  const users = read('users').map(u => {
    const b = computeBalance(u);
    return { ...u, balance_detail: b };
  });
  res.json({ code:0, data: users });
}));

// ── Admin: AI Hosting Pool ────────────────────────
app.get('/api/admin/ai-pool', adminAuth, asyncHandler((req, res) => {
  const pool = read('ai_pool', { total_frozen: 0, active_users: 0 });
  const aiBets = read('ai_bets');
  const stats = {
    total_ai_bets: aiBets.length,
    total_ai_volume: +aiBets.reduce((s, b) => s + (b.amount || 0), 0).toFixed(4),
    total_ai_won: +aiBets.filter(b => b.status === 'won').reduce((s, b) => s + (b.potential_win || 0), 0).toFixed(4),
    total_ai_lost: +aiBets.filter(b => b.status === 'lost').reduce((s, b) => s + (b.amount || 0), 0).toFixed(4),
  };
  res.json({ code:0, data: { pool, stats, recent_bets: aiBets.slice(-50).reverse() } });
}));

// ── Admin: Stats ──────────────────────────────────
app.get('/api/admin/stats', adminAuth, asyncHandler((req, res) => {
  const matches = read('matches');
  const bets = read('bets');
  const users = read('users');
  const deposits = read('deposits');
  const aiPool = read('ai_pool', { total_frozen: 0, active_users: 0 });
  const totalBets = bets.length;
  const totalVolume = bets.reduce((s, b) => s + (b.amount || 0), 0);
  const totalUsers = users.length;
  const totalDeposits = deposits.reduce((s, d) => s + (d.amount || 0), 0);
  const totalDepositCount = deposits.length;
  // Pool balance: all user balances + frozen amounts
  const poolBalance = users.reduce((s, u) => s + (u.balance || 0) + (u.frozen_bet || 0) + (u.frozen_ai || 0), 0);
  res.json({
    code: 0,
    data: {
      totalMatches: matches.length,
      totalBets,
      totalVolume: +totalVolume.toFixed(2),
      totalUsers,
      totalDeposits: +totalDeposits.toFixed(2),
      totalDepositCount,
      poolBalance: +poolBalance.toFixed(2),
      ai_pool: aiPool,
    }
  });
}));

// ── Admin: Create Match (alias) ───────────────────
app.post('/api/admin/create-match', adminAuth, asyncHandler((req, res) => {
  const { home, away, league, time, odds_home, odds_draw, odds_away } = req.body;

  if (!home || typeof home !== 'string' || home.trim().length === 0) {
    return res.status(400).json({ code: 1, msg: '请填写主队名称' });
  }
  if (!away || typeof away !== 'string' || away.trim().length === 0) {
    return res.status(400).json({ code: 1, msg: '请填写客队名称' });
  }

  const oh = Number(odds_home);
  const od = Number(odds_draw);
  const oa = Number(odds_away);
  if (odds_home !== undefined && (!Number.isFinite(oh) || oh <= 0)) {
    return res.status(400).json({ code: 1, msg: '主胜赔率必须是正数' });
  }
  if (odds_draw !== undefined && (!Number.isFinite(od) || od <= 0)) {
    return res.status(400).json({ code: 1, msg: '平局赔率必须是正数' });
  }
  if (odds_away !== undefined && (!Number.isFinite(oa) || oa <= 0)) {
    return res.status(400).json({ code: 1, msg: '客胜赔率必须是正数' });
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
    status: 'upcoming',
  };
  matches.push(newMatch);
  write('matches', matches);
  res.json({ code: 0, msg: '比赛已创建', data: newMatch });
}));

// ── Admin: Settle Match ───────────────────────────
app.post('/api/admin/settle-match', adminAuth, asyncHandler((req, res) => {
  const { match_id, result } = req.body;

  if (!match_id || !Number.isInteger(Number(match_id)) || Number(match_id) < 1) {
    return res.status(400).json({ code: 1, msg: '无效的比赛ID' });
  }
  if (!result || !['home', 'draw', 'away'].includes(result)) {
    return res.status(400).json({ code: 1, msg: '结算结果必须是 home, draw 或 away' });
  }

  const mid = Number(match_id);
  const matches = read('matches');
  const match = matches.find(m => m.id === mid);
  if (!match) return res.status(404).json({ code: 1, msg: '比赛不存在' });

  if (match.status === 'finished') {
    return res.status(400).json({ code: 1, msg: '该比赛已结算' });
  }

  // Mark match as finished with result
  match.status = 'finished';
  match.result = result;
  match.settled_at = new Date().toISOString();
  write('matches', matches);

  // Settle all pending bets on this match
  const bets = read('bets');
  const users = read('users');
  let settledCount = 0;
  let totalPayout = 0;

  for (const bet of bets) {
    if (bet.match_id !== mid || bet.status !== 'pending') continue;

    // Determine if bet won based on game type
    let won = false;
    if (bet.game_type === 'anti-score') {
      // Anti-score: bet wins if the score cell does NOT match the result
      const resultScore = getScoreForResult(result);
      won = bet.cell_score !== resultScore;
    } else if (bet.game_type === 'score') {
      // Score bet: bet wins if the score cell matches the result
      const resultScore = getScoreForResult(result);
      won = bet.cell_score === resultScore;
    } else {
      // Champion bets don't have match_id, skip
      continue;
    }

    bet.status = won ? 'won' : 'lost';
    bet.settled_at = new Date().toISOString();

    const user = users.find(u => u.address.toLowerCase() === bet.address.toLowerCase());
    if (won && user) {
      user.balance = (user.balance || 0) + bet.potential_win;
      totalPayout += bet.potential_win;
    }
    // Unfreeze bet amount
    if (user) {
      user.frozen_bet = Math.max(0, (user.frozen_bet || 0) - (bet.amount || 0));
    }
    settledCount++;
  }

  write('bets', bets);
  write('users', users);

  res.json({
    code: 0,
    msg: `比赛已结算，处理了 ${settledCount} 笔投注`,
    data: {
      match_id: mid,
      result,
      settled_bets: settledCount,
      total_payout: +totalPayout.toFixed(2),
    }
  });
}));

// Helper: map result to score string for anti/score bets
function getScoreForResult(result) {
  // Default score representations for common results
  const scoreMap = {
    home: '1:0',
    draw: '1:1',
    away: '0:1',
  };
  return scoreMap[result] || '1:0';
}

// ═══════════════════════════════════════════════════
//  INVITE SYSTEM
// ═══════════════════════════════════════════════════

// POST /api/invite/generate-code — generate invite code for a wallet
app.post('/api/invite/generate-code', asyncHandler((req, res) => {
  const { wallet_address } = req.body;

  if (!wallet_address || !isValidWallet(wallet_address)) {
    return res.status(400).json({ code: 1, msg: '无效的钱包地址' });
  }

  const addr = wallet_address.toLowerCase().trim();
  const users = read('users');
  const user = users.find(u => u.address.toLowerCase() === addr);
  if (!user) {
    return res.status(404).json({ code: 1, msg: '用户不存在，请先连接钱包' });
  }

  // Generate unique invite code if user doesn't have one
  if (!user.invite_code) {
    let code;
    do {
      code = '19888_' + crypto.randomBytes(4).toString('hex').toUpperCase();
    } while (users.some(u => u.invite_code === code));
    user.invite_code = code;
  }
  if (user.invite_count === undefined) user.invite_count = 0;

  write('users', users);

  res.json({ code: 0, data: { invite_code: user.invite_code } });
}));

// GET /api/invite/stats?wallet=0x...
app.get('/api/invite/stats', asyncHandler((req, res) => {
  const addr = (req.query.wallet || '').toLowerCase().trim();
  if (!isValidWallet(addr)) {
    return res.status(400).json({ code: 1, msg: '无效的钱包地址' });
  }

  const user = getUser(addr);
  if (!user) {
    return res.json({ code: 0, data: { code: null, invite_count: 0, rewards: 0 } });
  }

  // Calculate rewards: 5% of invited users' total bet volume
  const users = read('users');
  const bets = read('bets');
  const invitedUsers = users.filter(u => u.invited_by === user.invite_code);
  const invitedAddresses = invitedUsers.map(u => u.address.toLowerCase());
  const invitedBets = bets.filter(b => invitedAddresses.includes(b.address.toLowerCase()));
  const totalVolume = invitedBets.reduce((s, b) => s + (b.amount || 0), 0);
  const rewards = +(totalVolume * 0.05).toFixed(4);

  res.json({
    code: 0,
    data: {
      code: user.invite_code || null,
      invite_count: user.invite_count || 0,
      invited_users: invitedUsers.length,
      rewards,
    }
  });
}));

// POST /api/invite/referral-tracking — register with referrer code
app.post('/api/invite/referral-tracking', asyncHandler((req, res) => {
  const { wallet_address, invited_by } = req.body;

  if (!wallet_address || !isValidWallet(wallet_address)) {
    return res.status(400).json({ code: 1, msg: '无效的钱包地址' });
  }
  if (!invited_by || typeof invited_by !== 'string' || invited_by.trim().length === 0) {
    return res.status(400).json({ code: 1, msg: '请提供推荐码' });
  }

  const addr = wallet_address.toLowerCase().trim();
  const referrerCode = invited_by.trim();

  const users = read('users');
  const user = users.find(u => u.address.toLowerCase() === addr);
  if (!user) {
    return res.status(404).json({ code: 1, msg: '用户不存在，请先连接钱包' });
  }

  // Don't allow self-referral
  if (user.invite_code === referrerCode) {
    return res.status(400).json({ code: 1, msg: '不能使用自己的推荐码' });
  }

  // Check if already invited
  if (user.invited_by) {
    return res.status(400).json({ code: 1, msg: '您已经被其他用户推荐过了' });
  }

  // Find referrer
  const referrer = users.find(u => u.invite_code === referrerCode);
  if (!referrer) {
    return res.status(404).json({ code: 1, msg: '推荐码无效' });
  }

  // Set referral
  user.invited_by = referrerCode;
  referrer.invite_count = (referrer.invite_count || 0) + 1;

  write('users', users);

  res.json({ code: 0, msg: '推荐绑定成功', data: { invited_by: referrerCode } });
}));

// POST /api/invite/claim-reward — claim invite rewards
app.post('/api/invite/claim-reward', asyncHandler((req, res) => {
  const { wallet_address } = req.body;

  if (!wallet_address || !isValidWallet(wallet_address)) {
    return res.status(400).json({ code: 1, msg: '无效的钱包地址' });
  }

  const addr = wallet_address.toLowerCase().trim();
  const users = read('users');
  const user = users.find(u => u.address.toLowerCase() === addr);
  if (!user) {
    return res.status(404).json({ code: 1, msg: '用户不存在' });
  }

  // Calculate rewards
  const bets = read('bets');
  const invitedUsers = users.filter(u => u.invited_by === user.invite_code);
  const invitedAddresses = invitedUsers.map(u => u.address.toLowerCase());
  const invitedBets = bets.filter(b => invitedAddresses.includes(b.address.toLowerCase()));
  const totalVolume = invitedBets.reduce((s, b) => s + (b.amount || 0), 0);
  const rewards = +(totalVolume * 0.05).toFixed(4);

  if (rewards <= 0) {
    return res.status(400).json({ code: 1, msg: '暂无可用奖励' });
  }

  // Check if rewards already claimed (track via last_claimed_reward)
  const lastClaimed = user.last_claimed_reward || 0;
  const unclaimedVolume = invitedBets
    .filter(b => new Date(b.created_at) > new Date(lastClaimed))
    .reduce((s, b) => s + (b.amount || 0), 0);
  const unclaimedRewards = +(unclaimedVolume * 0.05).toFixed(4);

  if (unclaimedRewards <= 0) {
    return res.status(400).json({ code: 1, msg: '暂无新的可领取奖励' });
  }

  // Credit rewards to user balance
  user.balance = (user.balance || 0) + unclaimedRewards;
  user.last_claimed_reward = new Date().toISOString();

  write('users', users);

  res.json({
    code: 0,
    msg: `已领取 ${unclaimedRewards} USDT 推荐奖励`,
    data: { claimed: unclaimedRewards, total_rewards: rewards }
  });
}));

// ═══════════════════════════════════════════════════
//  DEPOSIT TRACKING
// ═══════════════════════════════════════════════════

// POST /api/deposit — record a deposit and credit user balance
app.post('/api/deposit', asyncHandler((req, res) => {
  const { wallet_address, tx_hash, amount } = req.body;

  if (!wallet_address || !isValidWallet(wallet_address)) {
    return res.status(400).json({ code: 1, msg: '无效的钱包地址' });
  }
  if (!tx_hash || typeof tx_hash !== 'string' || tx_hash.trim().length === 0) {
    return res.status(400).json({ code: 1, msg: '请提供交易哈希' });
  }
  if (!isValidAmount(amount)) {
    return res.status(400).json({ code: 1, msg: '充值金额必须是正数' });
  }
  if (Number(amount) < 0.01) {
    return res.status(400).json({ code: 1, msg: '最小充值金额 0.01 USDT' });
  }

  const addr = wallet_address.toLowerCase().trim();
  const txHash = tx_hash.trim();
  const amt = Number(amount);

  // Check for duplicate tx
  const deposits = read('deposits');
  if (deposits.some(d => d.tx_hash === txHash)) {
    return res.status(400).json({ code: 1, msg: '该交易已处理' });
  }

  // Create or get user
  const user = getOrCreateUser(addr);

  // Record deposit
  const deposit = {
    id: (deposits[deposits.length - 1]?.id || 0) + 1,
    address: addr,
    tx_hash: txHash,
    amount: amt,
    status: 'confirmed',
    created_at: new Date().toISOString(),
  };
  deposits.push(deposit);
  write('deposits', deposits);

  // Credit user balance
  const users = read('users');
  const u = users.find(x => x.address.toLowerCase() === addr);
  if (u) {
    u.balance = (u.balance || 0) + amt;
    write('users', users);
  }

  res.json({
    code: 0,
    msg: '充值成功',
    data: {
      deposit_id: deposit.id,
      amount: amt,
      tx_hash: txHash,
      new_balance: computeBalance(u || user),
    }
  });
}));

// GET /api/deposit/history?wallet=0x...
app.get('/api/deposit/history', asyncHandler((req, res) => {
  const addr = (req.query.wallet || '').toLowerCase().trim();
  if (!isValidWallet(addr)) {
    return res.status(400).json({ code: 1, msg: '无效的钱包地址' });
  }

  const deposits = read('deposits')
    .filter(d => d.address.toLowerCase() === addr)
    .reverse();

  const totalDeposited = deposits.reduce((s, d) => s + (d.amount || 0), 0);

  res.json({
    code: 0,
    data: {
      list: deposits,
      total_deposited: +totalDeposited.toFixed(4),
      count: deposits.length,
    }
  });
}));

// ═══════════════════════════════════════════════════
//  USER PNL (Profit & Loss)
// ═══════════════════════════════════════════════════

// GET /api/user/pnl?wallet=0x...
app.get('/api/user/pnl', asyncHandler((req, res) => {
  const addr = (req.query.wallet || '').toLowerCase().trim();
  if (!isValidWallet(addr)) {
    return res.status(400).json({ code: 1, msg: '无效的钱包地址' });
  }

  const bets = read('bets').filter(b => b.address.toLowerCase() === addr);

  const total_bets = bets.length;
  const total_wagered = bets.reduce((s, b) => s + (b.amount || 0), 0);
  const wonBets = bets.filter(b => b.status === 'won');
  const lostBets = bets.filter(b => b.status === 'lost');
  const total_won = wonBets.reduce((s, b) => s + (b.potential_win || 0), 0);
  const total_lost = lostBets.reduce((s, b) => s + (b.amount || 0), 0);
  const pnl = +(total_won - total_wagered).toFixed(4);
  const roi = total_wagered > 0 ? +((pnl / total_wagered) * 100).toFixed(2) : 0;

  // Breakdown by game type
  const championBets = bets.filter(b => !b.game_type || b.game_type === 'champion');
  const antiBets = bets.filter(b => b.game_type === 'anti-score');
  const scoreBets = bets.filter(b => b.game_type === 'score');

  res.json({
    code: 0,
    data: {
      total_bets,
      total_wagered: +total_wagered.toFixed(4),
      total_won: +total_won.toFixed(4),
      total_lost: +total_lost.toFixed(4),
      pnl,
      roi,
      won_count: wonBets.length,
      lost_count: lostBets.length,
      pending_count: bets.filter(b => b.status === 'pending').length,
      win_rate: bets.filter(b => b.status !== 'pending').length > 0
        ? +((wonBets.length / bets.filter(b => b.status !== 'pending').length) * 100).toFixed(1)
        : 0,
      breakdown: {
        champion: {
          bets: championBets.length,
          wagered: +championBets.reduce((s, b) => s + (b.amount || 0), 0).toFixed(4),
          won: championBets.filter(b => b.status === 'won').length,
        },
        anti_score: {
          bets: antiBets.length,
          wagered: +antiBets.reduce((s, b) => s + (b.amount || 0), 0).toFixed(4),
          won: antiBets.filter(b => b.status === 'won').length,
        },
        score: {
          bets: scoreBets.length,
          wagered: +scoreBets.reduce((s, b) => s + (b.amount || 0), 0).toFixed(4),
          won: scoreBets.filter(b => b.status === 'won').length,
        },
      },
    }
  });
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
});
process.on('unhandledRejection', (reason) => {
    console.error(`[${new Date().toISOString()}] UNHANDLED REJECTION: ${reason}`);
});

app.listen(PORT, () => {
  console.log(`\n🔒 19888 API Server v2.0 (lucky944-compatible) running on http://localhost:${PORT}`);
  console.log(`   Frontend:  http://localhost:${PORT}/`);
  console.log(`   Admin:     http://localhost:${PORT}/admin.html`);
  console.log(`   API:       http://localhost:${PORT}/api/status`);
  console.log(`\n   NEW lucky944 Endpoints:`);
  console.log(`   GET  /api/user/balance?address=0x...`);
  console.log(`   GET  /api/user/profile?address=0x...`);
  console.log(`   POST /api/user/profile`);
  console.log(`   GET  /api/ai-hosting/status?address=0x...`);
  console.log(`   POST /api/ai-hosting/activate`);
  console.log(`   POST /api/ai-hosting/deactivate`);
  console.log(`   GET  /api/ai-hosting/history?address=0x...`);
  console.log(`   POST /api/ai-hosting/settings`);
  console.log(`   GET  /api/bet-records?address=0x...`);
  console.log(`   GET  /api/teams`);
  console.log(`   GET  /api/teams/:id`);
  console.log(`   GET  /api/teams/:id/stats\n`);
  console.log(`\n   NEW Invite/Deposit/PnL Endpoints:`);
  console.log(`   POST /api/invite/generate-code`);
  console.log(`   GET  /api/invite/stats?wallet=0x...`);
  console.log(`   POST /api/invite/referral-tracking`);
  console.log(`   POST /api/invite/claim-reward`);
  console.log(`   POST /api/deposit`);
  console.log(`   GET  /api/deposit/history?wallet=0x...`);
  console.log(`   GET  /api/user/pnl?wallet=0x...`);
  console.log(`   POST /api/admin/create-match`);
  console.log(`   POST /api/admin/settle-match\n`);
});
