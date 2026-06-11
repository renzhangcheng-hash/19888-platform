(function() {
  'use strict';

  // ===== CONFIG =====
  const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? '/api'
    : 'https://serve-philosophy-bow-likelihood.trycloudflare.com/api';
  const API_TIMEOUT = 8000;

  // ===== STATE =====
  let apiAvailable = false;
  let walletAddress = null;
  let walletProvider = null;
  let currentPage = 'home';
  let betRecords = [];
  let userBalance = 0;
  let currentDetailMatchId = null;
  let oddsFlashInterval = null;
  let lang = 'cn';

  // ===== MOCK DATA =====
  const mockMatches = [
    { id:1, league:'英超 第38轮', home:'曼城', away:'利物浦', time:'2026-06-04 00:30', odds_home:2.10, odds_draw:3.30, odds_away:3.40, status:'upcoming', venue:'伊蒂哈德球场' },
    { id:2, league:'西甲 第38轮', home:'皇马', away:'巴萨', time:'2026-06-05 04:00', odds_home:2.40, odds_draw:3.20, odds_away:2.90, status:'upcoming', venue:'伯纳乌球场' },
    { id:3, league:'法甲 第38轮', home:'巴黎圣日耳曼', away:'马赛', time:'2026-06-03 03:00', odds_home:1.82, odds_draw:3.50, odds_away:4.20, status:'live', venue:'王子公园球场' },
    { id:4, league:'意甲 第38轮', home:'尤文图斯', away:'国米', time:'2026-06-05 02:45', odds_home:2.15, odds_draw:3.10, odds_away:3.50, status:'upcoming', venue:'安联球场' },
    { id:5, league:'德甲 第34轮', home:'拜仁慕尼黑', away:'多特蒙德', time:'2026-06-06 01:30', odds_home:1.95, odds_draw:3.60, odds_away:3.80, status:'upcoming', venue:'安联竞技场' },
    { id:6, league:'国际友谊赛', home:'巴西', away:'阿根廷', time:'2026-06-07 08:00', odds_home:2.50, odds_draw:3.00, odds_away:2.80, status:'upcoming', venue:'马拉卡纳球场' },
    { id:7, league:'欧冠 决赛', home:'拜仁慕尼黑', away:'巴黎圣日耳曼', time:'2026-06-08 03:00', odds_home:2.20, odds_draw:3.40, odds_away:3.10, status:'upcoming', venue:'温布利大球场' },
    { id:8, league:'英超 第37轮', home:'阿森纳', away:'切尔西', time:'2026-06-08 00:30', odds_home:2.05, odds_draw:3.25, odds_away:3.60, status:'upcoming', venue:'酋长球场' },
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

  // ===== API HELPERS =====
  function apiFetch(endpoint, opts) {
    opts = opts || {};
    let ctrl = new AbortController();
    let timer = setTimeout(function() { ctrl.abort(); }, API_TIMEOUT);
    return fetch(API_BASE + endpoint, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: opts.body || undefined,
      signal: ctrl.signal
    }).then(function(r) { return r.json(); }).then(function(d) {
      apiAvailable = true;
      return d;
    }).catch(function() {
      apiAvailable = false;
      return null;
    }).finally(function() {
      clearTimeout(timer);
    });
  }

  // ===== TOAST =====
  function showToast(msg, dur) {
    dur = dur || 2000;
    var el = document.getElementById('customToast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(function() { el.classList.remove('show'); }, dur);
  }

  // ===== CONFIRM DIALOG =====
  function showConfirm(title, content, onOk) {
    var overlay = document.getElementById('customConfirmOverlay');
    var dialog = document.getElementById('customConfirm');
    if (!overlay || !dialog) return;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmContent').textContent = content;
    overlay.style.display = 'block';
    dialog.style.display = 'block';
    function hide() { overlay.style.display = 'none'; dialog.style.display = 'none'; }
    var ok = document.getElementById('confirmOkBtn');
    var cancel = document.getElementById('confirmCancelBtn');
    var nOk = ok.cloneNode(true), nCancel = cancel.cloneNode(true), nOverlay = overlay.cloneNode(true);
    ok.parentNode.replaceChild(nOk, ok);
    cancel.parentNode.replaceChild(nCancel, cancel);
    overlay.parentNode.replaceChild(nOverlay, overlay);
    document.getElementById('confirmOkBtn').addEventListener('click', function() { hide(); if (onOk) onOk(); });
    document.getElementById('confirmCancelBtn').addEventListener('click', hide);
    document.getElementById('customConfirmOverlay').addEventListener('click', hide);
  }

  // ===== WALLET =====
  function detectWallet() {
    if (typeof window.ethereum !== 'undefined') {
      if (window.ethereum.isTokenPocket || window.ethereum.isTP) return { provider: window.ethereum, name: 'TP Wallet' };
      if (window.ethereum.isTrust) return { provider: window.ethereum, name: 'TrustWallet' };
      if (window.ethereum.isMetaMask) return { provider: window.ethereum, name: 'MetaMask' };
      return { provider: window.ethereum, name: 'Web3 Wallet' };
    }
    if (typeof window.tpWallet !== 'undefined') return { provider: window.tpWallet, name: 'TP Wallet' };
    if (typeof window.trustwallet !== 'undefined') return { provider: window.trustwallet, name: 'TrustWallet' };
    return null;
  }

  async function connectWalletWithRetry(maxRetries) {
    maxRetries = maxRetries || 3;
    for (var i = 0; i < maxRetries; i++) {
      var w = detectWallet();
      if (w) return w;
      if (i < maxRetries - 1) await new Promise(function(r) { setTimeout(r, 500); });
    }
    return null;
  }

  async function connectWallet() {
    try {
      var detected = await connectWalletWithRetry(3);
      if (!detected) { showToast('未检测到钱包插件，请安装 MetaMask 或 TP Wallet'); return; }
      var accounts = await detected.provider.request({ method: 'eth_requestAccounts' });
      if (accounts && accounts.length > 0) {
        walletAddress = accounts[0];
        walletProvider = detected.provider;
        updateWalletUI();
        showToast('钱包已连接: ' + walletAddress.substring(0, 6) + '...' + walletAddress.substring(walletAddress.length - 4));
        apiFetch('/wallet/connect', { method: 'POST', body: JSON.stringify({ wallet_address: walletAddress }) });
        if (walletProvider && walletProvider.on) {
          walletProvider.on('accountsChanged', function(newAcc) {
            if (newAcc.length === 0) { disconnectWallet(); }
            else { walletAddress = newAcc[0]; updateWalletUI(); }
          });
        }
        return;
      }
      showToast('未获取到钱包账户');
    } catch(e) {
      showToast('连接失败: ' + (e.message || '请重试'));
    }
  }

  function disconnectWallet() {
    walletAddress = null;
    walletProvider = null;
    updateWalletUI();
    showToast('已断开钱包连接');
  }

  function updateWalletUI() {
    var btn = document.getElementById('walletBtn');
    var addrEl = document.getElementById('walletAddress');
    if (walletAddress && addrEl) {
      var short = walletAddress.substring(walletAddress.length - 6);
      addrEl.textContent = '...' + short;
      if (btn) btn.classList.add('connected');
    } else {
      if (addrEl) addrEl.textContent = '';
      if (btn) btn.classList.remove('connected');
    }
  }

  function handleWalletBtnClick() {
    if (walletAddress) {
      showConfirm('断开钱包连接', '当前钱包: ...' + walletAddress.substring(walletAddress.length - 6) + '\n\n是否断开连接？', disconnectWallet);
    } else {
      connectWallet();
    }
  }

  // ===== WORLD CUP COUNTDOWN =====
  function startWorldCupCountdown() {
    var target = new Date('2026-06-11T00:00:00Z').getTime();
    var el = document.getElementById('cd-timer');
    function tick() {
      var diff = target - Date.now();
      if (diff <= 0) { if (el) el.textContent = '世界杯已开赛!'; return; }
      var d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000);
      var m = Math.floor((diff % 3600000) / 60000), s = Math.floor((diff % 60000) / 1000);
      if (el) el.textContent = d + '天 ' + h + '小时 ' + m + '分 ' + s + '秒';
    }
    tick();
    setInterval(tick, 1000);
  }

  // ===== TEAM LOGO =====
  function teamLogoImg(name, size) {
    var s = size || 50;
    var slug = name.replace(/[^a-zA-Z\u4e00-\u9fff]/g, '_').toLowerCase();
    var fallback = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="#E8EBF5"/><text x="50" y="60" text-anchor="middle" font-size="32" fill="#999" font-family="Arial" font-weight="bold">' + name.charAt(0) + '</text></svg>');
    return '<img src="img/teams/' + name + '.png" width="' + s + '" height="' + s + '" style="border-radius:50%;object-fit:contain;background:#E8EBF5;flex-shrink:0" alt="' + name + '" onerror="this.onerror=null;this.src=\'' + fallback + '\'">';
  }

  // ===== MATCH CARD (lucky944 DOM) =====
  function matchCardHTML(m) {
    var t = m.time || m.match_time || '';
    var parts = t.split(' ');
    var dateStr = parts.length > 1 ? parts[0].slice(5) : '';
    var timeStr = parts.length > 1 ? parts[1].slice(0, 5) : t.slice(11, 16) || '--';
    var home = m.home || m.home_team || '';
    var away = m.away || m.away_team || '';
    var league = m.league || m.league_name || '';
    return '<li><a href="javascript:;" class="con" onclick="app.openMatch(' + m.id + ')">' +
      '<div class="league-name"><p class="p1">' + league + '</p></div>' +
      '<div class="match-content">' +
        '<div class="team-left">' +
          '<div class="team-logo">' + teamLogoImg(home, 44) + '</div>' +
          '<div class="team-name">' + home + '</div>' +
        '</div>' +
        '<div class="match-center">' +
          '<div class="time">' + timeStr + '</div>' +
          '<div class="date">' + dateStr + '</div>' +
        '</div>' +
        '<div class="team-right">' +
          '<div class="team-logo">' + teamLogoImg(away, 44) + '</div>' +
          '<div class="team-name">' + away + '</div>' +
        '</div>' +
      '</div>' +
    '</a></li>';
  }

  // ===== MATCHES PAGE CARD (with odds) =====
  function matchesPageCardHTML(m) {
    var t = m.time || m.match_time || '';
    var parts = t.split(' ');
    var dateStr = parts.length > 1 ? parts[0].slice(5) : '';
    var timeStr = parts.length > 1 ? parts[1].slice(0, 5) : t.slice(11, 16) || '--';
    var home = m.home || m.home_team || '';
    var away = m.away || m.away_team || '';
    var league = m.league || m.league_name || '';
    return '<li><a href="javascript:;" class="con" onclick="app.openMatch(' + m.id + ')">' +
      '<div class="league-name"><p class="p1">' + league + '</p></div>' +
      '<div class="match-content">' +
        '<div class="team-left">' +
          '<div class="team-logo">' + teamLogoImg(home, 44) + '</div>' +
          '<div class="team-name">' + home + '</div>' +
        '</div>' +
        '<div class="match-center">' +
          '<div class="time">' + timeStr + '</div>' +
          '<div class="date">' + dateStr + '</div>' +
        '</div>' +
        '<div class="team-right">' +
          '<div class="team-logo">' + teamLogoImg(away, 44) + '</div>' +
          '<div class="team-name">' + away + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="match-odds">' +
        '<div class="odds-tag">主胜<span class="val">' + ((m.odds_home || (m.odds && m.odds.home)) || '--') + '</span></div>' +
        '<div class="odds-tag">平局<span class="val">' + ((m.odds_draw || (m.odds && m.odds.draw)) || '--') + '</span></div>' +
        '<div class="odds-tag">客胜<span class="val">' + ((m.odds_away || (m.odds && m.odds.away)) || '--') + '</span></div>' +
      '</div>' +
    '</a></li>';
  }

  // ===== NAVIGATION =====
  var tabPageMap = { 'home': 0, 'ai': 1, 'matches': 2, 'records': 3, 'profile': 4 };
  var tabNames = ['home', 'ai', 'matches', 'records', 'profile'];

  function navigateTo(page) {
    if (currentPage === page) return;
    currentPage = page;

    // Hide all pages
    var pages = document.querySelectorAll('.page');
    for (var i = 0; i < pages.length; i++) {
      pages[i].style.display = 'none';
    }

    // Show target page (create if needed)
    var target = document.getElementById('page-' + page);
    if (target) {
      target.style.display = '';
    }

    // Update bottom nav active state
    var tabItems = document.querySelectorAll('.footer .ul-tabbar li');
    for (var j = 0; j < tabItems.length; j++) {
      tabItems[j].classList.remove('on');
    }
    var tabIdx = tabPageMap[page];
    if (tabIdx !== undefined && tabItems[tabIdx]) {
      tabItems[tabIdx].classList.add('on');
    }

    // Update top tabs active state (for home page tabs: 推荐赛事 / 冠亚预测)
    if (page === 'home') {
      var topTabs = document.querySelectorAll('.slick_tab_btn .ul-tabs_b1 li');
      for (var k = 0; k < topTabs.length; k++) {
        topTabs[k].classList.toggle('on', k === 0);
      }
      var tabCons = document.querySelectorAll('.slick_tab .tab_con');
      if (tabCons.length > 0) tabCons[0].style.display = '';
      if (tabCons.length > 1) tabCons[1].style.display = 'none';
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Trigger page-specific renders
    if (page === 'home') renderMatchCards();
    if (page === 'matches') renderMatchesPage();
    if (page === 'records') renderRecords();
    if (page === 'profile') renderProfile();
    if (page === 'ai') renderAIPage();
  }

  // ===== TOP TAB SWITCHING (on home page) =====
  function switchTopTab(idx) {
    var tabCons = document.querySelectorAll('.slick_tab .tab_con');
    var topTabs = document.querySelectorAll('.slick_tab_btn .ul-tabs_b1 li');
    for (var i = 0; i < tabCons.length; i++) {
      tabCons[i].style.display = (i === idx) ? '' : 'none';
    }
    for (var j = 0; j < topTabs.length; j++) {
      topTabs[j].classList.toggle('on', j === idx);
    }
    if (idx === 1) renderChampionBet();
  }

  // ===== PAGE: HOME - Matches =====
  async function renderMatchCards() {
    var container = document.getElementById('matchList');
    if (!container) return;

    container.innerHTML = '<li><div class="con" style="padding:20px;text-align:center;color:#999">加载中...</div></li>';

    var data = mockMatches;
    if (apiAvailable) {
      var res = await apiFetch('/matches');
      if (res && res.code === 0 && res.data && res.data.length > 0) data = res.data;
    }

    if (!data || data.length === 0) {
      container.innerHTML = '<li><div class="con" style="padding:30px;text-align:center;color:#999">暂无赛事数据</div></li>';
    } else {
      container.innerHTML = data.map(function(m) { return matchCardHTML(m); }).join('');
    }
  }

  // ===== PAGE: HOME - Champion Bet =====
  async function renderChampionBet() {
    var grid = document.getElementById('teamsGrid');
    if (!grid) return;

    var teams = mockChampionTeams;
    if (apiAvailable) {
      var res = await apiFetch('/champion-bet/odds');
      if (res && res.code === 0 && res.data && res.data.odds) teams = res.data.odds;
    }

    grid.innerHTML = teams.map(function(t) {
      var champOdds = (t.championship_odds || t.champion_odds || 8).toFixed(2);
      var runnerOdds = (t.runner_up_odds || t.runnerUpOdds || 6).toFixed(2);
      return '<div class="team-card">' +
        '<div class="team-logo">' + teamLogoImg(t.name, 56) + '</div>' +
        '<div class="team-name">' + t.name + '</div>' +
        '<div class="odds-group">' +
          '<div class="odds-item"><span class="odds-label">冠军</span><span class="odds-value">' + champOdds + '</span></div>' +
          '<div class="odds-item"><span class="odds-label">亚军</span><span class="odds-value">' + runnerOdds + '</span></div>' +
        '</div>' +
        '<div class="bet-buttons">' +
          '<button class="bet-btn bet-champion" onclick="app.openChampionBet(\'' + t.name + '\', ' + t.id + ', \'champion\', ' + champOdds + ')">投冠军</button>' +
          '<button class="bet-btn bet-runner-up" onclick="app.openChampionBet(\'' + t.name + '\', ' + t.id + ', \'runnerup\', ' + runnerOdds + ')">投亚军</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ===== PAGE: MATCHES (full list with odds) =====
  async function renderMatchesPage() {
    var container = document.getElementById('matchesPageList');
    if (!container) {
      var mainEl = document.querySelector('.main .wp');
      if (!mainEl) return;
      var existing = document.getElementById('page-matches');
      if (!existing) {
        existing = document.createElement('div');
        existing.id = 'page-matches';
        existing.className = 'page';
        existing.innerHTML = '<ul class="ul-info" id="matchesPageList"></ul>';
        mainEl.appendChild(existing);
      }
      container = document.getElementById('matchesPageList');
    }

    container.innerHTML = '<li><div class="con" style="padding:20px;text-align:center;color:#999">加载中...</div></li>';

    var data = mockMatches.slice(0);
    if (apiAvailable) {
      var res = await apiFetch('/matches');
      if (res && res.code === 0 && res.data && res.data.length > 0) data = res.data;
    }

    if (!data || data.length === 0) {
      container.innerHTML = '<li><div class="con" style="padding:30px;text-align:center;color:#999">暂无赛事数据</div></li>';
    } else {
      container.innerHTML = data.map(function(m) { return matchesPageCardHTML(m); }).join('');
    }
  }

  // ===== PAGE: RECORDS =====
  async function renderRecords(filter) {
    filter = filter || 'all';
    var container = document.getElementById('recordsList');
    if (!container) return;

    var records = betRecords.slice(0);

    // Try API fetch if wallet connected
    if (apiAvailable && walletAddress) {
      var res = await apiFetch('/bets?address=' + encodeURIComponent(walletAddress));
      if (res && res.code === 0 && res.data && res.data.length > 0) {
        records = res.data.map(function(r) {
          return {
            id: r.id,
            team: r.team_name || r.team || '',
            type: r.bet_type_name || r.type || '',
            amount: r.amount || 0,
            odds: r.odds || 0,
            potentialWin: r.potential_win || 0,
            time: r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : (r.time || ''),
            status: r.status || 'pending'
          };
        });
      }
    }

    if (filter === 'pending') records = records.filter(function(r) { return r.status === 'pending'; });
    if (filter === 'won') records = records.filter(function(r) { return r.status === 'won'; });
    if (filter === 'lost') records = records.filter(function(r) { return r.status === 'lost'; });

    if (records.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:#999">暂无投注记录</div>';
      return;
    }

    container.innerHTML = records.map(function(r) {
      var cls = r.status === 'won' ? 'won' : r.status === 'lost' ? 'lost' : 'pending';
      var txt = r.status === 'won' ? '已赢' : r.status === 'lost' ? '已输' : '进行中';
      var color = r.status === 'won' ? '#03A66D' : r.status === 'lost' ? '#e53935' : '#DAA520';
      return '<div class="record-item" style="padding:12px;border-bottom:1px solid #eee">' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:4px">' +
          '<span style="font-size:12px;color:#999">' + (r.type || '投注') + '</span>' +
          '<span style="font-size:12px;color:#999">' + (r.time || '') + '</span>' +
        '</div>' +
        '<div style="font-weight:600;margin-bottom:4px">' + (r.team || '') + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<span>' + (r.amount || 0) + ' USDT</span>' +
          '<span style="color:' + color + ';font-size:12px;font-weight:600">' + txt + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function filterRecords(filter, evt) {
    if (evt && evt.target) {
      var btns = document.querySelectorAll('#page-records .filter-btn');
      for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
      evt.target.classList.add('active');
    }
    renderRecords(filter);
  }

  // ===== PAGE: PROFILE =====
  function renderProfile() {
    if (walletAddress) {
      var short = walletAddress.substring(0, 6) + '...' + walletAddress.substring(walletAddress.length - 4);
      var addrEl = document.getElementById('profileAddr');
      if (addrEl) addrEl.textContent = short;
    }
  }

  // ===== PAGE: AI =====
  function renderAIPage() {
    // AI prediction page - show placeholder content
    var container = document.getElementById('page-ai');
    if (!container) {
      var mainEl = document.querySelector('.main .wp');
      if (!mainEl) return;
      var existing = document.getElementById('page-ai');
      if (!existing) {
        existing = document.createElement('div');
        existing.id = 'page-ai';
        existing.className = 'page';
        existing.innerHTML = '<div style="padding:20px;text-align:center">' +
          '<h3 style="margin-bottom:15px">AI 智能预测</h3>' +
          '<p style="color:#999;margin-bottom:10px">基于5000万场历史数据进行深度学习</p>' +
          '<p style="color:#999;margin-bottom:10px">反波胆玩法理论胜率高达 88.89%</p>' +
          '<div style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:20px;border-radius:12px;margin-top:20px">' +
            '<p style="font-size:24px;font-weight:bold">15%</p>' +
            '<p style="font-size:12px">AI 托管月化收益</p>' +
          '</div>' +
        '</div>';
        mainEl.appendChild(existing);
      }
    }
  }

  // ===== BETTING FLOW =====
  var betDialogData = null;

  function openMatch(matchId) {
    currentDetailMatchId = matchId;
    var match = findMatch(matchId);
    if (!match) { showToast('赛事不存在'); return; }

    betDialogData = {
      matchId: matchId,
      home: match.home || match.home_team,
      away: match.away || match.away_team,
      league: match.league || match.league_name,
      oddsHome: match.odds_home || (match.odds && match.odds.home) || '--',
      oddsDraw: match.odds_draw || (match.odds && match.odds.draw) || '--',
      oddsAway: match.odds_away || (match.odds && match.odds.away) || '--',
      time: match.time || match.match_time || ''
    };

    showBetDialog();
  }

  function findMatch(id) {
    var found = mockMatches.find(function(m) { return m.id === id; });
    if (!found && id >= 1 && id <= mockMatches.length) found = mockMatches[id - 1];
    return found || mockMatches[0];
  }

  function showBetDialog() {
    var dialog = document.getElementById('betAmountDialog');
    if (!dialog) return;
    var d = betDialogData;
    if (!d) return;

    var timeParts = (d.time || '').split(' ');
    var timeStr = timeParts.length > 1 ? timeParts[1].slice(0, 5) : d.time.slice(11, 16) || '';

    document.getElementById('betDialogTeamName').textContent = d.home + ' vs ' + d.away;
    document.getElementById('betDialogTypeName').textContent = d.league + ' | ' + timeStr;
    document.getElementById('betDialogOdds').textContent = d.oddsHome;
    document.getElementById('betAmountInput').value = '100';
    updateBetDialogProfit();

    dialog.classList.add('show');
  }

  function closeBetDialog() {
    var dialog = document.getElementById('betAmountDialog');
    if (dialog) dialog.classList.remove('show');
  }

  function updateBetDialogProfit() {
    var amount = parseFloat(document.getElementById('betAmountInput').value) || 0;
    var odds = parseFloat(document.getElementById('betDialogOdds').textContent) || 0;
    var profit = amount > 0 ? (amount * odds - amount) : 0;
    document.getElementById('betDialogProfit').textContent = profit.toFixed(2);
  }

  function confirmBet() {
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    var amount = parseFloat(document.getElementById('betAmountInput').value);
    if (!amount || amount < 1 || isNaN(amount)) { showToast('请输入正确的投注金额'); return; }
    var d = betDialogData;
    if (!d) return;

    var record = {
      id: Date.now(),
      team: d.home + ' vs ' + d.away,
      type: '比分投注',
      amount: amount,
      odds: parseFloat(document.getElementById('betDialogOdds').textContent) || 0,
      potentialWin: parseFloat(document.getElementById('betDialogProfit').textContent) || 0,
      time: new Date().toLocaleString('zh-CN'),
      status: 'pending'
    };
    betRecords.unshift(record);
    saveData();
    closeBetDialog();
    showToast('投注成功！' + amount + ' USDT');
  }

  // Champion bet
  function openChampionBet(teamName, teamId, betType, odds) {
    if (!walletAddress) { showToast('请先连接钱包'); return; }

    var typeName = betType === 'champion' ? '冠军' : '亚军';
    betDialogData = {
      teamName: teamName,
      teamId: teamId,
      betType: betType,
      odds: odds,
      typeName: typeName
    };

    document.getElementById('betDialogTeamName').textContent = teamName;
    document.getElementById('betDialogTypeName').textContent = typeName;
    document.getElementById('betDialogOdds').textContent = odds;
    document.getElementById('betAmountInput').value = '100';
    updateBetDialogProfit();

    var dialog = document.getElementById('betAmountDialog');
    if (dialog) dialog.classList.add('show');
  }

  // ===== QUICK AMOUNTS =====
  function setQuickAmount(amount) {
    var inp = document.getElementById('betAmountInput');
    if (inp) {
      inp.value = amount;
      updateBetDialogProfit();
    }
  }

  // ===== DATA PERSISTENCE =====
  function saveData() {
    try {
      localStorage.setItem('19888_bet_records', JSON.stringify(betRecords));
      localStorage.setItem('19888_balance', userBalance);
    } catch(e) {}
  }

  function loadData() {
    try {
      var r = localStorage.getItem('19888_bet_records');
      if (r) betRecords = JSON.parse(r);
      userBalance = +localStorage.getItem('19888_balance') || 0;
    } catch(e) {}
  }

  // ===== LANGUAGE =====
  function setLanguage(langCode) {
    lang = langCode;
    try { localStorage.setItem('19888_lang', langCode); } catch(e) {}
    document.querySelectorAll('.global-lang-option').forEach(function(o) {
      o.classList.toggle('selected', o.getAttribute('data-lang') === langCode);
    });
    var modal = document.getElementById('globalLangModal');
    if (modal) modal.classList.remove('active');
  }

  // ===== OPPORTUNISTIC TOUCH FEEDBACK =====
  function setupTouchFeedback() {
    document.addEventListener('pointerdown', function(e) {
      var el = e.target.closest('button, [role="button"], .con, .team-card, .bet-btn, .record-item');
      if (el && !el.disabled) { el.style.transform = 'scale(0.96)'; el.style.transition = 'transform 0.1s ease'; }
    }, { passive: true });
    document.addEventListener('pointerup', function(e) {
      var el = e.target.closest('button, [role="button"], .con, .team-card, .bet-btn, .record-item');
      if (el) { el.style.transform = ''; }
    }, { passive: true });
    document.addEventListener('pointercancel', function(e) {
      var el = e.target.closest('button, [role="button"], .con, .team-card, .bet-btn, .record-item');
      if (el) { el.style.transform = ''; }
    }, { passive: true });
  }

  // ===== BANNER AUTO-PLAY =====
  function setupBanner() {
    var items = document.querySelectorAll('.slick-banner .item');
    if (items.length <= 1) return;
    var current = 0;
    for (var i = 1; i < items.length; i++) items[i].style.display = 'none';

    var dotsContainer = document.createElement('div');
    dotsContainer.className = 'slick-dots';
    items.forEach(function(_, i) {
      var dot = document.createElement('li');
      if (i === 0) dot.className = 'slick-active';
      var btn = document.createElement('button');
      btn.textContent = i + 1;
      dot.appendChild(btn);
      dot.addEventListener('click', function() { goTo(i); });
      dotsContainer.appendChild(dot);
    });
    var banner = document.querySelector('.slick-banner');
    if (banner) { banner.style.position = 'relative'; banner.appendChild(dotsContainer); }

    function goTo(idx) {
      items.forEach(function(it, i) { it.style.display = i === idx ? 'flex' : 'none'; });
      var dots = dotsContainer.querySelectorAll('li');
      dots.forEach(function(d, i) { d.className = i === idx ? 'slick-active' : ''; });
      current = idx;
    }
    function next() { goTo((current + 1) % items.length); }
    setInterval(next, 4000);
  }

  // ===== EXPORT API =====
  window.app = {
    openMatch: openMatch,
    navigateTo: navigateTo,
    connectWallet: connectWallet,
    disconnectWallet: disconnectWallet,
    handleWalletBtnClick: handleWalletBtnClick,
    showToast: showToast,
    openChampionBet: openChampionBet,
    closeBetDialog: closeBetDialog,
    confirmBet: confirmBet,
    setQuickAmount: setQuickAmount,
    filterRecords: filterRecords,
    setLanguage: setLanguage,
    switchTopTab: switchTopTab,
    renderMatchCards: renderMatchCards,
    renderChampionBet: renderChampionBet,
    openBetDialog: showBetDialog,
  };

  // ===== INIT =====
  function init() {
    loadData();
    setupTouchFeedback();
    setupBanner();
    startWorldCupCountdown();

    // Wallet button listener
    var walletBtn = document.getElementById('walletBtn');
    if (walletBtn) walletBtn.addEventListener('click', handleWalletBtnClick);

    // Language modal
    var langBtn = document.getElementById('globalLangSwitchBtn');
    if (langBtn) {
      langBtn.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        var m = document.getElementById('globalLangModal');
        if (m) m.classList.add('active');
      });
    }
    var langMask = document.getElementById('globalLangModalMask');
    if (langMask) {
      langMask.addEventListener('click', function() {
        var m = document.getElementById('globalLangModal');
        if (m) m.classList.remove('active');
      });
    }
    document.querySelectorAll('.global-lang-option').forEach(function(opt) {
      opt.addEventListener('click', function() {
        setLanguage(this.getAttribute('data-lang'));
      });
    });

    // Language options click
    document.querySelectorAll('.global-lang-option').forEach(function(opt) {
      opt.addEventListener('click', function() {
        var l = this.getAttribute('data-lang');
        lang = l;
        try { localStorage.setItem('current_lang', l); } catch(e) {}
        document.querySelectorAll('.global-lang-option').forEach(function(o) { o.classList.remove('selected'); });
        this.classList.add('selected');
        var m = document.getElementById('globalLangModal');
        if (m) m.classList.remove('active');
      });
    });

    // Bottom nav click handlers
    var footerLinks = document.querySelectorAll('.footer .ul-tabbar li a');
    footerLinks.forEach(function(link, idx) {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        var page = tabNames[idx] || 'home';
        navigateTo(page);
      });
    });

    // Top tab click handlers (home page tabs)
    var topTabs = document.querySelectorAll('.slick_tab_btn .ul-tabs_b1 li');
    topTabs.forEach(function(tab, idx) {
      tab.addEventListener('click', function(e) {
        e.preventDefault();
        switchTopTab(idx);
      });
    });

    // Bet dialog: amount input
    var betInput = document.getElementById('betAmountInput');
    if (betInput) betInput.addEventListener('input', updateBetDialogProfit);

    // Bet dialog: cancel
    var betCancel = document.getElementById('betDialogCancel');
    if (betCancel) betCancel.addEventListener('click', function(e) { e.preventDefault(); closeBetDialog(); });

    // Bet dialog: overlay click to close
    var betOverlay = document.querySelector('#betAmountDialog .dialog-overlay');
    if (betOverlay) betOverlay.addEventListener('click', function(e) { e.preventDefault(); closeBetDialog(); });

    // Bet dialog: confirm
    var betConfirm = document.getElementById('betDialogConfirm');
    if (betConfirm) betConfirm.addEventListener('click', function(e) { e.preventDefault(); confirmBet(); });

    // Quick amount buttons
    document.querySelectorAll('.quick-amount').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        setQuickAmount(this.getAttribute('data-amount'));
      });
    });

    // API health check
    apiFetch('/status').then(function() {}).catch(function() {});

    // Render home
    renderMatchCards();

    // Restore saved language
    try {
      var savedLang = localStorage.getItem('19888_lang') || localStorage.getItem('current_lang');
      if (savedLang) {
        lang = savedLang;
        document.querySelectorAll('.global-lang-option').forEach(function(o) {
          o.classList.toggle('selected', o.getAttribute('data-lang') === savedLang);
        });
      }
    } catch(e) {}

    console.log('19888 platform initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Offline detection
  (function() {
    var banner = null;
    function createBanner() {
      banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#e53935;color:#fff;text-align:center;padding:8px;font-size:13px;transform:translateY(-100%);transition:transform 0.3s';
      banner.textContent = '网络已断开 - 部分功能不可用';
      document.body.appendChild(banner);
    }
    window.addEventListener('online', function() {
      if (banner) banner.style.transform = 'translateY(-100%)';
      renderMatchCards();
    });
    window.addEventListener('offline', function() {
      if (!banner) createBanner();
      banner.style.transform = 'translateY(0)';
    });
    if (!navigator.onLine && !banner) { createBanner(); banner.style.transform = 'translateY(0)'; }
  })();

  // Global error handler
  window.onerror = function() { return true; };

})();
