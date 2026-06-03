/**
 * 19888 API Server — Express.js
 * Full CRUD: matches, teams, odds, bets, users, wallet auth
 * Storage: JSON files (zero-dependency persistence)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3088;
const DATA_DIR = path.join(__dirname, 'backend', 'data');

// ── Setup ─────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Serve static frontend
app.use(express.static(path.join(__dirname)));

// Ensure data dir
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── JSON File Helpers ─────────────────────────────
function read(name, def = []) {
  const f = path.join(DATA_DIR, name + '.json');
  if (!fs.existsSync(f)) return def;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; }
}
function write(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, name + '.json'), JSON.stringify(data, null, 2));
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

// ═══════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════

// Health check + serve index
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.get('/api/status', (req, res) => {
  res.json({ status:'ok', version:'1.0.0', name:'19888 API' });
});

// ── Wallet Auth ───────────────────────────────────
app.post('/api/wallet/connect', (req, res) => {
  const addr = (req.body.wallet_address || '').toLowerCase().trim();
  if (addr.length < 10) return res.status(400).json({ code:1, msg:'无效的钱包地址' });

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
});

// ── Matches ───────────────────────────────────────
app.get('/api/matches', (req, res) => {
  const matches = read('matches').map(m => ({
    ...m,
    home_logo: teamLogoUrl(m.home),
    away_logo: teamLogoUrl(m.away),
  }));
  res.json({ code:0, data: matches });
});

app.get('/api/matches/:id', (req, res) => {
  const match = read('matches').find(m => m.id == req.params.id);
  if (!match) return res.status(404).json({ code:1, msg:'比赛不存在' });
  res.json({ code:0, data: {
    ...match,
    home_logo: teamLogoUrl(match.home),
    away_logo: teamLogoUrl(match.away),
    grid_18: generate18Grid(),
  }});
});

// ── Champion Bet ──────────────────────────────────
app.get('/api/champion-bet/odds', (req, res) => {
  const teams = read('champion_teams').map(t => ({
    ...t,
    logo: teamLogoUrl(t.name),
  }));
  const bets = read('bets');
  const totalBet = bets.reduce((s, b) => s + (b.amount || 0), 0);
  const totalWin = bets.reduce((s, b) => s + (b.amount || 0) * (b.odds || 0), 0);
  res.json({ code:0, data: { odds: teams, total_bet: totalBet, total_potential_win: +totalWin.toFixed(2) } });
});

app.post('/api/champion-bet/place', (req, res) => {
  const { team_id, bet_type, amount, wallet_address } = req.body;
  const tid = +team_id;
  const btype = +bet_type;
  const amt = +amount;
  const addr = (wallet_address || '').toLowerCase().trim();

  if (!tid) return res.status(400).json({ code:1, msg:'请选择球队' });
  if (![1,2].includes(btype)) return res.status(400).json({ code:1, msg:'投注类型无效' });
  if (amt < 1) return res.status(400).json({ code:1, msg:'最小投注 1 USDT' });
  if (addr.length < 10) return res.status(400).json({ code:1, msg:'请先连接钱包' });

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
});

// ── Bets History ──────────────────────────────────
app.get('/api/bets', (req, res) => {
  const addr = (req.query.address || '').toLowerCase().trim();
  if (addr.length < 10) return res.status(400).json({ code:1, msg:'请提供钱包地址' });

  const bets = read('bets').filter(b => b.address.toLowerCase() === addr).reverse();
  res.json({ code:0, data: bets });
});

// ── User Balance ──────────────────────────────────
app.get('/api/user/balance', (req, res) => {
  const addr = (req.query.address || '').toLowerCase().trim();
  if (addr.length < 10) return res.status(400).json({ code:1, msg:'请提供钱包地址' });

  const users = read('users');
  const user = users.find(u => u.address.toLowerCase() === addr);
  res.json({ code:0, data: { address: addr, balance: user?.balance || 0 } });
});

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
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admins = read('admins');
  const admin = admins.find(a => a.username === username);
  if (!admin || !verifyPassword(password, admin.password)) {
    return res.status(401).json({ code:1, msg:'用户名或密码错误' });
  }
  res.json({ code:0, msg:'登录成功', data: { token: ADMIN_SECRET } });
});

// ── Admin: Matches CRUD ───────────────────────────
app.get('/api/admin/matches', adminAuth, (req, res) => {
  res.json({ code:0, data: read('matches') });
});

app.post('/api/admin/matches', adminAuth, (req, res) => {
  const matches = read('matches');
  const newMatch = {
    id: (matches[matches.length - 1]?.id || 0) + 1,
    league: req.body.league || '联赛',
    home: req.body.home || '主队',
    away: req.body.away || '客队',
    time: req.body.time || new Date().toISOString().slice(0, 16).replace('T', ' '),
    odds_home: +req.body.odds_home || 1.80,
    odds_draw: +req.body.odds_draw || 3.50,
    odds_away: +req.body.odds_away || 4.00,
    status: req.body.status || 'upcoming',
  };
  matches.push(newMatch);
  write('matches', matches);
  res.json({ code:0, msg:'比赛已添加', data: newMatch });
});

app.put('/api/admin/matches/:id', adminAuth, (req, res) => {
  const matches = read('matches');
  const idx = matches.findIndex(m => m.id == req.params.id);
  if (idx === -1) return res.status(404).json({ code:1, msg:'比赛不存在' });

  const m = matches[idx];
  ['league','home','away','time','odds_home','odds_draw','odds_away','status'].forEach(k => {
    if (req.body[k] !== undefined) m[k] = k.startsWith('odds_') ? +req.body[k] : req.body[k];
  });
  write('matches', matches);
  res.json({ code:0, msg:'已更新', data: m });
});

app.delete('/api/admin/matches/:id', adminAuth, (req, res) => {
  let matches = read('matches');
  const before = matches.length;
  matches = matches.filter(m => m.id != req.params.id);
  if (matches.length === before) return res.status(404).json({ code:1, msg:'比赛不存在' });
  write('matches', matches);
  res.json({ code:0, msg:'已删除' });
});

// ── Admin: Champion Teams CRUD ────────────────────
app.get('/api/admin/teams', adminAuth, (req, res) => {
  res.json({ code:0, data: read('champion_teams') });
});

app.put('/api/admin/teams/:id', adminAuth, (req, res) => {
  const teams = read('champion_teams');
  const idx = teams.findIndex(t => t.id == req.params.id);
  if (idx === -1) return res.status(404).json({ code:1, msg:'球队不存在' });

  const t = teams[idx];
  if (req.body.championship_odds !== undefined) t.championship_odds = +req.body.championship_odds;
  if (req.body.runner_up_odds !== undefined) t.runner_up_odds = +req.body.runner_up_odds;
  write('champion_teams', teams);
  res.json({ code:0, msg:'赔率已更新', data: t });
});

// ── Admin: Bets ───────────────────────────────────
app.get('/api/admin/bets', adminAuth, (req, res) => {
  const bets = read('bets').reverse();
  res.json({ code:0, data: bets });
});

app.put('/api/admin/bets/:id/settle', adminAuth, (req, res) => {
  const bets = read('bets');
  const bet = bets.find(b => b.id == req.params.id);
  if (!bet) return res.status(404).json({ code:1, msg:'投注不存在' });

  bet.status = req.body.result === 'win' ? 'won' : 'lost';
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
});

// ── Admin: Stats ──────────────────────────────────
app.get('/api/admin/stats', adminAuth, (req, res) => {
  const matches = read('matches');
  const bets = read('bets');
  const users = read('users');
  const totalBets = bets.length;
  const totalVolume = bets.reduce((s, b) => s + (b.amount || 0), 0);
  const totalUsers = users.length;
  res.json({ code:0, data: { totalMatches: matches.length, totalBets, totalVolume: +totalVolume.toFixed(2), totalUsers } });
});

// ═══════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════
seed();

app.listen(PORT, () => {
  console.log(`\n🏆 19888 API Server running on http://localhost:${PORT}`);
  console.log(`   Frontend:  http://localhost:${PORT}/`);
  console.log(`   Admin:     http://localhost:${PORT}/admin.html`);
  console.log(`   API:       http://localhost:${PORT}/api/status\n`);
});
