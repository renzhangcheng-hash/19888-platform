
(function() {
  'use strict';

  // ── Optimistic UI: instant scale feedback on all interactive elements (<200ms)
  document.addEventListener('pointerdown', function(e) {
    var el = e.target.closest('button, [role="button"], .gt-bet-btn, .btn-primary, .btn-outline, .profile-btn-primary, .profile-btn-outline, .odds-tag, .tabbar-item, .nav-item, .date-tab, .match-list-card, .match-card, .con, .match-row');
    if (el && !el.disabled) { el.style.transform = 'scale(0.95)'; el.style.transition = 'transform 0.1s ease'; }
  }, { passive: true });
  document.addEventListener('pointerup', function(e) {
    var el = e.target.closest('button, [role="button"], .gt-bet-btn, .btn-primary, .btn-outline, .profile-btn-primary, .profile-btn-outline, .odds-tag, .tabbar-item, .nav-item, .date-tab, .match-list-card, .match-card, .con, .match-row');
    if (el) { el.style.transform = ''; }
  }, { passive: true });
  document.addEventListener('pointercancel', function(e) {
    var el = e.target.closest('button, [role="button"], .gt-bet-btn, .btn-primary, .btn-outline, .profile-btn-primary, .profile-btn-outline');
    if (el) { el.style.transform = ''; }
  }, { passive: true });

  const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? '/api'
    : 'https://19888-platform.onrender.com/api';
  let apiAvailable = false;
  let walletAddress = null;
  let walletProvider = null;
  let currentPage = 'home';
  let currentTab = 'recommend';
  let currentLang = 'cn';
  let currentFilter = 'all';
  let pageHistory = ['home'];
  const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
  let usdtBalance = 0;
  let currentDetailMatchId = null;
  const CONTRACT_USDT = '0x98f1609261A1BE6B25e33FBDBa409dF93CD083cf';
  const CONTRACT_POOL = '0x02fda9c22d6f8733bA507Ed1019d67571626e9DA';
  const CONTRACT_ANTI = '0x865C5C27c75eFE75a18EBC0B51F2CA0aEb6597aD';
  const CONTRACT_CHAMP = '0x938246dee823cEFe5574E4d195EfAD0467b2ED71';
  let walletSigner = null;
  let ethersReady = (typeof ethers !== 'undefined');

  function loadEthersAndInit(cb) {
    if (ethersReady) { if (cb) cb(); return; }
    var s = document.createElement('script');
    s.src = 'js/vendor/ethers-6.13.umd.min.js';
    s.onload = function() { ethersReady = true; if (cb) cb(); };
    s.onerror = function() { ethersReady = false; };
    document.head.appendChild(s);
  }
  function getContractABI(name) {
    switch (name) {
      case 'USDT': return [
        { type:'function', name:'transfer', inputs:[{name:'to',type:'address'},{name:'amount',type:'uint256'}], outputs:[{type:'bool'}], stateMutability:'nonpayable' },
        { type:'function', name:'approve', inputs:[{name:'spender',type:'address'},{name:'amount',type:'uint256'}], outputs:[{type:'bool'}], stateMutability:'nonpayable' },
        { type:'function', name:'balanceOf', inputs:[{name:'owner',type:'address'}], outputs:[{type:'uint256'}], stateMutability:'view' }
      ];
      case 'POOL': return [
        { type:'function', name:'deposit', inputs:[{name:'amount',type:'uint256'}], outputs:[], stateMutability:'nonpayable' },
        { type:'function', name:'withdraw', inputs:[{name:'amount',type:'uint256'}], outputs:[], stateMutability:'nonpayable' },
        { type:'function', name:'userBalance', inputs:[{name:'user',type:'address'}], outputs:[{type:'uint256'}], stateMutability:'view' }
      ];
      case 'ANTI': return [
        { type:'function', name:'placeBet', inputs:[{name:'matchId',type:'uint256'},{name:'cell',type:'uint8'},{name:'amount',type:'uint256'}], outputs:[], stateMutability:'nonpayable' },
        { type:'function', name:'createMatch', inputs:[{name:'matchId',type:'uint256'},{name:'homeTeam',type:'string'},{name:'awayTeam',type:'string'},{name:'matchTime',type:'uint256'}], outputs:[], stateMutability:'nonpayable' }
      ];
      case 'CHAMP': return [
        { type:'function', name:'placeBet', inputs:[{name:'teamId',type:'uint256'},{name:'betType',type:'uint8'},{name:'amount',type:'uint256'}], outputs:[], stateMutability:'nonpayable' },
        { type:'function', name:'setResult', inputs:[{name:'teamId',type:'uint256'},{name:'resultType',type:'uint8'}], outputs:[], stateMutability:'nonpayable' }
      ];
      default: return [];
    }
  }
  async function contractApprove(spender, amount) {
    if (!ethersReady || !walletProvider) return null;
    try {
      let abi = getContractABI('USDT');
      let parsed = ethers.parseUnits(String(amount), 18);
      let data = new ethers.Interface(abi).encodeFunctionData('approve', [spender, parsed]);
      let tx = await walletProvider.request({ method:'eth_sendTransaction', params:[{ from:walletAddress, to:CONTRACT_USDT, data:data }] });
      return tx;
    } catch(e) { return null; }
  }

  async function contractDeposit(amount) {
    if (!ethersReady || !walletProvider) { showToast('链上交互不可用，请确保已连接钱包'); return null; }
    try {
      showToast('请在钱包中确认授权...');
      let approveTx = await contractApprove(CONTRACT_POOL, amount);
      if (!approveTx) { showToast('授权失败或已取消'); return null; }
      showToast('授权成功，请在钱包中确认充值...');
      let abi = getContractABI('POOL');
      let parsed = ethers.parseUnits(String(amount), 18);
      let data = new ethers.Interface(abi).encodeFunctionData('deposit', [parsed]);
      let tx = await walletProvider.request({ method:'eth_sendTransaction', params:[{ from:walletAddress, to:CONTRACT_POOL, data:data }] });
      showToast('链上充值已提交！TX: ' + tx.substring(0, 14) + '...');
      refreshBalance();
      return tx;
    } catch(e) { showToast('充值失败: ' + (e.message || '未知错误')); return null; }
  }

  async function contractWithdraw(amount) {
    if (!ethersReady || !walletProvider) { showToast('链上交互不可用'); return null; }
    try {
      showToast('请在钱包中确认提现...');
      let abi = getContractABI('POOL');
      let parsed = ethers.parseUnits(String(amount), 18);
      let data = new ethers.Interface(abi).encodeFunctionData('withdraw', [parsed]);
      let tx = await walletProvider.request({ method:'eth_sendTransaction', params:[{ from:walletAddress, to:CONTRACT_POOL, data:data }] });
      showToast('链上提现已提交！TX: ' + tx.substring(0, 14) + '...');
      refreshBalance();
      return tx;
    } catch(e) { showToast('提现失败: ' + (e.message || '未知错误')); return null; }
  }

  async function contractPlaceAntiBet(matchId, cell, amount) {
    if (!ethersReady || !walletProvider) return null;
    try {
      let approveTx = await contractApprove(CONTRACT_ANTI, amount);
      if (!approveTx) return null;
      let abi = getContractABI('ANTI');
      let parsed = ethers.parseUnits(String(amount), 18);
      let data = new ethers.Interface(abi).encodeFunctionData('placeBet', [BigInt(matchId), cell, parsed]);
      let tx = await walletProvider.request({ method:'eth_sendTransaction', params:[{ from:walletAddress, to:CONTRACT_ANTI, data:data }] });
      return tx;
    } catch(e) { return null; }
  }

  async function contractPlaceChampionBet(teamId, betType, amount) {
    if (!ethersReady || !walletProvider) return null;
    try {
      let approveTx = await contractApprove(CONTRACT_CHAMP, amount);
      if (!approveTx) return null;
      let abi = getContractABI('CHAMP');
      let parsed = ethers.parseUnits(String(amount), 18);
      let data = new ethers.Interface(abi).encodeFunctionData('placeBet', [BigInt(teamId), betType, parsed]);
      let tx = await walletProvider.request({ method:'eth_sendTransaction', params:[{ from:walletAddress, to:CONTRACT_CHAMP, data:data }] });
      return tx;
    } catch(e) { return null; }
  }
  async function getUSDTBalance(address) {
    try {
      let r = await fetch(SEPOLIA_RPC, {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:CONTRACT_USDT,data:'0x70a08231000000000000000000000000'+address.replace('0x','')},'latest']})});
      let j = await r.json();
      if (j.result) return parseInt(j.result,16)/1e18;
    } catch(e) {}
    return 0;
  }

  async function refreshBalance() {
    if (!walletAddress) return;
    let bal = await getUSDTBalance(walletAddress);
    usdtBalance = bal;
    let el = document.getElementById('profile-balance');
    if (el) el.textContent = bal.toFixed(2) + ' USDT';
    return bal;
  }
  function showDepositModal() {
    let div = document.getElementById('deposit-modal');
    if (!div) {
      div = document.createElement('div'); div.id = 'deposit-modal'; div.className = 'dialog-overlay';
      div.innerHTML = '<div class="dialog" style="max-width:340px"><div class="dialog-header">💳 USDT 充值</div><div class="dialog-body" style="text-align:center;padding:20px"><p style="color:var(--text2);font-size:12px;margin-bottom:12px">向以下地址转账 USDT（Sepolia）</p><div style="background:#F7F8FA;padding:12px;border-radius:8px;word-break:break-all;font-size:11px;margin-bottom:12px;user-select:all">'+CONTRACT_POOL+'</div><p style="color:var(--red);font-size:11px">⚠️ 仅支持 Sepolia 链 USDT</p><p style="color:var(--red);font-size:11px">其他链转账将永久丢失</p></div><div class="dialog-footer"><button class="btn-cancel" onclick="this.closest(\'.dialog-overlay\').style.display=\'none\'">关闭</button></div></div>';
      document.body.appendChild(div);
    }
    div.style.display = 'flex';
    div.onclick = function(e) { if (e.target === this) this.style.display = 'none'; };
  }

  function showWithdrawModal() {
    let div = document.getElementById('withdraw-modal');
    if (!div) {
      div = document.createElement('div'); div.id = 'withdraw-modal'; div.className = 'dialog-overlay';
      div.innerHTML = '<div class="dialog"><div class="dialog-header">📤 USDT 提现</div><div class="dialog-body" style="padding:15px"><label style="font-size:12px">提现地址</label><input type="text" id="w-addr" placeholder="0x..." style="width:100%;padding:10px;background:#F7F8FA;border:1px solid var(--border);border-radius:8px;margin-bottom:10px;font-size:13px"><label style="font-size:12px">金额 (USDT)</label><input type="number" id="w-amount" placeholder="100" step="0.01" min="10" style="width:100%;padding:10px;background:#F7F8FA;border:1px solid var(--border);border-radius:8px;margin-bottom:10px;font-size:13px"><p style="font-size:11px;color:var(--text3)">可用余额: <span id="w-balance">0.00</span> USDT</p><p style="font-size:11px;color:var(--red);margin-top:8px">⚠️ 最低提现 10 USDT</p></div><div class="dialog-footer"><button class="btn-cancel" onclick="this.closest(\'.dialog-overlay\').style.display=\'none\'">取消</button><button class="btn-confirm" onclick="app.submitWithdraw()">确认提现</button></div></div>';
      document.body.appendChild(div);
    }
    document.getElementById('w-balance').textContent = usdtBalance.toFixed(2);
    div.style.display = 'flex';
    div.onclick = function(e) { if (e.target === this) this.style.display = 'none'; };
  }

  function submitWithdraw() {
    let addr = document.getElementById('w-addr').value.trim();
    let amount = parseFloat(document.getElementById('w-amount').value);
    if (!addr || addr.length < 10) { showToast('请输入有效地址'); return; }
    if (isNaN(amount) || amount < 10) { showToast('最低提现 10 USDT'); return; }
    let records = JSON.parse(localStorage.getItem('19888_withdraw_requests') || '[]');
    records.push({ address:addr, amount:amount, wallet:walletAddress, time:new Date().toISOString(), status:'pending' });
    localStorage.setItem('19888_withdraw_requests', JSON.stringify(records));
    showToast('提现申请已提交！管理员审核后到账');
    document.getElementById('withdraw-modal').style.display = 'none';
  }

  let betRecords = [];
  let userBalance = 0;
  let betCart = [];
  let oddsFlashTimer = null;
  let _cleanupHandlers = [];
  let oddsFlashInterval = null;
  let pendingApiCalls = 0;
  // ── requestIdleCallback helper for deferring non-critical work
  function idleTask(fn, timeout) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(fn, { timeout: timeout || 2000 });
    } else {
      setTimeout(fn, 0);
    }
  }


  function showLoading(msg) {
    msg = msg || '加载中...';
    let overlay = document.getElementById('loading-overlay');
    let textEl = document.getElementById('loading-text');
    if (overlay) overlay.classList.add('show');
    if (textEl) textEl.textContent = msg;
    pendingApiCalls++;
  }

  function hideLoading() {
    pendingApiCalls = Math.max(0, pendingApiCalls - 1);
    if (pendingApiCalls <= 0) {
      pendingApiCalls = 0;
      let overlay = document.getElementById('loading-overlay');
      if (overlay) overlay.classList.remove('show');
    }
  }

  async function apiCall(endpoint, opts, showSpinner) {
    opts = opts || {};
    if (showSpinner !== false) showLoading();
    try {
      let controller = new AbortController();
      let timeout = setTimeout(function() { controller.abort(); }, 3000);
      let res = await fetch(API_BASE + endpoint, {
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        method: opts.method || 'GET',
        body: opts.body || undefined,
        signal: controller.signal
      });
      clearTimeout(timeout);
      let data = await res.json();
      apiAvailable = true;
      return data;
    } catch(e) {
      apiAvailable = false;
      return null;
    } finally {
      if (showSpinner !== false) hideLoading();
    }
  }
  function debounce(fn, delay) {
    delay = delay || 100;
    var timer = null;
    return function() {
      var context = this, args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function() { fn.apply(context, args); }, delay);
    };
  }

  const FLAGS = {
    "巴西":"\uD83C\uDDE7\uD83C\uDDF7","阿根廷":"\uD83C\uDDE6\uD83C\uDDF7","法国":"\uD83C\uDDEB\uD83C\uDDF7","英格兰":"\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67\uDB40\uDC7F",
    "西班牙":"\uD83C\uDDEA\uD83C\uDDF8","德国":"\uD83C\uDDE9\uD83C\uDDEA","葡萄牙":"\uD83C\uDDF5\uD83C\uDDF9","荷兰":"\uD83C\uDDF3\uD83C\uDDF1",
    "克罗地亚":"\uD83C\uDDED\uD83C\uDDF7","比利时":"\uD83C\uDDE7\uD83C\uDDEA","格鲁吉亚":"\uD83C\uDDEC\uD83C\uDDEA","罗马尼亚":"\uD83C\uDDF7\uD83C\uDDF4",
    "摩洛哥":"\uD83C\uDDF2\uD83C\uDDE6","马达加斯加":"\uD83C\uDDF2\uD83C\uDDEC","威尔士":"\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73\uDB40\uDC7F","加纳":"\uD83C\uDDEC\uD83C\uDDED",
  };

  function teamLogoUrl(name, ext) {
    let slug = name.replace(/[^a-zA-Z\u4e00-\u9fff]/g, '_').toLowerCase();
    return 'img/teams/' + slug + '.' + (ext || 'png');
  }

  function teamLogoImg(name, size) {
    let s = size || 50;
    if (FLAGS[name]) {
      return '<span style="display:inline-flex;align-items:center;justify-content:center;width:' + s + 'px;height:' + s + 'px;border-radius:50%;background:linear-gradient(135deg,#E8EBF5,#DDE1F0);font-size:' + Math.round(s*0.58) + 'px;flex-shrink:0;overflow:hidden">' + FLAGS[name] + '</span>';
    }
    let webpUrl = teamLogoUrl(name, 'webp');
    let pngUrl = teamLogoUrl(name, 'png');
    let initials = name.replace(/\s/g,'').slice(0,3).toUpperCase() || '⚽';
    let fallback = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="%23E8EBF5"/><text x="50" y="58" text-anchor="middle" font-size="' + (initials.length > 2 ? '28' : '38') + '" fill="%23888" font-family="Arial,sans-serif" font-weight="900">' + initials + '</text></svg>');
    return '<picture style=\"display:contents\">' +
      '<source srcset="' + webpUrl + '" type="image/webp">' +
      '<img src="' + pngUrl + '" width="' + s + '" height="' + s + '" style="border-radius:50%;object-fit:contain;background:#E8EBF5;flex-shrink:0" alt="' + name + ' team logo" title="' + name + '" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'' + fallback + '\'">' +
      '</picture>';
  }
  const mockMatches = [
    { id:1, league:'法甲 第38轮', home:'巴黎圣日耳曼', away:'马赛', time:'2026-06-03 03:00', odds_home:1.82, odds_draw:3.50, odds_away:4.20, status:'live', venue:'王子公园球场', referee:'克莱芒·蒂尔潘' },
    { id:2, league:'英超 第38轮', home:'曼城', away:'利物浦', time:'2026-06-04 00:30', odds_home:2.10, odds_draw:3.30, odds_away:3.40, status:'upcoming', venue:'伊蒂哈德球场', referee:'迈克尔·奥利弗' },
    { id:3, league:'西甲 第38轮', home:'皇马', away:'巴萨', time:'2026-06-05 04:00', odds_home:2.40, odds_draw:3.20, odds_away:2.90, status:'upcoming', venue:'伯纳乌球场', referee:'安东尼奥·马特乌' },
    { id:4, league:'意甲 第38轮', home:'尤文图斯', away:'国米', time:'2026-06-05 02:45', odds_home:2.15, odds_draw:3.10, odds_away:3.50, status:'upcoming', venue:'安联球场', referee:'达尼埃莱·奥萨托' },
    { id:5, league:'德甲 第34轮', home:'拜仁慕尼黑', away:'多特蒙德', time:'2026-06-06 01:30', odds_home:1.95, odds_draw:3.60, odds_away:3.80, status:'upcoming', venue:'安联竞技场', referee:'菲利克斯·茨瓦耶' },
    { id:6, league:'国际友谊赛', home:'巴西', away:'阿根廷', time:'2026-06-07 08:00', odds_home:2.50, odds_draw:3.00, odds_away:2.80, status:'upcoming', venue:'马拉卡纳球场', referee:'赫苏斯·巴伦苏埃拉' },
    { id:7, league:'欧冠 决赛', home:'拜仁慕尼黑', away:'巴黎圣日耳曼', time:'2026-06-08 03:00', odds_home:2.20, odds_draw:3.40, odds_away:3.10, status:'upcoming', venue:'温布利大球场', referee:'丹尼·马克列' },
    { id:8, league:'英超 第37轮', home:'阿森纳', away:'切尔西', time:'2026-06-08 00:30', odds_home:2.05, odds_draw:3.25, odds_away:3.60, status:'upcoming', venue:'酋长球场', referee:'保罗·蒂尔尼' },
    { id:9, league:'法甲 第37轮', home:'里昂', away:'摩纳哥', time:'2026-06-09 03:00', odds_home:2.30, odds_draw:3.40, odds_away:3.00, status:'upcoming', venue:'安盟球场', referee:'伯努瓦·巴斯蒂安' },
    { id:10, league:'西甲 第37轮', home:'马德里竞技', away:'塞维利亚', time:'2026-06-09 04:00', odds_home:1.75, odds_draw:3.60, odds_away:4.80, status:'upcoming', venue:'大都会球场', referee:'卡洛斯·德尔塞罗' },
  ];

  const mockChampionTeams = [
    { id:1, name:'巴西', championship_odds:5.50, runner_up_odds:4.20 },
    { id:2, name:'法国', championship_odds:6.00, runner_up_odds:4.50 },
    { id:3, name:'阿根廷', championship_odds:7.50, runner_up_odds:5.50 },
    { id:4, name:'英格兰', championship_odds:8.00, runner_up_odds:5.80 },
    { id:5, name:'西班牙', championship_odds:9.00, runner_up_odds:6.50 },
    { id:6, name:'德国', championship_odds:10.00, runner_up_odds:7.00 },
    { id:7, name:'葡萄牙', championship_odds:12.00, runner_up_odds:8.00 },
    { id:8, name:'荷兰', championship_odds:15.00, runner_up_odds:9.50 },
  ];

  const scoreGrid18 = ['0:0','0:1','0:2','0:3','1:0','1:1','1:2','1:3','2:0','2:1','2:2','2:3','3:0','3:1','3:2','3:3','主4+','客4+'];
  function scoreToCellIndex(score) {
    var idx = scoreGrid18.indexOf(score);
    return idx >= 0 ? idx : -1;
  }

  const SCORE_PROB_DIST = {
    '1:1': 0.15, '2:1': 0.12, '1:0': 0.10, '2:0': 0.08,
    '0:0': 0.07, '1:2': 0.06, '2:2': 0.05, '3:1': 0.04,
    '0:1': 0.04, '3:0': 0.03, '0:2': 0.03, '3:2': 0.03,
    '1:3': 0.02, '2:3': 0.02, '0:3': 0.015, '3:3': 0.01,
    '主4+': 0.005, '客4+': 0.003
  };
  function normalizeProbs(dist) {
    let sum = 0;
    for (let k in dist) { if (dist.hasOwnProperty(k)) sum += dist[k]; }
    let norm = {};
    for (let k in dist) { if (dist.hasOwnProperty(k)) norm[k] = dist[k] / sum; }
    return norm;
  }

  const SCORE_PROB_NORM = normalizeProbs(SCORE_PROB_DIST);

  function computeAntiOdds(score) {
    let prob = SCORE_PROB_NORM[score] || 0.01;
    let loseProb = Math.max(1 - prob, 0.001); // probability you lose (exact match)
    let rawOdds = 1 / loseProb;
    let odds = rawOdds * 0.85; // House Edge 15%
    return Math.max(1.01, +odds.toFixed(2));
  }

  function computeCorrectScoreOdds(score) {
    let prob = SCORE_PROB_NORM[score] || 0.01;
    let rawOdds = 1 / prob;
    let odds = rawOdds * 0.80; // House Edge 20%
    return Math.max(1.01, +odds.toFixed(2));
  }

  function computeAllAntiOdds() {
    return scoreGrid18.map(function(score) {
      return { score: score, odds: computeAntiOdds(score), correctOdds: computeCorrectScoreOdds(score) };
    });
  }

  const TEAM_TIER = {
    '巴西': { tier: 'strong', champBase: 5.50, runnerBase: 4.20 },
    '法国': { tier: 'strong', champBase: 6.00, runnerBase: 4.50 },
    '阿根廷': { tier: 'medium', champBase: 7.50, runnerBase: 5.50 },
    '英格兰': { tier: 'medium', champBase: 8.00, runnerBase: 5.80 },
    '西班牙': { tier: 'medium', champBase: 9.00, runnerBase: 6.50 },
    '德国': { tier: 'medium', champBase: 10.00, runnerBase: 7.00 },
    '葡萄牙': { tier: 'weak', champBase: 12.00, runnerBase: 8.00 },
    '荷兰': { tier: 'weak', champBase: 15.00, runnerBase: 9.50 },
    '克罗地亚': { tier: 'weak', champBase: 18.00, runnerBase: 10.00 },
    '比利时': { tier: 'weak', champBase: 13.00, runnerBase: 8.50 },
    '格鲁吉亚': { tier: 'weak', champBase: 22.00, runnerBase: 12.00 },
    '罗马尼亚': { tier: 'weak', champBase: 20.00, runnerBase: 11.00 },
    '摩洛哥': { tier: 'weak', champBase: 25.00, runnerBase: 14.00 },
    '马达加斯加': { tier: 'weak', champBase: 30.00, runnerBase: 16.00 },
    '威尔士': { tier: 'weak', champBase: 20.00, runnerBase: 12.00 },
    '加纳': { tier: 'weak', champBase: 28.00, runnerBase: 15.00 }
  };

  function computeChampionOdds(teamName, baseOdds) {
    let tier = TEAM_TIER[teamName];
    if (tier) {
      let fluctuation = 1 + (Math.random() - 0.5) * 0.10;
      return +(tier.champBase * fluctuation).toFixed(2);
    }
    return baseOdds || 8.00;
  }

  function computeRunnerUpOdds(teamName, baseOdds) {
    let tier = TEAM_TIER[teamName];
    if (tier) {
      let fluctuation = 1 + (Math.random() - 0.5) * 0.10;
      return +(tier.runnerBase * fluctuation).toFixed(2);
    }
    return baseOdds || 6.00;
  }

  function settleMatchBets(matchName, finalScore) {
    let results = { totalBets: 0, wonCount: 0, lostCount: 0, totalPayout: 0, settledRecords: [] };

    betRecords.forEach(function(record, idx) {
      if (record.status !== 'pending') return;
      let recordMatch = record.team ? record.team.split(' ')[0] : '';
      let targetMatch = matchName;
      if (recordMatch.indexOf(targetMatch.split(' vs ')[0]) === -1 &&
          recordMatch.indexOf(targetMatch.split(' vs ')[1]) === -1) {
        if (record.team && record.team.indexOf(targetMatch) === -1) return;
      }

      results.totalBets++;
      let betScore = record.score || extractScoreFromTeam(record.team);
      if (!betScore) { return; } // Can't determine bet score
      let isWin = (finalScore !== betScore);

      if (isWin) {
        record.status = 'won';
        record.payout = +(record.amount * record.odds).toFixed(2);
        userBalance += record.payout;
        results.wonCount++;
        results.totalPayout += record.payout;
      } else {
        record.status = 'lost';
        record.payout = 0;
        results.lostCount++;
      }

      results.settledRecords.push(record);
    });

    saveData();
    updateBadges();
    return results;
  }

  function settleChampionBets(championTeam, runnerUpTeam) {
    let results = { totalBets: 0, wonCount: 0, lostCount: 0, totalPayout: 0 };

    betRecords.forEach(function(record) {
      if (record.status !== 'pending') return;
      if (record.type !== '冠军' && record.type !== '亚军') return;

      results.totalBets++;
      let isWin = false;

      if (record.type === '冠军' && record.team === championTeam) {
        isWin = true;
      } else if (record.type === '亚军' && record.team === runnerUpTeam) {
        isWin = true;
      }

      if (isWin) {
        record.status = 'won';
        record.payout = +(record.amount * record.odds).toFixed(2);
        userBalance += record.payout;
        results.wonCount++;
        results.totalPayout += record.payout;
      } else {
        record.status = 'lost';
        record.payout = 0;
        results.lostCount++;
      }
    });

    saveData();
    updateBadges();
    return results;
  }

  function extractScoreFromTeam(teamStr) {
    if (!teamStr) return null;
    let parts = teamStr.split(' ');
    let lastPart = parts[parts.length - 1];
    if (/^\d+:\d+$/.test(lastPart)) return lastPart;
    if (lastPart === '主4+') return '主4+';
    if (lastPart === '客4+') return '客4+';
    let match = teamStr.match(/(\d+:\d+|主4\+|客4\+)/);
    return match ? match[0] : null;
  }

  let oddsElements = [];
  let lastOddsMap = {};
  function createRipple(e) {
    let target = e.currentTarget;
    let oldRipple = target.querySelector('.ripple-effect');
    if (oldRipple) oldRipple.remove();

    let ripple = document.createElement('span');
    ripple.className = 'ripple-effect';
    let rect = target.getBoundingClientRect();
    let size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + 'px';

    let x, y;
    if (e.touches) {
      x = e.touches[0].clientX - rect.left - size / 2;
      y = e.touches[0].clientY - rect.top - size / 2;
    } else if (e.clientX !== undefined) {
      x = e.clientX - rect.left - size / 2;
      y = e.clientY - rect.top - size / 2;
    } else {
      x = rect.width / 2 - size / 2;
      y = rect.height / 2 - size / 2;
    }
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';

    if (!target.style.position || target.style.position === 'static') target.style.position = 'relative';
    if (target.style.overflow === '' || target.style.overflow === 'visible') target.style.overflow = 'hidden';
    target.appendChild(ripple);

    ripple.addEventListener('animationend', function() { ripple.remove(); });
  }
  function startWorldCupCountdown() {
    var target = new Date('2026-06-11T00:00:00Z').getTime(); // FIFA World Cup 2026
    function tick() {
      var now = Date.now();
      var diff = target - now;
      if (diff <= 0) { document.getElementById('cd-timer').textContent = '已开赛!'; return; }
      var d = Math.floor(diff / 86400000);
      var h = Math.floor((diff % 86400000) / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);
      document.getElementById('cd-timer').textContent = d + '天 ' + h + '小时 ' + m + '分钟 ' + s + '秒';
    }
    tick();
    setInterval(tick, 1000);
  }
  document.addEventListener('DOMContentLoaded', startWorldCupCountdown);

  function filterMatches(type) {
    var cards = document.querySelectorAll('.match-card');
    cards.forEach(function(c) {
      if (type === 'all') { c.style.display = ''; return; }
      var league = (c.querySelector('.match-league')?.textContent || '').toLowerCase();
      c.style.display = league.includes(type) ? '' : 'none';
    });
  }

  function initRippleEffects() {
    document.querySelectorAll('.match-card, .grid-cell, .team-card, button, .btn-champion, .btn-runnerup, .tabbar-item, .tab-nav-item, .record-filter button, .record-item, .lang-option, .quick-amounts button')
      .forEach(function(el) {
        if (el._hasRipple) return;
        el._hasRipple = true;
        el.addEventListener('pointerdown', createRipple, { passive: true });
      });
  }
  function trackOddsElements() {
    oddsElements = [];
    document.querySelectorAll('.odds-tag .val, .cell-odds, .o-val').forEach(function(el) {
      let key = el.getAttribute('data-odds-key');
      if (!key) {
        key = 'odds_' + Math.random().toString(36).substr(2, 8);
        el.setAttribute('data-odds-key', key);
      }
      let currentVal = parseFloat(el.textContent) || 1.0;
      if (!(key in lastOddsMap)) lastOddsMap[key] = currentVal;
      oddsElements.push({ el: el, key: key });
    });
  }

  function flashOddsElement(el, direction) {
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth; // force reflow
    if (direction === 'up') {
      el.classList.add('flash-up');
    } else {
      el.classList.add('flash-down');
    }
    let existing = el.querySelector('.odds-arrow');
    if (!existing) {
      let arrow = document.createElement('span');
      arrow.className = 'odds-arrow';
      arrow.style.cssText = 'display:inline-block;margin-left:2px;font-size:10px;font-weight:700;transition:opacity 0.3s';
      el.appendChild(arrow);
    }
    let arrowEl = el.querySelector('.odds-arrow');
    arrowEl.textContent = direction === 'up' ? '\u2191' : '\u2193';
    arrowEl.style.color = direction === 'up' ? 'var(--green)' : 'var(--red)';
    arrowEl.style.opacity = '1';
    setTimeout(function() { if (arrowEl) arrowEl.style.opacity = '0'; }, 1800);
  }

  function startOddsFlash() {
    if (oddsFlashInterval) clearInterval(oddsFlashInterval);
    trackOddsElements();

    oddsFlashInterval = setInterval(function() {
      trackOddsElements();
      if (oddsElements.length === 0) return;

      let count = 1 + Math.floor(Math.random() * 4);
      let indices = [];
      while (indices.length < count && indices.length < oddsElements.length) {
        let idx = Math.floor(Math.random() * oddsElements.length);
        if (indices.indexOf(idx) === -1) indices.push(idx);
      }

      indices.forEach(function(i) {
        let entry = oddsElements[i];
        if (!entry || !entry.el) return;
        let prev = lastOddsMap[entry.key] || parseFloat(entry.el.textContent) || 1.0;
        let delta = prev * (Math.random() * 0.06) * (Math.random() > 0.5 ? 1 : -1);
        let newVal = Math.max(1.01, prev + delta);
        newVal = +newVal.toFixed(2);
        let direction = newVal >= prev ? 'up' : 'down';

        flashOddsElement(entry.el, direction);
        playOddsTickSound(direction === 'up');

        entry.el.textContent = newVal;
        lastOddsMap[entry.key] = newVal;
      });
    }, 2200 + Math.random() * 800);
  }

  function stopOddsFlash() {
    if (oddsFlashInterval) {
      clearInterval(oddsFlashInterval);
      oddsFlashInterval = null;
    }
  }

  function scrollToSection(id) {
    var el = document.getElementById(id);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }


  // ── Preload next page on hover (200ms hover → prefetch)
  (function() {
    var hoverTimer = null;
    var preloadMap = {
      'matches': '/api/status',
      'ai-predict': '/api/status',
      'records': '/api/status',
      'profile': '/api/status'
    };
    document.addEventListener('mouseover', function(e) {
      var navItem = e.target.closest('[onclick*="navigateTo"]');
      if (navItem) {
        var match = (navItem.getAttribute('onclick') || '').match(/navigateTo\(['"]([^'"]+)['"]\)/);
        if (match && preloadMap[match[1]]) {
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(function() {
            var link = document.createElement('link');
            link.rel = 'prefetch';
            link.href = preloadMap[match[1]];
            document.head.appendChild(link);
          }, 200);
        }
      }
    }, { passive: true });
  })();

  function initSwipeCards() {
    let container = document.querySelector('.match-cards-container, #match-list, #matches-page-list');
    if (!container) return;
    container.addEventListener('touchstart', handleSwipeStart, { passive: true });
    container.addEventListener('touchmove', handleSwipeMove, { passive: false });
    container.addEventListener('touchend', handleSwipeEnd, { passive: true });
  }

  let swipeData = { startX: 0, startY: 0, card: null, offset: 0 };

  function handleSwipeStart(e) {
    let card = e.target.closest('.match-card');
    if (!card) return;
    swipeData.card = card;
    swipeData.startX = e.touches[0].clientX;
    swipeData.startY = e.touches[0].clientY;
    swipeData.offset = 0;
    card.style.transition = 'none';
  }

  function handleSwipeMove(e) {
    if (!swipeData.card) return;
    var dx = e.touches[0].clientX - swipeData.startX;
    var dy = e.touches[0].clientY - swipeData.startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
      e.preventDefault();
      swipeData._latestDx = dx;
      if (!swipeData._rafPending) {
        swipeData._rafPending = true;
        requestAnimationFrame(function() {
          swipeData._rafPending = false;
          if (!swipeData.card) return;
          var dx2 = swipeData._latestDx || 0;
          swipeData.card.style.transform = 'translateX(' + dx2 + 'px)';
          swipeData.card.style.opacity = Math.max(0.5, 1 - Math.abs(dx2) / 400);
          swipeData.offset = dx2;
        });
      }
    }
  }

  function handleSwipeEnd() {
    let card = swipeData.card;
    if (!card) return;
    card.style.transition = 'transform 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease';
    if (Math.abs(swipeData.offset) > 120) {
      card.style.transform = 'translateX(' + (swipeData.offset > 0 ? 400 : -400) + 'px)';
      card.style.opacity = '0';
      setTimeout(function() {
        if (card && card.parentNode) card.remove();
      }, 350);
    } else {
      card.style.transform = 'translateX(0)';
      card.style.opacity = '1';
    }
    swipeData.card = null;
    swipeData.offset = 0;
  }
  function animateCountUp(el, from, to, duration) {
    duration = duration || 600;
    let start = null;
    let range = to - from;

    function step(timestamp) {
      if (!start) start = timestamp;
      let progress = Math.min((timestamp - start) / duration, 1);
      let eased = 1 - Math.pow(1 - progress, 3);
      let current = from + range * eased;
      el.textContent = current.toFixed(2);
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = to.toFixed(2);
      }
    }
    requestAnimationFrame(step);
  }

  function updateBetProfit() {
    let amount = parseFloat(document.getElementById('bet-amount-input').value) || 0;
    let overlay = document.getElementById('bet-dialog-overlay');
    let odds = overlay._betData ? overlay._betData.odds : 0;
    let profitEl = document.getElementById('bet-profit');
    let oldProfit = parseFloat(profitEl.textContent) || 0;
    let newProfit = amount > 0 ? (amount * odds - amount) : 0;
    if (Math.abs(newProfit - oldProfit) > 0.05) {
      animateCountUp(profitEl, oldProfit, newProfit, 400);
    } else {
      profitEl.textContent = newProfit.toFixed(2);
    }
    let totalEl = document.getElementById('bet-total-return');
    if (totalEl) {
      totalEl.textContent = amount > 0 ? (amount * odds).toFixed(2) : '0.00';
    }
  }
  const pageOrder = ['home', 'ai-predict', 'matches', 'detail', 'records', 'profile', 'rules', 'ai'];

  function navigateTo(page) {
    window.scrollTo({top: 0, behavior: 'smooth'});
    if (currentPage === page) return;

    let oldPage = currentPage;
    currentPage = page;
    if (pageHistory[pageHistory.length - 1] !== page) {
      pageHistory.push(page);
    }
    if (pageHistory.length > 20) pageHistory.shift();

    const oldIdx = pageOrder.indexOf(oldPage);
    const newIdx = pageOrder.indexOf(page);
    let direction = (newIdx >= oldIdx) ? 'forward' : 'backward';

    let targetPage = document.getElementById('page-' + page);
    if (!targetPage) return;
    let allPages = document.querySelectorAll('.page');
    allPages.forEach(function(p) {
      if (p !== targetPage && p.classList.contains('active')) {
        p.style.animation = 'none';
        p.offsetHeight; // force reflow
        p.style.animation = '';
        p.style.transform = '';
        p.style.opacity = '';
        p.style.transition = '';
        p.classList.remove('active');
      }
    });
    targetPage.style.animation = 'none';
    targetPage.offsetHeight; // force reflow
    targetPage.style.animation = '';
    targetPage.classList.add('active');
    document.querySelectorAll('.tabbar-item').forEach(function(i) { i.classList.remove('active'); });
    let tabMap = { home:0, 'ai-predict':1, matches:2, records:3, profile:4, detail:2, rules:5, ai:1 };
    let idx = tabMap[page];
    if (idx !== undefined) {
      let items = document.querySelectorAll('.tabbar-item');
      if (items[idx]) items[idx].classList.add('active');
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (page === 'matches') renderMatchList();
    if (page === 'profile') renderProfile();
    if (page === 'records') updateBadges();
    if (page === 'ai-predict') updateAIInvestPredictUI();

    }
  function goBackPage() {
    if (pageHistory.length > 1) {
      pageHistory.pop(); // remove current
      let prev = pageHistory[pageHistory.length - 1];
      navigateTo(prev);
    }
  }

  function initGestureBack() {
    let touchStartX = 0;
    let touchStartY = 0;
    let backIndicator = null;

    document.addEventListener('touchstart', function(e) {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      if (touchStartX > 30) { touchStartX = 0; return; }
      if (!backIndicator) {
        backIndicator = document.createElement('div');
        backIndicator.id = 'gesture-back-indicator';
        backIndicator.style.cssText = 'position:fixed;left:0;top:50%;transform:translateY(-50%);width:6px;height:60px;background:linear-gradient(to right,var(--gold),transparent);border-radius:0 6px 6px 0;z-index:9999;opacity:0;transition:opacity 0.2s;pointer-events:none';
        document.body.appendChild(backIndicator);
      }
    }, { passive: true });

    document.addEventListener('touchmove', function(e) {
      if (!touchStartX || e.touches.length !== 1) return;
      let dx = e.touches[0].clientX - touchStartX;
      let dy = e.touches[0].clientY - touchStartY;
      if (dx > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (backIndicator) backIndicator.style.opacity = Math.min(1, dx / 120);
      }
    }, { passive: true });

    document.addEventListener('touchend', function(e) {
      if (!touchStartX) return;
      if (backIndicator) backIndicator.style.opacity = '0';
      let dx = (e.changedTouches[0] ? e.changedTouches[0].clientX : 0) - touchStartX;
      if (dx > 80 && pageHistory.length > 1) {
          goBackPage();
      }
      touchStartX = 0;
    }, { passive: true });
  }

  function showChampion() {
    navigateTo('home');
    setTimeout(function() { switchTab('champion'); }, 100);
  }
  function showAbout() {
    navigateTo('home');
    setTimeout(function() { switchTab('about'); }, 100);
  }
  
  function switchTab(tab) {
    if (currentTab === tab) return;
    currentTab = tab;

    let contents = document.querySelectorAll('.tab-content');
    contents.forEach(function(c) {
      if (c.classList.contains('active')) {
        c.style.animation = 'fadeSlideOut .2s ease forwards';
        setTimeout(function() {
          c.classList.remove('active');
          c.style.animation = '';
        }, 200);
      }
    });

    document.querySelectorAll('.tab-nav-item').forEach(function(i) { i.classList.remove('active'); });

    let newContent = document.getElementById('tab-' + tab);
    if (newContent) {
      newContent.classList.add('active');
      newContent.style.animation = 'none';
      newContent.offsetHeight; // force reflow
      newContent.style.animation = '';
    }

    let tabMap = { recommend:0, champion:1, about:2 };
    let idx = tabMap[tab];
    if (idx !== undefined) document.querySelectorAll('.tab-nav-item')[idx].classList.add('active');
    if (tab === 'champion') { renderChampionBet(); renderHotRanking(); }
  }

  // Match list card for the matches page (compact professional layout)
  function matchListCardHTML(m) {
    var t = new Date(m.match_time || m.time || Date.now());
    var timeStr = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);
    var dateStr = (t.getMonth()+1) + '/' + t.getDate();
    return '<div class="match-list-card" onclick="app.navigateTo(\'detail\');app.loadMatchDetail(' + m.id + ')">' +
      '<div class="ml-left"></div>' +
      '<div class="ml-body">' +
        '<div class="ml-league-time">' +
          '<span class="ml-league">' + (m.league || '') + '</span>' +
          '<span class="ml-time">' + timeStr + '</span>' +
          '<span class="ml-date">' + dateStr + '</span>' +
        '</div>' +
        '<div class="ml-teams">' +
          '<div class="ml-team">' +
            '<span class="ml-team-name">' + m.home + '</span>' +
            teamLogoImg(m.home, 32) +
          '</div>' +
          '<span class="ml-score upcoming">VS</span>' +
          '<div class="ml-team">' +
            teamLogoImg(m.away, 32) +
            '<span class="ml-team-name">' + m.away + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="ml-odds">' +
          '<div class="ml-odd">主<span class="odd-val">' + (m.odds_home || (m.odds&&m.odds.home) || '—') + '</span></div>' +
          '<div class="ml-odd">平<span class="odd-val">' + (m.odds_draw || (m.odds&&m.odds.draw) || '—') + '</span></div>' +
          '<div class="ml-odd">客<span class="odd-val">' + (m.odds_away || (m.odds&&m.odds.away) || '—') + '</span></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function matchCardHTML(m) {
    let timeParts = (m.time || '').split(' ');
    let dateStr = timeParts.length > 1 ? timeParts[0].slice(5) : '';
    let timeStr = timeParts.length > 1 ? timeParts[1].slice(0,5) : (m.time || '--');
    let isLive = m.status === 'live';
    let statusText = m.status === 'live' ? '\uD83D\uDD34 直播中' : m.status === 'finished' ? '已结束' : '未开赛';
    // lucky944 exact match card: dark red gradient
    return '<div class="match-row con" onclick="app.navigateTo(\'detail\'); app.loadMatchDetail(' + m.id + ')">' +
      '<div class="league-name"><p class="p1">' + m.league + '</p></div>' +
      '<div class="match-content">' +
        '<div class="team-left">' +
          '<div class="team-logo">' + teamLogoImg(m.home, 40) + '</div>' +
          '<div class="team-name">' + m.home + '</div>' +
        '</div>' +
        '<div class="match-center">' +
          '<div class="time">' + timeStr + '</div>' +
          '<div class="date">' + dateStr + '</div>' +
        '</div>' +
        '<div class="team-right">' +
          '<div class="team-logo">' + teamLogoImg(m.away, 40) + '</div>' +
          '<div class="team-name">' + m.away + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="match-odds">' +
        '<div class="odds-tag">主胜<span class="val">' + (m.odds_home || (m.odds&&m.odds.home) || '—') + '</span></div>' +
        '<div class="odds-tag">平局<span class="val">' + (m.odds_draw || (m.odds&&m.odds.draw) || '—') + '</span></div>' +
        '<div class="odds-tag">客胜<span class="val">' + (m.odds_away || (m.odds&&m.odds.away) || '—') + '</span></div>' +
      '</div>' +
    '</div>';
  }
  function showSkeletons(container, count) {
    count = count || 4;
    container.classList.add('skeleton-loading');
    container.innerHTML = Array(count).fill(0).map(function() {
      return '<div class="match-card skeleton-card" style="pointer-events:none">' +
        '<div class="skeleton-line shimmer" style="height:12px;width:40%;margin-bottom:10px;border-radius:4px"></div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
          '<div class="skeleton-circle shimmer" style="width:48px;height:48px;border-radius:50%"></div>' +
          '<div class="skeleton-line shimmer" style="width:60px;height:16px;border-radius:4px"></div>' +
          '<div class="skeleton-circle shimmer" style="width:48px;height:48px;border-radius:50%"></div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;margin-top:10px">' +
          '<div class="skeleton-line shimmer" style="flex:1;height:32px;border-radius:6px"></div>' +
          '<div class="skeleton-line shimmer" style="flex:1;height:32px;border-radius:6px"></div>' +
          '<div class="skeleton-line shimmer" style="flex:1;height:32px;border-radius:6px"></div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function showDetailSkeleton() {
    let grid = document.getElementById('grid-18');
    if (!grid) return;
    grid.classList.add('skeleton-loading');
    grid.innerHTML = Array(18).fill(0).map(function() {
      return '<div class="grid-cell skeleton-cell">' +
        '<div class="skeleton-line shimmer" style="width:36px;height:14px;border-radius:4px;margin-bottom:6px"></div>' +
        '<div class="skeleton-line shimmer" style="width:28px;height:20px;border-radius:4px"></div>' +
      '</div>';
    }).join('');
  }

  async function renderMatchCards() {
    try {
    let container = document.getElementById('match-list');
    if (!container) return;

    showSkeletons(container, 4);
    let data = mockMatches;

    let apiData = await apiCall('/matches');
    if (apiData && apiData.code === 0 && apiData.data.length > 0) data = apiData.data;

    await new Promise(function(r) { setTimeout(r, 400); });
    container.classList.remove('skeleton-loading');
    container.style.opacity = '0';
    if (data.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text3)">暂无赛事数据</div>';
    } else {
      if (data.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text3)">暂无赛事数据</div>';
    } else {
      container.innerHTML = data.map(function(m) { return matchListCardHTML(m); }).join('');
      // Update match count
      var countEl = document.getElementById('matches-count');
      if (countEl) countEl.textContent = data.length + ' 场比赛';
    }
    }
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        container.style.opacity = '1';
        container.style.transition = 'opacity 0.35s ease';
        initRippleEffects();
        initSwipeCards();
        trackOddsElements();
      });
    });
    } catch(e) { }
  }
  function computeHotRanking() {
    let rankings = {};
    betRecords.forEach(function(r) {
      let team = r.team || '';
      let matchParts = team.split(' vs ');
      matchParts.forEach(function(part) {
        let name = part.trim().split(' ')[0];
        if (name) {
          if (!rankings[name]) rankings[name] = { count: 0, amount: 0 };
          rankings[name].count += 1;
          rankings[name].amount += r.amount || 0;
        }
      });
    });
    let champRecords = [];
    try {
      let cr = localStorage.getItem('19888_bet_records');
      if (cr) champRecords = JSON.parse(cr);
    } catch(e) {}

    champRecords.forEach(function(r) {
      if (r.type === '冠军' || r.type === '亚军') {
        let name = r.team;
        if (name) {
          if (!rankings[name]) rankings[name] = { count: 0, amount: 0 };
          rankings[name].count += 1;
          rankings[name].amount += r.amount || 0;
        }
      }
    });
    if (Object.keys(rankings).length === 0) {
      mockChampionTeams.forEach(function(t, i) {
        rankings[t.name] = {
          count: Math.floor(Math.random() * 50) + 10,
          amount: Math.floor(Math.random() * 5000) + 500
        };
      });
    }
    let sorted = Object.keys(rankings).map(function(name) {
      return { name: name, count: rankings[name].count, amount: rankings[name].amount };
    }).sort(function(a, b) { return b.count - a.count; });

    return sorted.slice(0, 10);
  }

  function renderHotRanking() {
    let container = document.getElementById('hot-ranking-list');
    if (!container) return;

    let ranking = computeHotRanking();
    let medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49', '4', '5', '6', '7', '8', '9', '10'];

    container.innerHTML = '<div style="font-size:13px;font-weight:700;color:var(--gold);margin-bottom:8px;text-align:center">\uD83D\uDD25 热门投注排行</div>' +
      ranking.map(function(item, idx) {
        let barWidth = ranking.length > 0 ? Math.round((item.count / ranking[0].count) * 100) : 50;
        let flag = FLAGS[item.name] || '';
        return '<div class="ranking-row" style="display:flex;align-items:center;padding:6px 8px;margin-bottom:4px;background:rgba(255,255,255,0.04);border-radius:8px;position:relative;overflow:hidden">' +
          '<div style="position:absolute;left:0;top:0;bottom:0;width:' + barWidth + '%;background:linear-gradient(90deg,rgba(218,165,32,0.08),rgba(218,165,32,0.02));border-radius:8px;transition:width 0.6s ease"></div>' +
          '<span style="width:28px;font-size:14px;font-weight:700;z-index:1;text-align:center">' + medals[idx] + '</span>' +
          '<span style="margin-right:4px;font-size:16px;z-index:1">' + flag + '</span>' +
          '<span style="flex:1;font-size:12px;font-weight:600;z-index:1">' + item.name + '</span>' +
          '<span style="font-size:11px;color:var(--text2);z-index:1">' + item.count + '人投注</span>' +
          '<span style="font-size:11px;color:var(--green);margin-left:8px;z-index:1">$' + item.amount + '</span>' +
        '</div>';
      }).join('');
  }
  async function renderChampionBet() {
    let grid = document.getElementById('teams-grid');
    if (!grid) return;

    grid.innerHTML = Array(8).fill(0).map(function() {
      return '<div class="team-card" style="pointer-events:none">' +
        '<div class="skeleton-circle shimmer" style="width:56px;height:56px;border-radius:50%;margin:0 auto 8px"></div>' +
        '<div class="skeleton-line shimmer" style="width:60%;height:16px;border-radius:4px;margin:0 auto 12px"></div>' +
        '<div style="display:flex;gap:8px;justify-content:center;margin-bottom:10px">' +
          '<div class="skeleton-line shimmer" style="width:50px;height:28px;border-radius:4px"></div>' +
          '<div class="skeleton-line shimmer" style="width:50px;height:28px;border-radius:4px"></div>' +
        '</div>' +
        '<div style="display:flex;gap:6px">' +
          '<div class="skeleton-line shimmer" style="flex:1;height:32px;border-radius:6px"></div>' +
          '<div class="skeleton-line shimmer" style="flex:1;height:32px;border-radius:6px"></div>' +
        '</div>' +
      '</div>';
    }).join('');

    let teams = mockChampionTeams;
    let totalBet = 12850;
    let totalWin = 67420;

    let apiData = await apiCall('/champion-bet/odds');
    if (apiData && apiData.code === 0 && apiData.data) {
      teams = apiData.data.odds || teams;
      totalBet = apiData.data.total_bet || totalBet;
      totalWin = apiData.data.total_potential_win || totalWin;
    }

    await new Promise(function(r) { setTimeout(r, 300); });

    grid.style.opacity = '0';
    grid.innerHTML = teams.map(function(t) {
      let champOdds = computeChampionOdds(t.name, t.championship_odds);
      let runnerOdds = computeRunnerUpOdds(t.name, t.runner_up_odds);
      return '\n      <div class="team-card">\n        <div class="t-logo" style="background:none">' + teamLogoImg(t.name, 56) + '<span style="display:none;align-items:center;justify-content:center;width:52px;height:52px;border-radius:50%;background:var(--bg-input);color:var(--text-muted);font-size:26px">\u26BD</span></div>\n        <div class="t-name">' + t.name + '</div>\n        <div class="odds-row">\n          <div><span class="o-label">冠军</span><br><span class="o-val">' + champOdds + '</span></div>\n          <div><span class="o-label">亚军</span><br><span class="o-val">' + runnerOdds + '</span></div>\n        </div>\n        <div class="bet-btns">\n          <button class="btn-champion" onclick="app.openBetDialog(\'' + t.name + '\', ' + t.id + ', \'champion\', ' + champOdds + ')">投冠军</button>\n          <button class="btn-runnerup" onclick="app.openBetDialog(\'' + t.name + '\', ' + t.id + ', \'runnerup\', ' + runnerOdds + ')">投亚军</button>\n        </div>\n      </div>\n    ';
    }).join('');

    let totalBetEl = document.getElementById('total-bet');
    let totalWinEl = document.getElementById('total-win');
    if (totalBetEl) totalBetEl.textContent = totalBet.toFixed(2);
    if (totalWinEl) totalWinEl.textContent = totalWin.toFixed(2);
    renderHotRanking();
    grid.style.transition = 'opacity 0.35s ease';
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        grid.style.opacity = '1';
      });
    });

    initRippleEffects();
    trackOddsElements();
  }
  function openBetDialog(teamName, teamId, betType, odds) {
    let overlay = document.getElementById('bet-dialog-overlay');
    let typeName = betType === 'champion' ? '冠军' : '亚军';
    document.getElementById('bet-team-name').textContent = teamName;
    document.getElementById('bet-type-name').textContent = typeName;
    document.getElementById('bet-odds').textContent = odds;
    document.getElementById('bet-amount-input').value = '';
    document.getElementById('bet-profit').textContent = '0.00';
    let totalEl = document.getElementById('bet-total-return');
    if (totalEl) totalEl.textContent = '0.00';
    overlay.classList.add('show');
    overlay._betData = { teamName: teamName, teamId: teamId, betType: betType, odds: odds, typeName: typeName };
    setTimeout(function() {
      let inp = document.getElementById('bet-amount-input');
      if (inp) inp.focus();
    }, 300);
  }

  function closeBetDialog() {
    document.getElementById('bet-dialog-overlay').classList.remove('show');
  }

  async function confirmBet() {
    let overlay = document.getElementById('bet-dialog-overlay');
    let amount = parseFloat(document.getElementById('bet-amount-input').value);
    if (!amount || amount < 1) { showToast('请输入正确的投注金额'); return; }
    if (!walletAddress) { showToast('请先连接钱包'); return; }

    let data = overlay._betData;
    let odds = data.odds;
    if (ethersReady && walletProvider) {
      let betType = data.betType === 'champion' ? 1 : 2;
      let tx = await contractPlaceChampionBet(data.teamId, betType, amount);
      if (tx) {
        let onchainRecord = {
          id: Date.now(), team: data.teamName, type: data.typeName,
          amount: amount, odds: odds, potentialWin: (amount * odds).toFixed(2),
          time: new Date().toLocaleString('zh-CN'), status: 'pending', tx: tx
        };
        betRecords.unshift(onchainRecord);
        saveData();
        closeBetDialog();
        spawnConfetti();
        showToast('链上投注已提交！TX: ' + tx.substring(0, 10) + '...');
        renderChampionBet();
        updateBadges();
        return;
      }
    }

    if (apiAvailable) {
      let res = await apiCall('/champion-bet/place', {
        method: 'POST',
        body: JSON.stringify({
          team_id: data.teamId,
          bet_type: data.betType === 'champion' ? 1 : 2,
          amount: amount,
          wallet_address: walletAddress
        })
      });
      if (res && res.code === 0) {
        showToast('投注成功！');
        closeBetDialog();
        spawnConfetti();
        renderChampionBet();
        updateBadges();
        return;
      }
    }

    let record = {
      id: Date.now(), team: data.teamName, type: data.typeName,
      amount: amount, odds: odds, potentialWin: (amount * odds).toFixed(2),
      time: new Date().toLocaleString('zh-CN'), status: 'pending'
    };
    betRecords.unshift(record);
    userBalance -= amount;
    saveData();
    closeBetDialog();
    spawnConfetti();
    showToast('投注成功！');
  }
  async function renderMatchList() {
    let container = document.getElementById('matches-page-list');
    if (!container) return;

    showSkeletons(container, 6);
    let data = [];
    try {
      let apiData = await apiCall('/matches');
      if (apiData && apiData.data && apiData.data.length > 0) {
        data = apiData.data;
      } else if (apiData && Array.isArray(apiData) && apiData.length > 0) {
        data = apiData;
      }
    } catch(e) {}
    if (data.length === 0) data = mockMatches;

    await new Promise(function(r) { setTimeout(r, 350); });
    container.classList.remove('skeleton-loading');
    container.style.opacity = '0';
    if (data.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text3)">暂无赛事数据</div>';
    } else {
      container.innerHTML = data.map(function(m) { return matchListCardHTML(m); }).join('');
      // Update match count
      var countEl = document.getElementById('matches-count');
      if (countEl) countEl.textContent = data.length + ' 场比赛';
    }
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        container.style.opacity = '1';
        container.style.transition = 'opacity 0.35s ease';
        initRippleEffects();
        initSwipeCards();
        trackOddsElements();
      });
    });
  }
  async function loadMatchDetail(matchId) {
    currentDetailMatchId = matchId;
    let match = mockMatches.find(function(m) { return m.id === matchId; }) || mockMatches[0];
    let grid18 = computeAllAntiOdds();

    showDetailSkeleton();

    let apiData = await apiCall('/matches/' + matchId);
    if (apiData && apiData.code === 0 && apiData.data) {
      match = apiData.data;
      if (apiData.data.grid_18 && apiData.data.grid_18.length) {
        grid18 = apiData.data.grid_18;
      }
    }

    let timeParts = (match.time || '').split(' ');
    var hl = document.getElementById('md-home-logo');
    var al = document.getElementById('md-away-logo');
    if (hl) hl.innerHTML = teamLogoImg(match.home, 48);
    if (al) al.innerHTML = teamLogoImg(match.away, 48);
    document.getElementById('md-league').textContent = match.league;
    document.getElementById('md-home').textContent = match.home;
    document.getElementById('md-away').textContent = match.away;
    document.getElementById('md-time').textContent = timeParts.length > 1 ? timeParts[1].slice(0,5) : (match.time || '--');
    document.getElementById('md-date').textContent = timeParts.length > 1 ? timeParts[0].slice(5) : '';
    document.getElementById('md-venue').textContent = '📍 ' + (match.venue || '--');
    document.getElementById('md-referee').textContent = '👨‍⚖️ ' + (match.referee || '--');
    let h2hHome = document.querySelectorAll('.ht-home');
    let h2hAway = document.querySelectorAll('.ht-away');
    h2hHome.forEach(function(el) { el.textContent = match.home; });
    h2hAway.forEach(function(el) { el.textContent = match.away; });
    document.getElementById('h2h-summary-line').textContent = match.home + ' 3胜 1平 1负';
    document.getElementById('rf-home-name').textContent = match.home;
    document.getElementById('rf-away-name').textContent = match.away;
    let champHomeName = document.getElementById('champion-home-name');
    let champAwayName = document.getElementById('champion-away-name');
    let champHomeFlag = document.getElementById('champion-home-flag');
    let champAwayFlag = document.getElementById('champion-away-flag');
    let champHomeOdds = document.getElementById('champion-home-odds');
    let champAwayOdds = document.getElementById('champion-away-odds');
    let runHomeName = document.getElementById('runnerup-home-name');
    let runAwayName = document.getElementById('runnerup-away-name');
    let runHomeOdds = document.getElementById('runnerup-home-odds');
    let runAwayOdds = document.getElementById('runnerup-away-odds');

    if (champHomeName) champHomeName.textContent = match.home;
    if (champAwayName) champAwayName.textContent = match.away;
    if (champHomeFlag) champHomeFlag.innerHTML = teamLogoImg(match.home, 48);
    if (champAwayFlag) champAwayFlag.innerHTML = teamLogoImg(match.away, 48);
    if (runHomeName) runHomeName.textContent = match.home;
    if (runAwayName) runAwayName.textContent = match.away;

    let hChampOdds = computeChampionOdds(match.home, 6.00);
    let aChampOdds = computeChampionOdds(match.away, 7.00);
    let hRunnerOdds = computeRunnerUpOdds(match.home, 4.50);
    let aRunnerOdds = computeRunnerUpOdds(match.away, 5.00);

    if (champHomeOdds) champHomeOdds.textContent = hChampOdds.toFixed(2);
    if (champAwayOdds) champAwayOdds.textContent = aChampOdds.toFixed(2);
    if (runHomeOdds) runHomeOdds.textContent = hRunnerOdds.toFixed(2);
    if (runAwayOdds) runAwayOdds.textContent = aRunnerOdds.toFixed(2);

    await new Promise(function(r) { setTimeout(r, 200); });

    let grid = document.getElementById('grid-18');
    renderLineup(match);

    grid.classList.remove('skeleton-loading');
    grid.style.opacity = '0';
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        grid.style.opacity = '1';
        grid.style.transition = 'opacity 0.35s ease';
      });
    });
    let matchName = match.home + ' vs ' + match.away;
    let top16 = grid18.slice(0, 16);
    let bottom2 = grid18.slice(16, 18);
    var homeLogoEl = document.getElementById('md-home-logo');
    var awayLogoEl = document.getElementById('md-away-logo');
    if (homeLogoEl) homeLogoEl.innerHTML = teamLogoImg(match.home, 52);
    if (awayLogoEl) awayLogoEl.innerHTML = teamLogoImg(match.away, 52);
    let tableHTML = '<div class="grid-table">' +
      '<div class="gt-teams-row">' +
        '<div class="gt-team"><span class="gt-t-flag">' + teamLogoImg(match.home, 24) + '</span><span class="gt-t-name">' + match.home + '</span></div>' +
        '<div class="gt-vs">VS</div>' +
        '<div class="gt-team"><span class="gt-t-flag">' + teamLogoImg(match.away, 24) + '</span><span class="gt-t-name">' + match.away + '</span></div>' +
      '</div>' +
      '<div class="gt-header"><span>比分</span><span>赔率</span><span>投注</span></div>' +
      grid18.map(function(cell, i) {
        let oddsColor = cell.odds < 3 ? 'var(--green)' : cell.odds < 15 ? 'var(--accent)' : cell.odds < 40 ? 'var(--accent-mid)' : 'var(--red)';
        let isHighRisk = cell.odds > 30 ? ' gt-high-risk' : '';
        let isLastTwo = i >= 16 ? ' gt-last-two' : '';
        let disabledAttr = (i === 0 || i === 3) ? ' disabled' : ''; // 0:0 and 0:3 disabled like lucky944
        var winRate = Math.round((1 - 1/cell.odds) * 100);
        var barWidth = Math.min(100, Math.max(5, winRate));
        return '<div class="gt-row' + isHighRisk + isLastTwo + '" onclick="app.quickBet(\'' + cell.score + '\', ' + cell.odds + ', \'' + matchName + '\')">' +
          '<span class="gt-score">' + cell.score + '</span>' +
          '<span class="gt-odds" style="color:' + oddsColor + '">' + cell.odds.toFixed(2) + 'x' +
            '<span class="gt-winrate">' + winRate + '%</span>' +
          '</span>' +
          '<button class="gt-bet-btn' + disabledAttr + '"' + disabledAttr + '>立即投注</button>' +
        '</div>';
      }).join('') +
    '</div>';
    let betPreviewHTML = '<div style="margin-top:12px;display:flex;gap:8px;align-items:center">' +
      '<input type="number" id="grid-bet-amount" placeholder="投注金额" min="1" step="10" value="100" ' +
        'style="flex:1;padding:10px 12px;border:1.5px solid var(--border);border-radius:12px;font-size:14px;text-align:center;background:var(--bg);color:var(--text)" ' +
        'oninput="app.updateGridPayout()">' +
      '<div class="bet-payout-preview" style="flex:1;margin-top:0" id="grid-payout-preview">' +
        '<div class="payout-label">预估回报</div>' +
        '<div class="payout-amount" id="grid-payout-amount">0.00</div>' +
        '<div class="payout-label">USDT</div>' +
      '</div>' +
    '</div>';

    grid.innerHTML = tableHTML + betPreviewHTML;
    grid._matchData = { matchId: matchId, matchName: matchName, grid18: grid18 };
    grid._selectedScore = null;
    initGridSelection(grid, grid18, matchName);

    initRippleEffects();
    trackOddsElements();
    if (pageHistory[pageHistory.length - 1] !== 'detail') {
      pageHistory.push('detail');
    }
    document.getElementById('detail-league-name').textContent = match.league;
    document.getElementById('detail-venue-name').textContent = match.venue || '--';
    document.getElementById('detail-ref-name').textContent = match.referee || '--';
    setTimeout(function() { updateGridPayout(); }, 100);
  }
  function initGridSelection(grid, grid18, matchName) {
    let cells = grid.querySelectorAll('.grid-cell[data-score]');
    cells.forEach(function(cell) {
      cell.addEventListener('click', function(e) {
        let score = cell.getAttribute('data-score');
        let odds = parseFloat(cell.getAttribute('data-odds'));
        let wasSelected = cell.classList.contains('grid-selected');
        cells.forEach(function(c) { c.classList.remove('grid-selected'); });
        if (!wasSelected) {
          cell.classList.add('grid-selected');
          grid._selectedScore = { score: score, odds: odds };
          triggerHaptic();
          cell.classList.add('micro-bounce');
          setTimeout(function() { cell.classList.remove('micro-bounce'); }, 200);
          updateGridPayout();
        } else {
          grid._selectedScore = null;
          updateGridPayout();
        }
      });
    });
  }
  function updateGridPayout() {
    let amountEl = document.getElementById('grid-bet-amount');
    let payoutEl = document.getElementById('grid-payout-amount');
    if (!amountEl || !payoutEl) return;

    let amount = parseFloat(amountEl.value) || 0;
    let grid = document.getElementById('grid-18');
    let selected = grid && grid._selectedScore ? grid._selectedScore : null;
    let odds = selected ? selected.odds : 0;

    let oldPayout = parseFloat(payoutEl.textContent) || 0;
    let newPayout = amount > 0 && odds > 0 ? (amount * odds) : 0;

    if (Math.abs(newPayout - oldPayout) > 0.05 && newPayout > 0) {
      animateCountUp(payoutEl, oldPayout, newPayout, 350);
    } else {
      payoutEl.textContent = newPayout.toFixed(2);
    }
    let preview = document.getElementById('grid-payout-preview');
    if (preview) {
      if (newPayout > 0) preview.style.opacity = '1';
      else preview.style.opacity = '0.5';
    }
  }
  function triggerHaptic() {
    if (navigator.vibrate && navigator.vibrate.length !== undefined) {
      try { navigator.vibrate(10); } catch(e) {}
    }
  }

  function quickBet(score, odds, matchName) {
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    addToCart(score, odds, matchName);
  }
  function addToCart(score, odds, matchName) {
    let existing = betCart.find(function(b) { return b.score === score && b.matchName === matchName; });
    if (existing) {
      existing.amount += 100;
      existing.estimatedReturn = +(existing.amount * existing.odds).toFixed(2);
    } else {
      betCart.push({
        score: score,
        odds: +odds,
        matchName: matchName,
        amount: 100,
        estimatedReturn: +(100 * odds).toFixed(2)
      });
    }
    updateCartUI();
    showToast('已添加 ' + matchName + ' ' + score + ' @' + odds + ' 到投注单');
  }

  function removeFromCart(index) {
    let removed = betCart.splice(index, 1);
    updateCartUI();
    if (removed.length) showToast('已移除 ' + removed[0].matchName + ' ' + removed[0].score);
  }

  function updateCartItemAmount(index, newAmount) {
    if (index >= 0 && index < betCart.length) {
      betCart[index].amount = +newAmount || 100;
      betCart[index].estimatedReturn = +(betCart[index].amount * betCart[index].odds).toFixed(2);
      updateCartUI();
    }
  }

  function updateCartUI() {
    if (updateCartUI._pending) return;
    updateCartUI._pending = true;
    requestAnimationFrame(function() {
      updateCartUI._pending = false;
      _updateCartUIImmediate();
    });
  }

  function _updateCartUIImmediate() {
    let cart = document.getElementById('betCart');
    let count = document.getElementById('cartCount');
    let total = document.getElementById('cartTotal');
    let cartItems = document.getElementById('cartItems');
    let cartSummary = document.getElementById('cartSummary');
    if (!cart) return;

    if (betCart.length === 0) {
      cart.classList.remove('show');
      if (cartItems) cartItems.innerHTML = '';
      if (cartSummary) cartSummary.style.display = 'none';
    } else {
      cart.classList.add('show');
      if (count) count.textContent = betCart.length;
      if (cartItems) {
        let totalPotential = 0;
        cartItems.innerHTML = betCart.map(function(b, idx) {
          let returnAmt = b.estimatedReturn || +(b.amount * b.odds).toFixed(2);
          totalPotential += returnAmt;
          return '<div class="cart-item" style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + b.matchName + '</div>' +
              '<div style="color:var(--text2);font-size:11px">' + b.score + ' @ <span style="color:var(--purple-start);font-weight:700">' + b.odds + '</span></div>' +
            '</div>' +
            '<div style="text-align:right;flex-shrink:0;margin:0 8px">' +
              '<input type="number" value="' + b.amount + '" min="1" step="10" ' +
                'style="width:70px;padding:4px 6px;background:#F7F8FA;border:1px solid var(--border);border-radius:6px;font-size:11px;text-align:center" ' +
                'onchange="app.updateCartItemAmount(' + idx + ', this.value)" onclick="event.stopPropagation()">' +
              '<div style="font-size:10px;color:var(--green);margin-top:2px">赢 ' + returnAmt.toFixed(2) + ' USDT</div>' +
            '</div>' +
            '<button onclick="app.removeFromCart(' + idx + ')" style="background:none;border:none;color:var(--red);font-size:16px;cursor:pointer;padding:4px;flex-shrink:0">✕</button>' +
          '</div>';
        }).join('');
        if (cartSummary) {
          cartSummary.style.display = 'block';
          let totalSum = betCart.reduce(function(s, b) { return s + b.amount; }, 0);
          total.textContent = totalSum + ' USDT';
          let potentialEl = document.getElementById('cartPotential');
          if (potentialEl) potentialEl.textContent = totalPotential.toFixed(2) + ' USDT';
        }
      } else {
        let sum = betCart.reduce(function(s, b) { return s + b.amount; }, 0);
        if (total) total.textContent = sum + ' USDT';
      }
    }
  }

  async function submitCart() {
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    if (betCart.length === 0) return;

    let total = betCart.reduce(function(s, b) { return s + b.amount; }, 0);
    if (ethersReady && walletProvider && currentDetailMatchId) {
      let allSuccess = true;
      for (let ci = 0; ci < betCart.length; ci++) {
        let b = betCart[ci];
        let cell = scoreToCellIndex(b.score);
        if (cell < 0) { allSuccess = false; continue; }
        let tx = await contractPlaceAntiBet(currentDetailMatchId, cell, b.amount);
        if (tx) {
          betRecords.unshift({
            id: Date.now() + ci, team: b.matchName + ' ' + b.score,
            type: '比分投注', amount: b.amount, odds: b.odds,
            potentialWin: (b.amount * b.odds).toFixed(2),
            time: new Date().toLocaleString('zh-CN'), status: 'pending', tx: tx
          });
        } else { allSuccess = false; }
      }
      betCart = [];
      updateCartUI();
      updateBadges();
      saveData();
      spawnConfetti();
      if (allSuccess) {
        showToast('链上投注已全部提交！共 ' + total + ' USDT');
      } else {
        showToast('部分链上投注已提交，请检查记录');
      }
      return;
    }

    betCart.forEach(function(b) {
      betRecords.unshift({
        id: Date.now() + Math.random(), team: b.matchName + ' ' + b.score,
        type: '比分投注', amount: b.amount, odds: b.odds,
        score: b.score, matchName: b.matchName,
        potentialWin: (b.amount * b.odds).toFixed(2),
        time: new Date().toLocaleString('zh-CN'), status: 'pending'
      });
    });
    userBalance += total;
    betCart = [];
    updateCartUI();
    updateBadges();
    saveData();
    spawnConfetti();
    showToast('已提交 ' + total + ' USDT 投注！\uD83C\uDF89');
  }
  function spawnConfetti() {
    let colors = ['#DC143C','#DAA520','#FFD700','#03A66D','#667eea','#f5576c'];
    for (let i = 0; i < 50; i++) {
      setTimeout(function() {
        let piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + '%';
        piece.style.top = -(Math.random() * 100) + 'px';
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.width = (6 + Math.random() * 10) + 'px';
        piece.style.height = (6 + Math.random() * 10) + 'px';
        piece.style.animationDuration = (1.2 + Math.random() * 2.5) + 's';
        piece.style.animationDelay = '0s';
        piece.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
        document.body.appendChild(piece);
        setTimeout(function() { piece.remove(); }, 3500);
      }, i * 20);
    }
  }
  function updateBadges() {
    let badge = document.getElementById('badge-records');
    let badgeMenu = document.getElementById('badge-records-menu');
    if (!badge && !badgeMenu) return;
    let pending = betRecords.filter(function(r) { return r.status === 'pending'; }).length;
    let count = pending > 99 ? '99+' : pending;
    [badge, badgeMenu].forEach(function(b) {
      if (!b) return;
      if (pending > 0) {
        b.textContent = count;
        b.classList.add('show');
      } else {
        b.classList.remove('show');
      }
    });
  }
  function renderSparkline(containerId, data, color) {
    let container = document.getElementById(containerId);
    if (!container) return;
    let max = Math.max.apply(null, data.concat([1]));
    container.innerHTML = data.map(function(v) {
      let h = Math.max(4, (v / max) * 100);
      return '<div class="sparkline-bar" style="height:' + h + '%;background:' + (color || 'var(--gold)') + '"></div>';
    }).join('');
  }
  let pullStart = 0;
  let pullDistance = 0;
  let pullingDown = false;
  const pullThreshold = 70;

  function addPassiveScroll(el, fn) {
    if (el) el.addEventListener('scroll', fn, { passive: true });
  }
  function initPullRefresh() {
    let main = document.querySelector('.main') || document.body;
    let indicator = document.getElementById('pullIndicator');
    if (!indicator) return;

    main.addEventListener('touchstart', function(e) {
      if (window.scrollY <= 5 && e.touches.length === 1) {
        pullStart = e.touches[0].clientY;
        pullDistance = 0;
        pullingDown = false;
      } else {
        pullStart = 0;
      }
    }, { passive: true });

    main.addEventListener('touchmove', function(e) {
      if (pullStart === 0) return;
      let dy = e.touches[0].clientY - pullStart;
      pullDistance = dy;
      if (dy > 20 && !pullingDown) {
        pullingDown = true;
        indicator.classList.add('active');
        let pullText = indicator.querySelector('.pull-text');
        if (pullText) pullText.textContent = '下拉刷新';
      }
      if (dy > pullThreshold && indicator.classList.contains('active')) {
        let pullText = indicator.querySelector('.pull-text');
        if (pullText) pullText.textContent = '释放刷新';
      }
    }, { passive: true });

    main.addEventListener('touchend', async function() {
      if (!pullingDown) { pullStart = 0; return; }
      if (pullDistance > pullThreshold && indicator && indicator.classList.contains('active')) {
        indicator.classList.add('refreshing');
        let pullText = indicator.querySelector('.pull-text');
        if (pullText) pullText.textContent = '刷新中...';

        await renderMatchCards();
        await renderChampionBet();
        await renderRecords(currentFilter || 'all');

        indicator.classList.remove('refreshing');
        indicator.classList.remove('active');
        let pullText2 = indicator.querySelector('.pull-text');
        if (pullText2) pullText2.textContent = '下拉刷新';
      } else {
        indicator.classList.remove('active');
        let pullText = indicator.querySelector('.pull-text');
        if (pullText) pullText.textContent = '下拉刷新';
      }
      pullStart = 0;
      pullDistance = 0;
      pullingDown = false;
    }, { passive: true });
  }
  async function renderRecords(filter) {
    let container = document.getElementById('records-list');
    if (!container) return;

    container.innerHTML = Array(4).fill(0).map(function() {
      return '<div class="record-item" style="pointer-events:none">' +
        '<div style="margin-bottom:6px"><div class="skeleton-line shimmer" style="width:40%;height:12px;border-radius:3px;margin-bottom:4px"></div><div class="skeleton-line shimmer" style="width:50%;height:10px;border-radius:3px"></div></div>' +
        '<div class="skeleton-line shimmer" style="width:70%;height:14px;border-radius:3px;margin-bottom:8px"></div>' +
        '<div style="display:flex;justify-content:space-between"><div class="skeleton-line shimmer" style="width:60px;height:16px;border-radius:3px"></div><div class="skeleton-line shimmer" style="width:40px;height:16px;border-radius:3px"></div></div>' +
      '</div>';
    }).join('');

    let records = betRecords;

    if (apiAvailable && walletAddress) {
      let res = await apiCall('/bets?address=' + encodeURIComponent(walletAddress));
      if (res && res.code === 0 && res.data.length > 0) {
        records = res.data.map(function(r) { return {
          id: r.id, team: r.team_name, type: r.bet_type_name,
          amount: r.amount, odds: r.odds, potentialWin: r.potential_win,
          time: new Date(r.created_at).toLocaleString('zh-CN'), status: r.status
        }; });
      }
    }

    if (filter === 'pending') records = records.filter(function(r) { return r.status === 'pending'; });
    if (filter === 'won') records = records.filter(function(r) { return r.status === 'won'; });
    if (filter === 'lost') records = records.filter(function(r) { return r.status === 'lost'; });

    await new Promise(function(r) { setTimeout(r, 250); });

    if (records.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="e-icon">\uD83D\uDCCB</div><div class="e-text">暂无投注记录</div></div>';
      return;
    }

    container.style.opacity = '0';
    container.innerHTML = records.map(function(r) {
      let cls = r.status === 'won' ? 'positive' : r.status === 'lost' ? 'negative' : 'pending';
      let txt = r.status === 'won' ? '已赢' : r.status === 'lost' ? '已输' : '进行中';
      return '<div class="record-item">\n        <div><div class="r-league">' + r.type + '</div><div class="r-time">' + r.time + '</div></div>\n        <div class="r-match">' + r.team + '</div>\n        <div class="r-amount"><div>$' + r.amount + '</div><div class="' + cls + '">' + txt + '</div></div>\n      </div>';
    }).join('');
    container.style.transition = 'opacity 0.35s ease';
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        container.style.opacity = '1';
        initRippleEffects();
      });
    });
  }

  function filterRecords(filter, evt) {
    currentFilter = filter;
    document.querySelectorAll('#page-records .record-filter button').forEach(function(b) { b.classList.remove('active'); });
    if (evt && evt.target) evt.target.classList.add('active');
    renderRecords(filter);
    updateBadges();
  }
  let lastProfileBalance = 0;

  function renderProfile() {
    var connectBtn = document.getElementById('wallet-connect-btn');
    if (connectBtn) {
      connectBtn.style.display = walletAddress ? 'none' : 'block';
    }

    if (walletAddress) {
      document.getElementById('profile-addr').textContent =
        walletAddress.substring(0, 6) + '...' + walletAddress.substring(walletAddress.length - 4);
      document.getElementById('profile-name').textContent = '19888 用户';
      let balEl = document.getElementById('profile-balance');
      let newBal = userBalance;
      if (Math.abs(newBal - lastProfileBalance) > 0.01 && balEl) {
        animateCountUp(balEl, lastProfileBalance, newBal, 500);
      } else if (balEl) {
        balEl.textContent = newBal.toFixed(2);
      }
      lastProfileBalance = newBal;

      (document.getElementById('wallet-status') || {}).innerHTML = '<div class="m-left"><span class="m-icon">👛</span> 钱包连接</div><span style="color:var(--green);margin-right:10px">● 已连接</span>';
    } else {
      document.getElementById('profile-addr').textContent = '未连接';
      document.getElementById('profile-name').textContent = '请连接钱包';
      document.getElementById('profile-balance').textContent = '0.00';
      (document.getElementById('wallet-status') || {}).innerHTML = '<div class="m-left"><span class="m-icon">👛</span> 钱包连接</div><span style="color:var(--text-muted);margin-right:10px">○ 未连接</span>';
    }
    renderVIPStatus();
    updateAIInvestUI();
  }
  function detectWallet() {
    if (typeof window.ethereum !== 'undefined') {
      if (window.ethereum.isTokenPocket || window.ethereum.isTP) return window.ethereum;
      if (window.ethereum.isTrust) return window.ethereum;
      if (window.ethereum.isMetaMask) return window.ethereum;
      return window.ethereum;
    }
    if (typeof window.tpWallet !== 'undefined') return window.tpWallet;
    if (typeof window.trustwallet !== 'undefined') return window.trustwallet;
    if (typeof window.imToken !== 'undefined') return window.imToken;
    if (typeof window.ethereum !== 'undefined') {
      const providers = window.ethereum.providers;
      if (providers && providers.length) {
        const tp = providers.find(p => p.isTokenPocket || p.isTP);
        if (tp) return tp;
        return providers[0];
      }
    }
    return null;
  }
  async function connectWalletWithRetry(maxRetries) {
    maxRetries = maxRetries || 3;
    for (let i = 0; i < maxRetries; i++) {
      const provider = detectWallet();
      if (provider) return provider;
      if (i < maxRetries - 1) await new Promise(r => setTimeout(r, 500));
    }
    return null;
  }

  async function connectWallet() {
    try {
      if (typeof window.ethereum !== 'undefined') {
        var accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (accounts && accounts.length > 0) {
          walletAddress = accounts[0];
          walletProvider = window.ethereum;
          if (typeof ethers !== 'undefined') {
            walletSigner = await new ethers.BrowserProvider(window.ethereum).getSigner();
          }
          await switchToSepolia();
          showToast('钱包已连接: ' + walletAddress.substring(0,6) + '...' + walletAddress.substring(38));
          updateWalletUI();
          renderProfile();
          refreshBalance();
          apiCall('/wallet/connect', { method:'POST', body: JSON.stringify({ wallet_address: walletAddress }) });
          if (walletProvider && walletProvider.on) {
            walletProvider.on('accountsChanged', function(newAcc) {
              if (newAcc.length === 0) { disconnectWallet(); }
              else { walletAddress = newAcc[0]; updateWalletUI(); renderProfile(); }
            });
          }
          return;
        }
      }
      showToast('未检测到钱包，请安装 MetaMask');
    } catch(e) {
      showToast('连接失败: ' + (e.message || '请重试'));
    }
  }

  function updateWalletUI() {
    let btn = document.getElementById('wallet-btn');
    let addrSpan = document.getElementById('wallet-addr');
    if (walletAddress) {
      addrSpan.textContent = walletAddress.substring(walletAddress.length - 4);
      btn.classList.add('connected');
    } else {
      addrSpan.textContent = '钱包';
      btn.classList.remove('connected');
    }
  }

  function toggleWallet() {
    if (walletAddress) { if (confirm('断开钱包连接？')) disconnectWallet(); }
    else { connectWallet(); }
  }

  function disconnectWallet() {
    walletAddress = null; walletProvider = null;
    updateWalletUI(); renderProfile();
    showToast('已断开连接');
  }
  function openLangModal() { document.getElementById('lang-modal').classList.add('show'); }
  function closeLangModal() { document.getElementById('lang-modal').classList.remove('show'); }
  function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('19888_lang', lang);
    document.querySelectorAll('.lang-option').forEach(function(o) { o.classList.remove('selected'); });
    let opt = document.querySelector('.lang-option[data-lang="' + lang + '"]');
    if (opt) opt.classList.add('selected');
    closeLangModal();
    showToast('语言已切换');
    }
  function showToast(message) {
    let toast = document.getElementById('toast');
    toast.textContent = message; toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(function() { toast.classList.remove('show'); }, 2000);
  }

  function saveData() {
    try { localStorage.setItem('19888_bet_records', JSON.stringify(betRecords)); localStorage.setItem('19888_balance', userBalance); } catch(e) {}
  }
  function loadData() {
    try { let r = localStorage.getItem('19888_bet_records'); if (r) betRecords = JSON.parse(r); userBalance = +localStorage.getItem('19888_balance') || 0; } catch(e) {}
  }
  function updateCountdown() {
    let el = document.getElementById('countdown');
    if (!el) return;
    let diff = new Date('2026-06-11T00:00:00').getTime() - Date.now();
    if (diff <= 0) { el.textContent = '世界杯已开幕！'; return; }
    let d = Math.floor(diff/86400000), h = Math.floor((diff%86400000)/3600000);
    let m = Math.floor((diff%3600000)/60000), s = Math.floor((diff%60000)/1000);
    el.textContent = '世界杯倒计时：' + d + '天' + h + '小时' + m + '分' + s + '秒';
  }
  function toggleNotifications(e) {
    if (e) e.stopPropagation();
    const panel = document.getElementById('notify-dropdown');
    if (!panel) return;
    panel.classList.toggle('show');
    }

  function openPromoModal() {
    const overlay = document.getElementById('promo-overlay');
    if (overlay) overlay.classList.add('show');
    }

  function closePromoModal() {
    const overlay = document.getElementById('promo-overlay');
    if (overlay) overlay.classList.remove('show');
  }
  var MOCK_LINEUPS = {
    1: { // match ID 1
      formation: '4-3-3',
      home: { name: '荷兰', color: '#FF6B00', players: [
        {num:1,name:'维尔布鲁根',pos:'GK'},{num:2,name:'邓弗里斯',pos:'RB'},
        {num:3,name:'德里赫特',pos:'CB'},{num:4,name:'范戴克',pos:'CB'},
        {num:5,name:'阿克',pos:'LB'},{num:6,name:'德容',pos:'CM'},
        {num:7,name:'赖因德斯',pos:'CM'},{num:8,name:'库普梅纳斯',pos:'CM'},
        {num:9,name:'加克波',pos:'LW'},{num:10,name:'德佩',pos:'ST'},
        {num:11,name:'西蒙斯',pos:'RW'}
      ]},
      away: { name: '法国', color: '#002395', players: [
        {num:1,name:'迈尼昂',pos:'GK'},{num:2,name:'孔德',pos:'RB'},
        {num:3,name:'萨利巴',pos:'CB'},{num:4,name:'于帕梅卡诺',pos:'CB'},
        {num:5,name:'特奥',pos:'LB'},{num:6,name:'楚阿梅尼',pos:'DM'},
        {num:7,name:'卡马文加',pos:'CM'},{num:8,name:'格列兹曼',pos:'AM'},
        {num:9,name:'登贝莱',pos:'RW'},{num:10,name:'姆巴佩',pos:'ST'},
        {num:11,name:'巴尔科拉',pos:'LW'}
      ]}
    }
  };

  function renderLineup(match) {
    var pitch = document.getElementById('lineup-pitch');
    if (!pitch) return;

    var data = MOCK_LINEUPS[match.id] || MOCK_LINEUPS[1];
    var html = '';
    html += '<div class="lineup-formation">⚽ ' + data.formation + '</div>';
    html += '<div class="lineup-team">';
    html += '<div class="lineup-team-header" style="color:' + data.home.color + '">🏠 ' + data.home.name + '</div>';
    html += '<div class="lineup-players">';
    data.home.players.forEach(function(p) {
      html += '<div class="lineup-player"><span class="lp-num">' + p.num + '</span><span class="lp-name">' + p.name + '</span><span class="lp-pos">' + p.pos + '</span></div>';
    });
    html += '</div></div>';
    html += '<div class="lineup-vs">VS</div>';
    html += '<div class="lineup-team">';
    html += '<div class="lineup-team-header" style="color:' + data.away.color + '">🚩 ' + data.away.name + '</div>';
    html += '<div class="lineup-players">';
    data.away.players.forEach(function(p) {
      html += '<div class="lineup-player"><span class="lp-num">' + p.num + '</span><span class="lp-name">' + p.name + '</span><span class="lp-pos">' + p.pos + '</span></div>';
    });
    html += '</div></div>';

    pitch.innerHTML = html;
  }

  function switchDetailTab(el, tabId) {
    document.querySelectorAll('#page-detail .detail-tab').forEach(function(b) { b.classList.remove('active'); });
    if (el) el.classList.add('active');
    document.querySelectorAll('#page-detail .detail-tab-body').forEach(function(d) { d.style.display = 'none'; });
    let target = document.getElementById(tabId);
    if (target) target.style.display = 'block';
    if (tabId === 'tab-h2h') renderH2H();
    if (tabId === 'tab-recent') renderRecentForm();
    if (tabId === 'tab-score' && currentDetailMatchId) {
      let match = mockMatches.find(function(m) { return m.id === currentDetailMatchId; });
      if (match) loadScoreGrid(match);
    }
    }
  function loadScoreGrid(match) {
    let grid = document.getElementById('score-grid');
    if (!grid) return;

    let scores = computeCorrectScoreOdds ?
      scoreGrid18.map(function(s) { return { score: s, odds: computeCorrectScoreOdds(s) }; }) :
      [
        { score: '1:0', odds: 6.50 }, { score: '2:1', odds: 8.50 }, { score: '1:1', odds: 7.20 },
        { score: '2:0', odds: 9.50 }, { score: '3:1', odds: 15.00 }, { score: '0:0', odds: 11.00 },
        { score: '3:0', odds: 18.00 }, { score: '2:2', odds: 14.00 }, { score: '0:1', odds: 7.00 },
        { score: '1:2', odds: 18.00 }, { score: '3:2', odds: 28.00 }, { score: '0:2', odds: 20.00 },
        { score: '1:3', odds: 38.00 }, { score: '4:1', odds: 45.00 }, { score: '0:3', odds: 50.00 },
        { score: '3:3', odds: 80.00 }, { score: '4:0', odds: 65.00 }, { score: '4:2', odds: 90.00 }
      ];

    grid.innerHTML = scores.map(function(s) {
      let oddsColor = s.odds < 10 ? 'var(--green)' : s.odds < 20 ? 'var(--purple-start)' : s.odds < 50 ? 'var(--accent-mid)' : 'var(--red)';
      return '<div class="score-cell" style="background:var(--surface);border-radius:10px;padding:12px 8px;text-align:center;box-shadow:var(--shadow);cursor:pointer;transition:all .2s;border:2px solid transparent" onclick="app.selectScoreBet(\'' + s.score + '\', ' + s.odds + ')" onmouseover="this.style.borderColor=\'var(--accent)\';this.style.transform=\'translateY(-2px)\'" onmouseout="this.style.borderColor=\'transparent\';this.style.transform=\'none\'">' +
        '<b style="font-size:15px;display:block;color:var(--text)">' + s.score + '</b>' +
        '<span style="font-size:13px;font-weight:700;color:' + oddsColor + '">' + s.odds + '</span>' +
      '</div>';
    }).join('');

    initRippleEffects();
  }

  let scoreBetData = null;

  function selectScoreBet(score, odds) {
    scoreBetData = { score: score, odds: odds };
    document.getElementById('score-bet-selection').textContent = score + ' @ ' + odds + 'x';
    document.getElementById('score-bet-odds').textContent = odds;
    document.getElementById('score-bet-amount').value = '';
    document.getElementById('score-bet-profit').textContent = '0.00';
    document.getElementById('score-bet-info').style.display = 'block';
    document.getElementById('score-bet-amount').focus();
    }

  function updateScoreBetProfit() {
    let amount = parseFloat(document.getElementById('score-bet-amount').value) || 0;
    if (scoreBetData) {
      let profit = amount > 0 ? (amount * scoreBetData.odds - amount) : 0;
      document.getElementById('score-bet-profit').textContent = profit.toFixed(2);
    }
  }

  function confirmScoreBet() {
    if (!scoreBetData) { showToast('请先选择一个比分'); return; }
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    let amount = parseFloat(document.getElementById('score-bet-amount').value) || 0;
    if (amount < 1) { showToast('请输入有效投注金额(最低1 USDT)'); return; }

    let record = {
      id: Date.now(),
      team: scoreBetData.score,
      type: '正波膽',
      amount: amount,
      odds: scoreBetData.odds,
      potentialWin: (amount * scoreBetData.odds).toFixed(2),
      time: new Date().toLocaleString('zh-CN'),
      status: 'pending'
    };
    betRecords.unshift(record);
    userBalance -= amount;
    saveData();
    clearScoreBet();
    spawnConfetti();
    showToast('正波膽投注成功！' + scoreBetData.score + ' @ ' + scoreBetData.odds + 'x · ' + amount + ' USDT');
    updateBadges();
  }

  function clearScoreBet() {
    scoreBetData = null;
    document.getElementById('score-bet-info').style.display = 'none';
    document.getElementById('score-bet-selection').textContent = '';
    document.getElementById('score-bet-amount').value = '';
    document.getElementById('score-bet-profit').textContent = '0.00';
    document.getElementById('score-bet-odds').textContent = '--';
  }
  let championDetailData = null;

  function selectChampionSide(side) {
    let homeCard = document.getElementById('champion-home-card');
    let awayCard = document.getElementById('champion-away-card');
    let homeOdds = parseFloat(document.getElementById('champion-home-odds').textContent) || 1.90;
    let awayOdds = parseFloat(document.getElementById('champion-away-odds').textContent) || 2.05;
    let homeName = document.getElementById('champion-home-name').textContent;
    let awayName = document.getElementById('champion-away-name').textContent;
    if (homeCard) homeCard.style.borderColor = 'transparent';
    if (awayCard) awayCard.style.borderColor = 'transparent';

    if (side === 'home') {
      championDetailData = { side: 'home', team: homeName, odds: homeOdds, type: '冠军' };
      if (homeCard) homeCard.style.borderColor = 'var(--accent)';
    } else {
      championDetailData = { side: 'away', team: awayName, odds: awayOdds, type: '冠军' };
      if (awayCard) awayCard.style.borderColor = 'var(--accent)';
    }

    showChampionBetPanel();
    }

  function selectChampionRunnerup(side) {
    let homeCard = document.getElementById('runnerup-home-card');
    let awayCard = document.getElementById('runnerup-away-card');
    let homeOdds = parseFloat(document.getElementById('runnerup-home-odds').textContent) || 4.20;
    let awayOdds = parseFloat(document.getElementById('runnerup-away-odds').textContent) || 4.50;
    let homeName = document.getElementById('runnerup-home-name').textContent;
    let awayName = document.getElementById('runnerup-away-name').textContent;
    if (homeCard) homeCard.style.borderColor = 'transparent';
    if (awayCard) awayCard.style.borderColor = 'transparent';

    if (side === 'home') {
      championDetailData = { side: 'home', team: homeName, odds: homeOdds, type: '亚军' };
      if (homeCard) homeCard.style.borderColor = 'var(--accent)';
    } else {
      championDetailData = { side: 'away', team: awayName, odds: awayOdds, type: '亚军' };
      if (awayCard) awayCard.style.borderColor = 'var(--accent)';
    }

    showChampionBetPanel();
    }

  function showChampionBetPanel() {
    if (!championDetailData) return;
    document.getElementById('champion-bet-selection').textContent = championDetailData.team + ' · ' + championDetailData.type;
    document.getElementById('champion-bet-odds').textContent = championDetailData.odds;
    document.getElementById('champion-bet-amount').value = '';
    document.getElementById('champion-bet-profit').textContent = '0.00';
    document.getElementById('champion-bet-panel').style.display = 'block';
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        let inp = document.getElementById('champion-bet-amount');
        if (inp) inp.focus();
      });
    });
  }

  function updateChampionBetProfit() {
    let amount = parseFloat(document.getElementById('champion-bet-amount').value) || 0;
    if (championDetailData) {
      let profit = amount > 0 ? (amount * championDetailData.odds - amount) : 0;
      document.getElementById('champion-bet-profit').textContent = profit.toFixed(2);
    }
  }

  function confirmChampionBet() {
    if (!championDetailData) { showToast('请先选择投注方'); return; }
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    let amount = parseFloat(document.getElementById('champion-bet-amount').value) || 0;
    if (amount < 1) { showToast('请输入有效投注金额(最低1 USDT)'); return; }

    let record = {
      id: Date.now(),
      team: championDetailData.team,
      type: championDetailData.type,
      amount: amount,
      odds: championDetailData.odds,
      potentialWin: (amount * championDetailData.odds).toFixed(2),
      time: new Date().toLocaleString('zh-CN'),
      status: 'pending'
    };
    betRecords.unshift(record);
    userBalance -= amount;
    saveData();
    clearChampionBet();
    spawnConfetti();
    showToast('冠亚投注成功！' + championDetailData.team + ' ' + championDetailData.type + ' @ ' + championDetailData.odds + 'x · ' + amount + ' USDT');
    updateBadges();
  }

  function clearChampionBet() {
    championDetailData = null;
    document.getElementById('champion-bet-panel').style.display = 'none';
    document.getElementById('champion-bet-selection').textContent = '';
    document.getElementById('champion-bet-amount').value = '';
    document.getElementById('champion-bet-profit').textContent = '0.00';
    document.getElementById('champion-bet-odds').textContent = '--';
    let homeCard = document.getElementById('champion-home-card');
    let awayCard = document.getElementById('champion-away-card');
    let rHomeCard = document.getElementById('runnerup-home-card');
    let rAwayCard = document.getElementById('runnerup-away-card');
    if (homeCard) homeCard.style.borderColor = 'transparent';
    if (awayCard) awayCard.style.borderColor = 'transparent';
    if (rHomeCard) rHomeCard.style.borderColor = 'transparent';
    if (rAwayCard) rAwayCard.style.borderColor = 'transparent';
  }

  function copyInviteCode() {
    navigator.clipboard.writeText('19888X7K2').then(() => showToast('邀请码已复制！')).catch(() => showToast('19888X7K2'));
  }

  function shareInviteLink() {
    const link = 'https://19888.asia/?ref=19888X7K2';
    navigator.clipboard.writeText(link).then(() => showToast('邀请链接已复制！分享给好友')).catch(() => showToast(link));
  }

  function markAllRead() {
    document.querySelectorAll('.notify-item').forEach(item => item.classList.remove('unread'));
    const badge = document.getElementById('header-notify-badge');
    if (badge) badge.style.display = 'none';
    showToast('全部已读');
  }

  function renderH2H() {
    const el = document.getElementById('detail-h2h');
    if (!el) return;
    el.innerHTML = '<div class="h2h-card"><div class="h2h-title">⚔️ 历史交锋（近5场）</div><div class="h2h-stats"><span>2胜</span><span>2平</span><span>1负</span></div><div class="h2h-matches"><div class="h2h-row"><span>2026-01-15</span><span class="h2h-score">巴黎 2-1 马赛</span><span class="h2h-result win">主胜</span></div><div class="h2h-row"><span>2025-11-09</span><span class="h2h-score">马赛 1-1 巴黎</span><span class="h2h-result draw">平</span></div><div class="h2h-row"><span>2025-05-03</span><span class="h2h-score">巴黎 3-0 马赛</span><span class="h2h-result win">主胜</span></div><div class="h2h-row"><span>2024-12-22</span><span class="h2h-score">马赛 2-2 巴黎</span><span class="h2h-result draw">平</span></div><div class="h2h-row"><span>2024-08-15</span><span class="h2h-score">马赛 2-0 巴黎</span><span class="h2h-result lose">客胜</span></div></div></div>';
  }

  function renderRecentForm() {
    const el = document.getElementById('detail-recent');
    if (!el) return;
    el.innerHTML = '<div class="recent-card"><div class="recent-team"><strong>巴黎圣日耳曼</strong> 近5场: <span class="form-char win">W</span><span class="form-char win">W</span><span class="form-char lose">L</span><span class="form-char draw">D</span><span class="form-char win">W</span> <span style="font-size:11px;color:var(--text3)">进12球/失5球</span></div><div class="recent-team" style="margin-top:10px"><strong>马赛</strong> 近5场: <span class="form-char win">W</span><span class="form-char win">W</span><span class="form-char win">W</span><span class="form-char draw">D</span><span class="form-char win">W</span> <span style="font-size:11px;color:var(--text3)">进8球/失2球</span></div></div>';
  }
  const VIP_TIERS = {
    1: { name: 'VIP 1', icon: '👑', title: '新晋会员', turnover: 20000, antiRebate: 0.2, scoreRebate: 1.0, aiRebate: 0.1 },
    2: { name: 'VIP 2', icon: '👑', title: '银牌会员', turnover: 100000, antiRebate: 0.4, scoreRebate: 2.0, aiRebate: 0.2 },
    3: { name: 'VIP 3', icon: '💎', title: '金牌会员', turnover: 1000000, antiRebate: 0.6, scoreRebate: 2.5, aiRebate: 0.3 },
    4: { name: 'VIP 4', icon: '💎', title: '铂金会员', turnover: 10000000, antiRebate: 0.7, scoreRebate: 3.0, aiRebate: 0.4 },
    5: { name: 'VIP 5', icon: '👑💎', title: '钻石会员', turnover: 50000000, antiRebate: 0.8, scoreRebate: 3.5, aiRebate: 0.5 }
  };

  let userVipLevel = 1;
  let userTurnover = 0;

  function computeVIPLevel(turnover) {
    let level = 0;
    for (let i = 5; i >= 1; i--) {
      if (turnover >= VIP_TIERS[i].turnover) { level = i; break; }
    }
    return level;
  }

  function renderVIPStatus() {
    let level = computeVIPLevel(userTurnover) || userVipLevel || 1;
    let tier = VIP_TIERS[level];
    let iconEl = document.getElementById('vip-level-icon');
    let nameEl = document.getElementById('vip-level-name');
    let titleEl = document.getElementById('vip-level-title');
    let tierBadgeEl = document.getElementById('vip-tier-badge');
    if (iconEl) iconEl.textContent = tier.icon;
    if (nameEl) nameEl.textContent = tier.name;
    if (titleEl) titleEl.textContent = tier.title;
    if (tierBadgeEl) {
      tierBadgeEl.textContent = tier.name;
      tierBadgeEl.className = 'vip-tier-badge vip-tier-' + level;
    }
    let antiRebateEl = document.getElementById('vip-anti-rebate');
    let scoreRebateEl = document.getElementById('vip-score-rebate');
    let aiRebateEl = document.getElementById('vip-ai-rebate');
    if (antiRebateEl) antiRebateEl.textContent = tier.antiRebate + '%';
    if (scoreRebateEl) scoreRebateEl.textContent = tier.scoreRebate + '%';
    if (aiRebateEl) aiRebateEl.textContent = tier.aiRebate + '%';
    let turnoverEl = document.getElementById('vip-turnover');
    let nextNeededEl = document.getElementById('vip-next-needed');
    let progressFillEl = document.getElementById('vip-progress-fill');

    if (turnoverEl) turnoverEl.textContent = '$' + userTurnover.toLocaleString();

    if (level >= 5) {
      if (nextNeededEl) nextNeededEl.textContent = '已达到最高等级 🎉';
      if (progressFillEl) progressFillEl.style.width = '100%';
    } else {
      let nextTier = VIP_TIERS[level + 1];
      let needed = nextTier.turnover - userTurnover;
      if (nextNeededEl) nextNeededEl.textContent = '$' + needed.toLocaleString();
      let progress = level > 0 ? (userTurnover - VIP_TIERS[level].turnover) / (nextTier.turnover - VIP_TIERS[level].turnover) * 100 : (userTurnover / nextTier.turnover) * 100;
      if (progressFillEl) {
        let newWidth = Math.min(100, Math.max(0, progress));
        progressFillEl.style.width = newWidth + '%';
      }
    }
    let menuBadge = document.querySelector('#page-profile .menu-badge');
    if (menuBadge) menuBadge.textContent = tier.name;
  }
  let aiInvestBalance = 0;
  let aiInvestProfit = 0;

  function aiDeposit() {
    let amount = parseFloat(document.getElementById('ai-deposit-amount').value);
    if (!amount || amount < 100) { showToast('最低存入 100 USDT'); return; }
    if (!walletAddress) { showToast('请先连接钱包'); return; }

    aiInvestBalance += amount;
    updateAIInvestUI();
    document.getElementById('ai-deposit-amount').value = '';
    userTurnover += amount;
    userVipLevel = computeVIPLevel(userTurnover);
    renderVIPStatus();
    saveData();

    showToast('AI 托管存入成功！' + amount + ' USDT');
  }

  function aiWithdraw() {
    let amount = parseFloat(document.getElementById('ai-withdraw-amount').value);
    if (!amount || amount < 10) { showToast('最低提取 10 USDT'); return; }
    if (amount > aiInvestBalance) { showToast('余额不足'); return; }
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    let fee = amount * 0.05;
    let netAmount = amount - fee;
    aiInvestBalance -= amount;
    if (aiInvestProfit > 0) aiInvestProfit = Math.max(0, aiInvestProfit - amount * 0.1);
    updateAIInvestUI();
    document.getElementById('ai-withdraw-amount').value = '';

    showToast('AI 提取成功！到手 ' + netAmount.toFixed(2) + ' USDT (手续费 ' + fee.toFixed(2) + ')');
    }

  function updateAIInvestUI() {
    let balEl = document.getElementById('ai-invest-balance');
    let profitEl = document.getElementById('ai-invest-profit');
    let aprEl = document.getElementById('ai-invest-apr');

    if (balEl) {
      let oldBal = parseFloat(balEl.textContent) || 0;
      let newBal = aiInvestBalance;
      if (Math.abs(newBal - oldBal) > 0.01) {
        animateCountUp(balEl, oldBal, newBal, 500);
      } else {
        balEl.textContent = aiInvestBalance.toFixed(2);
      }
    }
    if (profitEl) {
      profitEl.textContent = (aiInvestProfit >= 0 ? '+' : '') + aiInvestProfit.toFixed(2);
      profitEl.className = aiInvestProfit >= 0 ? 'ais-val green' : 'ais-val';
    }
    let dailyRate = aiInvestBalance > 0 ? (0.3 + Math.random() * 0.9) : 0;
    let monthlyReturn = aiInvestBalance * (Math.pow(1 + dailyRate/100, 30) - 1);
    let annualReturn = aiInvestBalance * (Math.pow(1 + dailyRate/100, 365) - 1);

    if (aprEl) {
      let monthlyRate = aiInvestBalance > 0 ? (monthlyReturn / aiInvestBalance * 100).toFixed(1) : '≈15';
      aprEl.textContent = '≈' + monthlyRate + '%';
    }
    let dailyRateEl = document.getElementById('ai-daily-rate');
    let monthlyRetEl = document.getElementById('ai-monthly-ret');
    let annualRetEl = document.getElementById('ai-annual-ret');
    if (dailyRateEl) dailyRateEl.textContent = dailyRate.toFixed(2) + '%';
    if (monthlyRetEl) monthlyRetEl.textContent = monthlyReturn.toFixed(2);
    if (annualRetEl) annualRetEl.textContent = annualReturn.toFixed(2);
    let settleEl = document.getElementById('ai-next-settle');
    if (settleEl) {
      let tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      settleEl.textContent = tomorrow.toISOString().split('T')[0] + ' 00:00 UTC+8';
    }
    let lockEl = document.getElementById('ai-lock-status');
    if (lockEl) {
      if (aiInvestBalance > 0) {
        lockEl.className = 'ai-lock-status locked';
        lockEl.innerHTML = '🔒 <span>锁定期 · 7天后解锁</span>';
      } else {
        lockEl.className = 'ai-lock-status unlocked';
        lockEl.innerHTML = '✅ <span>无锁定 · 可自由存取</span>';
      }
    }
    renderAISparkline();
  }
  function renderAISparkline() {
    let container = document.getElementById('ai-sparkline');
    if (!container) return;
    let data = [];
    let val = aiInvestBalance || 1000;
    let base = val * 0.85;
    for (let i = 0; i < 30; i++) {
      val = val * (1 + (Math.random() - 0.3) * 0.02);
      data.push(Math.max(base * 0.7, val));
    }

    let max = Math.max.apply(null, data);
    let min = Math.min.apply(null, data);
    let range = max - min || 1;

    container.innerHTML = data.map(function(v, i) {
      let h = ((v - min) / range) * 85 + 10;
      return '<div class="ai-sparkline-bar" style="height:' + h + '%;opacity:' + (0.5 + 0.5 * i/30) + '"></div>';
    }).join('');
  }
  let aiPredictDateFilter = 'today';

  function filterAiByDate(period, el, customDate) {
    aiPredictDateFilter = period;
    document.querySelectorAll('#page-ai-predict .date-filter-chip').forEach(function(c) { c.classList.remove('active'); });
    if (el) el.classList.add('active');
    showToast('已筛选: ' + (period === 'today' ? '今日' : period === 'tomorrow' ? '明日' : period === 'week' ? '本周' : '自定义日期'));
    }

  let recordsDateFilter = 'all';

  function filterRecordsByDate(period, el) {
    recordsDateFilter = period;
    document.querySelectorAll('#page-records .date-filter-chip').forEach(function(c) { c.classList.remove('active'); });
    if (el) el.classList.add('active');
    let now = new Date();
    let filtered = betRecords.filter(function(r) {
      let recordDate = new Date(r.time);
      if (isNaN(recordDate.getTime())) return true;
      switch(period) {
        case 'today':
          return recordDate.toDateString() === now.toDateString();
        case 'yesterday':
          let yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
          return recordDate.toDateString() === yesterday.toDateString();
        case 'week':
          let weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
          return recordDate >= weekAgo;
        case 'month':
          let monthAgo = new Date(now); monthAgo.setMonth(monthAgo.getMonth() - 1);
          return recordDate >= monthAgo;
        default:
          return true;
      }
    });
    renderFilteredRecords(filtered);
    }

  function renderFilteredRecords(records) {
    let container = document.getElementById('records-list');
    if (!container) return;
    if (records.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="e-icon">📋</div><div class="e-text">该时间段暂无投注记录</div></div>';
      return;
    }
    container.innerHTML = records.map(function(r) {
      let cls = r.status === 'won' ? 'positive' : r.status === 'lost' ? 'negative' : 'pending';
      let txt = r.status === 'won' ? '已赢' : r.status === 'lost' ? '已输' : '进行中';
      return '<div class="record-item">\n        <div><div class="r-league">' + r.type + '</div><div class="r-time">' + r.time + '</div></div>\n        <div class="r-match">' + r.team + '</div>\n        <div class="r-amount"><div>$' + r.amount + '</div><div class="' + cls + '">' + txt + '</div></div>\n      </div>';
    }).join('');
    initRippleEffects();
  }

  let recordsTypeFilter = 'all';

  function filterRecordsByType(type, evt) {
    recordsTypeFilter = type;
    document.querySelectorAll('#page-records .sub-nav-item').forEach(function(i) { i.classList.remove('active'); });
    if (evt && evt.target) evt.target.classList.add('active');
    let records = betRecords;
    if (type === 'anti') records = records.filter(function(r) { return r.type === '比分投注'; });
    if (type === 'score') records = records.filter(function(r) { return r.type === '正波膽'; });
    if (type === 'ai') records = records.filter(function(r) { return r.type === 'AI' || r.type === 'AI托管'; });
    if (type === 'champion') records = records.filter(function(r) { return r.type === '冠军' || r.type === '亚军'; });
    if (recordsDateFilter !== 'all') {
      let now = new Date();
      records = records.filter(function(r) {
        let recordDate = new Date(r.time);
        if (isNaN(recordDate.getTime())) return true;
        switch(recordsDateFilter) {
          case 'today': return recordDate.toDateString() === now.toDateString();
          case 'yesterday':
            let yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
            return recordDate.toDateString() === yesterday.toDateString();
          case 'week':
            let weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
            return recordDate >= weekAgo;
          case 'month':
            let monthAgo = new Date(now); monthAgo.setMonth(monthAgo.getMonth() - 1);
            return recordDate >= monthAgo;
          default: return true;
        }
      });
    }
    renderFilteredRecords(records);
    }
  function aiDepositPredict() {
    var amtEl = document.getElementById('ai-predict-deposit-amount');
    var amount = parseFloat(amtEl.value);
    if (!amount || amount < 100) { showToast('最低存入 100 USDT'); return; }
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    aiInvestBalance += amount;
    updateAIInvestPredictUI();
    amtEl.value = '';
    userTurnover += amount;
    userVipLevel = computeVIPLevel(userTurnover);
    renderVIPStatus();
    saveData();
    showToast('AI 托管存入成功！' + amount + ' USDT');
  }

  function aiWithdrawPredict() {
    var amtEl = document.getElementById('ai-predict-withdraw-amount');
    var amount = parseFloat(amtEl.value);
    if (!amount || amount < 10) { showToast('最低提取 10 USDT'); return; }
    if (amount > aiInvestBalance) { showToast('余额不足'); return; }
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    var fee = amount * 0.05;
    aiInvestBalance -= amount;
    if (aiInvestProfit > 0) aiInvestProfit = Math.max(0, aiInvestProfit - amount * 0.1);
    updateAIInvestPredictUI();
    amtEl.value = '';
    showToast('AI 提取成功！到手 ' + (amount - fee).toFixed(2) + ' USDT (手续费 ' + fee.toFixed(2) + ')');
    }

  function updateAIInvestPredictUI() {
    let balEl = document.getElementById('ai-predict-balance');
    let profitEl = document.getElementById('ai-predict-profit');
    let aprEl = document.getElementById('ai-predict-apr');
    if (balEl) balEl.textContent = aiInvestBalance.toFixed(2);
    if (profitEl) {
      profitEl.textContent = (aiInvestProfit >= 0 ? '+' : '') + aiInvestProfit.toFixed(2);
      profitEl.className = aiInvestProfit >= 0 ? 'ais-val green' : 'ais-val';
    }
    if (aprEl) {
      let monthlyRate = aiInvestBalance > 0 ? '≈15' : '≈15';
      aprEl.textContent = monthlyRate + '%';
    }
    let settleEl = document.getElementById('ai-predict-next-settle');
    if (settleEl) {
      let tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      settleEl.textContent = tomorrow.toISOString().split('T')[0] + ' 00:00 UTC+8';
    }
  }
  function updateProfileCountdown() {
    let daysEl = document.getElementById('cd-days');
    let hoursEl = document.getElementById('cd-hours');
    let minsEl = document.getElementById('cd-mins');
    let secsEl = document.getElementById('cd-secs');
    if (!daysEl) return;
    let diff = new Date('2026-06-11T00:00:00').getTime() - Date.now();
    if (diff <= 0) {
      if (daysEl) daysEl.textContent = '0';
      if (hoursEl) hoursEl.textContent = '0';
      if (minsEl) minsEl.textContent = '0';
      if (secsEl) secsEl.textContent = '0';
      return;
    }
    let d = Math.floor(diff / 86400000);
    let h = Math.floor((diff % 86400000) / 3600000);
    let m = Math.floor((diff % 3600000) / 60000);
    let s = Math.floor((diff % 60000) / 1000);
    if (daysEl) daysEl.textContent = d;
    if (hoursEl) hoursEl.textContent = String(h).padStart(2, '0');
    if (minsEl) minsEl.textContent = String(m).padStart(2, '0');
    if (secsEl) secsEl.textContent = String(s).padStart(2, '0');
  }
  async function init() {
    loadData();
    loadEthersAndInit();
    let savedLang = localStorage.getItem('19888_lang');
    if (savedLang) {
      currentLang = savedLang;
      document.querySelectorAll('.lang-option').forEach(function(o) { o.classList.remove('selected'); });
      let opt = document.querySelector('.lang-option[data-lang="' + savedLang + '"]');
      if (opt) opt.classList.add('selected');
    }
    try { apiAvailable = !!(await apiCall('/status')); } catch(e) { apiAvailable = false; }
    let betOverlay = document.getElementById('bet-dialog-overlay');
    if (betOverlay) betOverlay.addEventListener('click', function(e) { if (e.target === this) closeBetDialog(); });
    let langModal = document.getElementById('lang-modal');
    if (langModal) langModal.addEventListener('click', function(e) { if (e.target.classList.contains('lang-modal-mask')) closeLangModal(); });
    document.querySelectorAll('.quick-amounts button').forEach(function(btn) {
      btn.addEventListener('click', function() { document.getElementById('bet-amount-input').value = this.dataset.amount; updateBetProfit(); });
    });
    var amountInput = document.getElementById('bet-amount-input');
    if (amountInput) amountInput.addEventListener('input', debounce(updateBetProfit, 120));
    var scoreBetAmount = document.getElementById('score-bet-amount');
    if (scoreBetAmount) scoreBetAmount.addEventListener('input', debounce(updateScoreBetProfit, 120));
    var champBetAmount = document.getElementById('champion-bet-amount');
    if (champBetAmount) champBetAmount.addEventListener('input', debounce(updateChampionBetProfit, 120));
    var gridBetAmount = document.getElementById('grid-bet-amount');
    if (gridBetAmount) gridBetAmount.addEventListener('input', debounce(updateGridPayout, 120));
    var confirmBtn = document.getElementById('btn-confirm-bet');
    if (confirmBtn) confirmBtn.addEventListener('click', confirmBet);
    let cancelBtn = document.getElementById('btn-cancel-bet');
    if (cancelBtn) cancelBtn.addEventListener('click', closeBetDialog);
    initRippleEffects();
    startOddsFlash();
    initGestureBack();

    renderMatchCards();
    renderChampionBet();
    renderRecords('all');
    renderProfile();
    updateCountdown();
    updateProfileCountdown();
    updateBadges();
    idleTask(function() { initPullRefresh(); }, 3000);
    idleTask(function() { initSwipeCards(); }, 4000);
    let countdownInterval = setInterval(function() { updateCountdown(); updateProfileCountdown(); }, 1000);
    window._countdownInterval = countdownInterval;
    let sparkData = [2.1,1.8,3.2,2.9,4.1,3.5,2.7,5.0,4.3,3.1,6.2,5.8,4.0,7.5,6.1];
    renderSparkline('sparkline-ai', sparkData, 'var(--green)');
  }
  window.addEventListener('beforeunload', function() {
    if (window._countdownInterval) { clearInterval(window._countdownInterval); window._countdownInterval = null; }
    if (oddsFlashInterval) { clearInterval(oddsFlashInterval); oddsFlashInterval = null; }
    if (oddsFlashTimer) { clearTimeout(oddsFlashTimer); oddsFlashTimer = null; }
    // Cleanup tracked event listeners to prevent memory leaks
    if (typeof _cleanupHandlers !== 'undefined' && _cleanupHandlers.length) {
      for (var ci = 0; ci < _cleanupHandlers.length; ci++) {
        var h = _cleanupHandlers[ci];
        try { if (h.el && h.el.removeEventListener) h.el.removeEventListener(h.type, h.handler); } catch(e) {}
      }
      _cleanupHandlers.length = 0;
    }
    
    // Clear detached DOM nodes (confetti, ripples)
    var detached = document.querySelectorAll('.confetti-piece, .ripple-effect');
    for (var di = 0; di < detached.length; di++) detached[di].remove();
    
    stopOddsFlash();
  });
  window.onerror = function(message, source, lineno, colno, error) {
    return true;
  };
  window.app = {
    navigateTo: navigateTo,
    switchTab: switchTab,
    showChampion: showChampion,
    showAbout: showAbout,
    openBetDialog: openBetDialog,
    closeBetDialog: closeBetDialog,
    confirmBet: confirmBet,
    loadMatchDetail: loadMatchDetail,
    quickBet: quickBet,
    addToCart: addToCart,
    removeFromCart: removeFromCart,
    updateCartItemAmount: updateCartItemAmount,
    submitCart: submitCart,
    updateCartUI: updateCartUI,
    filterRecords: filterRecords,
    connectWallet: connectWallet,
    filterMatches: filterMatches,
    scrollTo: scrollToSection,
    toggleWallet: toggleWallet,
    openLangModal: openLangModal,
    closeLangModal: closeLangModal,
    setLanguage: setLanguage,
    updateBetProfit: updateBetProfit,
    showDepositModal: showDepositModal,
    showWithdrawModal: showWithdrawModal,
    submitWithdraw: submitWithdraw,
    refreshBalance: refreshBalance,
    goBackPage: goBackPage,createRipple: createRipple,
    contractDeposit: contractDeposit,
    contractWithdraw: contractWithdraw,
    contractPlaceAntiBet: contractPlaceAntiBet,
    contractPlaceChampionBet: contractPlaceChampionBet,
    getContractABI: getContractABI,
    loadEthersAndInit: loadEthersAndInit,
    computeAntiOdds: computeAntiOdds,
    computeCorrectScoreOdds: computeCorrectScoreOdds,
    computeAllAntiOdds: computeAllAntiOdds,
    computeChampionOdds: computeChampionOdds,
    computeRunnerUpOdds: computeRunnerUpOdds,
    settleMatchBets: settleMatchBets,
    settleChampionBets: settleChampionBets,
    getScoreProbabilities: function() { return SCORE_PROB_NORM; },
    loadScoreGrid: loadScoreGrid,
    selectScoreBet: selectScoreBet,
    updateScoreBetProfit: updateScoreBetProfit,
    confirmScoreBet: confirmScoreBet,
    clearScoreBet: clearScoreBet,
    selectChampionSide: selectChampionSide,
    selectChampionRunnerup: selectChampionRunnerup,
    updateChampionBetProfit: updateChampionBetProfit,
    confirmChampionBet: confirmChampionBet,
    clearChampionBet: clearChampionBet,
    toggleNotifications: toggleNotifications,
    openPromoModal: openPromoModal,
    closePromoModal: closePromoModal,
    switchDetailTab: switchDetailTab,
    copyInviteCode: copyInviteCode,
    shareInviteLink: shareInviteLink,
    markAllRead: markAllRead,
    aiDeposit: aiDeposit,
    aiWithdraw: aiWithdraw,
    updateAIInvestUI: updateAIInvestUI,
    updateGridPayout: updateGridPayout,
    triggerHaptic: triggerHaptic,
    renderAISparkline: renderAISparkline,
    showLoading: showLoading,
    hideLoading: hideLoading,
    filterAiByDate: filterAiByDate,
    filterRecordsByDate: filterRecordsByDate,
    filterRecordsByType: filterRecordsByType,
    aiDepositPredict: aiDepositPredict,
    aiWithdrawPredict: aiWithdrawPredict,
    updateAIInvestPredictUI: updateAIInvestPredictUI
  };
  function fastInit() {
    renderMatchCards();  // critical path: fetch from API
    startWorldCupCountdown();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fastInit);
  } else { fastInit(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }

  // Offline detection
  (function() {
    var banner = null;
    function createOfflineBanner() {
      banner = document.createElement('div');
      banner.className = 'offline-banner';
      banner.setAttribute('role', 'alert');
      banner.setAttribute('aria-live', 'assertive');
      banner.textContent = 'Network disconnected - some features unavailable';
      document.body.insertBefore(banner, document.body.firstChild);
    }
    function showOfflineBanner() {
      if (!banner) createOfflineBanner();
      banner.classList.add('visible');
    }
    function hideOfflineBanner() {
      if (banner) banner.classList.remove('visible');
    }
    window.addEventListener('online', function() {
      hideOfflineBanner();
      if (typeof showToast === 'function') showToast('Network restored');
      setTimeout(function() {
        if (typeof renderMatchCards === 'function') renderMatchCards();
      }, 500);
    });
    window.addEventListener('offline', function() {
      showOfflineBanner();
      if (typeof showToast === 'function') showToast('Network disconnected');
    });
    if (!navigator.onLine) showOfflineBanner();
  })();

})();