/**
 * 19888 反波膽平台 - Application Logic v4 (Premium - Beyond Lucky944)
 * API-first with mock fallback. SPA with tab navigation, wallet connect, betting.
 * Enhanced: directional odds flash, swipeable cards, count-up animation, gesture-back,
 * hot ranking leaderboard, multi-layered sound system, ripple touch.
 */
(function() {
  'use strict';

  // ==================== ADMIN DATA LOADER ====================
  function loadAdminMatches() {
    try { const d = localStorage.getItem('19888_matches'); if (d) return JSON.parse(d); } catch {}
    try { const d = localStorage.getItem('19888_admin_matches'); if (d) return JSON.parse(d); } catch {}
    return null;
  }
  function loadAdminTeams() {
    try { const d = localStorage.getItem('19888_champion_teams'); if (d) return JSON.parse(d); } catch {}
    try { const d = localStorage.getItem('19888_admin_teams'); if (d) return JSON.parse(d); } catch {}
    return null;
  }

  // ==================== CONFIG ====================
  var API_BASE = '/api';
  var apiAvailable = false;

  // ==================== STATE ====================
  var walletAddress = null;
  var walletProvider = null;
  var currentPage = 'home';
  var currentTab = 'recommend';
  var currentLang = 'cn';

  // Page navigation history stack for gesture-back
  var pageHistory = ['home'];

  // USDT / BSC
  var BSC_RPC = 'https://bsc-dataseed.binance.org/';
  var USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';
  var USDT_DECIMALS = 18;
  var PLATFORM_ADDRESS = '0x4B16c5dE96eB2117bBE5Fd171E4d20361976F324';
  var usdtBalance = 0;
  var currentDetailMatchId = null;

  // ==================== CONTRACT ADDRESSES (Anvil local -> BSC testnet for prod) ====================
  var CONTRACT_USDT = '0x0B306BF915C4d645ff596e518fAf3F9669b97016';
  var CONTRACT_POOL = '0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE';
  var CONTRACT_ANTI = '0x3Aa5ebB10DC797CAC828524e59A333d0A371443c';
  var CONTRACT_CHAMP = '0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44';
  var BSC_USDT_REAL = '0x55d398326f99059fF775485246999027B3197955';
  var viemLoaded = false;

  // ==================== DYNAMIC VIEM CDN LOADER ====================
  function loadViemCDN(cb) {
    if (typeof window.viem !== 'undefined' && window.viem.encodeFunctionData) {
      viemLoaded = true; if (cb) cb(); return;
    }
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/viem@2.21.55/dist/umd/index.js';
    script.onload = function() {
      if (typeof window.viem !== 'undefined' && window.viem.encodeFunctionData) viemLoaded = true;
      if (cb) cb();
    };
    script.onerror = function() {
      console.warn('[19888] viem CDN load failed. On-chain disabled, using localStorage fallback.');
      if (cb) cb();
    };
    document.head.appendChild(script);
  }

  // ==================== SCORE-TO-CELL INDEX MAPPING ====================
  function scoreToCellIndex(score) {
    return scoreGrid18.indexOf(score);
  }

  // ==================== CONTRACT ABIs (minimal) ====================
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
        { type:'function', name:'balanceOf', inputs:[{name:'user',type:'address'}], outputs:[{type:'uint256'}], stateMutability:'view' }
      ];
      case 'ANTI': return [
        { type:'function', name:'placeBet', inputs:[{name:'matchId',type:'uint256'},{name:'cell',type:'uint8'},{name:'amount',type:'uint256'}], outputs:[], stateMutability:'nonpayable' },
        { type:'function', name:'createMatch', inputs:[{name:'homeTeam',type:'string'},{name:'awayTeam',type:'string'},{name:'matchTime',type:'uint256'},{name:'odds',type:'uint256[]'}], outputs:[], stateMutability:'nonpayable' }
      ];
      case 'CHAMP': return [
        { type:'function', name:'placeBet', inputs:[{name:'teamId',type:'uint256'},{name:'betType',type:'uint8'},{name:'amount',type:'uint256'}], outputs:[], stateMutability:'nonpayable' },
        { type:'function', name:'setResult', inputs:[{name:'teamId',type:'uint256'},{name:'resultType',type:'uint8'}], outputs:[], stateMutability:'nonpayable' }
      ];
      default: return [];
    }
  }

  // ==================== ON-CHAIN HELPERS ====================
  async function contractApprove(spender, amount) {
    if (!viemLoaded || !walletProvider) return null;
    try {
      var abi = getContractABI('USDT');
      var parsed = window.viem.parseUnits(String(amount), 18);
      var data = window.viem.encodeFunctionData({ abi:abi, functionName:'approve', args:[spender, parsed] });
      var tx = await walletProvider.request({ method:'eth_sendTransaction', params:[{ from:walletAddress, to:CONTRACT_USDT, data:data }] });
      return tx;
    } catch(e) { console.error('[19888] approve error:', e); return null; }
  }

  async function contractDeposit(amount) {
    if (!viemLoaded || !walletProvider) { showToast('链上交互不可用，请确保已连接钱包'); return null; }
    try {
      showToast('请在钱包中确认授权...');
      var approveTx = await contractApprove(CONTRACT_POOL, amount);
      if (!approveTx) { showToast('授权失败或已取消'); return null; }
      showToast('授权成功，请在钱包中确认充值...');
      var abi = getContractABI('POOL');
      var parsed = window.viem.parseUnits(String(amount), 18);
      var data = window.viem.encodeFunctionData({ abi:abi, functionName:'deposit', args:[parsed] });
      var tx = await walletProvider.request({ method:'eth_sendTransaction', params:[{ from:walletAddress, to:CONTRACT_POOL, data:data }] });
      showToast('链上充值已提交！TX: ' + tx.substring(0, 14) + '...');
      refreshBalance();
      return tx;
    } catch(e) { console.error('[19888] deposit error:', e); showToast('充值失败: ' + (e.message || '未知错误')); return null; }
  }

  async function contractWithdraw(amount) {
    if (!viemLoaded || !walletProvider) { showToast('链上交互不可用'); return null; }
    try {
      showToast('请在钱包中确认提现...');
      var abi = getContractABI('POOL');
      var parsed = window.viem.parseUnits(String(amount), 18);
      var data = window.viem.encodeFunctionData({ abi:abi, functionName:'withdraw', args:[parsed] });
      var tx = await walletProvider.request({ method:'eth_sendTransaction', params:[{ from:walletAddress, to:CONTRACT_POOL, data:data }] });
      showToast('链上提现已提交！TX: ' + tx.substring(0, 14) + '...');
      refreshBalance();
      return tx;
    } catch(e) { console.error('[19888] withdraw error:', e); showToast('提现失败: ' + (e.message || '未知错误')); return null; }
  }

  async function contractPlaceAntiBet(matchId, cell, amount) {
    if (!viemLoaded || !walletProvider) return null;
    try {
      var approveTx = await contractApprove(CONTRACT_ANTI, amount);
      if (!approveTx) return null;
      var abi = getContractABI('ANTI');
      var parsed = window.viem.parseUnits(String(amount), 18);
      var data = window.viem.encodeFunctionData({ abi:abi, functionName:'placeBet', args:[BigInt(matchId), cell, parsed] });
      var tx = await walletProvider.request({ method:'eth_sendTransaction', params:[{ from:walletAddress, to:CONTRACT_ANTI, data:data }] });
      return tx;
    } catch(e) { console.error('[19888] placeAntiBet error:', e); return null; }
  }

  async function contractPlaceChampionBet(teamId, betType, amount) {
    if (!viemLoaded || !walletProvider) return null;
    try {
      var approveTx = await contractApprove(CONTRACT_CHAMP, amount);
      if (!approveTx) return null;
      var abi = getContractABI('CHAMP');
      var parsed = window.viem.parseUnits(String(amount), 18);
      var data = window.viem.encodeFunctionData({ abi:abi, functionName:'placeBet', args:[BigInt(teamId), betType, parsed] });
      var tx = await walletProvider.request({ method:'eth_sendTransaction', params:[{ from:walletAddress, to:CONTRACT_CHAMP, data:data }] });
      return tx;
    } catch(e) { console.error('[19888] placeChampionBet error:', e); return null; }
  }

  // ==================== USDT BALANCE ====================
  async function getUSDTBalance(address) {
    try {
      var r = await fetch(BSC_RPC, {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:USDT_ADDRESS,data:'0x70a08231000000000000000000000000'+address.replace('0x','')},'latest']})});
      var j = await r.json();
      if (j.result) return parseInt(j.result,16)/1e18;
    } catch(e) {}
    return 0;
  }

  async function refreshBalance() {
    if (!walletAddress) return;
    var bal = await getUSDTBalance(walletAddress);
    usdtBalance = bal;
    var el = document.getElementById('profile-balance');
    if (el) el.textContent = bal.toFixed(2) + ' USDT';
    return bal;
  }

  // ==================== DEPOSIT / WITHDRAW MODALS ====================
  function showDepositModal() {
    var div = document.getElementById('deposit-modal');
    if (!div) {
      div = document.createElement('div'); div.id = 'deposit-modal'; div.className = 'dialog-overlay';
      div.innerHTML = '<div class="dialog" style="max-width:340px"><div class="dialog-header">💳 USDT 充值</div><div class="dialog-body" style="text-align:center;padding:20px"><p style="color:var(--text2);font-size:12px;margin-bottom:12px">向以下地址转账 USDT（BSC/BEP-20）</p><div style="background:#F7F8FA;padding:12px;border-radius:8px;word-break:break-all;font-size:11px;margin-bottom:12px;user-select:all">'+PLATFORM_ADDRESS+'</div><p style="color:var(--red);font-size:11px">⚠️ 仅支持 BSC 链 USDT</p><p style="color:var(--red);font-size:11px">其他链转账将永久丢失</p></div><div class="dialog-footer"><button class="btn-cancel" onclick="this.closest(\'.dialog-overlay\').style.display=\'none\'">关闭</button></div></div>';
      document.body.appendChild(div);
    }
    div.style.display = 'flex';
    div.onclick = function(e) { if (e.target === this) this.style.display = 'none'; };
  }

  function showWithdrawModal() {
    var div = document.getElementById('withdraw-modal');
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
    var addr = document.getElementById('w-addr').value.trim();
    var amount = parseFloat(document.getElementById('w-amount').value);
    if (!addr || addr.length < 10) { showToast('请输入有效地址'); return; }
    if (isNaN(amount) || amount < 10) { showToast('最低提现 10 USDT'); return; }
    var records = JSON.parse(localStorage.getItem('19888_withdraw_requests') || '[]');
    records.push({ address:addr, amount:amount, wallet:walletAddress, time:new Date().toISOString(), status:'pending' });
    localStorage.setItem('19888_withdraw_requests', JSON.stringify(records));
    showToast('提现申请已提交！管理员审核后到账');
    document.getElementById('withdraw-modal').style.display = 'none';
  }

  var betRecords = [];
  var userBalance = 0;
  var betCart = [];
  var oddsFlashTimer = null;
  var oddsFlashInterval = null;
  var audioCtx = null;

  // ==================== API ====================
  async function apiCall(endpoint, opts) {
    opts = opts || {};
    try {
      var res = await fetch(API_BASE + endpoint, {
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        method: opts.method || 'GET',
        body: opts.body || undefined
      });
      var data = await res.json();
      apiAvailable = true;
      return data;
    } catch(e) {
      apiAvailable = false;
      return null;
    }
  }

  // ==================== TEAM FLAGS ====================
  var TEAM_FLAGS = {
    "巴西": "\uD83C\uDDE7\uD83C\uDDF7", "阿根廷": "\uD83C\uDDE6\uD83C\uDDF7", "法国": "\uD83C\uDDEB\uD83C\uDDF7", "英格兰": "\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67\uDB40\uDC7F",
    "西班牙": "\uD83C\uDDEA\uD83C\uDDF8", "德国": "\uD83C\uDDE9\uD83C\uDDEA", "葡萄牙": "\uD83C\uDDF5\uD83C\uDDF9", "荷兰": "\uD83C\uDDF3\uD83C\uDDF1",
    "克罗地亚": "\uD83C\uDDED\uD83C\uDDF7", "比利时": "\uD83C\uDDE7\uD83C\uDDEA", "格鲁吉亚": "\uD83C\uDDEC\uD83C\uDDEA", "罗马尼亚": "\uD83C\uDDF7\uD83C\uDDF4",
    "摩洛哥": "\uD83C\uDDF2\uD83C\uDDE6", "马达加斯加": "\uD83C\uDDF2\uD83C\uDDEC", "威尔士": "\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73\uDB40\uDC7F", "加纳": "\uD83C\uDDEC\uD83C\uDDED",
  };

  var FLAGS = {
    "巴西":"\uD83C\uDDE7\uD83C\uDDF7","阿根廷":"\uD83C\uDDE6\uD83C\uDDF7","法国":"\uD83C\uDDEB\uD83C\uDDF7","英格兰":"\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67\uDB40\uDC7F",
    "西班牙":"\uD83C\uDDEA\uD83C\uDDF8","德国":"\uD83C\uDDE9\uD83C\uDDEA","葡萄牙":"\uD83C\uDDF5\uD83C\uDDF9","荷兰":"\uD83C\uDDF3\uD83C\uDDF1",
    "克罗地亚":"\uD83C\uDDED\uD83C\uDDF7","比利时":"\uD83C\uDDE7\uD83C\uDDEA","格鲁吉亚":"\uD83C\uDDEC\uD83C\uDDEA","罗马尼亚":"\uD83C\uDDF7\uD83C\uDDF4",
    "摩洛哥":"\uD83C\uDDF2\uD83C\uDDE6","马达加斯加":"\uD83C\uDDF2\uD83C\uDDEC","威尔士":"\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73\uDB40\uDC7F","加纳":"\uD83C\uDDEC\uD83C\uDDED",
  };

  function teamLogoUrl(name) {
    var slug = name.replace(/[^a-zA-Z\u4e00-\u9fff]/g, '_').toLowerCase();
    return 'img/teams/' + slug + '.png';
  }

  function teamLogoImg(name, size) {
    var s = size || 50;
    if (FLAGS[name]) {
      return '<span style="display:inline-flex;align-items:center;justify-content:center;width:' + s + 'px;height:' + s + 'px;border-radius:50%;background:linear-gradient(135deg,#E8EBF5,#DDE1F0);font-size:' + Math.round(s*0.58) + 'px;flex-shrink:0;overflow:hidden">' + FLAGS[name] + '</span>';
    }
    var url = teamLogoUrl(name);
    var initials = name.replace(/\s/g,'').slice(0,3).toUpperCase() || '⚽';
    var fallback = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#E8EBF5"/><text x="50" y="58" text-anchor="middle" font-size="' + (initials.length > 2 ? '28' : '38') + '" fill="#999" font-family="Arial" font-weight="900">' + initials + '</text></svg>');
    return '<img src="' + url + '" width="' + s + '" height="' + s + '" style="border-radius:50%;object-fit:contain;background:#E8EBF5;flex-shrink:0" alt="' + name + '" loading="lazy" onerror="this.onerror=null;this.src=\'' + fallback + '\'">';
  }

  // ==================== MOCK DATA ====================
  var mockMatches = [
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

  var mockChampionTeams = [
    { id:1, name:'巴西', championship_odds:5.50, runner_up_odds:4.20 },
    { id:2, name:'法国', championship_odds:6.00, runner_up_odds:4.50 },
    { id:3, name:'阿根廷', championship_odds:7.50, runner_up_odds:5.50 },
    { id:4, name:'英格兰', championship_odds:8.00, runner_up_odds:5.80 },
    { id:5, name:'西班牙', championship_odds:9.00, runner_up_odds:6.50 },
    { id:6, name:'德国', championship_odds:10.00, runner_up_odds:7.00 },
    { id:7, name:'葡萄牙', championship_odds:12.00, runner_up_odds:8.00 },
    { id:8, name:'荷兰', championship_odds:15.00, runner_up_odds:9.50 },
  ];

  var scoreGrid18 = ['0:0','0:1','0:2','0:3','1:0','1:1','1:2','1:3','2:0','2:1','2:2','2:3','3:0','3:1','3:2','3:3','主4+','客4+'];

  // Store last known odds for directional flash tracking
  var lastOddsMap = {};
  var oddsElements = [];

  // ==================== ENHANCED SOUND SYSTEM (6 distinct sounds) ====================
  function getAudioCtx() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch(e) { audioCtx = null; }
    }
    return audioCtx;
  }

  function resumeCtx() {
    var ctx = getAudioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // 1. Success chime (ascending C-E-G triad) — bet confirmed
  function playSuccessSound() {
    var ctx = getAudioCtx();
    if (!ctx) return;
    resumeCtx();
    var now = ctx.currentTime;
    var notes = [
      { freq: 523.25, start: 0,    dur: 0.12 },
      { freq: 659.25, start: 0.1,  dur: 0.12 },
      { freq: 783.99, start: 0.2,  dur: 0.30 }
    ];
    notes.forEach(function(note) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.start);
      gain.gain.setValueAtTime(0, now + note.start);
      gain.gain.linearRampToValueAtTime(0.35, now + note.start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, now + note.start + note.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + note.start);
      osc.stop(now + note.start + note.dur + 0.05);
    });
  }

  // 2. Click / tap sound — UI interaction
  function playClickSound() {
    var ctx = getAudioCtx();
    if (!ctx) return;
    resumeCtx();
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.06);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  // 3. Error / alert buzz — validation failure
  function playErrorSound() {
    var ctx = getAudioCtx();
    if (!ctx) return;
    resumeCtx();
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, now);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  // 4. Swipe sound — subtle whoosh
  function playSwipeSound() {
    var ctx = getAudioCtx();
    if (!ctx) return;
    resumeCtx();
    var now = ctx.currentTime;
    var bufferSize = ctx.sampleRate * 0.15;
    var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2) * 0.04;
    }
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    var filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, now);
    filter.Q.setValueAtTime(0.5, now);
    src.connect(filter);
    filter.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.15);
  }

  // 5. Add-to-cart sound — short pop
  function playAddCartSound() {
    var ctx = getAudioCtx();
    if (!ctx) return;
    resumeCtx();
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.05);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  // 6. Odds-up / odds-down tick sounds
  function playOddsTickSound(up) {
    var ctx = getAudioCtx();
    if (!ctx) return;
    resumeCtx();
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(up ? 880 : 440, now);
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  // ==================== ENHANCED RIPPLE EFFECT ====================
  function createRipple(e) {
    var target = e.currentTarget;
    var oldRipple = target.querySelector('.ripple-effect');
    if (oldRipple) oldRipple.remove();

    var ripple = document.createElement('span');
    ripple.className = 'ripple-effect';
    var rect = target.getBoundingClientRect();
    var size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + 'px';

    var x, y;
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

  function initRippleEffects() {
    document.querySelectorAll('.match-card, .grid-cell, .team-card, button, .btn-champion, .btn-runnerup, .tabbar-item, .tab-nav-item, .record-filter button, .record-item, .lang-option, .quick-amounts button')
      .forEach(function(el) {
        if (el._hasRipple) return;
        el._hasRipple = true;
        el.addEventListener('pointerdown', createRipple, { passive: true });
      });
  }

  // ==================== ENHANCED DIRECTIONAL ODDS FLASH ====================
  function trackOddsElements() {
    oddsElements = [];
    document.querySelectorAll('.odds-tag .val, .cell-odds, .o-val').forEach(function(el) {
      var key = el.getAttribute('data-odds-key');
      if (!key) {
        key = 'odds_' + Math.random().toString(36).substr(2, 8);
        el.setAttribute('data-odds-key', key);
      }
      var currentVal = parseFloat(el.textContent) || 1.0;
      if (!(key in lastOddsMap)) lastOddsMap[key] = currentVal;
      oddsElements.push({ el: el, key: key });
    });
  }

  function flashOddsElement(el, direction) {
    // direction: 'up' or 'down'
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth; // force reflow
    if (direction === 'up') {
      el.classList.add('flash-up');
    } else {
      el.classList.add('flash-down');
    }
    // Add direction arrow indicator
    var existing = el.querySelector('.odds-arrow');
    if (!existing) {
      var arrow = document.createElement('span');
      arrow.className = 'odds-arrow';
      arrow.style.cssText = 'display:inline-block;margin-left:2px;font-size:10px;font-weight:700;transition:opacity 0.3s';
      el.appendChild(arrow);
    }
    var arrowEl = el.querySelector('.odds-arrow');
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

      var count = 1 + Math.floor(Math.random() * 4);
      var indices = [];
      while (indices.length < count && indices.length < oddsElements.length) {
        var idx = Math.floor(Math.random() * oddsElements.length);
        if (indices.indexOf(idx) === -1) indices.push(idx);
      }

      indices.forEach(function(i) {
        var entry = oddsElements[i];
        if (!entry || !entry.el) return;
        var prev = lastOddsMap[entry.key] || parseFloat(entry.el.textContent) || 1.0;
        var delta = prev * (Math.random() * 0.06) * (Math.random() > 0.5 ? 1 : -1);
        var newVal = Math.max(1.01, prev + delta);
        newVal = +newVal.toFixed(2);
        var direction = newVal >= prev ? 'up' : 'down';

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

  // ==================== ENHANCED SWIPEABLE MATCH CARDS ====================
  function initSwipeCards() {
    var container = document.querySelector('.match-cards-container, #match-list, #matches-page-list');
    if (!container) return;
    container.addEventListener('touchstart', handleSwipeStart, { passive: true });
    container.addEventListener('touchmove', handleSwipeMove, { passive: false });
    container.addEventListener('touchend', handleSwipeEnd, { passive: true });
  }

  var swipeData = { startX: 0, startY: 0, card: null, offset: 0 };

  function handleSwipeStart(e) {
    var card = e.target.closest('.match-card');
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
    // Only horizontal swipe (ignore vertical scrolls)
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
      e.preventDefault();
      swipeData.card.style.transform = 'translateX(' + dx + 'px)';
      swipeData.card.style.opacity = Math.max(0.5, 1 - Math.abs(dx) / 400);
      swipeData.offset = dx;
    }
  }

  function handleSwipeEnd() {
    var card = swipeData.card;
    if (!card) return;
    card.style.transition = 'transform 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease';
    if (Math.abs(swipeData.offset) > 120) {
      // Swipe complete — dismiss card with animation
      card.style.transform = 'translateX(' + (swipeData.offset > 0 ? 400 : -400) + 'px)';
      card.style.opacity = '0';
      playSwipeSound();
      // Remove after animation
      setTimeout(function() {
        if (card && card.parentNode) card.remove();
      }, 350);
    } else {
      // Snap back
      card.style.transform = 'translateX(0)';
      card.style.opacity = '1';
    }
    swipeData.card = null;
    swipeData.offset = 0;
  }

  // ==================== ENHANCED COUNT-UP ANIMATION (预估收益) ====================
  function animateCountUp(el, from, to, duration) {
    duration = duration || 600;
    var start = null;
    var range = to - from;

    function step(timestamp) {
      if (!start) start = timestamp;
      var progress = Math.min((timestamp - start) / duration, 1);
      // Ease-out cubic
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = from + range * eased;
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
    var amount = parseFloat(document.getElementById('bet-amount-input').value) || 0;
    var overlay = document.getElementById('bet-dialog-overlay');
    var odds = overlay._betData ? overlay._betData.odds : 0;
    var profitEl = document.getElementById('bet-profit');
    var oldProfit = parseFloat(profitEl.textContent) || 0;
    var newProfit = amount > 0 ? (amount * odds - amount) : 0;

    // Animate the profit count-up / count-down
    if (Math.abs(newProfit - oldProfit) > 0.05) {
      animateCountUp(profitEl, oldProfit, newProfit, 400);
    } else {
      profitEl.textContent = newProfit.toFixed(2);
    }

    // Update estimated return total
    var totalEl = document.getElementById('bet-total-return');
    if (totalEl) {
      totalEl.textContent = amount > 0 ? (amount * odds).toFixed(2) : '0.00';
    }
  }

  // ==================== ENHANCED PAGE TRANSITIONS + GESTURE BACK ====================
  var pageOrder = ['home', 'matches', 'detail', 'ai', 'records', 'profile'];

  function navigateTo(page) {
    if (currentPage === page) return;

    var oldPage = currentPage;
    currentPage = page;

    // Push to history for back navigation
    if (pageHistory[pageHistory.length - 1] !== page) {
      pageHistory.push(page);
    }
    // Keep history manageable
    if (pageHistory.length > 20) pageHistory.shift();

    var oldIdx = pageOrder.indexOf(oldPage);
    var newIdx = pageOrder.indexOf(page);
    var direction = (newIdx >= oldIdx) ? 'forward' : 'backward';

    var allPages = document.querySelectorAll('.page');
    var targetPage = document.getElementById('page-' + page);
    if (!targetPage) return;

    // Phase 1: Prepare entering page offscreen
    targetPage.style.transition = 'none';
    var offsetX = direction === 'forward' ? 35 : -35;
    targetPage.style.transform = 'translateX(' + offsetX + 'px)';
    targetPage.style.opacity = '0';
    targetPage.classList.add('active');
    void targetPage.offsetWidth;

    // Phase 2: Exit old page
    allPages.forEach(function(p) {
      if (p !== targetPage && p.classList.contains('active')) {
        p.style.transition = 'opacity 0.18s ease, transform 0.22s cubic-bezier(0.4,0,0.2,1)';
        p.style.transform = 'translateX(' + (-offsetX * 0.6) + 'px)';
        p.style.opacity = '0';
        var handler = function(el) {
          return function() {
            el.classList.remove('active');
            el.style.transform = '';
            el.style.opacity = '';
            el.style.transition = '';
            el.removeEventListener('transitionend', handler);
          };
        }(p);
        p.addEventListener('transitionend', handler, { once: false });
      }
    });

    // Phase 3: Animate new page in
    setTimeout(function() {
      targetPage.style.transition = 'opacity 0.28s ease 0.04s, transform 0.28s cubic-bezier(0.4,0,0.2,1) 0.04s';
      targetPage.style.transform = 'translateX(0)';
      targetPage.style.opacity = '1';
      var cleanup = function() {
        targetPage.style.transition = '';
        targetPage.style.transform = '';
        targetPage.style.opacity = '';
        targetPage.removeEventListener('transitionend', cleanup);
      };
      targetPage.addEventListener('transitionend', cleanup, { once: false });
    }, 40);

    // Update tabbar
    document.querySelectorAll('.tabbar-item').forEach(function(i) { i.classList.remove('active'); });
    var tabMap = { home:0, matches:1, ai:2, records:3, profile:4, detail:1 };
    var idx = tabMap[page];
    if (idx !== undefined) {
      var items = document.querySelectorAll('.tabbar-item');
      if (items[idx]) items[idx].classList.add('active');
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (page === 'matches') renderMatchList();
    if (page === 'profile') renderProfile();
    if (page === 'records') updateBadges();

    playClickSound();
  }

  // Gesture back: swipe right on page content to go back
  function goBackPage() {
    if (pageHistory.length > 1) {
      pageHistory.pop(); // remove current
      var prev = pageHistory[pageHistory.length - 1];
      navigateTo(prev);
    }
  }

  function initGestureBack() {
    var touchStartX = 0;
    var touchStartY = 0;
    var backIndicator = null;

    document.addEventListener('touchstart', function(e) {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      // Only trigger if starting from left edge (within 30px)
      if (touchStartX > 30) { touchStartX = 0; return; }
      // Create back indicator
      if (!backIndicator) {
        backIndicator = document.createElement('div');
        backIndicator.id = 'gesture-back-indicator';
        backIndicator.style.cssText = 'position:fixed;left:0;top:50%;transform:translateY(-50%);width:6px;height:60px;background:linear-gradient(to right,var(--gold),transparent);border-radius:0 6px 6px 0;z-index:9999;opacity:0;transition:opacity 0.2s;pointer-events:none';
        document.body.appendChild(backIndicator);
      }
    }, { passive: true });

    document.addEventListener('touchmove', function(e) {
      if (!touchStartX || e.touches.length !== 1) return;
      var dx = e.touches[0].clientX - touchStartX;
      var dy = e.touches[0].clientY - touchStartY;
      if (dx > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (backIndicator) backIndicator.style.opacity = Math.min(1, dx / 120);
      }
    }, { passive: true });

    document.addEventListener('touchend', function(e) {
      if (!touchStartX) return;
      if (backIndicator) backIndicator.style.opacity = '0';
      var dx = (e.changedTouches[0] ? e.changedTouches[0].clientX : 0) - touchStartX;
      if (dx > 80 && pageHistory.length > 1) {
        playSwipeSound();
        goBackPage();
      }
      touchStartX = 0;
    }, { passive: true });
  }

  function switchTab(tab) {
    if (currentTab === tab) return;
    currentTab = tab;

    var contents = document.querySelectorAll('.tab-content');
    contents.forEach(function(c) {
      if (c.classList.contains('active')) {
        c.style.transition = 'opacity 0.15s ease';
        c.style.opacity = '0';
        setTimeout(function() { c.classList.remove('active'); c.style.opacity = ''; c.style.transition = ''; }, 150);
      }
    });

    document.querySelectorAll('.tab-nav-item').forEach(function(i) { i.classList.remove('active'); });

    var newContent = document.getElementById('tab-' + tab);
    if (newContent) {
      newContent.classList.add('active');
      newContent.style.opacity = '0';
      newContent.style.transition = 'opacity 0.2s ease 0.1s';
      void newContent.offsetWidth;
      newContent.style.opacity = '1';
      setTimeout(function() { newContent.style.transition = ''; newContent.style.opacity = ''; }, 350);
    }

    var tabMap = { recommend:0, champion:1, about:2 };
    var idx = tabMap[tab];
    if (idx !== undefined) document.querySelectorAll('.tab-nav-item')[idx].classList.add('active');
    if (tab === 'champion') { renderChampionBet(); renderHotRanking(); }
  }

  // ==================== HOME – MATCH CARDS ====================
  function matchCardHTML(m) {
    var timeParts = (m.time || '').split(' ');
    var dateStr = timeParts.length > 1 ? timeParts[0].slice(5) : '';
    var timeStr = timeParts.length > 1 ? timeParts[1].slice(0,5) : (m.time || '--');
    var isLive = m.status === 'live';
    var statusText = m.status === 'live' ? '\uD83D\uDD34 直播中' : m.status === 'finished' ? '已结束' : '未开赛';
    return '\n      <div class="match-card swipe-card' + (isLive ? ' live' : '') + '" onclick="app.navigateTo(\'detail\'); app.loadMatchDetail(' + m.id + ')" title="' + (m.venue || '') + '">\n        <div class="match-league">' + m.league + (isLive ? ' <span style="color:var(--red);font-weight:700">LIVE</span>' : '') + '</div>\n        <div class="match-content">\n          <div class="team">\n            <div class="team-logo" style="background:none">' + teamLogoImg(m.home, 50) + '</div>\n            <div class="team-name">' + m.home + '</div>\n          </div>\n          <div class="match-time">\n            <div class="time">' + timeStr + '</div>\n            <div class="date">' + dateStr + '</div>\n            <div class="status" style="color:' + (isLive ? 'var(--red)' : 'var(--text-muted)') + '">' + statusText + '</div>\n          </div>\n          <div class="team">\n            <div class="team-logo" style="background:none">' + teamLogoImg(m.away, 50) + '</div>\n            <div class="team-name">' + m.away + '</div>\n          </div>\n        </div>\n        <div class="match-odds">\n          <div class="odds-tag">主胜<br><span class="val">' + (m.odds_home || (m.odds && m.odds.home) || '\u2014') + '</span></div>\n          <div class="odds-tag">平局<br><span class="val">' + (m.odds_draw || (m.odds && m.odds.draw) || '\u2014') + '</span></div>\n          <div class="odds-tag">客胜<br><span class="val">' + (m.odds_away || (m.odds && m.odds.away) || '\u2014') + '</span></div>\n        </div>\n      </div>';
  }

  // ==================== SKELETON SCREENS ====================
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
    var grid = document.getElementById('grid-18');
    if (!grid) return;
    grid.classList.add('skeleton-loading');
    grid.innerHTML = Array(18).fill(0).map(function() {
      return '<div class="grid-cell skeleton-cell">' +
        '<div class="skeleton-line shimmer" style="width:36px;height:14px;border-radius:4px;margin-bottom:6px"></div>' +
        '<div class="skeleton-line shimmer" style="width:28px;height:20px;border-radius:4px"></div>' +
      '</div>';
    }).join('');
  }

  function showListSkeleton(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    showSkeletons(container, 6);
  }

  async function renderMatchCards() {
    var container = document.getElementById('match-list');
    if (!container) return;

    showSkeletons(container, 4);
    var data = mockMatches;

    var apiData = await apiCall('/matches');
    if (apiData && apiData.code === 0 && apiData.data.length > 0) data = apiData.data;

    await new Promise(function(r) { setTimeout(r, 400); });
    container.classList.remove('skeleton-loading');
    container.innerHTML = data.map(function(m) { return matchCardHTML(m); }).join('');
    initRippleEffects();
    initSwipeCards();
    trackOddsElements();
  }

  // ==================== HOT BETTING LEADERBOARD (冠亚投注排行榜) ====================
  function computeHotRanking() {
    var rankings = {};

    // Aggregate from localStorage bet records
    betRecords.forEach(function(r) {
      var team = r.team || '';
      // Extract team name (strip score suffix, etc.)
      var matchParts = team.split(' vs ');
      matchParts.forEach(function(part) {
        var name = part.trim().split(' ')[0];
        if (name) {
          if (!rankings[name]) rankings[name] = { count: 0, amount: 0 };
          rankings[name].count += 1;
          rankings[name].amount += r.amount || 0;
        }
      });
    });

    // Also aggregate champion bets
    var champRecords = [];
    try {
      var cr = localStorage.getItem('19888_bet_records');
      if (cr) champRecords = JSON.parse(cr);
    } catch(e) {}

    champRecords.forEach(function(r) {
      if (r.type === '冠军' || r.type === '亚军') {
        var name = r.team;
        if (name) {
          if (!rankings[name]) rankings[name] = { count: 0, amount: 0 };
          rankings[name].count += 1;
          rankings[name].amount += r.amount || 0;
        }
      }
    });

    // If no data, seed with mock champion data
    if (Object.keys(rankings).length === 0) {
      mockChampionTeams.forEach(function(t, i) {
        rankings[t.name] = {
          count: Math.floor(Math.random() * 50) + 10,
          amount: Math.floor(Math.random() * 5000) + 500
        };
      });
    }

    // Sort by count desc
    var sorted = Object.keys(rankings).map(function(name) {
      return { name: name, count: rankings[name].count, amount: rankings[name].amount };
    }).sort(function(a, b) { return b.count - a.count; });

    return sorted.slice(0, 10);
  }

  function renderHotRanking() {
    var container = document.getElementById('hot-ranking-list');
    if (!container) return;

    var ranking = computeHotRanking();
    var medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49', '4', '5', '6', '7', '8', '9', '10'];

    container.innerHTML = '<div style="font-size:13px;font-weight:700;color:var(--gold);margin-bottom:8px;text-align:center">\uD83D\uDD25 热门投注排行</div>' +
      ranking.map(function(item, idx) {
        var barWidth = ranking.length > 0 ? Math.round((item.count / ranking[0].count) * 100) : 50;
        var flag = FLAGS[item.name] || '';
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

  // ==================== CHAMPION BET ====================
  async function renderChampionBet() {
    var grid = document.getElementById('teams-grid');
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

    var teams = mockChampionTeams;
    var totalBet = 12850;
    var totalWin = 67420;

    var apiData = await apiCall('/champion-bet/odds');
    if (apiData && apiData.code === 0 && apiData.data) {
      teams = apiData.data.odds || teams;
      totalBet = apiData.data.total_bet || totalBet;
      totalWin = apiData.data.total_potential_win || totalWin;
    }

    await new Promise(function(r) { setTimeout(r, 300); });

    grid.innerHTML = teams.map(function(t) {
      return '\n      <div class="team-card">\n        <div class="t-logo" style="background:none">' + teamLogoImg(t.name, 56) + '<span style="display:none;align-items:center;justify-content:center;width:52px;height:52px;border-radius:50%;background:var(--bg-input);color:var(--text-muted);font-size:26px">\u26BD</span></div>\n        <div class="t-name">' + t.name + '</div>\n        <div class="odds-row">\n          <div><span class="o-label">冠军</span><br><span class="o-val">' + t.championship_odds + '</span></div>\n          <div><span class="o-label">亚军</span><br><span class="o-val">' + t.runner_up_odds + '</span></div>\n        </div>\n        <div class="bet-btns">\n          <button class="btn-champion" onclick="app.openBetDialog(\'' + t.name + '\', ' + t.id + ', \'champion\', ' + t.championship_odds + ')">投冠军</button>\n          <button class="btn-runnerup" onclick="app.openBetDialog(\'' + t.name + '\', ' + t.id + ', \'runnerup\', ' + t.runner_up_odds + ')">投亚军</button>\n        </div>\n      </div>\n    ';
    }).join('');

    var totalBetEl = document.getElementById('total-bet');
    var totalWinEl = document.getElementById('total-win');
    if (totalBetEl) totalBetEl.textContent = totalBet.toFixed(2);
    if (totalWinEl) totalWinEl.textContent = totalWin.toFixed(2);

    // Render hot ranking alongside
    renderHotRanking();

    initRippleEffects();
    trackOddsElements();
  }

  // ==================== BET DIALOG (enhanced with count-up animation) ====================
  function openBetDialog(teamName, teamId, betType, odds) {
    var overlay = document.getElementById('bet-dialog-overlay');
    var typeName = betType === 'champion' ? '冠军' : '亚军';
    document.getElementById('bet-team-name').textContent = teamName;
    document.getElementById('bet-type-name').textContent = typeName;
    document.getElementById('bet-odds').textContent = odds;
    document.getElementById('bet-amount-input').value = '';
    document.getElementById('bet-profit').textContent = '0.00';
    var totalEl = document.getElementById('bet-total-return');
    if (totalEl) totalEl.textContent = '0.00';
    overlay.classList.add('show');
    overlay._betData = { teamName: teamName, teamId: teamId, betType: betType, odds: odds, typeName: typeName };

    // Focus input
    setTimeout(function() {
      var inp = document.getElementById('bet-amount-input');
      if (inp) inp.focus();
    }, 300);
  }

  function closeBetDialog() {
    document.getElementById('bet-dialog-overlay').classList.remove('show');
  }

  async function confirmBet() {
    var overlay = document.getElementById('bet-dialog-overlay');
    var amount = parseFloat(document.getElementById('bet-amount-input').value);
    if (!amount || amount < 1) { playErrorSound(); showToast('请输入正确的投注金额'); return; }
    if (!walletAddress) { playErrorSound(); showToast('请先连接钱包'); return; }

    var data = overlay._betData;
    var odds = data.odds;

    // Try on-chain contract interaction first (when viem + wallet available)
    if (viemLoaded && walletProvider) {
      var betType = data.betType === 'champion' ? 1 : 2;
      var tx = await contractPlaceChampionBet(data.teamId, betType, amount);
      if (tx) {
        var onchainRecord = {
          id: Date.now(), team: data.teamName, type: data.typeName,
          amount: amount, odds: odds, potentialWin: (amount * odds).toFixed(2),
          time: new Date().toLocaleString('zh-CN'), status: 'pending', tx: tx
        };
        betRecords.unshift(onchainRecord);
        saveData();
        closeBetDialog();
        playSuccessSound();
        spawnConfetti();
        showToast('链上投注已提交！TX: ' + tx.substring(0, 10) + '...');
        renderChampionBet();
        updateBadges();
        return;
      }
    }

    if (apiAvailable) {
      var res = await apiCall('/champion-bet/place', {
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
        playSuccessSound();
        spawnConfetti();
        renderChampionBet();
        updateBadges();
        return;
      }
    }

    var record = {
      id: Date.now(), team: data.teamName, type: data.typeName,
      amount: amount, odds: odds, potentialWin: (amount * odds).toFixed(2),
      time: new Date().toLocaleString('zh-CN'), status: 'pending'
    };
    betRecords.unshift(record);
    userBalance += amount;
    saveData();
    closeBetDialog();
    playSuccessSound();
    spawnConfetti();
    showToast('投注成功！');
  }

  // ==================== MATCH LIST PAGE ====================
  async function renderMatchList() {
    var container = document.getElementById('matches-page-list');
    if (!container) return;

    showSkeletons(container, 6);
    var data = mockMatches.concat(mockMatches);
    var apiData = await apiCall('/matches');
    if (apiData && apiData.code === 0 && apiData.data.length > 0) data = apiData.data;

    await new Promise(function(r) { setTimeout(r, 350); });
    container.classList.remove('skeleton-loading');
    container.innerHTML = data.map(function(m) { return matchCardHTML(m); }).join('');
    initRippleEffects();
    initSwipeCards();
    trackOddsElements();
  }

  // ==================== MATCH DETAIL ====================
  async function loadMatchDetail(matchId) {
    currentDetailMatchId = matchId;
    var match = mockMatches.find(function(m) { return m.id === matchId; }) || mockMatches[0];
    var grid18 = scoreGrid18.map(function(score) { return { score: score, odds: +(1.5 + Math.random() * 8).toFixed(2) }; });

    showDetailSkeleton();

    var apiData = await apiCall('/matches/' + matchId);
    if (apiData && apiData.code === 0 && apiData.data) {
      match = apiData.data;
      grid18 = apiData.data.grid_18 || grid18;
    }

    var timeParts = (match.time || '').split(' ');
    document.getElementById('md-league').textContent = match.league;
    document.getElementById('md-home').textContent = match.home;
    document.getElementById('md-away').textContent = match.away;
    document.getElementById('md-time').textContent = timeParts.length > 1 ? timeParts[1].slice(0,5) : (match.time || '--');
    document.getElementById('md-date').textContent = timeParts.length > 1 ? timeParts[0].slice(5) : '';

    await new Promise(function(r) { setTimeout(r, 200); });

    var grid = document.getElementById('grid-18');
    grid.classList.remove('skeleton-loading');
    grid.innerHTML = grid18.map(function(cell) {
      return '\n      <div class="grid-cell" onclick="app.quickBet(\'' + cell.score + '\', ' + cell.odds + ', \'' + match.home + ' vs ' + match.away + '\')">\n        <div class="cell-score">' + cell.score + '</div>\n        <div class="cell-odds">' + cell.odds + '</div>\n      </div>\n    ';
    }).join('');

    initRippleEffects();
    trackOddsElements();

    // Push detail to history
    if (pageHistory[pageHistory.length - 1] !== 'detail') {
      pageHistory.push('detail');
    }
  }

  function quickBet(score, odds, matchName) {
    if (!walletAddress) { playErrorSound(); showToast('请先连接钱包'); return; }
    addToCart(score, odds, matchName);
    playAddCartSound();
  }

  // ==================== BET CART SYSTEM ====================
  function addToCart(score, odds, matchName) {
    var existing = betCart.find(function(b) { return b.score === score && b.matchName === matchName; });
    if (existing) {
      existing.amount += 100;
    } else {
      betCart.push({ score: score, odds: +odds, matchName: matchName, amount: 100 });
    }
    updateCartUI();
    showToast('已添加 ' + matchName + ' ' + score + ' 到投注单');
  }

  function removeFromCart(index) {
    betCart.splice(index, 1);
    updateCartUI();
  }

  function updateCartUI() {
    var cart = document.getElementById('betCart');
    var count = document.getElementById('cartCount');
    var total = document.getElementById('cartTotal');
    if (!cart) return;

    if (betCart.length === 0) {
      cart.classList.remove('show');
    } else {
      cart.classList.add('show');
      count.textContent = betCart.length;
      var sum = betCart.reduce(function(s, b) { return s + b.amount; }, 0);
      total.textContent = sum + ' USDT';
    }
  }

  async function submitCart() {
    if (!walletAddress) { playErrorSound(); showToast('请先连接钱包'); return; }
    if (betCart.length === 0) return;

    var total = betCart.reduce(function(s, b) { return s + b.amount; }, 0);

    // Try on-chain contract interaction first (when viem + wallet available)
    if (viemLoaded && walletProvider && currentDetailMatchId) {
      var allSuccess = true;
      for (var ci = 0; ci < betCart.length; ci++) {
        var b = betCart[ci];
        var cell = scoreToCellIndex(b.score);
        if (cell < 0) { allSuccess = false; continue; }
        var tx = await contractPlaceAntiBet(currentDetailMatchId, cell, b.amount);
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
      playSuccessSound();
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
        potentialWin: (b.amount * b.odds).toFixed(2),
        time: new Date().toLocaleString('zh-CN'), status: 'pending'
      });
    });
    userBalance += total;
    betCart = [];
    updateCartUI();
    updateBadges();
    saveData();
    playSuccessSound();
    spawnConfetti();
    showToast('已提交 ' + total + ' USDT 投注！\uD83C\uDF89');
  }

  // ==================== CONFETTI ====================
  function spawnConfetti() {
    var colors = ['#DC143C','#DAA520','#FFD700','#03A66D','#667eea','#f5576c'];
    for (var i = 0; i < 50; i++) {
      setTimeout(function() {
        var piece = document.createElement('div');
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

  // ==================== BADGES ====================
  function updateBadges() {
    var badge = document.getElementById('badge-records');
    if (!badge) return;
    var pending = betRecords.filter(function(r) { return r.status === 'pending'; }).length;
    if (pending > 0) {
      badge.textContent = pending > 99 ? '99+' : pending;
      badge.classList.add('show');
    } else {
      badge.classList.remove('show');
    }
  }

  // ==================== SPARKLINE ====================
  function renderSparkline(containerId, data, color) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var max = Math.max.apply(null, data.concat([1]));
    container.innerHTML = data.map(function(v) {
      var h = Math.max(4, (v / max) * 100);
      return '<div class="sparkline-bar" style="height:' + h + '%;background:' + (color || 'var(--gold)') + '"></div>';
    }).join('');
  }

  // ==================== PULL TO REFRESH ====================
  var pullStart = 0;
  function initPullRefresh() {
    var main = document.querySelector('.main') || document.body;
    var indicator = document.getElementById('pullIndicator');

    main.addEventListener('touchstart', function(e) {
      if (window.scrollY === 0) pullStart = e.touches[0].clientY;
    }, { passive: true });

    main.addEventListener('touchmove', function(e) {
      if (window.scrollY === 0 && pullStart > 0) {
        var dy = e.touches[0].clientY - pullStart;
        if (dy > 30 && indicator) indicator.classList.add('active');
      }
    }, { passive: true });

    main.addEventListener('touchend', async function() {
      if (indicator && indicator.classList.contains('active')) {
        indicator.textContent = '\u27F3 刷新中...';
        await renderMatchCards();
        indicator.classList.remove('active');
        indicator.textContent = '\u2193 下拉刷新';
      }
      pullStart = 0;
    }, { passive: true });
  }

  // ==================== RECORDS PAGE ====================
  async function renderRecords(filter) {
    var container = document.getElementById('records-list');
    if (!container) return;

    container.innerHTML = Array(4).fill(0).map(function() {
      return '<div class="record-item" style="pointer-events:none">' +
        '<div style="margin-bottom:6px"><div class="skeleton-line shimmer" style="width:40%;height:12px;border-radius:3px;margin-bottom:4px"></div><div class="skeleton-line shimmer" style="width:50%;height:10px;border-radius:3px"></div></div>' +
        '<div class="skeleton-line shimmer" style="width:70%;height:14px;border-radius:3px;margin-bottom:8px"></div>' +
        '<div style="display:flex;justify-content:space-between"><div class="skeleton-line shimmer" style="width:60px;height:16px;border-radius:3px"></div><div class="skeleton-line shimmer" style="width:40px;height:16px;border-radius:3px"></div></div>' +
      '</div>';
    }).join('');

    var records = betRecords;

    if (apiAvailable && walletAddress) {
      var res = await apiCall('/bets?address=' + encodeURIComponent(walletAddress));
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

    container.innerHTML = records.map(function(r) {
      var cls = r.status === 'won' ? 'positive' : r.status === 'lost' ? 'negative' : 'pending';
      var txt = r.status === 'won' ? '已赢' : r.status === 'lost' ? '已输' : '进行中';
      return '<div class="record-item">\n        <div><div class="r-league">' + r.type + '</div><div class="r-time">' + r.time + '</div></div>\n        <div class="r-match">' + r.team + '</div>\n        <div class="r-amount"><div>$' + r.amount + '</div><div class="' + cls + '">' + txt + '</div></div>\n      </div>';
    }).join('');

    initRippleEffects();
  }

  function filterRecords(filter) {
    document.querySelectorAll('#page-records .record-filter button').forEach(function(b) { b.classList.remove('active'); });
    if (event && event.target) event.target.classList.add('active');
    renderRecords(filter);
    updateBadges();
  }

  // ==================== PROFILE ====================
  function renderProfile() {
    if (walletAddress) {
      document.getElementById('profile-addr').textContent =
        walletAddress.substring(0, 6) + '...' + walletAddress.substring(walletAddress.length - 4);
      document.getElementById('profile-name').textContent = '19888 用户';
      document.getElementById('profile-balance').textContent = userBalance.toFixed(2);
      document.getElementById('wallet-status').innerHTML = '<div class="m-left"><span class="m-icon">\uD83D\uDC5B</span> 钱包连接</div><span style="color:var(--green);margin-right:10px">\u25CF 已连接</span>';
    } else {
      document.getElementById('profile-addr').textContent = '未连接';
      document.getElementById('profile-name').textContent = '请连接钱包';
      document.getElementById('profile-balance').textContent = '0.00';
      document.getElementById('wallet-status').innerHTML = '<div class="m-left"><span class="m-icon">\uD83D\uDC5B</span> 钱包连接</div><span style="color:var(--text-muted);margin-right:10px">\u25CB 未连接</span>';
    }
  }

  // ==================== WALLET ====================
  function detectWallet() {
    if (typeof window.tpWallet !== 'undefined') return window.tpWallet;
    if (typeof window.trustwallet !== 'undefined') return window.trustwallet;
    if (typeof window.ethereum !== 'undefined') {
      if (window.ethereum.isTrust || window.ethereum.isTokenPocket) return window.ethereum;
      return window.ethereum;
    }
    if (typeof window.imToken !== 'undefined') return window.imToken;
    return null;
  }

  async function connectWallet() {
    try {
      var accounts = [];
      var provider = detectWallet();
      if (provider) {
        accounts = await provider.request({ method: 'eth_requestAccounts' });
        walletProvider = provider;
      } else if (typeof window.ethereum !== 'undefined') {
        accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        walletProvider = window.ethereum;
      } else if (typeof window.tpWallet !== 'undefined') {
        accounts = await window.tpWallet.request({ method: 'eth_requestAccounts' });
        walletProvider = window.tpWallet;
      } else if (typeof window.imToken !== 'undefined') {
        accounts = await window.imToken.request({ method: 'eth_requestAccounts' });
        walletProvider = window.imToken;
      } else {
        walletAddress = '0x19888' + Math.random().toString(16).substring(2, 34);
        showToast('演示模式：已模拟钱包连接');
        updateWalletUI();
        renderProfile();
        return;
      }
      if (accounts && accounts.length > 0) {
        walletAddress = accounts[0];
        showToast('钱包连接成功！');
        updateWalletUI();
        renderProfile();
        playSuccessSound();
        apiCall('/wallet/connect', { method:'POST', body: JSON.stringify({ wallet_address: walletAddress }) });
        if (walletProvider && walletProvider.on) {
          walletProvider.on('accountsChanged', function(newAcc) {
            if (newAcc.length === 0) { disconnectWallet(); }
            else { walletAddress = newAcc[0]; updateWalletUI(); renderProfile(); }
          });
        }
      }
    } catch(e) {
      walletAddress = '0x19888' + Math.random().toString(16).substring(2, 34);
      showToast('演示模式：已模拟钱包连接');
      updateWalletUI();
      renderProfile();
    }
  }

  function updateWalletUI() {
    var btn = document.getElementById('wallet-btn');
    var addrSpan = document.getElementById('wallet-addr');
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

  // ==================== LANGUAGE ====================
  function openLangModal() { document.getElementById('lang-modal').classList.add('show'); }
  function closeLangModal() { document.getElementById('lang-modal').classList.remove('show'); }
  function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('19888_lang', lang);
    document.querySelectorAll('.lang-option').forEach(function(o) { o.classList.remove('selected'); });
    var opt = document.querySelector('.lang-option[data-lang="' + lang + '"]');
    if (opt) opt.classList.add('selected');
    closeLangModal();
    showToast('语言已切换');
    playClickSound();
  }

  // ==================== UTILS ====================
  function showToast(message) {
    var toast = document.getElementById('toast');
    toast.textContent = message; toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(function() { toast.classList.remove('show'); }, 2000);
  }

  function saveData() {
    try { localStorage.setItem('19888_bet_records', JSON.stringify(betRecords)); localStorage.setItem('19888_balance', userBalance); } catch(e) {}
  }
  function loadData() {
    try { var r = localStorage.getItem('19888_bet_records'); if (r) betRecords = JSON.parse(r); userBalance = +localStorage.getItem('19888_balance') || 0; } catch(e) {}
  }

  // ==================== COUNTDOWN ====================
  function updateCountdown() {
    var el = document.getElementById('countdown');
    if (!el) return;
    var diff = new Date('2026-06-11T00:00:00').getTime() - Date.now();
    if (diff <= 0) { el.textContent = '世界杯已开幕！'; return; }
    var d = Math.floor(diff/86400000), h = Math.floor((diff%86400000)/3600000);
    var m = Math.floor((diff%3600000)/60000), s = Math.floor((diff%60000)/1000);
    el.textContent = '世界杯倒计时：' + d + '天' + h + '小时' + m + '分' + s + '秒';
  }

// ==================== NEW HTML FEATURES ====================
  function toggleNotifications(e) {
    e.stopPropagation();
    const panel = document.getElementById('notify-panel');
    if (!panel) return;
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    playClickSound();
  }

  function openPromoModal() {
    const overlay = document.getElementById('promo-overlay');
    if (overlay) overlay.classList.add('show');
    playClickSound();
  }

  function closePromoModal() {
    const overlay = document.getElementById('promo-overlay');
    if (overlay) overlay.classList.remove('show');
  }

  function switchDetailTab(el, tabId) {
    document.querySelectorAll('#page-detail .detail-tabs button').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    document.querySelectorAll('#page-detail .detail-tab-content > div').forEach(d => d.style.display = 'none');
    const target = document.getElementById('detail-' + tabId);
    if (target) target.style.display = 'block';
    if (tabId === 'h2h') renderH2H();
    if (tabId === 'recent') renderRecentForm();
    playClickSound();
  }

  function placeBet(type, selection, odds) {
    showToast('投注成功：' + selection + ' @ ' + odds);
    playSuccessSound();
    spawnConfetti();
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

  // ==================== INIT ====================
  async function init() {
    loadData();
    loadViemCDN(); // Load viem for on-chain contract interactions (non-blocking)
    var savedLang = localStorage.getItem('19888_lang');
    if (savedLang) {
      currentLang = savedLang;
      document.querySelectorAll('.lang-option').forEach(function(o) { o.classList.remove('selected'); });
      var opt = document.querySelector('.lang-option[data-lang="' + savedLang + '"]');
      if (opt) opt.classList.add('selected');
    }

    // Probe API
    apiAvailable = !!(await apiCall('/status'));

    // Dialogs
    var betOverlay = document.getElementById('bet-dialog-overlay');
    if (betOverlay) betOverlay.addEventListener('click', function(e) { if (e.target === this) closeBetDialog(); });
    var langModal = document.getElementById('lang-modal');
    if (langModal) langModal.addEventListener('click', function(e) { if (e.target.classList.contains('lang-modal-mask')) closeLangModal(); });
    document.querySelectorAll('.quick-amounts button').forEach(function(btn) {
      btn.addEventListener('click', function() { document.getElementById('bet-amount-input').value = this.dataset.amount; updateBetProfit(); });
    });
    var amountInput = document.getElementById('bet-amount-input');
    if (amountInput) amountInput.addEventListener('input', updateBetProfit);
    var confirmBtn = document.getElementById('btn-confirm-bet');
    if (confirmBtn) confirmBtn.addEventListener('click', confirmBet);
    var cancelBtn = document.getElementById('btn-cancel-bet');
    if (cancelBtn) cancelBtn.addEventListener('click', closeBetDialog);

    // Initialize ripple effect
    initRippleEffects();

    // Start enhanced odds flash
    startOddsFlash();

    // Initialize gesture back navigation
    initGestureBack();

    renderMatchCards();
    renderChampionBet();
    renderRecords('all');
    renderProfile();
    updateCountdown();
    updateBadges();
    initPullRefresh();
    initSwipeCards();
    setInterval(updateCountdown, 1000);

    // Render sparkline for AI page
    var sparkData = [2.1,1.8,3.2,2.9,4.1,3.5,2.7,5.0,4.3,3.1,6.2,5.8,4.0,7.5,6.1];
    renderSparkline('sparkline-ai', sparkData, 'var(--green)');

    // Re-init ripple on dynamic content updates via MutationObserver
    var observer = new MutationObserver(function() {
      initRippleEffects();
      trackOddsElements();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ==================== PUBLIC API ====================
  window.app = {
    navigateTo: navigateTo,
    switchTab: switchTab,
    openBetDialog: openBetDialog,
    closeBetDialog: closeBetDialog,
    confirmBet: confirmBet,
    loadMatchDetail: loadMatchDetail,
    quickBet: quickBet,
    addToCart: addToCart,
    submitCart: submitCart,
    updateCartUI: updateCartUI,
    filterRecords: filterRecords,
    connectWallet: connectWallet,
    toggleWallet: toggleWallet,
    openLangModal: openLangModal,
    closeLangModal: closeLangModal,
    setLanguage: setLanguage,
    updateBetProfit: updateBetProfit,
    showDepositModal: showDepositModal,
    showWithdrawModal: showWithdrawModal,
    submitWithdraw: submitWithdraw,
    refreshBalance: refreshBalance,
    goBackPage: goBackPage,
    // Enhanced public helpers
    playSuccessSound: playSuccessSound,
    playClickSound: playClickSound,
    playErrorSound: playErrorSound,
    createRipple: createRipple,
    // On-chain contract interaction layer
    contractDeposit: contractDeposit,
    contractWithdraw: contractWithdraw,
    contractPlaceAntiBet: contractPlaceAntiBet,
    contractPlaceChampionBet: contractPlaceChampionBet,
    getContractABI: getContractABI,
    loadViemCDN: loadViemCDN
  };

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
