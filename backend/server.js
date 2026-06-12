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
const jwt = require('jsonwebtoken');
const { ethers } = require('ethers');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3088;
const DATA_DIR = path.join(__dirname, 'data');

// ── JWT Config ──────────────────────────────────
// FP-V19888-3: Use env var, or generate once and persist in jwt_secret.txt
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  const fs2 = require('fs');
  const secretPath = path.join(__dirname, 'data', 'jwt_secret.txt');
  try {
    JWT_SECRET = fs2.readFileSync(secretPath, 'utf8').trim();
  } catch (_e) {
    JWT_SECRET = require('crypto').randomBytes(32).toString('hex');
    fs2.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
    fs2.writeFileSync(secretPath, JWT_SECRET, 'utf8');
    console.log('⚠️ JWT_SECRET not set — generated persistent random secret');
  }
}
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

// ── Sepolia RPC for on-chain verification ───────
const RPC_URL = process.env.RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const LUCKY_POOL_ADDRESS = (process.env.LUCKY_POOL_ADDRESS || '0x02fda9c22d6f8733bA507Ed1019d67571626e9DA').toLowerCase();
const CHAMPION_BET_ADDRESS = (process.env.CHAMPION_BET_ADDRESS || '0x938246dee823cEFe5574E4d195EfAD0467b2ED71').toLowerCase();
const ANTI_SCORE_BET_ADDRESS = (process.env.ANTI_SCORE_BET_ADDRESS || '0x865C5C27c75eFE75a18EBC0B51F2CA0aEb6597aD').toLowerCase();

// Lazy ethers provider (created on first use)
let _provider = null;
function getProvider() {
  if (!_provider) _provider = new ethers.JsonRpcProvider(RPC_URL);
  return _provider;
}

// ── Verify a transaction on-chain ───────────────
async function verifyOnChainTx(txHash, expectedFrom, expectedTo, expectedAmountWei) {
  try {
    const provider = getProvider();
    const tx = await provider.getTransaction(txHash);
    if (!tx) return { valid: false, reason: '交易不存在' };
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status === 0) return { valid: false, reason: '交易失败或未确认' };
    if (tx.from.toLowerCase() !== expectedFrom.toLowerCase()) return { valid: false, reason: '发送方不匹配' };
    if (tx.to && tx.to.toLowerCase() !== expectedTo.toLowerCase()) return { valid: false, reason: '接收合约不匹配' };
    if (expectedAmountWei && tx.value < expectedAmountWei) return { valid: false, reason: '金额不匹配' };
    return { valid: true, blockNumber: receipt.blockNumber, confirmations: receipt.confirmations || 1 };
  } catch (err) {
    console.error('[OnChainVerify] Error:', err.message);
    return { valid: false, reason: '链上验证服务暂不可用: ' + err.message };
  }
}

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

// ── CORS — allow only explicit origins ──
// FP-V19888-4: Exact origins only. NO suffix matching (prevents subdomain takeover).
const ALLOWED_ORIGINS = [
  'http://localhost:3088',
  'http://127.0.0.1:3088',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://19888.netlify.app',
  'https://19888.asia',
  'https://www.19888.asia',
  'https://one9888-api.onrender.com',
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    callback(null, ALLOWED_ORIGINS.includes(origin));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Rate Limiting ─────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
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
app.use(express.urlencoded({ extended: true, parameterLimit: 1000 }));

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
// Static files — serve only when path exists (Render compatibility)
const staticPath = path.join(__dirname, '..');
if (fs.existsSync(staticPath)) {
  app.use(express.static(staticPath));
}

// ── Ensure Data Directory ─────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════

// ── JSON File Helpers ─────────────────────────────
function read(name, def = []) {
  const f = path.join(DATA_DIR, name + '.json');
  if (!fs.existsSync(f)) return def;
  try {
    const raw = fs.readFileSync(f, 'utf8');
    if (!raw.trim()) return def;
    return JSON.parse(raw);
  } catch(e) {
    console.error(`[DATA_CORRUPTION] Failed to read ${name}.json: ${e.message}. Returning default.`);
    // Backup corrupt file for recovery
    const backup = path.join(DATA_DIR, name + '.corrupt.' + Date.now() + '.json');
    try { fs.copyFileSync(f, backup); } catch {}
    return def;
  }
}
// Atomic write: write to temp file first, then rename (prevents corruption on crash)
function write(name, data) {
  const f = path.join(DATA_DIR, name + '.json');
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f);
}

// ── File Lock for Atomic Read-Modify-Write ─────────
const fileLocks = new Map();
function acquireLock(name, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function tryAcquire() {
      if (!fileLocks.has(name)) {
        fileLocks.set(name, true);
        resolve();
      } else if (Date.now() - start > timeout) {
        reject(new Error(`Lock timeout for ${name}`));
      } else {
        setImmediate(tryAcquire);
      }
    }
    tryAcquire();
  });
}
function releaseLock(name) { fileLocks.delete(name); }

// Atomic read-modify-write with lock
function lockedUpdate(name, updateFn) {
  return new Promise((resolve, reject) => {
    // Use setImmediate to avoid blocking the event loop
    setImmediate(async () => {
      try {
        await acquireLock(name, 3000);
        try {
          const data = read(name);
          const result = updateFn(data);
          write(name, data);
          releaseLock(name);
          resolve(result);
        } catch (e) {
          releaseLock(name);
          throw e;
        }
      } catch (e) {
        reject(e);
      }
    });
  });
}

// ── Input Validation Helpers ──────────────────────
function isValidWallet(addr) {
  if (typeof addr !== 'string') return false;
  const a = addr.toLowerCase().trim();
  return /^0x[0-9a-f]{40}$/.test(a);
}

function isValidAmount(val) {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 && n <= 10000;
}

// ── Deduplication Helper ───────────────────────────
function isDuplicateTx(txHash, collection) {
  if (!txHash) return false;
  const records = read(collection);
  return records.some(r => r.tx_hash && r.tx_hash.toLowerCase() === txHash.toLowerCase());
}

function isValidTeamId(val) {
  const id = parseInt(val, 10);
  return id >= 1 && id <= 48;
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

// ── Error-handling wrapper (supports async/await) ──
function asyncHandler(fn) {
  return (req, res, next) => {
    const result = fn(req, res, next);
    if (result && typeof result.then === 'function') {
      result.catch(function(err) {
        console.error(`[API Error] ${req.method} ${req.originalUrl}:`, err.message);
        res.status(500).json({ code: 99, msg: '服务器内部错误' });
      });
    }
  };
}

// ── Auth Helpers ──────────────────────────────────
function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}

function verifyPassword(pw, hash) {
  try {
    return bcrypt.compareSync(pw, hash);
  } catch (e) {
    return false;
  }
}

// ── User factory (single source of truth for new user creation) ──
function createUserObject(addr) {
  return {
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
      risk_level: 'medium',
      auto_settle: true,
      preferred_matches: 'all',
    },
    ai_hosting_since: null,
    created_at: new Date().toISOString(),
    last_login: new Date().toISOString(),
  };
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
    user = createUserObject(addr);
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

// ═══════════════════════════════════════════════════
//  MOCK MARKET DATA GENERATORS
// ═══════════════════════════════════════════════════

// ── Generate mock K-line (candlestick) data ───────
function generateMockKlines(symbol = 'BTCUSD', interval = '1h', limit = 100) {
  const klines = [];
  const now = Date.now();
  const intervalMs = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
  const ms = intervalMs[interval] || 3600000;
  let basePrice = symbol === 'BTCUSD' ? 68500 : (symbol === 'ETHUSD' ? 3450 : 1.05);

  for (let i = limit - 1; i >= 0; i--) {
    const t = now - i * ms;
    const open = basePrice + (Math.random() - 0.5) * basePrice * 0.02;
    const close = open + (Math.random() - 0.5) * open * 0.015;
    const high = Math.max(open, close) * (1 + Math.random() * 0.008);
    const low = Math.min(open, close) * (1 - Math.random() * 0.008);
    const volume = Math.round((100 + Math.random() * 900) * 100) / 100;
    klines.push([t, +open.toFixed(2), +high.toFixed(2), +low.toFixed(2), +close.toFixed(2), volume]);
    basePrice = close;
  }
  return klines;
}

// ── Generate mock orderbook ────────────────────────
function generateMockOrderbook(symbol = 'BTCUSD', depth = 20) {
  const midPrice = symbol === 'BTCUSD' ? 68500 : (symbol === 'ETHUSD' ? 3450 : 1.05);
  const spread = midPrice * 0.001; // 0.1% spread
  const bids = [];
  const asks = [];

  for (let i = 0; i < depth; i++) {
    const bidPrice = +(midPrice - spread * (i + 1) + (Math.random() - 0.5) * spread * 0.5).toFixed(2);
    const askPrice = +(midPrice + spread * (i + 1) + (Math.random() - 0.5) * spread * 0.5).toFixed(2);
    const bidQty = +((Math.random() * 2 + 0.1) * (depth - i) / depth).toFixed(4);
    const askQty = +((Math.random() * 2 + 0.1) * (depth - i) / depth).toFixed(4);
    bids.push([bidPrice, bidQty]);
    asks.push([askPrice, askQty]);
  }

  // Sort bids descending by price, asks ascending by price
  bids.sort((a, b) => b[0] - a[0]);
  asks.sort((a, b) => a[0] - b[0]);

  return { bids, asks, timestamp: Date.now() };
}

// ── Generate mock match odds ──────────────────────
function generateMockOdds() {
  const matches = read('matches');
  if (!matches || matches.length === 0) {
    return [];
  }
  return matches.slice(0, 10).map(m => ({
    match_id: m.id,
    home: m.home,
    away: m.away,
    odds_home: +(m.odds_home || 1.5 + Math.random() * 3).toFixed(2),
    odds_draw: +(m.odds_draw || 2.5 + Math.random() * 2).toFixed(2),
    odds_away: +(m.odds_away || 3 + Math.random() * 5).toFixed(2),
    updated_at: new Date().toISOString(),
  }));
}

// ── Generate mock pool status ──────────────────────
function generateMockPool() {
  const aiPool = read('ai_pool');
  const totalFrozen = aiPool && aiPool.total_frozen ? aiPool.total_frozen : 12500;
  const activeUsers = aiPool && aiPool.active_users ? aiPool.active_users : 47;
  return {
    total_pool: +((totalFrozen || 12500) + Math.random() * 5000).toFixed(2),
    active_users: (activeUsers || 47) + Math.floor(Math.random() * 5) - 2,
    total_bets_today: Math.floor(200 + Math.random() * 800),
    avg_roi: +((Math.random() * 12 - 3)).toFixed(2),
    updated_at: new Date().toISOString(),
  };
}

// ── Seed Data ─────────────────────────────────────
function seed() {
  const hasMatches = read('matches').length > 0;

  if (!hasMatches) {
    // Copy World Cup 2026 data from seed files
    const seedDir = path.join(__dirname, 'seed');
    const seedMatches = path.join(seedDir, 'matches.json');
    const seedTeams = path.join(seedDir, 'champion_teams.json');

    if (fs.existsSync(seedMatches) && fs.existsSync(seedTeams)) {
      fs.copyFileSync(seedMatches, path.join(DATA_DIR, 'matches.json'));
      fs.copyFileSync(seedTeams, path.join(DATA_DIR, 'champion_teams.json'));
      console.log('✅ World Cup 2026 seed data loaded');
    } else {
      const now = new Date();
      write('matches', [
        { id:1, league:'世界杯 A组·第1轮', home:'美国', away:'墨西哥', match_time: fmt(now,0,14,0), odds_home:1.65, odds_draw:3.30, odds_away:6.00, status:'upcoming' },
      ]);
      write('champion_teams', [
        { id:1, name:'巴西', flag:'🇧🇷', champion_odds:5.5, runner_odds:4.0, group:'B' },
      ]);
    }
  }

  // Always seed admin account if it doesn't exist (FP fix)
  const admins = read('admins');
  if (admins.length === 0) {
    const ADMIN_DEFAULT_PASS = process.env.ADMIN_PASSWORD;
    if (!ADMIN_DEFAULT_PASS) {
      console.error('❌ CRITICAL: Set ADMIN_PASSWORD env var before first boot. Generating random fallback...');
    }
    const pass = ADMIN_DEFAULT_PASS || require('crypto').randomBytes(6).toString('hex');
    write('admins', [{ username: 'admin', password: hashPassword(pass) }]);
    console.log(`✅ Admin account created (password: ${pass})`);
    console.log('⚠️  Change this password immediately after first login');
  }

  // Always seed AI pool if missing
  if (!read('ai_pool').total_frozen && read('ai_pool').total_frozen !== 0) {
    write('ai_pool', { total_frozen: 0, active_users: 0 });
  }
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

// GET /api/tunnel-url — return current tunnel URL (used by keeper cron)
app.get('/api/tunnel-url', asyncHandler((req, res) => {
  const host = req.headers.host || '';
  // If accessed via tunnel (trycloudflare.com), return the full origin
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const tunnelUrl = host.includes('trycloudflare.com')
    ? `${proto}://${host}/api`
    : `https://enlargement-celtic-for-moderators.trycloudflare.com/api`;
  res.json({ code: 0, data: { tunnel_url: tunnelUrl, host } });
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
    user = createUserObject(addr);
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
      championship_odds: team.champion_odds,
      runner_up_odds: team.runner_odds,
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

app.post('/api/champion-bet/place', riskCheck, asyncHandler(async (req, res) => {
  const { team_id, bet_type, amount, wallet_address, tx_hash } = req.body;

  if (!wallet_address || !isValidWallet(wallet_address)) {
    return res.status(400).json({ code:1, msg:'无效的钱包地址（需要0x开头的42位十六进制地址）' });
  }
  if (!team_id || !isValidTeamId(team_id)) {
    return res.status(400).json({ code:1, msg:'球队ID无效（1-48）' });
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

  // If tx_hash provided, verify on-chain before deducting (two-phase)
  if (tx_hash && typeof tx_hash === 'string' && tx_hash.trim().length > 0) {
    const txHash = tx_hash.trim();
    const amountWei = ethers.parseUnits(amt.toFixed(18), 18);
    const verification = await verifyOnChainTx(txHash, addr, CHAMPION_BET_ADDRESS, amountWei);
    if (!verification.valid) {
      console.error(`[ChampionBet] On-chain verify failed: addr=${addr} tx=${txHash}`, verification.reason);
      return res.status(400).json({ code:1, msg:`链上交易验证失败: ${verification.reason}` });
    }
    console.log(`[ChampionBet] On-chain verified: block=${verification.blockNumber} tx=${txHash.slice(0,10)}...`);
  } else {
    console.warn(`[ChampionBet] No tx_hash provided - deducting immediately (two-phase recommended for security)`);
  }

  // Check user balance
  const users = read('users');
  const user = users.find(u => u.address.toLowerCase() === addr);
  if (!user) return res.status(404).json({ code:1, msg:'用户不存在，请先连接钱包' });
  const balance = computeBalance(user);
  if (amt > balance.available) {
    return res.status(400).json({ code:1, msg:`余额不足，可用: ${balance.available.toFixed(2)} USDT` });
  }

  // Check for duplicate bet (same user, same team, same type, pending)
  const bets = read('bets');
  const dupBet = bets.find(b =>
    b.address.toLowerCase() === addr &&
    b.team_id === tid &&
    b.bet_type === btype &&
    b.status === 'pending'
  );
  if (dupBet) {
    return res.status(400).json({ code:1, msg:'您已对该球队下过相同类型的投注，请等待结算' });
  }

  const odds = btype === 1 ? team.champion_odds : team.runner_odds;
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
    tx_hash: tx_hash ? tx_hash.trim() : undefined,
    created_at: new Date().toISOString(),
  };
  bets.push(bet);
  write('bets', bets);

  // Deduct from available balance (freeze for bet)
  user.balance = Math.max(0, +(user.balance - amt).toFixed(4));
  user.frozen_bet = (user.frozen_bet || 0) + amt;
  write('users', users);

  res.json({ code:0, msg:'投注成功！', data: { bet_id: bet.id, potential_win: bet.potential_win } });
}));

// ═══════════════════════════════════════════════════
//  TWO-PHASE BET CONFIRMATION
// ═══════════════════════════════════════════════════

// POST /api/bet/confirm — confirm a bet with on-chain tx hash
// Used when frontend first creates bet via blockchain tx, then confirms here
app.post('/api/bet/confirm', riskCheck, asyncHandler(async (req, res) => {
  const { bet_id, wallet_address, tx_hash, amount, game_type, match_id, cell_score, team_id, bet_type } = req.body;

  if (!wallet_address || !isValidWallet(wallet_address)) {
    return res.status(400).json({ code:1, msg:'无效的钱包地址' });
  }
  if (!bet_id || !Number.isInteger(Number(bet_id))) {
    return res.status(400).json({ code:1, msg:'无效的投注ID' });
  }
  if (!tx_hash || typeof tx_hash !== 'string' || tx_hash.trim().length === 0) {
    return res.status(400).json({ code:1, msg:'请提供交易哈希' });
  }

  const addr = wallet_address.toLowerCase().trim();
  const txHash = tx_hash.trim();
  const bid = Number(bet_id);

  // Check if bet already exists
  const bets = read('bets');
  if (bets.some(b => b.id === bid)) {
    return res.status(400).json({ code:1, msg:'该投注已存在' });
  }

  // Verify the tx_hash on-chain
  const amtNum = Number(amount || 0);
  const amountWei = ethers.parseUnits(amtNum.toFixed(18), 18);
  const expectedTo = game_type === 'champion' ? CHAMPION_BET_ADDRESS : ANTI_SCORE_BET_ADDRESS;
  const verification = await verifyOnChainTx(txHash, addr, expectedTo, amountWei);
  if (!verification.valid) {
    return res.status(400).json({ code:1, msg:`链上交易验证失败: ${verification.reason}` });
  }

  console.log(`[BetConfirm] On-chain verified: bet_id=${bid} block=${verification.blockNumber} tx=${txHash.slice(0,10)}...`);

  // Check user balance
  const users = read('users');
  const user = users.find(u => u.address.toLowerCase() === addr);
  if (!user) return res.status(404).json({ code:1, msg:'用户不存在' });
  const balance = computeBalance(user);
  const amt = Number(amount || 0);
  if (amt > balance.available) {
    return res.status(400).json({ code:1, msg:`余额不足，可用: ${balance.available.toFixed(2)} USDT` });
  }

  // Create the bet record
  const bet = {
    id: bid,
    address: addr,
    tx_hash: txHash,
    block_number: verification.blockNumber,
    amount: amt,
    status: 'pending',
    game_type: game_type || 'champion',
    match_id: match_id || null,
    cell_score: cell_score || null,
    team_id: team_id || null,
    bet_type: bet_type || null,
    created_at: new Date().toISOString(),
  };
  bets.push(bet);
  write('bets', bets);

  // Deduct from available balance
  user.balance = Math.max(0, +(user.balance - amt).toFixed(4));
  user.frozen_bet = (user.frozen_bet || 0) + amt;
  write('users', users);

  res.json({ code:0, msg:'投注确认成功！', data: { bet_id: bid, tx_hash: txHash } });
}));

// ═══════════════════════════════════════════════════
//  ANTI-SCORE BETS (existing — backward compat)
// ═══════════════════════════════════════════════════

app.post('/api/anti-bet/place', riskCheck, asyncHandler((req, res) => {
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
  user.balance = Math.max(0, +(user.balance - amt).toFixed(4));
  user.frozen_bet = (user.frozen_bet || 0) + amt;
  write('users', users);

  res.json({ code:0, msg:'反波膽投注成功！', data: { bet_id: bet.id, potential_win: bet.potential_win } });
}));

// ═══════════════════════════════════════════════════
//  SCORE BETS (existing — backward compat)
// ═══════════════════════════════════════════════════

app.post('/api/score-bet/place', riskCheck, asyncHandler((req, res) => {
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
  user.balance = Math.max(0, +(user.balance - amt).toFixed(4));
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
//  ADMIN API (protected by JWT)
// ═══════════════════════════════════════════════════

function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ code:1, msg:'未授权，请先登录' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ code:1, msg:'登录已过期，请重新登录' });
    }
    return res.status(401).json({ code:1, msg:'无效的凭据' });
  }
}

// Admin login → returns JWT
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

  const token = jwt.sign(
    { username: admin.username, role: 'admin' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );

  res.json({ code:0, msg:'登录成功', data: { token, expiresIn: JWT_EXPIRY } });
}));

// GET /api/admin/verify — verify current token is valid
app.get('/api/admin/verify', adminAuth, asyncHandler((req, res) => {
  res.json({ code:0, msg:'凭据有效', data: { username: req.admin.username } });
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
      code = '19888_' + crypto.randomBytes(6).toString('hex').toUpperCase();
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
//  DEPOSIT & WITHDRAW
// ═══════════════════════════════════════════════════

// POST /api/withdraw — withdraw USDT from user balance (ATOMIC with lock)
app.post('/api/withdraw', asyncHandler(async (req, res) => {
  const { wallet_address, amount, withdraw_address, tx_hash } = req.body;

  if (!wallet_address || !isValidWallet(wallet_address)) {
    return res.status(400).json({ code: 1, msg: '无效的钱包地址' });
  }
  if (!withdraw_address || !isValidWallet(withdraw_address)) {
    return res.status(400).json({ code: 1, msg: '无效的提现地址' });
  }
  if (!isValidAmount(amount)) {
    return res.status(400).json({ code: 1, msg: '提现金额无效（1-10000 USDT）' });
  }
  if (Number(amount) < 1) {
    return res.status(400).json({ code: 1, msg: '最小提现金额 1 USDT' });
  }

  const addr = wallet_address.toLowerCase().trim();
  const amt = Number(amount);
  const toAddr = withdraw_address.toLowerCase().trim();

  // Deduplication
  if (tx_hash && isDuplicateTx(tx_hash, 'withdrawals')) {
    return res.status(409).json({ code: 1, msg: '重复的提现请求' });
  }

  // Atomic update with lock
  try {
    const result = await lockedUpdate('users', (users) => {
      const user = users.find(u => u.address.toLowerCase() === addr);
      if (!user) throw { code: 404, msg: '用户不存在' };

      const available = (user.balance || 0) - (user.frozen_bet || 0) - (user.frozen_ai || 0);
      if (available < amt) {
        throw { code: 400, msg: `余额不足。可用: ${available.toFixed(2)} USDT` };
      }

      // Balance floor
      user.balance = Math.max(0, +(user.balance - amt).toFixed(4));

      // Risk: large withdraw alert
      if (amt >= (riskConfig.large_withdraw_threshold || 500)) {
        addRiskAlert('large_withdraw', 'warning',
          `${addr.slice(0, 10)}... 提现 ${amt} USDT → ${toAddr.slice(0, 10)}...`);
      }

      return { user, users };
    });

    // Record withdrawal (separate lock for withdrawals file)
    const wResult = await lockedUpdate('withdrawals', (withdrawals) => {
      const withdrawal = {
        id: (withdrawals[withdrawals.length - 1]?.id || 0) + 1,
        address: addr,
        to_address: toAddr,
        amount: amt,
        tx_hash: tx_hash || null,
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      withdrawals.push(withdrawal);
      return withdrawal;
    });

    console.log(`[Withdraw] ${addr.slice(0, 10)}... → ${toAddr.slice(0, 10)}... ${amt} USDT`);

    res.json({
      code: 0,
      msg: '提现申请已提交',
      data: {
        withdraw_id: wResult.id,
        amount: amt,
        to_address: toAddr,
      }
    });
  } catch (e) {
    if (e.code) return res.status(e.code).json({ code: 1, msg: e.msg });
    throw e;
  }
}));

// GET /api/withdraw/history?wallet=0x...
app.get('/api/withdraw/history', asyncHandler((req, res) => {
  const addr = (req.query.wallet || '').toLowerCase().trim();
  if (!isValidWallet(addr)) {
    return res.status(400).json({ code: 1, msg: '无效的钱包地址' });
  }
  const withdrawals = read('withdrawals')
    .filter(w => w.address.toLowerCase() === addr)
    .reverse();
  res.json({ code: 0, data: withdrawals });
}));

// POST /api/deposit — record a deposit and credit user balance
// Uses on-chain tx verification before crediting
app.post('/api/deposit', asyncHandler(async (req, res) => {
  const { wallet_address, tx_hash, amount } = req.body;

  if (!wallet_address || !isValidWallet(wallet_address)) {
    return res.status(400).json({ code: 1, msg: '无效的钱包地址' });
  }
  if (!tx_hash || typeof tx_hash !== 'string' || tx_hash.trim().length === 0) {
    return res.status(400).json({ code: 1, msg: '请提供交易哈希' });
  }
  if (!isValidAmount(amount)) {
    return res.status(400).json({ code: 1, msg: '充值金额必须是正数（不超过10000）' });
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

  // --- On-chain verification ---
  // Verify the tx_hash is a real Sepolia transaction to LuckyPool contract
  const amountWei = ethers.parseUnits(amt.toFixed(18), 18);
  const verification = await verifyOnChainTx(txHash, addr, LUCKY_POOL_ADDRESS, amountWei);
  if (!verification.valid) {
    console.error(`[Deposit] On-chain verify failed: addr=${addr} tx=${txHash}`, verification.reason);
    // Record failed attempt for audit
    const failedDep = {
      id: (deposits[deposits.length - 1]?.id || 0) + 1,
      address: addr,
      tx_hash: txHash,
      amount: amt,
      status: 'failed',
      reason: verification.reason,
      created_at: new Date().toISOString(),
    };
    deposits.push(failedDep);
    write('deposits', deposits);
    return res.status(400).json({ code: 1, msg: `充值验证失败: ${verification.reason}` });
  }

  console.log(`[Deposit] On-chain verified: block=${verification.blockNumber} tx=${txHash.slice(0,10)}...`);

  // Create or get user
  const user = getOrCreateUser(addr);

  // Record deposit as confirmed
  const deposit = {
    id: (deposits[deposits.length - 1]?.id || 0) + 1,
    address: addr,
    tx_hash: txHash,
    amount: amt,
    status: 'confirmed',
    block_number: verification.blockNumber,
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
      block_number: verification.blockNumber,
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
  // PnL = winnings - losses (FP fix: was total_won - total_wagered, which double-counts losses)
  const pnl = +(total_won - total_lost).toFixed(4);
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
//  VIP SYSTEM
// ═══════════════════════════════════════════════════

const VIP_LEVELS = [
  { level:0, name:'普通', min_wagered:0, cashback:0, withdraw_priority:false, odds_boost:0 },
  { level:1, name:'青铜', min_wagered:500, cashback:0.005, withdraw_priority:false, odds_boost:0 },
  { level:2, name:'白银', min_wagered:2000, cashback:0.01, withdraw_priority:false, odds_boost:0 },
  { level:3, name:'黄金', min_wagered:10000, cashback:0.02, withdraw_priority:true, odds_boost:0.02 },
  { level:4, name:'铂金', min_wagered:50000, cashback:0.03, withdraw_priority:true, odds_boost:0.05 },
  { level:5, name:'钻石', min_wagered:200000, cashback:0.05, withdraw_priority:true, odds_boost:0.10 },
];

function computeVIPLevel(totalWagered) {
  let lvl = 0;
  for (const v of VIP_LEVELS) {
    if (totalWagered >= v.min_wagered) lvl = v.level;
  }
  return lvl;
}

// GET /api/vip/status?wallet=0x...
app.get('/api/vip/status', asyncHandler((req, res) => {
  const addr = (req.query.wallet || '').toLowerCase().trim();
  if (!isValidWallet(addr)) return res.status(400).json({ code:1, msg:'无效的钱包地址' });
  const user = getUser(addr);
  if (!user) return res.json({ code:0, data: { level:0, name:'普通', total_wagered:0 } });

  const bets = read('bets').filter(b => b.address.toLowerCase() === addr);
  const totalWagered = bets.reduce((s, b) => s + (b.amount || 0), 0);
  const currentLevel = computeVIPLevel(totalWagered);
  const vip = VIP_LEVELS[currentLevel];
  const nextVip = VIP_LEVELS.find(v => v.level > currentLevel);

  res.json({
    code:0,
    data: {
      level: vip.level,
      name: vip.name,
      total_wagered: +totalWagered.toFixed(2),
      cashback: vip.cashback,
      odds_boost: vip.odds_boost,
      withdraw_priority: vip.withdraw_priority,
      next_level: nextVip ? { level:nextVip.level, name:nextVip.name, need:+(nextVip.min_wagered - totalWagered).toFixed(2) } : null,
    }
  });
}));

// GET /api/vip/levels — static level config
app.get('/api/vip/levels', asyncHandler((req, res) => {
  res.json({ code:0, data: VIP_LEVELS });
}));

// POST /api/vip/check-upgrade — check & trigger VIP upgrade
app.post('/api/vip/check-upgrade', asyncHandler((req, res) => {
  const { wallet_address } = req.body;
  if (!isValidWallet(wallet_address)) return res.status(400).json({ code:1, msg:'无效的钱包地址' });
  const addr = wallet_address.toLowerCase().trim();
  const user = getUser(addr);
  if (!user) return res.json({ code:0, data: { can_upgrade: false, current_level: 0, next_level: null } });

  const bets = read('bets').filter(b => b.address.toLowerCase() === addr);
  const totalWagered = bets.reduce((s, b) => s + (b.amount || 0), 0);
  const currentLevel = computeVIPLevel(totalWagered);

  // Find next achievable level
  const nextLevel = VIP_LEVELS.find(v => v.level > currentLevel);
  if (nextLevel && totalWagered >= nextLevel.min_wagered) {
    // Upgrade user's VIP level in data
    const users = read('users');
    const idx = users.findIndex(u => u.address.toLowerCase() === addr);
    if (idx !== -1) {
      users[idx].vip_level = nextLevel.level;
      users[idx].vip_name = nextLevel.name;
      write('users', users);
    }
    return res.json({ code:0, data: { can_upgrade: true, new_level: nextLevel.level, name: nextLevel.name } });
  }

  res.json({ code:0, data: { can_upgrade: false, current_level: currentLevel, next_level: nextLevel ? { level: nextLevel.level, name: nextLevel.name, need: +(nextLevel.min_wagered - totalWagered).toFixed(2) } : null } });
}));

// ═══════════════════════════════════════════════════
//  RISK CONTROL SYSTEM (L5-L7)
// ═══════════════════════════════════════════════════

let riskConfig = {
  max_single_bet: 1000,
  max_daily_bet: 5000,
  max_daily_loss: 2000,
  large_withdraw_threshold: 500,
  abnormal_freq_per_hour: 50,
  circuit_breaker: false,
  circuit_reason: '',
  circuit_since: null,
};

let riskAlerts = [];

function addRiskAlert(type, severity, message, data) {
  const alert = {
    id: (riskAlerts[riskAlerts.length-1]?.id || 0) + 1,
    type, severity, message, data,
    created_at: new Date().toISOString(),
    acknowledged: false,
  };
  riskAlerts.unshift(alert);
  if (riskAlerts.length > 200) riskAlerts.length = 200;
  console.warn(`[RISK_ALERT] [${severity}] ${type}: ${message}`);
  return alert;
}

// Risk middleware: check circuit breaker on all bet endpoints
function riskCheck(req, res, next) {
  if (riskConfig.circuit_breaker) {
    return res.status(503).json({
      code: 99,
      msg: `系统熔断中: ${riskConfig.circuit_reason}`,
      data: { circuit_since: riskConfig.circuit_since }
    });
  }
  next();
}

// GET /api/admin/risk/alerts
app.get('/api/admin/risk/alerts', adminAuth, asyncHandler((req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json({ code:0, data: riskAlerts.slice(0, limit) });
}));

// POST /api/admin/risk/circuit-break
app.post('/api/admin/risk/circuit-break', adminAuth, asyncHandler((req, res) => {
  const { action, reason } = req.body;
  if (action === 'engage') {
    riskConfig.circuit_breaker = true;
    riskConfig.circuit_reason = reason || '管理员手动熔断';
    riskConfig.circuit_since = new Date().toISOString();
    addRiskAlert('circuit_break', 'critical', `熔断已启用: ${riskConfig.circuit_reason}`);
  } else if (action === 'release') {
    riskConfig.circuit_breaker = false;
    riskConfig.circuit_reason = '';
    riskConfig.circuit_since = null;
    addRiskAlert('circuit_release', 'info', '熔断已解除');
  } else {
    return res.status(400).json({ code:1, msg:'action 必须是 engage 或 release' });
  }
  res.json({ code:0, msg: action === 'engage' ? '熔断已启用' : '熔断已解除', data: riskConfig });
}));

// GET /api/admin/risk/config
app.get('/api/admin/risk/config', adminAuth, asyncHandler((req, res) => {
  res.json({ code:0, data: { ...riskConfig, alerts_count: riskAlerts.length } });
}));

// POST /api/admin/risk/config — update limits
app.post('/api/admin/risk/config', adminAuth, asyncHandler((req, res) => {
  const { max_single_bet, max_daily_bet, max_daily_loss, large_withdraw_threshold, abnormal_freq_per_hour } = req.body;
  if (max_single_bet !== undefined) riskConfig.max_single_bet = Number(max_single_bet);
  if (max_daily_bet !== undefined) riskConfig.max_daily_bet = Number(max_daily_bet);
  if (max_daily_loss !== undefined) riskConfig.max_daily_loss = Number(max_daily_loss);
  if (large_withdraw_threshold !== undefined) riskConfig.large_withdraw_threshold = Number(large_withdraw_threshold);
  if (abnormal_freq_per_hour !== undefined) riskConfig.abnormal_freq_per_hour = Number(abnormal_freq_per_hour);
  addRiskAlert('config_change', 'info', '风控配置已更新');
  res.json({ code:0, msg:'配置已更新', data: riskConfig });
}));

// ═══════════════════════════════════════════════════
//  AGENT LEVELS + AUTO SETTLE
// ═══════════════════════════════════════════════════

const AGENT_LEVELS = [
  { level:0, name:'普通会员', min_invites:0, commission_l1:0.03, commission_l2:0 },
  { level:1, name:'青铜代理', min_invites:3, commission_l1:0.05, commission_l2:0.01 },
  { level:2, name:'白银代理', min_invites:10, commission_l1:0.07, commission_l2:0.02 },
  { level:3, name:'黄金代理', min_invites:30, commission_l1:0.10, commission_l2:0.03 },
  { level:4, name:'铂金代理', min_invites:100, commission_l1:0.12, commission_l2:0.05 },
  { level:5, name:'钻石代理', min_invites:500, commission_l1:0.15, commission_l2:0.07 },
];

function computeAgentLevel(inviteCount) {
  let lvl = 0;
  for (const a of AGENT_LEVELS) {
    if (inviteCount >= a.min_invites) lvl = a.level;
  }
  return lvl;
}

// GET /api/invite/levels
app.get('/api/invite/levels', asyncHandler((req, res) => {
  res.json({ code:0, data: AGENT_LEVELS });
}));

// GET /api/invite/earnings?wallet=0x...
app.get('/api/invite/earnings', asyncHandler((req, res) => {
  const addr = (req.query.wallet || '').toLowerCase().trim();
  if (!isValidWallet(addr)) return res.status(400).json({ code:1, msg:'无效的钱包地址' });
  const user = getUser(addr);
  if (!user) return res.json({ code:0, data: { level:0, total_earned:0, invite_count:0 } });

  const users = read('users');
  const inviteCount = user.invite_count || 0;
  const agentLevel = computeAgentLevel(inviteCount);
  const agent = AGENT_LEVELS[agentLevel];

  // Calculate total earned from invite rewards
  const bets = read('bets');
  const invitedUsers = users.filter(u => u.invited_by === user.invite_code);
  const invitedAddresses = invitedUsers.map(u => u.address.toLowerCase());
  const invitedBets = bets.filter(b => invitedAddresses.includes(b.address.toLowerCase()));
  const totalVolume = invitedBets.reduce((s, b) => s + (b.amount || 0), 0);
  // Calculate total earned: commission_l1 on direct invitees' volume
  const l1Earned = +(totalVolume * agent.commission_l1).toFixed(4);
  // L2: second-level invitees (those invited by your direct invitees)
  const l2Addresses = [];
  for (const iu of invitedUsers) {
    const l2Users = users.filter(u => u.invited_by === iu.invite_code);
    l2Addresses.push(...l2Users.map(u => u.address.toLowerCase()));
  }
  const l2Bets = bets.filter(b => l2Addresses.includes(b.address.toLowerCase()));
  const l2Volume = l2Bets.reduce((s, b) => s + (b.amount || 0), 0);
  const l2Earned = +(l2Volume * agent.commission_l2).toFixed(4);
  const totalEarned = +(l1Earned + l2Earned).toFixed(4);

  res.json({
    code:0,
    data: {
      level: agent.level,
      name: agent.name,
      invite_count: inviteCount,
      commission_l1: agent.commission_l1,
      commission_l2: agent.commission_l2,
      total_volume: +totalVolume.toFixed(2),
      total_earned: totalEarned,
      last_claimed: user.last_claimed_reward || null,
      next_level: AGENT_LEVELS.find(a => a.level > agentLevel) || null,
    }
  });
}));

// ═══════════════════════════════════════════════════
//  FINANCIAL SYSTEM
// ═══════════════════════════════════════════════════

// GET /api/finance/daily-report?date=YYYY-MM-DD
app.get('/api/finance/daily-report', adminAuth, asyncHandler((req, res) => {
  const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
  const dayStart = dateStr + 'T00:00:00.000Z';
  const dayEnd = dateStr + 'T23:59:59.999Z';

  const bets = read('bets').filter(b => {
    const t = b.created_at || b.settled_at;
    return t && t >= dayStart && t <= dayEnd;
  });
  const deposits = read('deposits').filter(d => d.created_at >= dayStart && d.created_at <= dayEnd);
  const withdrawals = read('withdrawals').filter(w => w.created_at >= dayStart && w.created_at <= dayEnd);

  const totalBets = bets.length;
  const totalVolume = bets.reduce((s, b) => s + (b.amount || 0), 0);
  const wonBets = bets.filter(b => b.status === 'won');
  const lostBets = bets.filter(b => b.status === 'lost');
  const totalPayout = wonBets.reduce((s, b) => s + (b.potential_win || 0), 0);
  const totalLost = lostBets.reduce((s, b) => s + (b.amount || 0), 0);
  const platformPnL = +(totalVolume - totalPayout).toFixed(2);
  const totalDeposits = deposits.filter(d => d.status === 'confirmed').reduce((s, d) => s + (d.amount || 0), 0);
  const totalWithdrawals = withdrawals.reduce((s, w) => s + (w.amount || 0), 0);
  const newUsers = read('users').filter(u => u.created_at >= dayStart && u.created_at <= dayEnd).length;

  res.json({
    code:0,
    data: {
      date: dateStr,
      bets: { total: totalBets, volume: +totalVolume.toFixed(2), won: wonBets.length, lost: lostBets.length },
      finance: { deposits: +totalDeposits.toFixed(2), withdrawals: +totalWithdrawals.toFixed(2), platform_pnl: platformPnL },
      users: { new: newUsers, total: read('users').length },
      payout: +totalPayout.toFixed(2),
    }
  });
}));

// GET /api/finance/pool-status
app.get('/api/finance/pool-status', asyncHandler((req, res) => {
  const users = read('users');
  const totalBalance = users.reduce((s, u) => s + (u.balance || 0), 0);
  const totalFrozen = users.reduce((s, u) => s + (u.frozen_bet || 0) + (u.frozen_ai || 0), 0);
  const deposits = read('deposits').filter(d => d.status === 'confirmed');
  const totalDeposited = deposits.reduce((s, d) => s + (d.amount || 0), 0);
  const withdrawals = read('withdrawals');
  const totalWithdrawn = withdrawals.reduce((s, w) => s + (w.amount || 0), 0);
  const pendingWithdrawals = withdrawals.filter(w => w.status === 'pending');
  const bets = read('bets');
  const totalPendingBets = bets.filter(b => b.status === 'pending').length;

  res.json({
    code:0,
    data: {
      total_balance: +totalBalance.toFixed(2),
      total_frozen: +totalFrozen.toFixed(2),
      total_deposited: +totalDeposited.toFixed(2),
      total_withdrawn: +totalWithdrawn.toFixed(2),
      pending_withdrawals: pendingWithdrawals.length,
      pending_bets: totalPendingBets,
      user_count: users.length,
    }
  });
}));

// ═══════════════════════════════════════════════════
//  ORDER SYSTEM: CANCEL + TRANSACTION HISTORY
// ═══════════════════════════════════════════════════

// POST /api/bets/:id/cancel — cancel a pending bet
app.post('/api/bets/:id/cancel', asyncHandler((req, res) => {
  const betId = parseInt(req.params.id);
  if (!Number.isInteger(betId) || betId < 1) {
    return res.status(400).json({ code:1, msg:'无效的投注ID' });
  }
  const { wallet_address } = req.body;
  if (!wallet_address || !isValidWallet(wallet_address)) {
    return res.status(400).json({ code:1, msg:'无效的钱包地址' });
  }

  const addr = wallet_address.toLowerCase().trim();
  const bets = read('bets');
  const bet = bets.find(b => b.id === betId && b.address.toLowerCase() === addr);
  if (!bet) return res.status(404).json({ code:1, msg:'投注不存在或不属于您' });
  if (bet.status !== 'pending') return res.status(400).json({ code:1, msg:'只能取消待结算的投注' });

  // Refund to balance
  const users = read('users');
  const user = users.find(u => u.address.toLowerCase() === addr);
  if (user) {
    user.balance = (user.balance || 0) + (bet.amount || 0);
    user.frozen_bet = Math.max(0, (user.frozen_bet || 0) - (bet.amount || 0));
    write('users', users);
  }

  bet.status = 'cancelled';
  bet.cancelled_at = new Date().toISOString();
  write('bets', bets);

  res.json({ code:0, msg:'投注已取消，金额已退回', data: { bet_id: betId, refunded: bet.amount } });
}));

// GET /api/user/transactions?wallet=0x...&type=all|deposit|withdraw|bet
app.get('/api/user/transactions', asyncHandler((req, res) => {
  const addr = (req.query.wallet || '').toLowerCase().trim();
  if (!isValidWallet(addr)) return res.status(400).json({ code:1, msg:'无效的钱包地址' });
  const type = req.query.type || 'all';
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  const txs = [];

  // Deposits
  if (type === 'all' || type === 'deposit') {
    read('deposits').filter(d => d.address.toLowerCase() === addr).forEach(d => {
      txs.push({ type:'deposit', id:d.id, amount:d.amount, status:d.status, tx_hash:d.tx_hash, created_at:d.created_at });
    });
  }

  // Withdrawals
  if (type === 'all' || type === 'withdraw') {
    read('withdrawals').filter(w => w.address.toLowerCase() === addr).forEach(w => {
      txs.push({ type:'withdraw', id:w.id, amount:-w.amount, status:w.status, to_address:w.to_address, created_at:w.created_at });
    });
  }

  // Bets
  if (type === 'all' || type === 'bet') {
    read('bets').filter(b => b.address.toLowerCase() === addr).forEach(b => {
      const result = b.status === 'won' ? b.potential_win : (b.status === 'lost' || b.status === 'cancelled' ? -(b.amount || 0) : 0);
      txs.push({
        type:'bet', id:b.id, game_type:b.game_type, team_name:b.team_name,
        amount: b.status === 'pending' ? -(b.amount || 0) : result,
        status:b.status, odds:b.odds, created_at:b.created_at, settled_at:b.settled_at,
      });
    });
  }

  // Sort by time desc, limit
  txs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const sliced = txs.slice(0, limit);

  res.json({ code:0, data: { transactions: sliced, total: txs.length } });
}));

// ═══════════════════════════════════════════════════
//  MARKET DATA ENDPOINTS (K-line & Orderbook)
// ═══════════════════════════════════════════════════

// GET /api/market/kline?symbol=BTCUSD&interval=1h&limit=100
// Returns mock candlestick OHLCV data
app.get('/api/market/kline', asyncHandler((req, res) => {
  const symbol = (req.query.symbol || 'BTCUSD').toUpperCase();
  const interval = req.query.interval || '1h';
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);

  const klines = generateMockKlines(symbol, interval, limit);
  res.json({
    code: 0,
    data: {
      symbol,
      interval,
      klines,
    },
  });
}));

// GET /api/market/orderbook?symbol=BTCUSD&depth=20
// Returns mock orderbook data
app.get('/api/market/orderbook', asyncHandler((req, res) => {
  const symbol = (req.query.symbol || 'BTCUSD').toUpperCase();
  const depth = Math.min(parseInt(req.query.depth, 10) || 20, 100);

  const orderbook = generateMockOrderbook(symbol, depth);
  res.json({
    code: 0,
    data: {
      symbol,
      ...orderbook,
    },
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

// ── Create HTTP Server & Attach Socket.IO ─────────
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      if (ALLOWED_ORIGIN_SUFFIXES.some(s => origin.endsWith(s))) return callback(null, true);
      callback(null, false);
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// ── WebSocket Connection Handler ──────────────────
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  // Send initial data on connect
  socket.emit('kline_update', {
    symbol: 'BTCUSD',
    interval: '1h',
    klines: generateMockKlines('BTCUSD', '1h', 50),
    timestamp: Date.now(),
  });

  socket.emit('odds_update', {
    matches: generateMockOdds(),
    timestamp: Date.now(),
  });

  socket.emit('pool_update', generateMockPool());

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// ── Periodic WebSocket Emissions ──────────────────
// K-line update every 5 seconds
const klineInterval = setInterval(() => {
  const klines = generateMockKlines('BTCUSD', '1h', 50);
  io.emit('kline_update', {
    symbol: 'BTCUSD',
    interval: '1h',
    klines,
    timestamp: Date.now(),
  });
}, 5000);

// Odds update every 10 seconds
const oddsInterval = setInterval(() => {
  io.emit('odds_update', {
    matches: generateMockOdds(),
    timestamp: Date.now(),
  });
}, 10000);

// Pool update every 30 seconds
const poolInterval = setInterval(() => {
  io.emit('pool_update', generateMockPool());
}, 30000);

// ── Graceful Shutdown ─────────────────────────────
let _shuttingDown = false;
function gracefulShutdown(signal) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log(`\n[SHUTDOWN] Received ${signal}. Closing gracefully...`);
  clearInterval(klineInterval);
  clearInterval(oddsInterval);
  clearInterval(poolInterval);
  io.close(() => {
    console.log('[SHUTDOWN] Socket.IO closed.');
    server.close(() => {
      console.log('[SHUTDOWN] HTTP server closed.');
      process.exit(0);
    });
  });
  // Force exit after 10s
  setTimeout(() => {
    console.error('[SHUTDOWN] Timed out, forcing exit.');
    process.exit(1);
  }, 10000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Resilience: catch uncaught exceptions to prevent crash
process.on('uncaughtException', (err) => {
    console.error(`[${new Date().toISOString()}] UNCAUGHT: ${err.message}`, err.stack);
    if (!_shuttingDown) {
      _shuttingDown = true;
      setTimeout(() => process.exit(1), 1000);
    }
});
process.on('unhandledRejection', (reason) => {
    console.error(`[${new Date().toISOString()}] UNHANDLED REJECTION:`, reason);
});

try {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('PORT=' + PORT + ' STARTED');
  });
  server.on('error', (err) => {
    console.error('LISTEN ERROR:', err.message);
    process.exit(1);
  });
} catch(e) {
  console.error('STARTUP CRASH:', e.message);
  process.exit(1);
}
