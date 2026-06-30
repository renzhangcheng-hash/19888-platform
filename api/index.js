// Vercel Serverless API — wraps Express backend
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const DATA_DIR = '/tmp/data';

app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// Ensure data dir
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Helpers
function read(name, def = []) {
  const f = path.join(DATA_DIR, name + '.json');
  if (!fs.existsSync(f)) return def;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; }
}
function write(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, name + '.json'), JSON.stringify(data, null, 2));
}

// Seed
function seed() {
  if (read('matches').length > 0) return;
  const now = new Date();
  const matches = [
    { id:1, league:'法甲 第38轮', home:'巴黎圣日耳曼', away:'马赛', time:'2026-06-03 03:00', odds_home:1.82, odds_draw:3.50, odds_away:4.20, status:'live', venue:'王子公园球场', referee:'克莱芒·蒂尔潘' },
    { id:2, league:'英超 第38轮', home:'曼城', away:'利物浦', time:'2026-06-04 00:30', odds_home:2.10, odds_draw:3.30, odds_away:3.40, status:'upcoming', venue:'伊蒂哈德球场', referee:'迈克尔·奥利弗' },
    { id:3, league:'西甲 第38轮', home:'皇马', away:'巴萨', time:'2026-06-05 04:00', odds_home:2.40, odds_draw:3.20, odds_away:2.90, status:'upcoming', venue:'伯纳乌球场', referee:'安东尼奥·马特乌' },
    { id:4, league:'意甲 第38轮', home:'尤文图斯', away:'国米', time:'2026-06-05 02:45', odds_home:2.15, odds_draw:3.10, odds_away:3.50, status:'upcoming', venue:'安联球场', referee:'达尼埃莱·奥萨托' },
    { id:5, league:'德甲 第34轮', home:'拜仁慕尼黑', away:'多特蒙德', time:'2026-06-06 01:30', odds_home:1.95, odds_draw:3.60, odds_away:3.80, status:'upcoming', venue:'安联竞技场', referee:'菲利克斯·茨瓦耶' },
    { id:6, league:'国际友谊赛', home:'巴西', away:'阿根廷', time:'2026-06-07 08:00', odds_home:2.50, odds_draw:3.00, odds_away:2.80, status:'upcoming', venue:'马拉卡纳球场', referee:'赫苏斯·巴伦苏埃拉' },
    { id:7, league:'欧冠 决赛', home:'拜仁慕尼黑', away:'巴黎圣日耳曼', time:'2026-06-08 03:00', odds_home:2.20, odds_draw:3.40, odds_away:3.10, status:'upcoming', venue:'温布利大球场', referee:'丹尼·马克列' },
    { id:8, league:'英超 第37轮', home:'阿森纳', away:'切尔西', time:'2026-06-08 00:30', odds_home:2.05, odds_draw:3.25, odds_away:3.60, status:'upcoming', venue:'酋长球场', referee:'保罗·蒂尔尼' },
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
  write('admins', [{ username: 'admin', password: crypto.createHash('sha256').update('19888admin' + '19888salt').digest('hex') }]);
}

seed();

// Routes
app.get('/api/status', (req, res) => res.json({ status:'ok', name:'19888 API' }));

app.get('/api/matches', (req, res) => res.json({ code:0, data: read('matches') }));
app.get('/api/matches/:id', (req, res) => {
  const m = read('matches').find(x => x.id == req.params.id);
  if (!m) return res.status(404).json({ code:1, msg:'Not found' });
  const cells = ['0:0','0:1','0:2','0:3','1:0','1:1','1:2','1:3','2:0','2:1','2:2','2:3','3:0','3:1','3:2','3:3','主4+','客4+'];
  res.json({ code:0, data: { ...m, grid_18: cells.map(s => ({ score:s, odds:+(1.5+Math.random()*8).toFixed(2) })) } });
});

app.get('/api/champion-bet/odds', (req, res) => {
  const bets = read('bets');
  const totalBet = bets.reduce((s,b) => s + (b.amount||0), 0);
  const totalWin = bets.reduce((s,b) => s + (b.amount||0)*(b.odds||0), 0);
  res.json({ code:0, data: { odds:read('champion_teams'), total_bet:totalBet, total_potential_win:+totalWin.toFixed(2) } });
});

app.post('/api/champion-bet/place', (req, res) => {
  const { team_id, bet_type, amount, wallet_address } = req.body;
  if (!team_id || ![1,2].includes(+bet_type) || +amount < 1) return res.status(400).json({ code:1, msg:'参数错误' });
  const team = read('champion_teams').find(t => t.id == +team_id);
  if (!team) return res.status(404).json({ code:1, msg:'球队不存在' });
  const odds = +bet_type === 1 ? team.championship_odds : team.runner_up_odds;
  const bets = read('bets');
  const bet = { id:(bets[bets.length-1]?.id||0)+1, address:(wallet_address||'').toLowerCase(), team_id:+team_id, team_name:team.name, bet_type:+bet_type, bet_type_name:+bet_type===1?'冠军':'亚军', amount:+amount, odds, potential_win:+(+amount*odds).toFixed(2), status:'pending', created_at:new Date().toISOString() };
  bets.push(bet);
  write('bets', bets);
  res.json({ code:0, msg:'投注成功', data:{ bet_id:bet.id } });
});

app.get('/api/bets', (req, res) => {
  const addr = (req.query.address||'').toLowerCase();
  res.json({ code:0, data: read('bets').filter(b => b.address === addr).reverse() });
});

app.post('/api/wallet/connect', (req, res) => {
  const addr = (req.body.wallet_address||'').toLowerCase().trim();
  if (addr.length < 10) return res.status(400).json({ code:1, msg:'无效地址' });
  const users = read('users');
  let user = users.find(u => u.address === addr), type = 'login';
  if (!user) { users.push({ address:addr, balance:0, created_at:new Date().toISOString() }); type = 'register'; write('users', users); }
  res.json({ code:0, msg: type==='register'?'注册成功':'登录成功', data:{ address:addr, type } });
});

app.get('/api/user/balance', (req, res) => {
  const u = read('users').find(x => x.address === (req.query.address||'').toLowerCase());
  res.json({ code:0, data:{ balance: u?.balance||0 } });
});

// Admin
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '19888-admin-secret-token';
if (!process.env.ADMIN_TOKEN) {
  console.warn('⚠️  WARNING: ADMIN_TOKEN not set — using default. Set ADMIN_TOKEN env var in production.');
}
function adminAuth(req, res, next) {
  if ((req.headers.authorization||'').replace('Bearer ','') !== ADMIN_TOKEN) return res.status(401).json({ code:1 });
  next();
}
app.post('/api/admin/login', (req, res) => {
  const admins = read('admins');
  const admin = admins.find(a => a.username === req.body.username);
  if (!admin || admin.password !== crypto.createHash('sha256').update((req.body.password||'')+'19888salt').digest('hex'))
    return res.status(401).json({ code:1, msg:'用户名或密码错误' });
  res.json({ code:0, data:{ token:ADMIN_TOKEN } });
});
app.get('/api/admin/stats', adminAuth, (req, res) => {
  res.json({ code:0, data:{ totalMatches:read('matches').length, totalBets:read('bets').length, totalVolume:+read('bets').reduce((s,b)=>s+(b.amount||0),0).toFixed(2), totalUsers:read('users').length } });
});
app.get('/api/admin/matches', adminAuth, (req, res) => res.json({ code:0, data:read('matches') }));
app.post('/api/admin/matches', adminAuth, (req, res) => {
  const matches = read('matches');
  const m = { id:(matches[matches.length-1]?.id||0)+1, league:req.body.league||'', home:req.body.home||'', away:req.body.away||'', time:req.body.time||'', odds_home:+req.body.odds_home||1.80, odds_draw:+req.body.odds_draw||3.50, odds_away:+req.body.odds_away||4.00, status:req.body.status||'upcoming', venue:req.body.venue||'', referee:req.body.referee||'' };
  matches.push(m); write('matches', matches);
  res.json({ code:0, data:m });
});
app.put('/api/admin/matches/:id', adminAuth, (req, res) => {
  const matches = read('matches');
  const idx = matches.findIndex(m => m.id == req.params.id);
  if (idx === -1) return res.status(404).json({ code:1 });
  ['league','home','away','time','odds_home','odds_draw','odds_away','status','venue','referee'].forEach(k => { if (req.body[k] !== undefined) matches[idx][k] = k.startsWith('odds_') ? +req.body[k] : req.body[k]; });
  write('matches', matches);
  res.json({ code:0, data:matches[idx] });
});
app.delete('/api/admin/matches/:id', adminAuth, (req, res) => {
  const before = read('matches').length;
  write('matches', read('matches').filter(m => m.id != req.params.id));
  res.json({ code:0, msg: read('matches').length < before ? '已删除' : '不存在' });
});
app.get('/api/admin/teams', adminAuth, (req, res) => res.json({ code:0, data:read('champion_teams') }));
app.put('/api/admin/teams/:id', adminAuth, (req, res) => {
  const teams = read('champion_teams');
  const t = teams.find(x => x.id == req.params.id);
  if (!t) return res.status(404).json({ code:1 });
  if (req.body.championship_odds !== undefined) t.championship_odds = +req.body.championship_odds;
  if (req.body.runner_up_odds !== undefined) t.runner_up_odds = +req.body.runner_up_odds;
  write('champion_teams', teams);
  res.json({ code:0, data:t });
});
app.get('/api/admin/bets', adminAuth, (req, res) => res.json({ code:0, data:read('bets').reverse() }));

module.exports = app;
