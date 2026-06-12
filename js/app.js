(function() {
  'use strict';

  // ===== CONFIG =====
  const DEFAULT_API_BASE = 'https://one9888-api.onrender.com/api';
  function resolveApiBase() {
    // Priority: localStorage override → same-domain api → default tunnel
    const stored = cacheGet('19888_api_base');
    if (stored) return stored;
    // On localhost, use relative path
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return '/api';
    }
    return DEFAULT_API_BASE;
  }

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

  // In-memory cache fallback when localStorage unavailable (FP-V19888-4)
  const _memCache = new Map();

  function cacheSet(key, val) {
    try { localStorage.setItem(key, val); }
    catch(e) {
      console.warn('[FP-V19888-4] localStorage unavailable, using memory cache:', e.message);
      _memCache.set(key, val);
    }
  }
  function cacheGet(key) {
    try { return localStorage.getItem(key); }
    catch(e) { return _memCache.get(key) || null; }
  }

  // ===== API OFFLINE BANNER (FP-V19888-3) =====
  let _apiOfflineBannerShown = false;
  function showApiOfflineBanner() {
    if (_apiOfflineBannerShown) return;
    _apiOfflineBannerShown = true;
    var banner = document.createElement('div');
    banner.id = 'api-offline-banner';
    banner.style.cssText = 'background:#FFF3CD;color:#856404;text-align:center;padding:8px 12px;font-size:12px;font-weight:600;border-bottom:1px solid #FFC107;position:sticky;top:45px;z-index:99;display:flex;align-items:center;justify-content:space-between;gap:8px';
    banner.innerHTML = '<span>⚠️ API离线 — 展示示例数据，不可下注</span><button onclick="app.retryConnection()" style="background:#E53935;color:#fff;border:none;padding:4px 12px;border-radius:4px;font-size:11px;cursor:pointer;font-weight:700">🔄 重试连接</button>';
    var header = document.querySelector('.header');
    if (header && header.nextSibling) {
      header.parentNode.insertBefore(banner, header.nextSibling);
    }
    // Auto-hide when API recovers
    setTimeout(function() {
      var el = document.getElementById('api-offline-banner');
      if (el && apiAvailable) { el.style.display = 'none'; _apiOfflineBannerShown = false; }
    }, 10000);
  }

  // Retry API connection
  function retryConnection() {
    _apiOfflineBannerShown = false;
    var banner = document.getElementById('api-offline-banner');
    if (banner) banner.style.display = 'none';
    // Reload current page data
    if (currentPage === 'home') renderMatchCards();
    if (currentPage === 'ai') renderAIPage();
    if (currentPage === 'matches') navigateTo('matches');
    if (currentPage === 'records') renderRecords();
    if (currentPage === 'profile') renderProfile();
    if (currentPage === 'transactions') renderTransactions();
  }

  // Try API, fallback to mock data (FP-V19888-3)
  async function loadWithFallback(endpoint, mockData) {
    var res = await apiFetch(endpoint);
    if (res && res.code === 0 && res.data) {
      apiAvailable = true;
      return res.data;
    }
    // API failed — show banner and return mock
    if (!apiAvailable) showApiOfflineBanner();
    return mockData;
  }
  const mockMatches = [
    {id:1,league:"世界杯 A组·第1轮",home:"美国",away:"墨西哥",time:"2026-06-11 14:00",odds_home:1.65,odds_draw:3.30,odds_away:6.00,status:"upcoming"},
    {id:2,league:"世界杯 A组·第2轮",home:"挪威",away:"新西兰",time:"2026-06-11 17:00",odds_home:1.70,odds_draw:3.50,odds_away:5.50,status:"upcoming"},
    {id:3,league:"世界杯 B组·第1轮",home:"巴西",away:"德国",time:"2026-06-11 14:00",odds_home:1.56,odds_draw:3.50,odds_away:6.50,status:"upcoming"},
    {id:4,league:"世界杯 C组·第5轮",home:"法国",away:"荷兰",time:"2026-06-12 14:00",odds_home:1.55,odds_draw:3.80,odds_away:6.00,status:"upcoming"},
    {id:5,league:"世界杯 D组·第3轮",home:"阿根廷",away:"英格兰",time:"2026-06-12 17:00",odds_home:1.60,odds_draw:3.50,odds_away:5.50,status:"upcoming"},
    {id:6,league:"世界杯 E组·第1轮",home:"西班牙",away:"意大利",time:"2026-06-12 20:00",odds_home:1.80,odds_draw:3.20,odds_away:4.50,status:"upcoming"},
    {id:7,league:"世界杯 F组·第2轮",home:"葡萄牙",away:"比利时",time:"2026-06-13 14:00",odds_home:1.75,odds_draw:3.40,odds_away:4.80,status:"upcoming"},
    {id:8,league:"世界杯 G组·第1轮",home:"摩洛哥",away:"塞内加尔",time:"2026-06-13 17:00",odds_home:2.80,odds_draw:2.90,odds_away:2.80,status:"upcoming"},
  ];
  const mockChampionTeams = [
    {id:1,name:"巴西",flag:"🇧🇷",champion_odds:5.5,runner_odds:4.0,group:"B"},
    {id:2,name:"法国",flag:"🇫🇷",champion_odds:6.0,runner_odds:4.5,group:"C"},
    {id:3,name:"阿根廷",flag:"🇦🇷",champion_odds:6.5,runner_odds:5.0,group:"D"},
    {id:4,name:"德国",flag:"🇩🇪",champion_odds:7.0,runner_odds:5.0,group:"B"},
    {id:5,name:"英格兰",flag:"🏴󠁧󠁢󠁥󠁮󠁧󠁿",champion_odds:7.5,runner_odds:5.5,group:"D"},
    {id:6,name:"西班牙",flag:"🇪🇸",champion_odds:9.0,runner_odds:6.5,group:"E"},
    {id:7,name:"葡萄牙",flag:"🇵🇹",champion_odds:10.0,runner_odds:7.0,group:"F"},
    {id:8,name:"荷兰",flag:"🇳🇱",champion_odds:11.0,runner_odds:8.0,group:"C"},
    {id:9,name:"意大利",flag:"🇮🇹",champion_odds:13.0,runner_odds:9.0,group:"E"},
    {id:10,name:"比利时",flag:"🇧🇪",champion_odds:15.0,runner_odds:10.0,group:"F"},
    {id:11,name:"美国",flag:"🇺🇸",champion_odds:15.0,runner_odds:10.0,group:"A"},
    {id:12,name:"挪威",flag:"🇳🇴",champion_odds:20.0,runner_odds:14.0,group:"A"},
  ];

  // ===== API HELPERS =====
  function apiFetch(endpoint, opts) {
    opts = opts || {};

    // Simple: try each URL once, first success wins
    const urls = [resolveApiBase()];
    const sameOrigin = window.location.origin + '/api';
    if (urls[0] !== sameOrigin) urls.push(sameOrigin);

    function tryUrl(idx) {
      if (idx >= urls.length) {
        return Promise.resolve(null);
      }
      var base = urls[idx];
      var url = base + endpoint;
      var ctrl = new AbortController();
      var timer = setTimeout(function() { ctrl.abort(); }, 10000);
      return fetch(url, {
        method: opts.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: opts.body || undefined,
        signal: ctrl.signal
      }).then(function(r) {
        clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        apiAvailable = true;
        if (base !== resolveApiBase()) cacheSet('19888_api_base', base);
        return r.json();
      }).catch(function(err) {
        clearTimeout(timer);
        return tryUrl(idx + 1);
      });
    }
    return tryUrl(0);
  }

  // ===== TOAST =====
  function showToast(msg, dur) {
    dur = dur || 2000;
    const el = document.getElementById('customToast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(function() { el.classList.remove('show'); }, dur);
  }

  // ===== CONFIRM DIALOG =====
  function showConfirm(title, content, onOk) {
    const overlay = document.getElementById('customConfirmOverlay');
    const dialog = document.getElementById('customConfirm');
    if (!overlay || !dialog) return;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmContent').textContent = content;
    overlay.style.display = 'block';
    dialog.style.display = 'block';
    function hide() { overlay.style.display = 'none'; dialog.style.display = 'none'; }
    const ok = document.getElementById('confirmOkBtn');
    const cancel = document.getElementById('confirmCancelBtn');
    const nOk = ok.cloneNode(true), nCancel = cancel.cloneNode(true), nOverlay = overlay.cloneNode(true);
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

  // ===== WALLET (DApp via web3.js) =====
  async function connectWallet() {
    if (typeof window.dapp === 'undefined') { showToast('Web3模块未加载'); return; }
    // dapp.connect() internally waits for wallet provider injection (TP Wallet support)
    const result = await window.dapp.connect();
    if (result.success) {
      walletAddress = result.address;

      // Check if on Sepolia, if not — switch
      const chainOk = await dapp.switchChain();
      if (!chainOk) {
        showToast('⚠️ 未检测到Sepolia网络，部分功能可能受限');
      }

      showToast('钱包已连接: ' + walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4));

      // Sync with backend (await it)
      await apiFetch('/wallet/connect', { method: 'POST', body: JSON.stringify({ wallet_address: walletAddress }) });

      // Load all user data from backend
      loadPoolBalance();
      syncAllUserData();
      
      // Refresh current page
      if (currentPage === 'profile') renderProfile();
      if (currentPage === 'records') renderRecords();
      if (currentPage === 'transactions') renderTransactions();
    } else {
      showToast(result.error || '连接失败');
    }
  }

  async function loadPoolBalance() {
    // Always load backend balance first
    if (walletAddress) {
      try {
        var balRes = await apiFetch('/user/balance?address=' + encodeURIComponent(walletAddress));
        if (balRes && balRes.code === 0 && balRes.data) {
          userBalance = balRes.data.available || 0;
          var usdtEl = document.getElementById('profileUSDTBalance');
          if (usdtEl) usdtEl.textContent = Number(balRes.data.available || 0).toFixed(2) + ' USDT';
        }
      } catch(e) {}
    }
    // Also try on-chain balance via dapp
    if (typeof dapp !== 'undefined') {
      try {
        const bal = await dapp.getPoolBalance();
        const balEl = document.getElementById('profilePoolBalance');
        if (balEl) balEl.textContent = Number(bal).toFixed(2) + ' USDT';
      } catch(e) {}
    }
  }

  // ===== SYNC ALL USER DATA =====
  async function syncAllUserData() {
    if (!walletAddress) return;
    await Promise.all([
      loadPnLData().catch(function(){}),
      loadVIPData().catch(function(){}),
    ]);
  }

  // Auto-refresh profile data every 30s
  let _profileRefreshTimer = null;
  function startProfileAutoRefresh() {
    stopProfileAutoRefresh();
    _profileRefreshTimer = setInterval(function() {
      if (currentPage === 'profile' && walletAddress) {
        loadPoolBalance();
        loadPnLData();
        loadVIPData();
      }
    }, 30000);
  }
  function stopProfileAutoRefresh() {
    if (_profileRefreshTimer) { clearInterval(_profileRefreshTimer); _profileRefreshTimer = null; }
  }

  // ===== PNl DATA =====
  let pnlData = { total_wagered: 0, total_won: 0, net_pnl: 0, roi: 0 };

  async function loadPnLData() {
    if (!walletAddress) return;
    try {
      const res = await apiFetch('/user/pnl?wallet=' + encodeURIComponent(walletAddress));
      if (res && res.code === 0 && res.data) {
        pnlData = {
          total_wagered: parseFloat(res.data.total_wagered) || 0,
          total_won: parseFloat(res.data.total_won) || 0,
          net_pnl: parseFloat(res.data.net_pnl) || 0,
          roi: parseFloat(res.data.roi) || 0
        };
      }
    } catch(e) { pnlData = { total_wagered: 0, total_won: 0, net_pnl: 0, roi: 0 }; }
  }

  // ===== VIP DATA =====
  async function loadVIPData() {
    if (!walletAddress) return;
    var card = document.getElementById('vipCard');
    if (!card) return;
    try {
      var res = await apiFetch('/vip/status?wallet=' + encodeURIComponent(walletAddress));
      if (res && res.code === 0 && res.data) {
        var d = res.data;
        card.style.display = 'block';
        var levelEl = document.getElementById('vipLevelName');
        if (levelEl) levelEl.textContent = d.name;
        var wageredEl = document.getElementById('vipWagered');
        if (wageredEl) wageredEl.textContent = '$' + (d.total_wagered || 0).toLocaleString();
        var cashbackEl = document.getElementById('vipCashback');
        if (cashbackEl) cashbackEl.textContent = '返佣' + ((d.cashback || 0) * 100).toFixed(1) + '%';
        var oddsEl = document.getElementById('vipOdds');
        if (oddsEl) oddsEl.textContent = '赔率+' + ((d.odds_boost || 0) * 100).toFixed(0) + '%';
        var barEl = document.getElementById('vipProgressBar');
        var labelEl = document.getElementById('vipProgressLabel');
        var nextEl = document.getElementById('vipNextLevel');
        if (d.next_level) {
          var progress = Math.min(100, ((d.total_wagered || 0) / d.next_level.need * 100));
          if (barEl) barEl.style.width = progress + '%';
          if (labelEl) labelEl.textContent = '距' + d.next_level.name + '还需';
          if (nextEl) nextEl.textContent = '$' + (d.next_level.need || 0).toLocaleString();
        } else {
          if (barEl) barEl.style.width = '100%';
          if (labelEl) labelEl.textContent = '已达最高等级';
          if (nextEl) nextEl.textContent = '🎉';
        }
      }
    } catch(e) { if (card) card.style.display = 'none'; }
  }

  function disconnectWallet() {
    if (typeof dapp !== 'undefined') dapp.disconnect();
    walletAddress = null;
    walletProvider = null;
    showToast('已断开钱包连接');
  }

  function handleWalletBtnClick() {
    if (walletAddress) {
      showConfirm('断开钱包连接', '当前: ...' + walletAddress.slice(-6) + '\n断开？', disconnectWallet);
    } else {
      connectWallet();
    }
  }

  function updateWalletUI() { /* handled by web3.js */ }

  // ===== WORLD CUP COUNTDOWN =====
  // ===== TEAM LOGO =====
  function teamLogoImg(name, size) {
    var s = size || 50;
    var slug = name.replace(/[^a-zA-Z\u4e00-\u9fff]/g, '_').toLowerCase();
    var fallback = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="#F0E8E0"/><text x="50" y="60" text-anchor="middle" font-size="32" fill="#FF6B35" font-family="Arial" font-weight="bold">' + name.charAt(0) + '</text></svg>');
    var src = 'img/teams/' + name + '.png';
    return '<img src="' + src + '" width="' + s + '" height="' + s + '" style="border-radius:50%;object-fit:contain;background:#F0E8E0;flex-shrink:0" alt="' + name + '" loading="lazy" onerror="var t=this;if(t.src.indexOf(\'.png\')!==-1){t.src=t.src.replace(\'.png\',\'.svg\')}else{t.onerror=null;t.src=\'' + fallback + '\'}">';
  }

  // ===== MATCH CARD (lucky944 DOM — enhanced with odds) =====
  function matchCardHTML(m) {
    var t = m.time || m.match_time || '';
    var parts = t.split(' ');
    var dateStr = parts.length > 1 ? parts[0].slice(5) : '';
    var timeStr = parts.length > 1 ? parts[1].slice(0, 5) : t.slice(11, 16) || '--';
    var home = m.home || m.home_team || '';
    var away = m.away || m.away_team || '';
    var league = m.league || m.league_name || '';
    var hO = Number(m.odds_home || m.home_odds || 0);
    var dO = Number(m.odds_draw || m.draw_odds || 0);
    var aO = Number(m.odds_away || m.away_odds || 0);
    var oddsRow = '</div>' +
      '<div class="odds-row" style="display:flex;justify-content:center;gap:12px;padding:4px 0;font-size:11px;border-top:1px solid #f0f0f0;margin-top:4px">' +
        '<span style="color:#03A66D;font-weight:600">主 ' + (hO ? hO.toFixed(2) : '—') + '</span>' +
        '<span style="color:#999">平 ' + (dO ? dO.toFixed(2) : '—') + '</span>' +
        '<span style="color:#E53935;font-weight:600">客 ' + (aO ? aO.toFixed(2) : '—') + '</span>' +
      '</div>';
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
        oddsRow +
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
  var tabPageMap = { 'home': 0, 'ai': 1, 'matches': 2, 'profile': 4 };
  var tabNames = ['home', 'ai', 'matches', null, 'profile'];

  function navigateTo(page) {
    if (currentPage === page) return;
    currentPage = page;

    // Auto-refresh management
    if (page === 'profile') startProfileAutoRefresh();
    else stopProfileAutoRefresh();

    // Hide all pages
    var pages = document.querySelectorAll('.page');
    for (var i = 0; i < pages.length; i++) {
      pages[i].style.display = 'none';
    }

    if (page === 'detail') {
      var detailPage = document.getElementById('page-detail');
      if (detailPage) detailPage.style.display = 'block';
      // Hide home sections
      var homeSecs = ['liveStatsBar', 'announceBar', 'aiRecCard', 'trustSignalsBar', 'tabHeaderWrapper'];
      for (var s = 0; s < homeSecs.length; s++) {
        var sec = document.getElementById(homeSecs[s]);
        if (sec) sec.style.display = 'none';
      }
      return;
    }

    // Toggle home-specific sections
    var homeSections = ['liveStatsBar', 'announceBar', 'aiRecCard', 'trustSignalsBar', 'tabHeaderWrapper'];
    for (var s = 0; s < homeSections.length; s++) {
      var sec = document.getElementById(homeSections[s]);
      if (sec) sec.style.display = (page === 'home') ? 'block' : 'none';
    }

    // Show target page (create if needed)
    var target = document.getElementById('page-' + page);
    if (target) {
      target.style.display = 'block';
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
      if (tabCons.length > 0) tabCons[0].style.display = 'block';
      if (tabCons.length > 1) tabCons[1].style.display = 'none';
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Trigger page-specific renders
    if (page === 'home') renderMatchCards();
    if (page === 'matches') renderMatchesPage();
    if (page === 'records') renderRecords();
    if (page === 'profile') renderProfile();
    if (page === 'ai') renderAIPage();
    if (page === 'transactions') renderTransactions();
  }

  // ===== TOP TAB SWITCHING (on home page) =====
  function switchTopTab(idx) {
    var tabCons = document.querySelectorAll('.slick_tab .tab_con');
    var topTabs = document.querySelectorAll('.slick_tab_btn .ul-tabs_b1 li');
    for (var i = 0; i < tabCons.length; i++) {
      tabCons[i].style.display = (i === idx) ? 'block' : 'none';
    }
    for (var j = 0; j < topTabs.length; j++) {
      topTabs[j].classList.toggle('on', j === idx);
    }
    if (idx === 1) renderChampionBet();
  }

  // ===== PAGE: HOME - Matches =====
  var _homeMatchesData = [];
  var _homeMatchPage = 1;
  var _homeMatchPageSize = 10;

  async function renderMatchCards() {
    var container = document.getElementById('matchList');
    if (!container) return;
    container.innerHTML = '<li><div class="con" style="padding:20px;text-align:center;color:#999">加载中...</div></li>';
    var data = await loadWithFallback('/matches', mockMatches);
    if (!data || data.length === 0) {
      container.innerHTML = '<li><div class="con" style="padding:30px;text-align:center;color:#999">暂无赛事数据</div></li>';
    } else {
      _homeMatchesData = data;
      _homeMatchPage = 1;
      renderHomeMatchPage();
    }
  }

  function renderHomeMatchPage() {
    var container = document.getElementById('matchList');
    if (!container) return;
    var total = _homeMatchesData.length;
    var end = Math.min(_homeMatchPage * _homeMatchPageSize, total);
    var slice = _homeMatchesData.slice(0, end);
    var hasMore = end < total;
    container.innerHTML = slice.map(function(m) { return matchCardHTML(m); }).join('') +
      (hasMore ? '<li class="load-more-li"><a href="javascript:;" class="load-more-btn" onclick="app.loadMoreMatches()">▼ 加载更多 (' + (total - end) + ')</a></li>' : '');
  }

  function loadMoreMatches() {
    _homeMatchPage++;
    renderHomeMatchPage();
  }

  // ===== PAGE: HOME - Champion Bet =====
  async function renderChampionBet() {
    var grid = document.getElementById('teamsGrid');
    if (!grid) return;
    var teams = await loadWithFallback('/champion-bet/odds', mockChampionTeams.map(function(t) {
      return { id: t.id, name: t.name, championship_odds: t.championship_odds, runner_up_odds: t.runner_up_odds };
    }));
    // loadWithFallback returns raw data array; for champion it might be in .odds
    if (teams && teams.odds) teams = teams.odds;
    if (!Array.isArray(teams)) teams = mockChampionTeams;

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

  // ===== PAGE: MATCHES (grouped by league) =====
  async function renderMatchesPage() {
    var container = document.getElementById('matchesPageList') || document.getElementById('fullMatchList');
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
    var data = await loadWithFallback('/matches', mockMatches.slice(0));

    if (!data || data.length === 0) {
      container.innerHTML = '<li><div class="con" style="padding:30px;text-align:center;color:#999">暂无赛事数据</div></li>';
    } else {
      // Group by league group (e.g. "世界杯 A组" from "世界杯 A组·第1轮")
      var groups = {};
      data.forEach(function(m) {
        var league = m.league || m.league_name || '';
        // Extract group prefix (e.g. "世界杯 A组" from "世界杯 A组·第1轮")
        var key = league.replace(/·.*$/, '');
        if (!key) key = '其他';
        if (!groups[key]) groups[key] = [];
        groups[key].push(m);
      });
      var keys = Object.keys(groups).sort();
      var html = '';
      keys.forEach(function(k) {
        if (html) html += '<li class="league-group-header"><div class="con" style="padding:6px 12px;text-align:center"><span class="load-more-btn" style="cursor:default;padding:6px 16px;font-size:12px">' + k + '</span></div></li>';
        groups[k].forEach(function(m) {
          html += matchesPageCardHTML(m);
        });
      });
      container.innerHTML = html;
    }
  }

  // ===== PAGE: RECORDS =====
  async function renderRecords(filter) {
    filter = filter || 'all';
    var container = document.getElementById('recordsList');
    if (!container) return;

    var records = betRecords.slice(0);

    // Always try API fetch if wallet connected (FP fix: remove stale apiAvailable gate)
    if (walletAddress) {
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
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span style="color:' + color + ';font-size:12px;font-weight:600">' + txt + '</span>' +
            (r.status === 'pending' ? '<button onclick="app.cancelBet(' + r.id + ')" style="background:none;border:1px solid #e53935;color:#e53935;padding:4px 10px;border-radius:12px;font-size:11px;cursor:pointer">取消</button>' : '') +
          '</div>' +
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

  // ===== PAGE: PROFILE (User Center) =====
  async function renderProfile() {
    // Create profile page if not exists
    var profilePage = document.getElementById('page-profile');
    if (!profilePage) {
      var mainEl = document.querySelector('.main .wp');
      if (!mainEl) return;
      profilePage = document.createElement('div');
      profilePage.id = 'page-profile';
      profilePage.className = 'tab_con page';
      mainEl.querySelector('.slick_tab').appendChild(profilePage);
    }

    if (!walletAddress) {
      profilePage.innerHTML = '<div class="profile-page" style="padding:40px 20px;text-align:center">' +
        '<div style="font-size:48px;margin-bottom:16px">🔒</div>' +
        '<p style="font-size:16px;font-weight:600;margin-bottom:8px">请先连接钱包</p>' +
        '<p style="color:#999;font-size:13px;margin-bottom:20px">连接钱包以查看您的账户信息</p>' +
        '<button onclick="app.connectWallet()" style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;padding:12px 32px;border-radius:24px;font-size:15px;cursor:pointer">连接钱包</button>' +
        '</div>';
      return;
    }

    // Load data
    await loadPoolBalance();
    await loadPnLData();
    await loadVIPData();

    var shortAddr = walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4);
    var pnlClass = pnlData.net_pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
    var pnlSign = pnlData.net_pnl >= 0 ? '+' : '';
    var roiClass = pnlData.roi >= 0 ? 'pnl-positive' : 'pnl-negative';

    profilePage.innerHTML =
      '<div class="profile-page" style="padding:16px">' +

      // ---- User Header ----
      '<div class="profile-header" style="display:flex;align-items:center;gap:14px;padding:16px;background:#fff;border-radius:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05)">' +
        '<div class="avatar" style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;font-size:24px;color:#fff;flex-shrink:0">' + walletAddress.slice(2,4).toUpperCase() + '</div>' +
        '<div class="user-info" style="flex:1;min-width:0">' +
          '<div class="nickname" style="font-size:16px;font-weight:700;color:#1a1a2e">我的钱包</div>' +
          '<div class="wallet-addr" style="font-size:12px;color:#999;font-family:monospace;overflow:hidden;text-overflow:ellipsis">' + shortAddr + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px">' +
          '<button onclick="app.showProfileEdit()" style="background:#fff;border:1px solid #ddd;border-radius:18px;padding:6px 12px;font-size:11px;color:#666;cursor:pointer">✏️</button>' +
          '<button onclick="app.showInviteModal()" style="background:#F0F0FF;color:#667eea;border:none;padding:8px 14px;border-radius:18px;font-size:13px;font-weight:600;cursor:pointer">📨 邀请</button>' +
          '<button onclick="app.claimInviteRewards()" style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;padding:8px 14px;border-radius:18px;font-size:12px;font-weight:600;cursor:pointer">💰 领取</button>' +
        '</div>' +
      '</div>' +

      // ---- Balance Cards ----
      '<div style="display:flex;gap:10px;margin-bottom:12px">' +
        '<div style="flex:1;background:#fff;border-radius:14px;padding:14px;box-shadow:0 2px 8px rgba(0,0,0,0.05)">' +
          '<div style="font-size:11px;color:#999;margin-bottom:6px">💰 钱包余额</div>' +
          '<div id="profileUSDTBalance" style="font-size:18px;font-weight:700;color:#1a1a2e">0.00 USDT</div>' +
        '</div>' +
        '<div style="flex:1;background:#fff;border-radius:14px;padding:14px;box-shadow:0 2px 8px rgba(0,0,0,0.05)">' +
          '<div style="font-size:11px;color:#999;margin-bottom:6px">🏊 平台余额</div>' +
          '<div id="profilePoolBalance" style="font-size:18px;font-weight:700;color:#1a1a2e">0.00 USDT</div>' +
        '</div>' +
      '</div>' +

      // ---- Action Buttons ----
      '<div style="display:flex;gap:10px;margin-bottom:14px">' +
        '<button onclick="app.showDepositModal()" style="flex:1;background:linear-gradient(135deg,#03A66D,#02C076);color:#fff;border:none;padding:12px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer">📥 充值</button>' +
        '<button onclick="app.showWithdrawModal()" style="flex:1;background:#fff;color:#e53935;border:1px solid #e53935;padding:12px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer">📤 提现</button>' +
      '</div>' +

      // ---- PnL Panel ----
      '<div style="background:#fff;border-radius:14px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.05);margin-bottom:14px">' +
        '<div style="font-size:14px;font-weight:700;color:#1a1a2e;margin-bottom:12px">📊 盈亏分析</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
          '<div>' +
            '<div style="font-size:11px;color:#999;margin-bottom:4px">总投注额</div>' +
            '<div style="font-size:15px;font-weight:600">' + pnlData.total_wagered.toFixed(2) + ' USDT</div>' +
          '</div>' +
          '<div>' +
            '<div style="font-size:11px;color:#999;margin-bottom:4px">总赢额</div>' +
            '<div style="font-size:15px;font-weight:600;color:#03A66D">' + pnlData.total_won.toFixed(2) + ' USDT</div>' +
          '</div>' +
          '<div>' +
            '<div style="font-size:11px;color:#999;margin-bottom:4px">净盈亏</div>' +
            '<div style="font-size:15px;font-weight:600;color:' + (pnlData.net_pnl >= 0 ? '#03A66D' : '#e53935') + '">' + pnlSign + pnlData.net_pnl.toFixed(2) + ' USDT</div>' +
          '</div>' +
          '<div>' +
            '<div style="font-size:11px;color:#999;margin-bottom:4px">ROI</div>' +
            '<div style="font-size:15px;font-weight:600;color:' + (pnlData.roi >= 0 ? '#03A66D' : '#e53935') + '">' + (pnlData.roi >= 0 ? '+' : '') + pnlData.roi.toFixed(1) + '%</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // ---- Recent Bet History ----
      '<div style="background:#fff;border-radius:14px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.05);margin-bottom:12px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
          '<span style="font-size:14px;font-weight:700;color:#1a1a2e">📋 近期投注</span>' +
          '<a href="javascript:;" onclick="app.navigateTo(\'records\')" style="font-size:12px;color:#667eea;text-decoration:none">查看全部 →</a>' +
        '</div>' +
        '<div id="profileRecentBets" style="font-size:13px;color:#999;text-align:center;padding:10px">加载中...</div>' +
      '</div>' +

      // ---- Quick Actions ----
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        '<button onclick="app.navigateTo(\'records\')" style="background:#fff;border:1px solid #e8eaed;border-radius:10px;padding:12px;font-size:12px;color:#666;cursor:pointer">📋 投注记录</button>' +
        '<button onclick="app.navigateTo(\'transactions\')" style="background:#fff;border:1px solid #e8eaed;border-radius:10px;padding:12px;font-size:12px;color:#666;cursor:pointer">📊 交易流水</button>' +
        '<button onclick="app.loadDepositHistory()" style="background:#fff;border:1px solid #e8eaed;border-radius:10px;padding:12px;font-size:12px;color:#666;cursor:pointer">📥 充值记录</button>' +
        '<button onclick="app.loadWithdrawHistory()" style="background:#fff;border:1px solid #e8eaed;border-radius:10px;padding:12px;font-size:12px;color:#666;cursor:pointer">📤 提现记录</button>' +
        (document.getElementById('vipCard') && document.getElementById('vipCard').style.display !== 'none' ? 
          '<button onclick="app.checkVIPUpgrade()" style="background:#fff;border:1px solid #FF6B35;border-radius:10px;padding:12px;font-size:12px;color:#FF6B35;cursor:pointer">⭐ VIP升级</button>' : '') +
      '</div>' +

      '</div>';

    // Load USDT + pool balances
    loadPoolBalance();

    // Load recent bets
    loadRecentBets();
  }

  async function loadRecentBets() {
    var container = document.getElementById('profileRecentBets');
    if (!container) return;

    var records = [];

    // Try from blockchain
    if (typeof dapp !== 'undefined' && walletAddress) {
      try {
        var onChainBets = await dapp.getUserBets();
        if (onChainBets && onChainBets.length > 0) {
          records = onChainBets.slice(0, 5).map(function(b) {
            return {
              id: b.id,
              type: '反波胆 #' + b.matchId,
              team: '格子 ' + b.cell,
              amount: parseFloat(b.amount),
              odds: b.odds,
              status: b.settled ? (b.won ? 'won' : 'lost') : 'pending',
              time: b.timestamp ? new Date(b.timestamp * 1000).toLocaleString('zh-CN') : ''
            };
          });
        }
      } catch(e) {}
    }

    // Fallback: try API
    if (records.length === 0 && apiAvailable && walletAddress) {
      try {
        var res = await apiFetch('/bets?address=' + encodeURIComponent(walletAddress) + '&limit=5');
        if (res && res.code === 0 && res.data) {
          records = res.data.map(function(r) {
            return {
              id: r.id,
              type: r.bet_type_name || '投注',
              team: r.team_name || r.team || '',
              amount: parseFloat(r.amount) || 0,
              odds: parseFloat(r.odds) || 0,
              status: r.status || 'pending',
              time: r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : (r.time || '')
            };
          });
        }
      } catch(e) {}
    }

    if (records.length === 0) {
      container.innerHTML = '<div style="text-align:center;color:#ccc;padding:16px">暂无投注记录</div>';
      return;
    }

    container.innerHTML = records.map(function(r) {
      var cls = r.status === 'won' ? 'won' : r.status === 'lost' ? 'lost' : 'pending';
      var txt = r.status === 'won' ? '✅ 已赢' : r.status === 'lost' ? '❌ 已输' : '⏳ 进行中';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f0f0f0">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (r.type || '') + '</div>' +
          '<div style="font-size:11px;color:#999">' + (r.time || '') + '</div>' +
        '</div>' +
        '<div style="text-align:right;margin-left:12px;flex-shrink:0">' +
          '<div style="font-size:13px;font-weight:600">' + (r.amount || 0).toFixed(2) + ' USDT</div>' +
          '<div style="font-size:11px;font-weight:600;color:' + (r.status === 'won' ? '#03A66D' : r.status === 'lost' ? '#e53935' : '#DAA520') + '">' + txt + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ===== DEPOSIT / WITHDRAW HANDLERS =====
  function showDepositModal() {
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    if (typeof dapp !== 'undefined') {
      dapp.showDepositModal();
    } else {
      var modal = document.getElementById('depositModal');
      if (modal) modal.style.display = 'flex';
    }
  }

  function hideDepositModal() {
    if (typeof dapp !== 'undefined') {
      dapp.hideDepositModal();
    } else {
      var modal = document.getElementById('depositModal');
      if (modal) modal.style.display = 'none';
    }
  }

  // ===== DEPOSIT / WITHDRAW (API-backed) =====
  function showWithdrawModal() {
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    var modal = document.getElementById('withdrawModal');
    if (modal) modal.style.display = 'flex';
  }

  function hideWithdrawModal() {
    var modal = document.getElementById('withdrawModal');
    if (modal) modal.style.display = 'none';
  }

  async function confirmDeposit() {
    var amountInput = document.getElementById('depositAmount');
    var amount = parseFloat(amountInput ? amountInput.value : 0);
    if (!amount || isNaN(amount) || amount < 1) {
      showToast('请输入有效充值金额（最低1 USDT）');
      return;
    }

    // Try on-chain first via Web3, then confirm via API
    if (typeof dapp !== 'undefined') {
      try {
        var txHash = await dapp.executeDeposit(amount);
        if (txHash) {
          // Confirm the deposit with backend API
          var confirmRes = await apiFetch('/deposit', {
            method: 'POST',
            body: JSON.stringify({ wallet_address: walletAddress, tx_hash: txHash, amount: amount })
          });
          if (confirmRes && confirmRes.code === 0) {
            showToast('✅ 充值成功: ' + amount + ' USDT\nTx: ' + txHash.slice(0, 10) + '...');
            hideDepositModal();
            if (currentPage === 'profile') renderProfile();
            return;
          }
          showToast('⚠️ 链上交易已提交，但后端验证失败: ' + (confirmRes ? confirmRes.msg : '网络错误'));
          return;
        }
      } catch(e) {
        showToast('❌ ' + (e.reason || e.message || '充值失败'));
        return;
      }
    }

    // Fallback: API-only deposit with tx_hash prompt
    showToast('请通过MetaMask向合约地址转账后，提供交易哈希');
  }

  async function confirmWithdraw() {
    var amountInput = document.getElementById('withdrawAmount');
    var addrInput = document.getElementById('withdrawAddress');
    var amount = parseFloat(amountInput ? amountInput.value : 0);
    var toAddress = addrInput ? addrInput.value.trim() : '';

    if (!amount || isNaN(amount) || amount < 1) {
      showToast('请输入有效提现金额（最低1 USDT）');
      return;
    }
    if (!toAddress || !/^0x[0-9a-fA-F]{40}$/.test(toAddress)) {
      showToast('请输入有效的提现地址（0x...）');
      return;
    }
    if (!walletAddress) { showToast('请先连接钱包'); return; }

    try {
      var res = await apiFetch('/withdraw', {
        method: 'POST',
        body: JSON.stringify({ wallet_address: walletAddress, amount: amount, withdraw_address: toAddress })
      });
      if (res && res.code === 0) {
        showToast('✅ 提现申请已提交: ' + amount + ' USDT → ' + toAddress.slice(0,6) + '...');
        var modal = document.getElementById('withdrawModal');
        if (modal) modal.style.display = 'none';
        if (currentPage === 'profile') renderProfile();
      } else {
        showToast('❌ ' + (res ? res.msg : '提现失败'));
      }
    } catch(e) {
      showToast('❌ 网络错误，请重试');
    }
  }

  // ===== INVITE SYSTEM =====
  let inviteCode = '';
  let inviteData = { count: 0, rewards: 0 };

  async function loadInviteData() {
    if (!walletAddress) return;
    try {
      // First try GET stats (non-404 friendly fallback if no user yet)
      var statsRes = await apiFetch('/invite/stats?wallet=' + encodeURIComponent(walletAddress));
      if (statsRes && statsRes.code === 0 && statsRes.data) {
        inviteCode = statsRes.data.code || '';
        inviteData.count = parseInt(statsRes.data.invite_count || 0);
        inviteData.rewards = parseFloat(statsRes.data.rewards || 0);
      }
      // If no code yet, generate one via POST
      if (!inviteCode) {
        var genRes = await apiFetch('/invite/generate-code', {
          method: 'POST',
          body: JSON.stringify({ wallet_address: walletAddress })
        });
        if (genRes && genRes.code === 0 && genRes.data) {
          inviteCode = genRes.data.invite_code || genRes.data.code || '';
        }
      }
    } catch(e) {}
  }

  function showInviteModal() {
    if (!walletAddress) { showToast('请先连接钱包'); return; }

    var modal = document.getElementById('inviteModal');
    if (!modal) return;

    var codeEl = document.getElementById('inviteCode');
    var statsEl = document.getElementById('inviteStats');
    if (codeEl) codeEl.textContent = '加载中...';
    if (statsEl) statsEl.textContent = '';

    modal.style.display = 'flex';

    // Load invite data + agent earnings
    Promise.all([loadInviteData(), loadAgentEarnings()]).then(function() {
      if (codeEl) codeEl.textContent = inviteCode || '生成失败，请重试';
      var agentInfo = window._agentInfo || {};
      var levelName = agentInfo.name || '普通会员';
      var commissionL1 = ((agentInfo.commission_l1 || 0) * 100).toFixed(1);
      if (statsEl) statsEl.innerHTML =
        '<div style="font-size:12px;color:#DAA520;margin-bottom:4px">🏅 ' + levelName + ' · 一级返佣 ' + commissionL1 + '%</div>' +
        '<div>已邀请: <b>' + inviteData.count + '</b>人 | 交易额: <b>$' + (agentInfo.total_volume || 0).toLocaleString() + '</b></div>' +
        '<div style="font-size:11px;color:#999;margin-top:4px">已领取: ' + inviteData.rewards.toFixed(2) + ' USDT</div>';
    });
  }

  function hideInviteModal() {
    var modal = document.getElementById('inviteModal');
    if (modal) modal.style.display = 'none';
  }

  function copyInviteCode() {
    if (!inviteCode) { showToast('邀请码未生成'); return; }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(inviteCode).then(function() {
          showToast('✅ 邀请码已复制: ' + inviteCode);
        }).catch(function() {
          fallbackCopy(inviteCode);
        });
      } else {
        fallbackCopy(inviteCode);
      }
    } catch(e) {
      fallbackCopy(inviteCode);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('✅ 邀请码已复制: ' + text); } catch(e) { showToast('复制失败，请手动复制'); }
    document.body.removeChild(ta);
  }

  async function claimInviteRewards() {
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    try {
      var res = await apiFetch('/invite/claim', {
        method: 'POST',
        body: JSON.stringify({ address: walletAddress })
      });
      if (res && res.code === 0) {
        showToast('✅ 返佣奖励已领取');
        loadInviteData();
      } else {
        showToast(res && res.message ? res.message : '领取失败');
      }
    } catch(e) { showToast('领取失败，请重试'); }
  }

  function shareInvite() {
    if (!inviteCode) { showToast('邀请码未生成'); return; }
    var shareText = '🎯 快来加入19888反波胆竞猜平台！使用我的邀请码注册: ' + inviteCode;
    if (navigator.share) {
      navigator.share({ title: '19888邀请', text: shareText }).catch(function() {});
    } else {
      copyInviteCode();
      showToast('邀请码已复制，请分享给好友');
    }
  }

  // ===== AGENT EARNINGS =====
  async function loadAgentEarnings() {
    if (!walletAddress) return;
    try {
      var res = await apiFetch('/invite/earnings?wallet=' + encodeURIComponent(walletAddress));
      if (res && res.code === 0 && res.data) {
        window._agentInfo = res.data;
      }
    } catch(e) {}
  }

  // ===== CANCEL BET =====
  async function cancelBet(betId) {
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    showConfirm('取消投注', '确定要取消这笔投注吗？金额将退回余额。', async function() {
      try {
        var res = await apiFetch('/bets/' + betId + '/cancel', {
          method: 'POST',
          body: JSON.stringify({ wallet_address: walletAddress })
        });
        if (res && res.code === 0) {
          showToast('✅ 投注已取消，' + (res.data ? res.data.refunded : '') + ' USDT 已退回');
          if (currentPage === 'records') renderRecords();
          if (currentPage === 'profile') renderProfile();
        } else {
          showToast('❌ ' + (res ? res.msg : '取消失败'));
        }
      } catch(e) { showToast('网络错误，请重试'); }
    });
  }

  // ===== AI HOSTING TOGGLE =====
  async function toggleAIHosting() {
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    try {
      var statusRes = await apiFetch('/ai-hosting/status?address=' + encodeURIComponent(walletAddress));
      var isActive = statusRes && statusRes.data && statusRes.data.active;
      if (isActive) {
        var res = await apiFetch('/ai-hosting/deactivate', {
          method: 'POST',
          body: JSON.stringify({ wallet_address: walletAddress })
        });
        if (res && res.code === 0) {
          showToast('✅ AI托管已停用，冻结资金已释放');
          renderAIPage();
        } else {
          showToast('❌ ' + (res ? res.msg : '操作失败'));
        }
      } else {
        // Activate with default amount
        var activateRes = await apiFetch('/ai-hosting/activate', {
          method: 'POST',
          body: JSON.stringify({ wallet_address: walletAddress, freeze_amount: 100 })
        });
        if (activateRes && activateRes.code === 0) {
          showToast('✅ AI托管已激活，冻结 100 USDT');
          renderAIPage();
        } else {
          showToast('❌ ' + (activateRes ? activateRes.msg : '激活失败'));
        }
      }
    } catch(e) { showToast('网络错误，请重试'); }
  }

  // ===== DEPOSIT/WITHDRAW HISTORY =====
  async function loadDepositHistory() {
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    try {
      var res = await apiFetch('/deposit/history?wallet=' + encodeURIComponent(walletAddress));
      var data = (res && res.data) ? (Array.isArray(res.data) ? res.data : (res.data.transactions || [])) : [];
      if (data.length === 0) { showToast('暂无充值记录'); return; }
      var html = data.slice(0, 5).map(function(d) {
        return '📥 +' + Number(d.amount || 0).toFixed(2) + ' USDT | ' + (d.tx_hash ? d.tx_hash.slice(0,8) + '...' : '') + ' | ' + (d.created_at ? new Date(d.created_at).toLocaleDateString() : '');
      }).join('\n');
      showConfirm('充值记录 (' + data.length + '条)', html, function(){ app.navigateTo('transactions'); });
    } catch(e) { showToast('加载失败'); }
  }

  async function loadWithdrawHistory() {
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    try {
      var res = await apiFetch('/withdraw/history?wallet=' + encodeURIComponent(walletAddress));
      var data = (res && res.data) ? (Array.isArray(res.data) ? res.data : (res.data.transactions || [])) : [];
      if (data.length === 0) { showToast('暂无提现记录'); return; }
      var html = data.slice(0, 5).map(function(d) {
        return '📤 -' + Number(d.amount || 0).toFixed(2) + ' USDT | ' + (d.target_address ? d.target_address.slice(0,8) + '...' : '') + ' | ' + (d.status || '');
      }).join('\n');
      showConfirm('提现记录 (' + data.length + '条)', html, function(){ app.navigateTo('transactions'); });
    } catch(e) { showToast('加载失败'); }
  }

  async function checkVIPUpgrade() {
    if (!walletAddress) return;
    try {
      var res = await apiFetch('/vip/check-upgrade', {
        method: 'POST',
        body: JSON.stringify({ wallet_address: walletAddress })
      });
      if (res && res.code === 0) {
        showToast('VIP升级检查: ' + (res.data.can_upgrade ? '✅ 可升级到 ' + res.data.next_level : '当前已是最高等级'));
      }
    } catch(e) {}
  }

  // ===== AI HOSTING HISTORY =====
  async function loadAIHistory() {
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    try {
      var res = await apiFetch('/ai-hosting/history?address=' + encodeURIComponent(walletAddress));
      var data = (res && res.data) || [];
      if (data.length === 0) { showToast('暂无AI托管记录'); return; }
      var html = data.slice(0, 5).map(function(h) {
        return '🤖 ' + (h.action || '') + ' | ' + Number(h.amount || 0).toFixed(2) + ' USDT | ' + (h.created_at ? new Date(h.created_at).toLocaleDateString() : '');
      }).join('\n');
      showConfirm('AI托管记录', html);
    } catch(e) { showToast('加载失败'); }
  }

  // ===== AI SETTINGS =====
  async function showAISettings() {
    if (!walletAddress) return;
    try {
      var res = await apiFetch('/ai-hosting/status?address=' + encodeURIComponent(walletAddress));
      var s = (res && res.data && res.data.settings) || { max_bet_per_match: 100, max_daily_bet: 500, risk_level: 'medium' };
      var html = '<div style="text-align:left;font-size:12px;line-height:2">' +
        '<label>单场上限: <input id="aiMaxBet" type="number" value="' + s.max_bet_per_match + '" style="width:80px;padding:4px;border:1px solid #ddd;border-radius:4px"></label><br>' +
        '<label>日上限: <input id="aiMaxDaily" type="number" value="' + s.max_daily_bet + '" style="width:80px;padding:4px;border:1px solid #ddd;border-radius:4px"></label><br>' +
        '<label>风险等级: <select id="aiRisk" style="padding:4px;border:1px solid #ddd;border-radius:4px">' +
          '<option value="low" ' + (s.risk_level === 'low' ? 'selected' : '') + '>低风险</option>' +
          '<option value="medium" ' + (s.risk_level === 'medium' ? 'selected' : '') + '>中风险</option>' +
          '<option value="high" ' + (s.risk_level === 'high' ? 'selected' : '') + '>高风险</option>' +
        '</select></label>' +
      '</div>';
      showConfirm('⚙️ AI托管设置', html, async function() {
        var settings = {
          max_bet_per_match: Number(document.getElementById('aiMaxBet').value) || 100,
          max_daily_bet: Number(document.getElementById('aiMaxDaily').value) || 500,
          risk_level: document.getElementById('aiRisk').value
        };
        try {
          var r = await apiFetch('/ai-hosting/settings', {
            method: 'POST',
            body: JSON.stringify({ wallet_address: walletAddress, settings: settings })
          });
          if (r && r.code === 0) showToast('设置已保存');
        } catch(e) { showToast('保存失败'); }
      });
    } catch(e) { showToast('加载设置失败'); }
  }

  // ===== PROFILE EDIT =====
  async function showProfileEdit() {
    if (!walletAddress) return;
    try {
      var res = await apiFetch('/user/profile?address=' + encodeURIComponent(walletAddress));
      var p = (res && res.data) || {};
      var html = '<div style="text-align:left;font-size:12px;line-height:2">' +
        '<label>昵称: <input id="editNick" value="' + (p.nickname || '') + '" style="width:120px;padding:4px;border:1px solid #ddd;border-radius:4px"></label>' +
      '</div>';
      showConfirm('✏️ 编辑资料', html, async function() {
        var nick = document.getElementById('editNick').value.trim() || '';
        try {
          var r = await apiFetch('/user/profile', {
            method: 'POST',
            body: JSON.stringify({ address: walletAddress, nickname: nick })
          });
          if (r && r.code === 0) { showToast('资料已更新'); renderProfile(); }
        } catch(e) { showToast('更新失败'); }
      });
    } catch(e) { showToast('加载失败'); }
  }

  // ===== REFERRAL CLAIM =====
  async function claimInviteRewards() {
    if (!walletAddress) return;
    try {
      var r = await apiFetch('/invite/claim-reward', {
        method: 'POST',
        body: JSON.stringify({ wallet_address: walletAddress })
      });
      if (r && r.code === 0) { showToast('✅ 已领取 ' + r.data.claimed + ' USDT'); renderProfile(); }
      else showToast(r.msg || '领取失败');
    } catch(e) { showToast('网络错误'); }
  }

  // ===== SCORE BET (猜比分) =====
  var _selectedScore = null;
  function openScoreBet(matchId) {
    var match = findMatch(matchId);
    if (!match) return;
    var scores = ['0:0','1:0','0:1','1:1','2:0','0:2','2:1','1:2','2:2','3:0','0:3','3:1','1:3','3:2','2:3','3:3','主4+','客4+'];
    var btns = scores.map(function(s) { return '<button onclick="app.selectScoreBet(\'' + s + '\')" style="padding:8px 6px;border:1px solid #ddd;border-radius:6px;background:#fff;font-size:11px;cursor:pointer">' + s + '</button>'; }).join('');
    var html = '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px">' + btns + '</div>' +
      '<input id="scoreBetAmount" type="number" placeholder="下注金额 (USDT)" value="10" style="width:100%;margin-top:12px;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px">';
    showConfirm('猜比分 — ' + match.home + ' vs ' + match.away, html, function() {
      var amt = Number(document.getElementById('scoreBetAmount').value) || 10;
      if (!_selectedScore) { showToast('请选择一个比分'); return; }
      placeScoreBet(matchId, _selectedScore, amt);
    });
  }

  function selectScoreBet(score) { _selectedScore = score; showToast('已选: ' + score); }

  async function placeScoreBet(matchId, score, amount) {
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    try {
      var r = await apiFetch('/score-bet/place', {
        method: 'POST',
        body: JSON.stringify({ wallet_address: walletAddress, match_id: matchId, selected_score: score, amount: amount })
      });
      if (r && r.code === 0) showToast('✅ 比分投注成功');
      else showToast(r.msg || '投注失败');
      closeConfirm();
    } catch(e) { showToast('网络错误'); }
  }
  function setupDappListeners() {
    // Listen for tx status updates from dapp
    window.addEventListener('dapp:txStatus', function(e) {
      var d = e.detail;
      if (!d) return;
      if (d.status === 'approving' || d.status === 'depositing' || d.status === 'withdrawing') {
        showToast(d.message, 5000);
      } else if (d.status === 'success') {
        hideDepositModal();
        showToast('✅ ' + d.message + (d.txHash ? ' Tx: ' + d.txHash.slice(0, 10) + '...' : ''), 4000);
        renderProfile();
      } else if (d.status === 'error') {
        showToast('❌ ' + d.message, 3000);
      }
    });

    // Listen for balance updates
    window.addEventListener('dapp:balancesUpdated', function(e) {
      var d = e.detail;
      if (!d) return;
      var usdtEl = document.getElementById('profileUSDTBalance');
      if (usdtEl) usdtEl.textContent = Number(d.usdt || 0).toFixed(2) + ' USDT';
      var poolEl = document.getElementById('profilePoolBalance');
      if (poolEl) poolEl.textContent = Number(d.pool || 0).toFixed(2) + ' USDT';
    });

    // Listen for account changes
    window.addEventListener('dapp:accountChanged', function(e) {
      if (!e.detail || !e.detail.address) {
        walletAddress = null;
        if (currentPage === 'profile') renderProfile();
      }
    });
  }

  // ===== PAGE: AI =====
  async function renderAIPage() {
    var container = document.getElementById('page-ai');
    if (!container) {
      var mainEl = document.querySelector('.main .wp');
      if (!mainEl) return;
      container = document.createElement('div');
      container.id = 'page-ai';
      container.className = 'page';
      mainEl.appendChild(container);
    }

    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">加载中...</div>';

    // Fetch pool status + AI hosting if wallet connected
    var poolData = null;
    var aiStatus = null;
    try {
      var poolRes = await apiFetch('/finance/pool-status');
      if (poolRes && poolRes.code === 0) poolData = poolRes.data;
    } catch(e) {}
    if (walletAddress) {
      try {
        var aiRes = await apiFetch('/ai-hosting/status?address=' + encodeURIComponent(walletAddress));
        if (aiRes && aiRes.code === 0) aiStatus = aiRes.data;
      } catch(e) {}
    }

    var userCount = poolData ? poolData.user_count : 0;
    var poolBalance = poolData ? poolData.total_balance : 0;
    var pendingBets = poolData ? poolData.pending_bets : 0;

    container.innerHTML =
      '<div style="padding:16px">' +
        // Stats overview
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">' +
          '<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:12px;text-align:center">' +
            '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">平台用户</div>' +
            '<div style="font-size:20px;font-weight:700;color:var(--text)">' + userCount + '</div>' +
          '</div>' +
          '<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:12px;text-align:center">' +
            '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">资金池</div>' +
            '<div style="font-size:20px;font-weight:700;color:var(--accent)">$' + Number(poolBalance).toLocaleString() + '</div>' +
          '</div>' +
          '<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:12px;text-align:center">' +
            '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">进行中</div>' +
            '<div style="font-size:20px;font-weight:700;color:var(--green)">' + pendingBets + '</div>' +
          '</div>' +
        '</div>' +

        // AI Introduction
        '<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:20px;margin-bottom:16px">' +
          '<h3 style="font-size:16px;color:var(--accent);margin-bottom:10px">🤖 AI 智能预测引擎</h3>' +
          '<p style="font-size:13px;color:var(--text-light);line-height:1.8;margin-bottom:10px">基于5000万场历史数据的深度学习模型，反波胆玩法理论胜率高达88.89%。AI托管自动执行投注策略，月化收益目标15%。</p>' +
          '<div style="display:flex;gap:8px;margin-top:12px">' +
            '<div style="flex:1;background:rgba(240,185,11,0.06);border:1px solid rgba(240,185,11,0.15);border-radius:4px;padding:12px;text-align:center">' +
              '<div style="font-size:10px;color:var(--text-muted)">理论胜率</div><div style="font-size:22px;font-weight:800;color:var(--accent)">88.89%</div>' +
            '</div>' +
            '<div style="flex:1;background:rgba(14,203,129,0.06);border:1px solid rgba(14,203,129,0.15);border-radius:4px;padding:12px;text-align:center">' +
              '<div style="font-size:10px;color:var(--text-muted)">月化收益</div><div style="font-size:22px;font-weight:800;color:var(--green)">+15%</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // AI Hosting CTA
        (walletAddress ?
          '<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:16px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
              '<div><div style="font-size:14px;font-weight:600;color:var(--text)">AI 自动托管</div><div style="font-size:11px;color:var(--text-muted)">' + (aiStatus && aiStatus.active ? '运行中' : '未激活') + '</div></div>' +
              '<button onclick="app.toggleAIHosting()" style="background:' + (aiStatus && aiStatus.active ? 'var(--surface-hover)' : 'var(--accent)') + ';color:' + (aiStatus && aiStatus.active ? 'var(--text)' : '#0B0E11') + ';border:none;padding:8px 16px;border-radius:4px;font-size:12px;font-weight:700;cursor:pointer">' + (aiStatus && aiStatus.active ? '停用' : '激活托管') + '</button>' +
            '</div>' +
            '<p style="font-size:11px;color:var(--text-muted);line-height:1.6">AI自动执行反波胆投注，最小冻结10 USDT，双阶段链上确认，可随时停用。</p>' +
            (aiStatus && aiStatus.active ? '<button onclick="app.showAISettings()" style="background:transparent;border:1px solid var(--border);border-radius:4px;padding:6px 12px;font-size:11px;color:var(--text);cursor:pointer;margin-top:8px">⚙️ 托管设置</button>' : '') +
          '</div>'
        :
          '<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:16px;text-align:center">' +
            '<p style="color:var(--text-muted);font-size:13px;margin-bottom:12px">连接钱包以激活AI自动托管</p>' +
            '<button onclick="app.connectWallet()" style="background:var(--accent);color:#0B0E11;border:none;padding:10px 24px;border-radius:4px;font-size:13px;font-weight:700;cursor:pointer">🔗 连接钱包</button>' +
          '</div>') +
      '</div>';
  }

  // ===== PAGE: TRANSACTIONS =====
  async function renderTransactions() {
    var container = document.getElementById('page-transactions');
    if (!container) {
      var mainEl = document.querySelector('.main .wp');
      if (!mainEl) return;
      container = document.createElement('div');
      container.id = 'page-transactions';
      container.className = 'page';
      mainEl.appendChild(container);
    }

    container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted)">加载中...</div>';

    if (!walletAddress) {
      container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-muted)"><p style="margin-bottom:12px">请先连接钱包</p><button onclick="app.connectWallet()" style="background:var(--accent);color:#0B0E11;border:none;padding:10px 24px;border-radius:4px;cursor:pointer">连接钱包</button></div>';
      return;
    }

    var txData = [];
    try {
      var res = await apiFetch('/user/transactions?wallet=' + encodeURIComponent(walletAddress) + '&limit=50');
      if (res && res.code === 0 && res.data && res.data.transactions) {
        txData = res.data.transactions;
      }
    } catch(e) {}

    if (txData.length === 0) {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">暂无交易记录</div>';
      return;
    }

    container.innerHTML = '<div style="padding:12px">' +
      '<h3 style="font-size:16px;color:var(--text);margin-bottom:12px">交易流水</h3>' +
      txData.map(function(tx) {
        var icon = tx.type === 'deposit' ? '📥' : tx.type === 'withdraw' ? '📤' : '🎯';
        var label = tx.type === 'deposit' ? '充值' : tx.type === 'withdraw' ? '提现' : (tx.game_type === 'champion' ? '冠亚' : tx.game_type === 'anti-score' ? '反波胆' : '比分');
        var amount = tx.amount || 0;
        var amountColor = amount > 0 ? 'var(--green)' : amount < 0 ? 'var(--red)' : 'var(--text-light)';
        var time = tx.created_at ? new Date(tx.created_at).toLocaleString('zh-CN') : '';
        return '<div style="display:flex;align-items:center;padding:12px;border-bottom:1px solid var(--border);gap:12px">' +
          '<div style="font-size:24px">' + icon + '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:13px;color:var(--text)">' + label + (tx.team_name ? ' · ' + tx.team_name : '') + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted)">' + time + '</div>' +
            '<div style="font-size:10px;color:var(--text-muted)">' + (tx.status || '') + (tx.tx_hash ? ' · ' + tx.tx_hash.slice(0,8) + '...' : '') + '</div>' +
          '</div>' +
          '<div style="font-size:14px;font-weight:700;color:' + amountColor + ';white-space:nowrap">' + (amount > 0 ? '+' : '') + Number(amount).toFixed(2) + ' USDT</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  // ===== BETTING FLOW =====
  var betDialogData = null;

  function openMatch(matchId) {
    currentDetailMatchId = matchId;
    var match = findMatch(matchId);
    if (!match) { showToast('赛事不存在'); return; }

    // Navigate to detail page and populate
    navigateTo('detail');

    var home = match.home || match.home_team || '';
    var away = match.away || match.away_team || '';
    var time = match.time || match.match_time || '';
    var venue = match.venue || '';
    var odds = match.odds_home || '--';

    var homeEl = document.getElementById('detailHomeTeam');
    if (homeEl) homeEl.textContent = home;
    var awayEl = document.getElementById('detailAwayTeam');
    if (awayEl) awayEl.textContent = away;
    var timeEl = document.getElementById('detailMatchTime');
    if (timeEl) timeEl.textContent = time;
    var venueEl = document.getElementById('detailMatchVenue');
    if (venueEl) venueEl.textContent = venue || '--';
    var oddsEl = document.getElementById('detailOdds');
    if (oddsEl) oddsEl.textContent = typeof odds === 'number' ? odds.toFixed(2) : odds;

    // Populate 18-grid score cells
    var grid = document.getElementById('scoreGrid');
    if (grid) {
      var scores = ['0:0','0:1','0:2','0:3','1:0','1:1','1:2','1:3','2:0','2:1','2:2','2:3','3:0','3:1','3:2','3:3','主4+','客4+'];
      grid.innerHTML = scores.map(function(s) {
        return '<div class="score-cell" data-score="' + s + '" onclick="app.selectScore(\'' + s + '\')" style="display:inline-flex;align-items:center;justify-content:center;width:58px;height:40px;margin:4px;border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:14px;font-weight:600;color:var(--text);background:var(--surface)">' + s + '</div>';
      }).join('');
      window._selectedScore = null;
      window._detailMatchId = matchId;
    }

    // Inject score-bet button after grid
    setTimeout(function() {
      var existBtn = document.getElementById('scoreBetBtn');
      if (!existBtn) {
        var sg = document.getElementById('scoreGrid');
        if (sg && sg.parentNode) {
          var btn = document.createElement('button');
          btn.id = 'scoreBetBtn';
          btn.textContent = '🎯 猜比分 (波胆投注)';
          btn.style.cssText = 'width:100%;margin-top:8px;padding:10px;background:linear-gradient(135deg,#FF6B35,#FFA502);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer';
          btn.onclick = function() { app.openScoreBet(currentDetailMatchId); };
          sg.parentNode.insertBefore(btn, sg.nextSibling);
        }
      }
    }, 100);

    // Wire up quick-bet amounts
    var amtBtns = document.querySelectorAll('.quick-bet-amt');
    for (var i = 0; i < amtBtns.length; i++) {
      amtBtns[i].onclick = function() {
        var btns = document.querySelectorAll('.quick-bet-amt');
        for (var j = 0; j < btns.length; j++) btns[j].style.background = 'var(--surface)';
        this.style.background = 'var(--accent)';
        this.style.color = '#fff';
        window._selectedAmount = parseInt(this.getAttribute('data-amt'));
      };
    }
    window._selectedAmount = 10; // default
  }

  function selectScore(score) {
    window._selectedScore = score;
    var cells = document.querySelectorAll('.score-cell');
    for (var i = 0; i < cells.length; i++) {
      cells[i].style.background = 'var(--surface)';
      cells[i].style.borderColor = 'var(--border)';
    }
    var el = document.querySelector('.score-cell[data-score="' + score + '"]');
    if (el) { el.style.background = 'rgba(229,57,53,0.12)'; el.style.borderColor = 'var(--accent)'; }
  }

  document.getElementById('placeBetBtn').onclick = function() {
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    if (!window._selectedScore) { showToast('请选择比分'); return; }
    var amount = window._selectedAmount || 10;
    var matchId = window._detailMatchId;
    if (!matchId) { showToast('赛事数据异常'); return; }
    showConfirm('确认投注',
      '赛事 #' + matchId + ' | 反波胆 ' + window._selectedScore + ' | ' + amount + ' USDT',
      function() { placeAntiBet(matchId, window._selectedScore, amount); }
    );
  };

  async function placeAntiBet(matchId, score, amount) {
    try {
      var res = await apiFetch('/anti-bet/place', {
        method: 'POST',
        body: JSON.stringify({
          match_id: matchId,
          selected_score: score,
          amount: amount,
          wallet_address: walletAddress,
          tx_hash: 'browser_' + Date.now()
        })
      });
      if (res && res.code === 0) {
        showToast('✅ 投注成功! #' + (res.data && res.data.bet_id || '') + ' 比分:' + score + ' | ' + amount + ' USDT');
        if (currentPage === 'records') renderRecords();
      } else {
        showToast('❌ ' + (res ? res.msg : '投注失败'));
      }
    } catch(e) { showToast('网络错误，请重试'); }
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

  async function confirmBet() {
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    var amount = parseFloat(document.getElementById('betAmountInput').value);
    if (!amount || amount < 1 || isNaN(amount)) { showToast('请输入正确的投注金额'); return; }
    var d = betDialogData;
    if (!d) return;

    closeBetDialog();
    showToast('交易提交中...');

    try {
      var tx;
      if (d.teamId !== undefined) {
        // Champion bet
        var betTypeIdx = d.betType === 'champion' ? 0 : 1;
        tx = await dapp.placeChampionBet(d.teamId, betTypeIdx, amount + '');
      } else if (d.matchId !== undefined) {
        // Score bet — cellIndex from dialog
        var cellIdx = d.cellIndex || 0;
        tx = await dapp.placeBet(d.matchId, cellIdx, amount + '');
      } else {
        showToast('无效的投注数据'); return;
      }

      showToast('✅ 投注成功! Tx: ' + tx.hash.slice(0, 10) + '...');
    } catch(e) {
      showToast('❌ 交易失败: ' + (e.reason || e.message || '未知错误'));
      console.error('Bet error:', e);
    }
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

  // ===== LIVE STATS =====
  async function loadLiveStats() {
    try {
      var res = await apiFetch('/finance/pool-status');
      if (res && res.code === 0 && res.data) {
        var d = res.data;
        var bets = document.getElementById('statBets');
        var users = document.getElementById('statUsers');
        var payout = document.getElementById('statPayout');
        if (bets) bets.textContent = d.pending_bets || d.user_count || 0;
        if (users) users.textContent = d.user_count || 0;
        if (payout) payout.textContent = '$' + Number(d.total_balance || 0).toLocaleString();
      }
    } catch(e) {}
    var online = document.getElementById('statOnline');
    if (online) online.textContent = Math.floor(Math.random() * 200 + 50);
    setTimeout(loadLiveStats, 60000);
  }

  async function loadAIRecommendation() {
    var card = document.getElementById('aiRecCard');
    if (!card) return;
    try {
      var res = await apiFetch('/champion-bet/odds');
      if (res && res.code === 0 && res.data && res.data.odds) {
        var odds = res.data.odds;
        if (odds.length > 0) {
          var top = odds.slice().sort(function(a,b){ return a.champion_odds - b.champion_odds; }).slice(0, 3);
          var names = top.map(function(t){ return t.name; }).join(' / ');
          document.getElementById('aiRecText').textContent = '🏆 ' + names;
          card.style.display = 'block';
        }
      }
    } catch(e) {}
  }

  async function loadTrustSignals() {
    try {
      var res = await apiFetch('/finance/pool-status');
      if (res && res.code === 0 && res.data) {
        var recent = res.data.recent_payout || res.data.total_frozen;
        if (recent !== undefined) {
          var el = document.getElementById('recentPayout');
          if (el) el.innerHTML = '<div style="color:#667eea;font-weight:700">🔥 奖池</div><div>$' + Number(recent).toLocaleString() + '</div>';
        }
      }
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
    loadMoreMatches: loadMoreMatches,
    renderChampionBet: renderChampionBet,
    openBetDialog: showBetDialog,
    // Deposit / Withdraw
    showDepositModal: showDepositModal,
    hideDepositModal: hideDepositModal,
    confirmDeposit: confirmDeposit,
    showWithdrawModal: showWithdrawModal,
    confirmWithdraw: confirmWithdraw,
    // Invite
    showInviteModal: showInviteModal,
    hideInviteModal: hideInviteModal,
    copyInviteCode: copyInviteCode,
    claimInviteRewards: claimInviteRewards,
    shareInvite: shareInvite,
    // Cancel + Agent
    cancelBet: cancelBet,
    loadAgentEarnings: loadAgentEarnings,
    // AI + Transactions
    toggleAIHosting: toggleAIHosting,
    navigateTo: navigateTo,
    // Betting
    selectScore: selectScore,
    openMatch: openMatch,
    // Retry
    retryConnection: retryConnection,
    // History
    loadDepositHistory: loadDepositHistory,
    loadWithdrawHistory: loadWithdrawHistory,
    checkVIPUpgrade: checkVIPUpgrade,
    loadAIHistory: loadAIHistory,
    // New: AI settings, profile edit, invite claim, score bet
    showAISettings: showAISettings,
    showProfileEdit: showProfileEdit,
    claimInviteRewards: claimInviteRewards,
    openScoreBet: openScoreBet,
    selectScoreBet: selectScoreBet,
    placeScoreBet: placeScoreBet,
  };

  // ===== INIT =====
  function init() {
    loadData();
    setupTouchFeedback();
    setupBanner();
    setupDappListeners();

    // Wallet button listener
    var walletBtn = document.getElementById('walletBtn');
    if (walletBtn) walletBtn.addEventListener('click', handleWalletBtnClick);

    // Deposit modal confirm
    var depositConfirm = document.getElementById('depositConfirm');
    if (depositConfirm) depositConfirm.addEventListener('click', function(e) { e.preventDefault(); confirmDeposit(); });

    // Deposit modal cancel — handled by web3.js DOMContentLoaded

    // Withdraw modal confirm
    var withdrawConfirm = document.getElementById('withdrawConfirm');
    if (withdrawConfirm) withdrawConfirm.addEventListener('click', function(e) { e.preventDefault(); confirmWithdraw(); });

    // Invite modal close
    var inviteClose = document.getElementById('inviteClose');
    if (inviteClose) inviteClose.addEventListener('click', function(e) { e.preventDefault(); hideInviteModal(); });

    // Invite modal: close on overlay click
    var inviteModal = document.getElementById('inviteModal');
    if (inviteModal) {
      inviteModal.addEventListener('click', function(e) {
        if (e.target === inviteModal) hideInviteModal();
      });
    }

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

    // Live stats + AI rec + trust signals
    loadLiveStats();
    loadAIRecommendation();
    loadTrustSignals();

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

  // Global error handler — log but don't swallow
  window.addEventListener('error', function(e) {
    console.error('[19888 Error]', e.message, e.filename, e.lineno);
  });

})();
