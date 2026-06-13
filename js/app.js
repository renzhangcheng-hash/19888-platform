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
      var timer = setTimeout(function() {
        ctrl.abort();
        showToast('请求超时');
      }, 25000);
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
        if (err.name === 'AbortError') {
          return { code: -1, msg: 'timeout' };
        }
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
    overlay.classList.add('show');
    dialog.classList.add('show');
    function hide() { overlay.style.display = 'none'; dialog.style.display = 'none'; overlay.classList.remove('show'); dialog.classList.remove('show'); }
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

  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function() { reject(new Error('Failed to load ' + src)); };
      document.body.appendChild(s);
    });
  }

  // ===== WALLET (DApp via web3.js) =====
  // BscScan tx link helper
  function txLink(txHash) {
    var base = (typeof dapp !== 'undefined' && dapp.getConfig) ? dapp.getConfig().explorer : 'https://bscscan.com';
    return base + '/tx/' + txHash;
  }

  // Show toast with tx link
  function showTxToast(msg, txHash, duration) {
    var link = txLink(txHash);
    var html = msg + ' <a href=\"' + link + '\" target=\"_blank\" style=\"color:#FF6B35;text-decoration:underline;font-weight:700\">查看交易 ↗</a>';
    showToast(html, duration || 5000);
  }

  // ===== GAS TIP (first-time BNB reminder) =====
  let _gasTipShown = false;
  function showGasTip() {
    if (_gasTipShown) return;
    _gasTipShown = true;
    var cfg = (typeof dapp !== 'undefined' && dapp.getConfig) ? dapp.getConfig() : null;
    var token = cfg ? cfg.currency.symbol : 'BNB';
    showToast('💡 BSC交易需要' + token + '作为Gas费。请确保钱包有少量' + token + '。', 6000);
  }

  async function connectWallet() {
    if (typeof window.dapp === 'undefined') {
      showToast('加载钱包模块...');
      try {
        await loadScript('js/vendor/ethers-6.13.umd.min.js');
        await loadScript('js/web3.js');
      } catch(e) {
        showToast('钱包模块加载失败: ' + e.message);
        return;
      }
    }
    // dapp.connect() internally waits for wallet provider injection (TP Wallet support)
    const result = await window.dapp.connect();
    if (result.success) {
      walletAddress = result.address;

      // Check chain and switch to correct network
      const chainOk = await dapp.switchChain();
      if (!chainOk) {
        showToast('⚠️ 请切换到BSC主网以进行交易');
      }

      showToast('钱包已连接: ' + walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4));
      showGasTip();  // Remind about BNB gas

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

  // ===== POOL STATUS DATA =====
  async function loadPoolStatusData() {
    try {
      var res = await apiFetch('/finance/pool-status');
      if (res && res.code === 0 && res.data) {
        var d = res.data;
        var depositedEl = document.getElementById('poolTotalDeposited');
        if (depositedEl) depositedEl.textContent = Number(d.total_deposited || d.total_balance || 0).toFixed(2) + ' USDT';
        var frozenEl = document.getElementById('poolTotalFrozen');
        if (frozenEl) frozenEl.textContent = Number(d.total_frozen || 0).toFixed(2) + ' USDT';
        var pendingWEl = document.getElementById('poolPendingWithdrawals');
        if (pendingWEl) pendingWEl.textContent = Number(d.pending_withdrawals || 0).toFixed(2) + ' USDT';
        var usersEl = document.getElementById('poolUserCount');
        if (usersEl) usersEl.textContent = d.user_count || '0';
        var betsEl = document.getElementById('poolPendingBets');
        if (betsEl) betsEl.textContent = d.pending_bets || '0';
      }
    } catch(e) {}
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

  // ===== XSS Sanitization Helper (FP-V19888-5) =====
  function sanitize(str) {
    if (typeof str !== 'string') return '';
    if (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) {
      return DOMPurify.sanitize(str);
    }
    // Fallback: basic HTML entity encoding
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  // ===== TEAM LOGO =====
  function teamLogoImg(name, size) {
    var s = size || 50;
    var safeName = sanitize(name);
    var slug = safeName.replace(/[^a-zA-Z\u4e00-\u9fff]/g, '_').toLowerCase();
    var fallback = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="#F0E8E0"/><text x="50" y="60" text-anchor="middle" font-size="32" fill="#FF6B35" font-family="Arial" font-weight="bold">' + safeName.charAt(0) + '</text></svg>');
    var src = 'img/teams/' + encodeURIComponent(name) + '.png';
    return '<img src="' + src + '" width="' + s + '" height="' + s + '" style="border-radius:50%;object-fit:contain;background:#F0E8E0;flex-shrink:0" alt="' + safeName + '" loading="lazy" decoding="async" onerror="var t=this;if(t.src.indexOf(\'.png\')!==-1){t.src=t.src.replace(\'.png\',\'.svg\')}else{t.onerror=null;t.src=\'' + fallback + '\'}">';
  }

  // ===== MATCH CARD (lucky944 DOM — enhanced with odds) =====
  function matchCardHTML(m) {
    var t = m.time || m.match_time || '';
    var parts = t.split(' ');
    var dateStr = parts.length > 1 ? parts[0].slice(5) : '';
    var timeStr = parts.length > 1 ? parts[1].slice(0, 5) : t.slice(11, 16) || '--';
    var home = sanitize(m.home || m.home_team || '');
    var away = sanitize(m.away || m.away_team || '');
    var league = sanitize(m.league || m.league_name || '');
    var hO = Number(m.odds_home || m.home_odds || 0);
    var dO = Number(m.odds_draw || m.draw_odds || 0);
    var aO = Number(m.odds_away || m.away_odds || 0);
    var oddsRow = '</div>' +
      '<div class="odds-row">' +
        '<span style="color:#03A66D;font-weight:600">主 ' + (hO ? hO.toFixed(2) : '—') + '</span>' +
        '<span style="color:#999">平 ' + (dO ? dO.toFixed(2) : '—') + '</span>' +
        '<span style="color:#E53935;font-weight:600">客 ' + (aO ? aO.toFixed(2) : '—') + '</span>' +
      '</div>';
    return '<li><a href="javascript:;" class="con" data-match-id="' + m.id + '">' +
      '<div class="league-name"><p class="p1">' + league + '</p></div>' +
      '<div class="match-content">' +
        '<div class="team-left">' +
          '<div class="team-logo">' + teamLogoImg(home, 44) + '</div>' +
          '<div class="team-name"><a href="javascript:;" onclick="event.stopPropagation();app.openTeamDetail(\'' + home.replace(/'/g, "\\'") + '\')" style="color:inherit;text-decoration:none">' + home + '</a></div>' +
        '</div>' +
        '<div class="match-center">' +
          '<div class="time">' + timeStr + '</div>' +
          '<div class="date">' + dateStr + '</div>' +
        '</div>' +
        '<div class="team-right">' +
          '<div class="team-logo">' + teamLogoImg(away, 44) + '</div>' +
          '<div class="team-name"><a href="javascript:;" onclick="event.stopPropagation();app.openTeamDetail(\'' + away.replace(/'/g, "\\'") + '\')" style="color:inherit;text-decoration:none">' + away + '</a></div>' +
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
    var home = sanitize(m.home || m.home_team || '');
    var away = sanitize(m.away || m.away_team || '');
    var league = sanitize(m.league || m.league_name || '');
    return '<li><a href="javascript:;" class="con" data-match-id="' + m.id + '">' +
      '<div class="league-name"><p class="p1">' + league + '</p></div>' +
      '<div class="match-content">' +
        '<div class="team-left">' +
          '<div class="team-logo">' + teamLogoImg(home, 44) + '</div>' +
          '<div class="team-name"><a href="javascript:;" onclick="event.stopPropagation();app.openTeamDetail(\'' + home.replace(/'/g, "\\'") + '\')" style="color:inherit;text-decoration:none">' + home + '</a></div>' +
        '</div>' +
        '<div class="match-center">' +
          '<div class="time">' + timeStr + '</div>' +
          '<div class="date">' + dateStr + '</div>' +
        '</div>' +
        '<div class="team-right">' +
          '<div class="team-logo">' + teamLogoImg(away, 44) + '</div>' +
          '<div class="team-name"><a href="javascript:;" onclick="event.stopPropagation();app.openTeamDetail(\'' + away.replace(/'/g, "\\'") + '\')" style="color:inherit;text-decoration:none">' + away + '</a></div>' +
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
  var tabPageMap = { 'home': 0, 'matches': 1, 'market': 2, 'profile': 3, 'transactions': 3, 'docs': -1, 'fiat': -1 };
  var tabNames = ['home', 'matches', 'market', 'profile'];

  function navigateTo(page) {
    if (currentPage === page) return;
    currentPage = page;

    // Update page title
    var titles = { home:'首页', matches:'赛事列表', market:'行情', profile:'我的', records:'投注记录', transactions:'交易流水', detail:'赛事详情', about:'关于我们' };
    document.title = '19888 | ' + (titles[page] || page);

    // Auto-refresh management
    if (page === 'profile') startProfileAutoRefresh();
    else stopProfileAutoRefresh();

    // Hide all pages — use CSS classes for fade animation
    var pages = document.querySelectorAll('.page');
    for (var i = 0; i < pages.length; i++) {
      pages[i].classList.remove('active');
      pages[i].style.display = '';
    }

    if (page === 'detail') {
      var detailPage = document.getElementById('page-detail');
      if (detailPage) { detailPage.classList.add('active'); detailPage.style.display = ''; }
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
      if (sec) sec.style.display = (page === 'home') ? '' : 'none';
    }

    // Show target page (create if needed)
    var target = document.getElementById('page-' + page);
    if (target) {
      target.classList.add('active');
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
      if (tabCons.length > 0) tabCons[0].style.display = 'block';
      if (tabCons.length > 1) tabCons[1].style.display = 'none';
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Trigger page-specific renders
    if (page === 'home') renderMatchCards();
    if (page === 'matches') renderMatchesPage();
    if (page === 'records') renderRecords();
    if (page === 'profile') renderProfile();
    if (page === 'transactions') renderTransactions();
    if (page === 'market') renderMarketPage();
    if (page === 'docs') renderAPIDocs();
    if (page === 'fiat') renderFiatPage();
  }

  // ===== TOP TAB SWITCHING (on home page) =====
  function switchTopTab(idx) {
    var tabCons = document.querySelectorAll('.slick_tab .tab_con');
    var topTabs = document.querySelectorAll('.slick_tab_btn .ul-tabs_b1 li');
    for (var i = 0; i < tabCons.length; i++) {
      tabCons[i].classList.toggle('active', i === idx);
      tabCons[i].style.display = '';
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
    container.innerHTML = '<li class="skeleton-row"></li><li class="skeleton-row"></li><li class="skeleton-row"></li><li class="skeleton-row"></li><li class="skeleton-row"></li>';
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
    container.innerHTML = sanitize(slice.map(function(m) { return matchCardHTML(m); }).join('') +
      (hasMore ? '<li class="load-more-li"><a href="javascript:;" class="load-more-btn" onclick="app.loadMoreMatches()">▼ 加载更多 (' + (total - end) + ')</a></li>' : ''));
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
      var safeName = sanitize(t.name);
      return '<div class="team-card">' +
        '<div class="team-logo">' + teamLogoImg(t.name, 56) + '</div>' +
        '<div class="team-name">' + safeName + '</div>' +
        '<div class="odds-group">' +
          '<div class="odds-item"><span class="odds-label">冠军</span><span class="odds-value">' + champOdds + '</span></div>' +
          '<div class="odds-item"><span class="odds-label">亚军</span><span class="odds-value">' + runnerOdds + '</span></div>' +
        '</div>' +
        '<div class="bet-buttons">' +
          '<button class="bet-btn bet-champion" onclick="app.openChampionBet(\'' + safeName.replace(/'/g, "\\'") + '\', ' + t.id + ', \'champion\', ' + champOdds + ')">投冠军</button>' +
          '<button class="bet-btn bet-runner-up" onclick="app.openChampionBet(\'' + safeName.replace(/'/g, "\\'") + '\', ' + t.id + ', \'runnerup\', ' + runnerOdds + ')">投亚军</button>' +
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

    container.innerHTML = '<li class="skeleton-row"></li><li class="skeleton-row"></li><li class="skeleton-row"></li><li class="skeleton-row"></li><li class="skeleton-row"></li>';
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
        if (html) html += '<li class="league-group-header"><div class="con" style="padding:6px 12px;text-align:center"><span class="load-more-btn" style="cursor:default;padding:6px 16px;font-size:12px">' + sanitize(k) + '</span></div></li>';
        groups[k].forEach(function(m) {
          html += matchesPageCardHTML(m);
        });
      });
      container.innerHTML = sanitize(html);
    }
  }

  // ===== PAGE: MARKET (K-line + Orderbook) =====
  var _marketKlineData = [];
  var _cachedOnlineUsers = null;
  var _marketPollTimer = null;

  async function renderMarketPage() {
    var container = document.getElementById('marketContent');
    if (!container) return;

    container.innerHTML = '<div class="skeleton-market"><div class="skeleton-kline"></div><div class="skeleton-orderbook"></div></div>';

    // Fetch kline + orderbook in parallel
    var klineData = await loadWithFallback('/market/kline', generateMockKline(50));
    var obData = null;
    try {
      var obRes = await apiFetch('/market/orderbook');
      if (obRes && obRes.code === 0 && obRes.data) obData = obRes.data;
    } catch(e) {}
    if (!obData) obData = generateMockOrderbook();

    // Normalize orderbook format (arrays → objects)
    if (obData && obData.bids && Array.isArray(obData.bids) && obData.bids.length > 0 && Array.isArray(obData.bids[0])) {
      obData.bids = obData.bids.map(function(b) { return { price: b[0], quantity: b[1] }; });
      obData.asks = obData.asks.map(function(a) { return { price: a[0], quantity: a[1] }; });
    }

    _marketKlineData = Array.isArray(klineData) ? klineData : (klineData && klineData.candles ? klineData.candles : (klineData && klineData.klines ? klineData.klines.map(function(k) { return { t: k[0], o: k[1], h: k[2], l: k[3], c: k[4], v: k[5] }; }) : generateMockKline(50)));

    var chartHtml = renderKlineChart(_marketKlineData);
    var obHtml = renderOrderbook(obData);

    container.innerHTML =
      '<div style="max-width:100%;overflow-x:hidden">' +
        // Chart title + timeframe
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
          '<h3 style="font-size:16px;font-weight:700;margin:0;color:var(--text)">📈 K线图</h3>' +
          '<span style="font-size:11px;color:var(--text-muted)">最后50根 · 1小时</span>' +
        '</div>' +
        '<div class="market-chart-section">' + chartHtml + '</div>' +
        '<div style="height:16px"></div>' +
        '<h3 style="font-size:16px;font-weight:700;margin:0 0 8px 0;color:var(--text)">📊 订单簿</h3>' +
        '<div class="market-orderbook-section">' + obHtml + '</div>' +
      '</div>';

    // Start long-polling fallback
    startMarketPolling();
  }

  function generateMockKline(count) {
    var now = Date.now();
    var price = 45000 + Math.random() * 2000;
    var data = [];
    for (var i = 0; i < count; i++) {
      var o = price;
      var change = (Math.random() - 0.5) * 400;
      var c = o + change;
      var h = Math.max(o, c) + Math.random() * 100;
      var l = Math.min(o, c) - Math.random() * 100;
      var v = Math.random() * 1000 + 100;
      data.push({
        t: now - (count - i) * 3600000,
        o: parseFloat(o.toFixed(2)),
        h: parseFloat(h.toFixed(2)),
        l: parseFloat(l.toFixed(2)),
        c: parseFloat(c.toFixed(2)),
        v: parseFloat(v.toFixed(2))
      });
      price = c;
    }
    return data;
  }

  var _cachedMockOrderbook = null;
  function generateMockOrderbook() {
    if (_cachedMockOrderbook) return _cachedMockOrderbook;
    var basePrice = 45600;
    var bids = [], asks = [];
    for (var i = 0; i < 10; i++) {
      var bidPx = basePrice - i * 10 - Math.random() * 5;
      var askPx = basePrice + i * 10 + Math.random() * 5;
      bids.push({ price: parseFloat(bidPx.toFixed(2)), quantity: parseFloat((Math.random() * 5 + 0.1).toFixed(4)) });
      asks.push({ price: parseFloat(askPx.toFixed(2)), quantity: parseFloat((Math.random() * 5 + 0.1).toFixed(4)) });
    }
    _cachedMockOrderbook = { bids: bids, asks: asks };
    return _cachedMockOrderbook;
  }

  function renderKlineChart(candles) {
    if (!candles || candles.length === 0) return '<div style="text-align:center;padding:20px;color:var(--text-muted)">暂无K线数据</div>';

    var len = candles.length;
    var last50 = candles.slice(-50);
    var w = Math.min(window.innerWidth - 40, 600);
    var h = 280;
    var pad = { top: 20, right: 20, bottom: 30, left: 50 };
    var chartW = w - pad.left - pad.right;
    var chartH = h - pad.top - pad.bottom;

    // Find min/max
    var minPrice = Infinity, maxPrice = -Infinity, maxVol = 0;
    for (var i = 0; i < last50.length; i++) {
      var cdl = last50[i];
      if (cdl.l < minPrice) minPrice = cdl.l;
      if (cdl.h > maxPrice) maxPrice = cdl.h;
      if (cdl.v > maxVol) maxVol = cdl.v;
    }
    var priceRange = maxPrice - minPrice || 1;
    var padding = priceRange * 0.05;
    minPrice -= padding;
    maxPrice += padding;

    var candleW = Math.max(3, Math.min(8, (chartW / last50.length) * 0.6));
    var gap = (chartW - candleW * last50.length) / (last50.length - 1) || 0;

    function pxToY(px) { return pad.top + chartH - ((px - minPrice) / (maxPrice - minPrice)) * chartH; }
    function volToH(v) { return (v / maxVol) * (chartH * 0.2); }

    var svg = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="background:var(--surface);border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.05);display:block;margin:0 auto">';

    // Grid lines
    var gridLines = 5;
    for (var g = 0; g <= gridLines; g++) {
      var y = pad.top + (chartH / gridLines) * g;
      svg += '<line x1="' + pad.left + '" y1="' + y + '" x2="' + (w - pad.right) + '" y2="' + y + '" stroke="#f0f0f0" stroke-width="0.5"/>';
      var priceLabel = (maxPrice - (maxPrice - minPrice) * g / gridLines).toFixed(0);
      svg += '<text x="' + (pad.left - 5) + '" y="' + (y + 3) + '" text-anchor="end" font-size="9" fill="#999">' + priceLabel + '</text>';
    }

    // Volume bars + Candles
    for (var i = 0; i < last50.length; i++) {
      var cdl = last50[i];
      var x = pad.left + i * (candleW + gap) + gap / 2;
      var isUp = cdl.c >= cdl.o;
      var color = isUp ? '#03A66D' : '#E53935';
      var volH = volToH(cdl.v);

      // Volume bar at bottom 20% of chart
      svg += '<rect x="' + (x - candleW / 4) + '" y="' + (pad.top + chartH - volH) + '" width="' + (candleW / 2) + '" height="' + volH + '" fill="' + color + '" opacity="0.15"/>';

      // Candle body
      var bodyTop = isUp ? pxToY(cdl.c) : pxToY(cdl.o);
      var bodyBot = isUp ? pxToY(cdl.o) : pxToY(cdl.c);
      var bodyH = Math.max(bodyBot - bodyTop, 1);
      svg += '<rect x="' + (x - candleW / 2) + '" y="' + bodyTop + '" width="' + candleW + '" height="' + bodyH + '" fill="' + color + '" stroke="' + color + '" stroke-width="0.5"/>';

      // Wick
      svg += '<line x1="' + x + '" y1="' + pxToY(cdl.h) + '" x2="' + x + '" y2="' + pxToY(cdl.l) + '" stroke="' + color + '" stroke-width="0.8"/>';
    }

    svg += '</svg>';

    // Current price info bar
    var lastCdl = last50[last50.length - 1];
    var lastChange = last50.length > 1 ? ((lastCdl.c - last50[last50.length - 2].c) / last50[last50.length - 2].c * 100) : 0;
    var changeColor = lastChange >= 0 ? '#03A66D' : '#E53935';

    return '<div style="overflow-x:auto;text-align:center">' + svg + '</div>' +
      '<div style="display:flex;gap:12px;justify-content:center;margin-top:6px;font-size:12px">' +
        '<span>最新: <b style="color:' + changeColor + '">' + lastCdl.c.toFixed(2) + '</b></span>' +
        '<span>高: <b>' + lastCdl.h.toFixed(2) + '</b></span>' +
        '<span>低: <b>' + lastCdl.l.toFixed(2) + '</b></span>' +
        '<span>24h: <b style="color:' + changeColor + '">' + (lastChange >= 0 ? '+' : '') + lastChange.toFixed(2) + '%</b></span>' +
      '</div>';
  }

  function renderOrderbook(ob) {
    if (!ob || !ob.bids || !ob.asks) return '<div style="text-align:center;padding:20px;color:var(--text-muted)">暂无订单簿数据</div>';

    var bids = ob.bids.slice(0, 10);
    var asks = ob.asks.slice(0, 10);

    // Find max cumulative for bar width
    var bidCumul = 0, askCumul = 0;
    var bidMax = 0, askMax = 0;
    for (var i = 0; i < bids.length; i++) { bidCumul += bids[i].quantity; if (bidCumul > bidMax) bidMax = bidCumul; }
    for (var i = 0; i < asks.length; i++) { askCumul += asks[i].quantity; if (askCumul > askMax) askMax = askCumul; }

    var html = '<div style="background:var(--surface);border-radius:10px;padding:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05);font-size:12px">';

    // Header
    html += '<div style="display:flex;justify-content:space-between;padding-bottom:6px;border-bottom:1px solid var(--border);color:var(--text-muted);font-size:11px">' +
      '<span style="flex:1;text-align:left">价格</span>' +
      '<span style="flex:1;text-align:center">数量</span>' +
      '<span style="flex:1;text-align:right">累计</span>' +
    '</div>';

    // Asks (red, descending)
    var cumul = 0;
    for (var i = asks.length - 1; i >= 0; i--) {
      cumul += asks[i].quantity;
      var pct = cumul / askMax * 100;
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;position:relative">' +
        '<div style="position:absolute;right:0;top:0;height:100%;width:' + pct + '%;background:rgba(229,57,53,0.08);border-radius:2px;pointer-events:none"></div>' +
        '<span style="flex:1;text-align:left;color:#E53935;font-weight:600;z-index:1">' + asks[i].price.toFixed(2) + '</span>' +
        '<span style="flex:1;text-align:center;z-index:1">' + asks[i].quantity.toFixed(4) + '</span>' +
        '<span style="flex:1;text-align:right;color:var(--text-muted);z-index:1">' + cumul.toFixed(4) + '</span>' +
      '</div>';
    }

    // Spread
    var spread = asks[0] ? (asks[0].price - bids[0].price).toFixed(2) : '—';
    html += '<div style="text-align:center;padding:6px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin:4px 0;font-size:11px;color:var(--text-muted)">价差: <b style="color:var(--text)">' + spread + '</b></div>';

    // Bids (green, ascending)
    cumul = 0;
    for (var i = 0; i < bids.length; i++) {
      cumul += bids[i].quantity;
      var pct = cumul / bidMax * 100;
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;position:relative">' +
        '<div style="position:absolute;left:0;top:0;height:100%;width:' + pct + '%;background:rgba(3,166,109,0.08);border-radius:2px;pointer-events:none"></div>' +
        '<span style="flex:1;text-align:left;color:#03A66D;font-weight:600;z-index:1">' + bids[i].price.toFixed(2) + '</span>' +
        '<span style="flex:1;text-align:center;z-index:1">' + bids[i].quantity.toFixed(4) + '</span>' +
        '<span style="flex:1;text-align:right;color:var(--text-muted);z-index:1">' + cumul.toFixed(4) + '</span>' +
      '</div>';
    }

    html += '</div>';
    return html;
  }

  function startMarketPolling() {
    stopMarketPolling();
    _marketPollTimer = setInterval(function() {
      apiFetch('/market/kline').then(function(res) {
        if (res && res.code === 0 && res.data) {
          _marketKlineData = Array.isArray(res.data) ? res.data : (res.data.candles || _marketKlineData);
          var obContainer = document.getElementById('marketContent');
          if (obContainer && currentPage === 'market') {
            // Update chart section
            var chartSection = obContainer.querySelector('.market-chart-section');
            if (chartSection && _marketKlineData.length > 0) {
              var chartHtml = renderKlineChart(_marketKlineData);
              chartSection.innerHTML = chartHtml;
            }
          }
        }
      }).catch(function() {});
    }, 10000);
  }

  function stopMarketPolling() {
    if (_marketPollTimer) { clearInterval(_marketPollTimer); _marketPollTimer = null; }
  }

  // ===== PAGE: FIAT (法币入金引导) =====
  function renderFiatPage() {
    var container = document.getElementById('page-fiat') || (function() {
      var div = document.createElement('div');
      div.id = 'page-fiat';
      div.className = 'page';
      div.style.display = 'block';
      var mainEl = document.querySelector('.main .wp');
      if (mainEl) mainEl.appendChild(div);
      return div;
    })();
    if (!container) return;

    container.innerHTML =
      '<div style="padding:16px;max-width:500px;margin:0 auto">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">' +
          '<button onclick="app.navigateTo(\'profile\')" style="background:none;border:none;font-size:16px;cursor:pointer;color:var(--text-muted)">←</button>' +
          '<h3 style="font-size:18px;font-weight:700;margin:0;color:var(--text)">💰 法币入金指南</h3>' +
        '</div>' +

        // Bank transfer
        '<div style="background:var(--surface);border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05)">' +
          '<div style="font-size:14px;font-weight:700;margin-bottom:10px;color:var(--text)">🏦 银行转账</div>' +
          '<div style="font-size:12px;color:#666;line-height:1.8">' +
            '<p><b>1.</b> 登录您的网上银行或手机银行App</p>' +
            '<p><b>2.</b> 选择"跨境汇款"或"国际转账"</p>' +
            '<p><b>3.</b> 输入以下收款信息：</p>' +
            '<div style="background:#f9f9f9;border-radius:8px;padding:12px;margin:8px 0;font-size:11px">' +
              '<div>🏦 银行: Winsupreme Technology Limitada</div>' +
              '<div>📋 账号: 6222 0211 3456 7890</div>' +
              '<div>🏛️ 银行: Banco Nacional de Costa Rica</div>' +
              '<div>🌐 SWIFT: BNCRCRSJXXX</div>' +
            '</div>' +
            '<p><b>4.</b> 转账完成后，将转账凭证截图发送至客服</p>' +
            '<p><b>5.</b> 客服确认后，USDT将在30分钟内到账</p>' +
            '<div style="margin-top:8px;padding:8px;background:rgba(255,107,53,0.08);border-radius:6px;font-size:11px;color:#E55A2B">⚠️ 最低入金: 100 USDT等值法币 | 到账时间约5-30分钟</div>' +
          '</div>' +
        '</div>' +

        // USDT purchase guide
        '<div style="background:var(--surface);border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05)">' +
          '<div style="font-size:14px;font-weight:700;margin-bottom:10px;color:var(--text)">💱 USDT 购买指南</div>' +
          '<div style="font-size:12px;color:#666;line-height:1.8">' +
            '<p><b>方法一：中心化交易所购买</b></p>' +
            '<p>1. 在 Binance / OKX / HTX 等交易所注册账号</p>' +
            '<p>2. 完成KYC实名认证</p>' +
            '<p>3. 使用C2C/法币通道购买USDT</p>' +
            '<p>4. 提现USDT至您的钱包地址</p>' +
            '<div style="border-top:1px solid var(--border);margin:10px 0"></div>' +
            '<p><b>方法二：去中心化钱包购买</b></p>' +
            '<p>1. 在 MetaMask / TP Wallet 中点击"购买"</p>' +
            '<p>2. 选择MoonPay / Transak 等支付通道</p>' +
            '<p>3. 使用信用卡/借记卡直接购买</p>' +
            '<p>4. USDT直接到账钱包</p>' +
          '</div>' +
        '</div>' +

        // Contact
        '<div style="background:var(--surface);border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.05);text-align:center">' +
          '<div style="font-size:13px;color:#666;margin-bottom:8px">📱 联系客服</div>' +
          '<div style="font-size:12px;color:var(--text)">客服Telegram: <b>@support_19888</b></div>' +
        '</div>' +
      '</div>';
  }

  // ===== PAGE: API DOCS =====
  function renderAPIDocs() {
    var container = document.getElementById('page-docs');
    if (!container) {
      var mainEl = document.querySelector('.main .wp');
      if (!mainEl) return;
      container = document.getElementById('docsContent');
      if (!container) return;
    }
    var content = document.getElementById('docsContent');
    if (!content) {
      content = container;
    }

    content.innerHTML =
      '<div style="padding:12px;max-width:600px;margin:0 auto">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">' +
          '<button onclick="app.navigateTo(\'profile\')" style="background:none;border:none;font-size:16px;cursor:pointer;color:var(--text-muted)">←</button>' +
          '<h3 style="font-size:18px;font-weight:700;margin:0;color:var(--text)">📋 API 文档</h3>' +
        '</div>' +

        '<div style="background:var(--surface);border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05)">' +
          '<div style="font-size:14px;font-weight:700;margin-bottom:10px;color:var(--text)">🎯 赛事数据</div>' +
          '<div class="api-endpoint" style="margin-bottom:10px">' +
            '<code style="background:#f5f5f5;padding:3px 8px;border-radius:4px;font-size:11px;color:#E53935">GET</code> <code style="background:#f0f0f0;padding:3px 8px;border-radius:4px;font-size:11px">/api/matches</code>' +
            '<div style="font-size:11px;color:#666;margin-top:4px">获取赛事列表。支持分页参数: ?page=1&limit=10</div>' +
          '</div>' +
          '<div class="api-endpoint" style="margin-bottom:10px">' +
            '<code style="background:#f5f5f5;padding:3px 8px;border-radius:4px;font-size:11px;color:#E53935">GET</code> <code style="background:#f0f0f0;padding:3px 8px;border-radius:4px;font-size:11px">/api/matches/:id</code>' +
            '<div style="font-size:11px;color:#666;margin-top:4px">获取单场赛事详情</div>' +
          '</div>' +
        '</div>' +

        '<div style="background:var(--surface);border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05)">' +
          '<div style="font-size:14px;font-weight:700;margin-bottom:10px;color:var(--text)">📊 市场数据</div>' +
          '<div class="api-endpoint" style="margin-bottom:10px">' +
            '<code style="background:#f5f5f5;padding:3px 8px;border-radius:4px;font-size:11px;color:#E53935">GET</code> <code style="background:#f0f0f0;padding:3px 8px;border-radius:4px;font-size:11px">/api/market/kline</code>' +
            '<div style="font-size:11px;color:#666;margin-top:4px">K线数据。参数: ?symbol=BTC&interval=1h&limit=50</div>' +
          '</div>' +
          '<div class="api-endpoint" style="margin-bottom:10px">' +
            '<code style="background:#f5f5f5;padding:3px 8px;border-radius:4px;font-size:11px;color:#E53935">GET</code> <code style="background:#f0f0f0;padding:3px 8px;border-radius:4px;font-size:11px">/api/market/orderbook</code>' +
            '<div style="font-size:11px;color:#666;margin-top:4px">订单簿深度数据。参数: ?symbol=BTC&limit=10</div>' +
          '</div>' +
        '</div>' +

        '<div style="background:var(--surface);border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05)">' +
          '<div style="font-size:14px;font-weight:700;margin-bottom:10px;color:var(--text)">💰 财务数据</div>' +
          '<div class="api-endpoint" style="margin-bottom:10px">' +
            '<code style="background:#f5f5f5;padding:3px 8px;border-radius:4px;font-size:11px;color:#E53935">GET</code> <code style="background:#f0f0f0;padding:3px 8px;border-radius:4px;font-size:11px">/api/finance/pool-status</code>' +
            '<div style="font-size:11px;color:#666;margin-top:4px">资金池状态: 总存入、冻结、待提现、用户数、待结算投注</div>' +
          '</div>' +
          '<div class="api-endpoint" style="margin-bottom:10px">' +
            '<code style="background:#f5f5f5;padding:3px 8px;border-radius:4px;font-size:11px;color:#E53935">GET</code> <code style="background:#f0f0f0;padding:3px 8px;border-radius:4px;font-size:11px">/api/user/balance?address=0x...</code>' +
            '<div style="font-size:11px;color:#666;margin-top:4px">查询用户余额</div>' +
          '</div>' +
        '</div>' +

        '<div style="background:var(--surface);border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05)">' +
          '<div style="font-size:14px;font-weight:700;margin-bottom:10px;color:var(--text)">🤖 AI & 投注</div>' +
          '<div class="api-endpoint" style="margin-bottom:6px">' +
            '<code style="background:#f5f5f5;padding:3px 8px;border-radius:4px;font-size:11px;color:#03A66D">POST</code> <code style="background:#f0f0f0;padding:3px 8px;border-radius:4px;font-size:11px">/api/anti-bet/place</code>' +
            '<div style="font-size:11px;color:#666;margin-top:4px">提交反波胆投注。Body: {match_id, selected_score, amount, wallet_address}</div>' +
          '</div>' +
          '<div class="api-endpoint" style="margin-bottom:6px">' +
            '<code style="background:#f5f5f5;padding:3px 8px;border-radius:4px;font-size:11px;color:#E53935">GET</code> <code style="background:#f0f0f0;padding:3px 8px;border-radius:4px;font-size:11px">/api/user/pnl?wallet=0x...</code>' +
            '<div style="font-size:11px;color:#666;margin-top:4px">查询用户盈亏数据</div>' +
          '</div>' +
          '<div class="api-endpoint">' +
            '<code style="background:#f5f5f5;padding:3px 8px;border-radius:4px;font-size:11px;color:#E53935">GET</code> <code style="background:#f0f0f0;padding:3px 8px;border-radius:4px;font-size:11px">/api/bets?address=0x...</code>' +
            '<div style="font-size:11px;color:#666;margin-top:4px">查询用户投注记录</div>' +
          '</div>' +
        '</div>' +

        '<div style="background:var(--surface);border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.05);text-align:center;font-size:11px;color:var(--text-muted)">' +
          '更多API详情请联系技术支持' +
        '</div>' +
      '</div>';
  }

  // ===== WEBSOCKET CLIENT =====
  var _wsConnected = false;
  var _wsSocket = null;
  var _wsReconnectAttempts = 0;
  var _wsReconnectTimer = null;
  var _wsMaxRetries = 10;
  var _wsReconnectDelay = 1000; // starts at 1s, doubles each attempt

  function resolveWsUrl() {
    // Derive WebSocket URL from API base
    var apiBase = resolveApiBase();
    if (apiBase.indexOf('https://') === 0) {
      return apiBase.replace('https://', 'wss://').replace('/api', '');
    }
    if (apiBase.indexOf('http://') === 0) {
      return apiBase.replace('http://', 'ws://').replace('/api', '');
    }
    // Fallback: same origin WS
    var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + window.location.host;
  }

  function initWebSocket() {
    // Reset retry state
    _wsReconnectAttempts = 0;
    _wsReconnectDelay = 1000;
    connectWebSocket();
  }

  function connectWebSocket() {
    if (_wsSocket) {
      try { _wsSocket.close(); } catch(e) {}
      _wsSocket = null;
    }

    var url = resolveWsUrl();
    console.log('[19888] WS connecting to', url);

    try {
      // Use Socket.IO if CDN loaded (it has built-in reconnection)
      if (typeof io !== 'undefined') {
        _wsSocket = io(url, {
          transports: ['websocket', 'polling'],
          reconnection: false, // we handle reconnection ourselves
          timeout: 20000
        });

        _wsSocket.on('connect', function() {
          console.log('[19888] WebSocket connected');
          _wsConnected = true;
          _wsReconnectAttempts = 0;
          _wsReconnectDelay = 1000;
          stopMarketPolling();
        });

        _wsSocket.on('kline_update', function(data) {
          if (data && data.klines && typeof renderMarketKline === 'function') {
            renderMarketKline(data.klines);
          } else if (data && data.candles && currentPage === 'market') {
            _marketKlineData = Array.isArray(data.candles) ? data.candles : _marketKlineData;
            if (typeof renderMarketPage === 'function') renderMarketPage();
          }
        });

        _wsSocket.on('odds_update', function(data) {
          if (data && data.matches) { window._lastWsOdds = data.matches; }
          if (data && data.match_id) {
            if (currentPage === 'home') renderMatchCards();
            if (currentPage === 'matches') renderMatchesPage();
          }
        });

        _wsSocket.on('pool_update', function(data) {
          if (data && currentPage === 'profile') {
            var poolEl = document.getElementById('profilePoolBalance');
            if (poolEl && data.total_balance !== undefined) poolEl.textContent = Number(data.total_balance).toFixed(2) + ' USDT';
          }
        });

        _wsSocket.on('disconnect', function(reason) {
          console.log('[19888] WS disconnected:', reason);
          _wsConnected = false;
          startLongPolling();
          scheduleReconnect();
        });

        _wsSocket.on('connect_error', function(err) {
          console.warn('[19888] WS connect error:', err.message);
          _wsConnected = false;
          startLongPolling();
          scheduleReconnect();
        });
      } else {
        // Raw WebSocket fallback (Socket.IO CDN not loaded)
        _wsSocket = new WebSocket(url);

        _wsSocket.onopen = function() {
          console.log('[19888] WebSocket connected');
          _wsConnected = true;
          _wsReconnectAttempts = 0;
          _wsReconnectDelay = 1000;
          stopMarketPolling();
        };

        _wsSocket.onmessage = function(event) {
          var data;
          try { data = JSON.parse(event.data); } catch(e) { return; }
          if (!data || !data.type) return;

          var msgType = data.type;
          if (msgType === 'kline_update' || msgType === 'kline') {
            if (currentPage === 'market' && data.candles) {
              _marketKlineData = Array.isArray(data.candles) ? data.candles : _marketKlineData;
              if (typeof renderMarketPage === 'function') renderMarketPage();
            }
          }
          if (msgType === 'odds_update' || msgType === 'odds') {
            if (data.match_id) {
              if (currentPage === 'home') renderMatchCards();
              if (currentPage === 'matches') renderMatchesPage();
            }
          }
          if (msgType === 'pool_update' || msgType === 'pool') {
            if (currentPage === 'profile') {
              var poolEl = document.getElementById('profilePoolBalance');
              if (poolEl && data.total_balance !== undefined) poolEl.textContent = Number(data.total_balance).toFixed(2) + ' USDT';
            }
          }
        };

        _wsSocket.onclose = function(event) {
          console.log('[19888] WebSocket closed:', event.code, event.reason);
          _wsConnected = false;
          startLongPolling();
          scheduleReconnect();
        };

        _wsSocket.onerror = function(err) {
          console.warn('[19888] WebSocket error');
        };
      }
    } catch(e) {
      console.warn('[19888] WS init error:', e.message);
      _wsConnected = false;
      startLongPolling();
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (_wsReconnectTimer) {
      clearTimeout(_wsReconnectTimer);
      _wsReconnectTimer = null;
    }
    if (_wsReconnectAttempts >= _wsMaxRetries) {
      console.warn('[19888] WS max retries exceeded');
      showToast('实时推送已断开');
      return;
    }
    _wsReconnectAttempts++;
    var delay = Math.min(_wsReconnectDelay, 30000);
    console.log('[19888] WS reconnecting in ' + (delay / 1000) + 's... (attempt ' + _wsReconnectAttempts + '/' + _wsMaxRetries + ')');
    _wsReconnectTimer = setTimeout(function() {
      _wsReconnectDelay = Math.min(_wsReconnectDelay * 2, 30000);
      connectWebSocket();
    }, delay);
  }

  function stopWebSocket() {
    if (_wsReconnectTimer) {
      clearTimeout(_wsReconnectTimer);
      _wsReconnectTimer = null;
    }
    if (_wsSocket) {
      try {
        if (typeof io !== 'undefined' && _wsSocket.id) {
          _wsSocket.disconnect();
        } else {
          _wsSocket.close();
        }
      } catch(e) {}
      _wsSocket = null;
    }
  }

  function startLongPolling() {
    // Long-polling fallback already handled by startMarketPolling for market data
    // Also poll pool status for profile
    if (_marketPollTimer) return; // already polling
    stopMarketPolling();
    _marketPollTimer = setInterval(function() {
      // Pool status
      apiFetch('/finance/pool-status').then(function(res) {
        if (res && res.code === 0 && res.data && currentPage === 'profile') {
          var poolEl = document.getElementById('profilePoolBalance');
          if (poolEl) poolEl.textContent = Number(res.data.total_balance || 0).toFixed(2) + ' USDT';
        }
      }).catch(function() {});
    }, 10000);
  }

  // ===== PAGE: RECORDS =====
  let _recordsPage = 1;
  let _recordsTotalPages = 1;
  let _recordsFilter = 'all';

  async function renderRecords(filter) {
    filter = filter || _recordsFilter;
    _recordsFilter = filter;
    var container = document.getElementById('betsList');
    if (!container) {
      // Fallback: try recordsList
      container = document.getElementById('recordsList');
      if (!container) return;
    }

    var page = _recordsPage;
    container.innerHTML = '<div class="skeleton-record"></div><div class="skeleton-record" style="animation-delay:.15s"></div><div class="skeleton-record" style="animation-delay:.3s"></div>';

    // Always try API fetch if wallet connected
    if (walletAddress) {
      var query = '/bet-records?address=' + encodeURIComponent(walletAddress) + '&page=' + page + '&page_size=20';
      if (filter !== 'all') query += '&status=' + filter;
      try {
        var res = await apiFetch(query);
        if (res && res.code === 0 && res.data) {
        var list = res.data.list || [];
        var pagination = res.data.pagination || {};
        _recordsTotalPages = pagination.total_pages || 1;
        var records = list.map(function(r) {
          return {
            id: r.id,
            team: r.team_name || r.team || r.match_name || '',
            type: r.bet_type_name || r.type || (r.game_type === 'champion' ? '冠军' : r.game_type === 'anti-score' ? '波胆' : '投注'),
            amount: r.amount || 0,
            odds: r.odds || 0,
            potentialWin: r.potential_win || 0,
            time: r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : (r.time || ''),
            status: r.status || 'pending'
          };
        });
        renderRecordsList(container, records, pagination);
        return;
      }
      } catch(e) {
        showToast('加载记录失败: ' + (e.message || '网络错误'));
      }
    }

    // Fallback: filter local betRecords
    var records = betRecords.slice(0);
    if (filter === 'pending') records = records.filter(function(r) { return r.status === 'pending'; });
    if (filter === 'won') records = records.filter(function(r) { return r.status === 'won'; });
    if (filter === 'lost') records = records.filter(function(r) { return r.status === 'lost'; });
    renderRecordsList(container, records, null);
  }

  function renderRecordsList(container, records, pagination) {
    if (!records || records.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无投注记录</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var cls = r.status === 'won' ? 'won' : r.status === 'lost' ? 'lost' : 'pending';
      var txt = r.status === 'won' ? '已赢' : r.status === 'lost' ? '已输' : '进行中';
      var color = r.status === 'won' ? '#03A66D' : r.status === 'lost' ? '#e53935' : '#DAA520';
      var safeTeam = sanitize(r.team || '');
      var safeType = sanitize(r.type || '投注');
      var safeTime = sanitize(r.time || '');
      html += '<div class="record-item">' +
        '<div class="record-header">' +
          '<span class="record-label">' + safeType + '</span>' +
          '<span class="record-label">' + safeTime + '</span>' +
        '</div>' +
        '<div class="record-team">' + safeTeam + '</div>' +
        '<div class="record-footer">' +
          '<span class="record-amount">' + (r.amount || 0) + ' USDT</span>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span class="record-status" style="color:' + color + '">' + txt + '</span>' +
            (r.status === 'pending' ? '<button onclick="app.cancelBet(' + r.id + ')" class="cancel-bet-btn">取消</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }

    // Pagination controls
    if (pagination && pagination.total_pages > 1) {
      html += '<div class="pagination-bar">';
      if (pagination.page > 1) {
        html += '<button onclick="app.pageRecords(' + (pagination.page - 1) + ')" class="pagination-btn">← 上一页</button>';
      }
      html += '<span>第 ' + pagination.page + '/' + pagination.total_pages + ' 页</span>';
      if (pagination.page < pagination.total_pages) {
        html += '<button onclick="app.pageRecords(' + (pagination.page + 1) + ')" class="pagination-btn">下一页 →</button>';
      }
      html += '</div>';
    }

    container.innerHTML = html;
  }

  function filterRecords(filter, evt) {
    if (evt && evt.target) {
      var btns = document.querySelectorAll('#page-records .filter-btn');
      for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
      evt.target.classList.add('active');
    }
    _recordsPage = 1;
    renderRecords(filter);
  }

  function pageRecords(page) {
    _recordsPage = page;
    renderRecords(_recordsFilter);
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
      profilePage.style.display = 'block';
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
    await loadPoolStatusData();

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

      // ---- Pool Status ----
      '<div id="poolStatusCard" style="background:#fff;border-radius:14px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.05);margin-bottom:14px">' +
        '<div style="font-size:14px;font-weight:700;color:#1a1a2e;margin-bottom:12px">🏊 奖金池状态</div>' +
        '<div id="poolStatusGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
          '<div><div style="font-size:11px;color:#999;margin-bottom:4px">总存入</div><div id="poolTotalDeposited" style="font-size:14px;font-weight:600">加载中...</div></div>' +
          '<div><div style="font-size:11px;color:#999;margin-bottom:4px">总冻结</div><div id="poolTotalFrozen" style="font-size:14px;font-weight:600">加载中...</div></div>' +
          '<div><div style="font-size:11px;color:#999;margin-bottom:4px">待提现</div><div id="poolPendingWithdrawals" style="font-size:14px;font-weight:600">加载中...</div></div>' +
          '<div><div style="font-size:11px;color:#999;margin-bottom:4px">用户数</div><div id="poolUserCount" style="font-size:14px;font-weight:600">加载中...</div></div>' +
          '<div style="grid-column:1/-1"><div style="font-size:11px;color:#999;margin-bottom:4px">待结算投注</div><div id="poolPendingBets" style="font-size:14px;font-weight:600">加载中...</div></div>' +
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
        '<button onclick="app.navigateTo(\'fiat\')" style="background:#fff;border:1px solid #03A66D;border-radius:10px;padding:12px;font-size:12px;color:#03A66D;cursor:pointer">💰 法币入金</button>' +
        '<button onclick="app.navigateTo(\'docs\')" style="background:#fff;border:1px solid #667eea;border-radius:10px;padding:12px;font-size:12px;color:#667eea;cursor:pointer">📋 API文档</button>' +
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
      var safeType = sanitize(r.type || '');
      var safeTeam = sanitize(r.team || '');
      var safeTime = sanitize(r.time || '');
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f0f0f0">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + safeType + '</div>' +
          '<div style="font-size:11px;color:#999">' + safeTime + '</div>' +
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
      if (modal) { modal.style.display = 'flex'; modal.classList.add('show'); }
    }
  }

  function hideDepositModal() {
    if (typeof dapp !== 'undefined') {
      dapp.hideDepositModal();
    } else {
      var modal = document.getElementById('depositModal');
      if (modal) { modal.style.display = 'none'; modal.classList.remove('show'); }
    }
  }

  // Gas estimate updater — polls BSC gas price
  function updateGasEstimate() {
    var el = document.getElementById('gasEstimate');
    if (!el) return;
    // Use cached value from dapp, or fallback
    el.textContent = '~0.0001 BNB';
    // Try to get real gas price
    if (typeof dapp !== 'undefined' && dapp.getConfig) {
      var cfg = dapp.getConfig();
      if (cfg.chainId === 56) el.textContent = '~0.0001 BNB (BSC)';
      else if (cfg.explorer) el.textContent = '查询中...';
    }
  }

  // Approval limit info — warns about unlimited USDT approval
  function showApprovalLimitInfo() {
    var msg = '⚠️ 授权说明\n\n' +
      'LuckyPool 合约需要 USDT 授权才能充值。\n\n' +
      '默认授权为无限额 — 这意味着合约理论上可划转您全部 USDT。\n\n' +
      '建议：授权时手动设置限额为本次充值金额。\n' +
      '钱包会弹出授权窗口，可将"支出上限"改为具体数额。';
    showConfirm('USDT 授权安全提示', '<div style="font-size:12px;line-height:1.6;padding:8px">' + msg.replace(/\n/g, '<br>') + '</div>', function(){ closeConfirm(); });
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
            showTxToast('✅ 充值成功: ' + amount + ' USDT', txHash);
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
        body: JSON.stringify({ wallet_address: walletAddress, amount: amount, withdraw_address: toAddress, tx_hash: 'withdraw_' + Date.now() })
      });
      if (res && res.code === 0) {
        showToast('✅ 提现申请已提交: ' + amount + ' USDT → ' + toAddress.slice(0,6) + '...');
        var modal = document.getElementById('withdrawModal');
        if (modal) { modal.style.display = 'none'; modal.classList.remove('show'); }
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
    var levelsEl = document.getElementById('inviteLevels');
    if (codeEl) { codeEl.textContent = ''; codeEl.innerHTML = '<div class="skeleton-invite-row" style="width:60%;margin:0 auto"></div>'; }
    if (statsEl) statsEl.innerHTML = '<div class="skeleton-invite-row" style="width:80%"></div><div class="skeleton-invite-row" style="width:50%;margin-top:6px"></div>';
    if (levelsEl) levelsEl.innerHTML = '<div class="skeleton-invite-row" style="width:70%"></div>';

    modal.style.display = 'flex';
    modal.classList.add('show');

    // Load invite data + agent earnings + invite levels
    Promise.all([loadInviteData(), loadAgentEarnings(), loadInviteLevels()]).then(function() {
      if (codeEl) codeEl.textContent = inviteCode || '生成失败，请重试';
      var agentInfo = window._agentInfo || {};
      var levelName = agentInfo.name || '普通会员';
      var commissionL1 = ((agentInfo.commission_l1 || 0) * 100).toFixed(1);
      var commissionL2 = ((agentInfo.commission_l2 || 0) * 100).toFixed(1);
      var nextLevel = agentInfo.next_level || null;
      var totalEarned = agentInfo.total_earned || 0;

      if (statsEl) statsEl.innerHTML =
        '<div style="font-size:12px;color:#DAA520;margin-bottom:4px">🏅 ' + sanitize(levelName) + ' · 一级返佣 ' + sanitize(commissionL1) + '% · 二级返佣 ' + sanitize(commissionL2) + '%</div>' +
        '<div>已邀请: <b>' + inviteData.count + '</b>人 | 交易额: <b>$' + (agentInfo.total_volume || 0).toLocaleString() + '</b></div>' +
        '<div style="font-size:11px;color:#999;margin-top:4px">已赚取: ' + totalEarned.toFixed(2) + ' USDT</div>' +
        '<div style="font-size:11px;color:#999">已领取: ' + inviteData.rewards.toFixed(2) + ' USDT</div>' +
        (nextLevel ? '<div style="font-size:11px;color:#667eea;margin-top:4px">下一等级: ' + sanitize(nextLevel.name) + ' (需邀请 ' + nextLevel.min_invites + '人)</div>' : '');

      // Render invite levels
      renderInviteLevels(levelsEl, agentInfo);
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

  // claimInviteRewards defined below with the profile section — L2049 is the active version
  function _placeholder() {}

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

  // ===== INVITE LEVELS =====
  var _inviteLevels = [];

  async function loadInviteLevels() {
    try {
      var res = await apiFetch('/invite/levels');
      if (res && res.code === 0 && Array.isArray(res.data)) {
        _inviteLevels = res.data;
      }
    } catch(e) {}
  }

  function renderInviteLevels(container, agentInfo) {
    if (!container) return;
    if (!_inviteLevels || _inviteLevels.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:8px;color:#999;font-size:11px">暂无等级数据</div>';
      return;
    }

    var currentLevel = (agentInfo && agentInfo.level !== undefined) ? agentInfo.level : 0;
    var inviteCount = (agentInfo && agentInfo.invite_count !== undefined) ? agentInfo.invite_count : 0;

    var html = '<div style="margin-top:12px;border-top:1px solid #eee;padding-top:10px">' +
      '<div style="font-size:13px;font-weight:700;color:#1a1a2e;margin-bottom:8px">📊 代理等级</div>';

    for (var i = 0; i < _inviteLevels.length; i++) {
      var lv = _inviteLevels[i];
      var isCurrent = lv.level === currentLevel;
      var isUnlocked = inviteCount >= lv.min_invites;
      var nextLevel = _inviteLevels[i + 1] || null;
      var progressPct = 0;
      if (nextLevel && inviteCount > lv.min_invites) {
        progressPct = Math.min(100, Math.round((inviteCount - lv.min_invites) / (nextLevel.min_invites - lv.min_invites) * 100));
      }
      var bgColor = isCurrent ? '#667eea' : (isUnlocked ? '#03A66D' : '#f0f0f0');
      var textColor = isCurrent || isUnlocked ? '#fff' : '#999';
      var checkMark = isUnlocked ? '✅' : (isCurrent ? '⭐' : '🔒');

      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:4px;background:' + (isCurrent ? '#EEF0FF' : '#fafafa') + ';border-radius:8px;font-size:12px">' +
        '<div style="width:24px;text-align:center;font-size:14px">' + checkMark + '</div>' +
        '<div style="flex:1">' +
          '<div style="font-weight:' + (isCurrent ? '700' : '400') + ';color:' + (isCurrent ? '#667eea' : '#333') + '">' + sanitize(lv.name) + '</div>' +
          '<div style="font-size:10px;color:#999">返佣 L1: ' + (lv.commission_l1 * 100).toFixed(0) + '% · L2: ' + (lv.commission_l2 * 100).toFixed(0) + '% · 需 ' + lv.min_invites + '人</div>' +
        '</div>' +
        '<div style="font-size:11px;font-weight:600;color:' + textColor + ';padding:2px 8px;border-radius:10px;background:' + bgColor + '">' +
          (isCurrent ? '当前' : (isUnlocked ? '已解锁' : '未达')) +
        '</div>' +
      '</div>';

      // Progress bar for current level to next
      if (isCurrent && nextLevel && progressPct < 100) {
        html += '<div style="margin:0 8px 6px 32px;height:4px;background:#e0e0e0;border-radius:2px;overflow:hidden">' +
          '<div style="height:100%;width:' + progressPct + '%;background:linear-gradient(90deg,#667eea,#764ba2);border-radius:2px;transition:width 0.3s"></div>' +
        '</div>';
      }
    }

    html += '</div>';
    container.innerHTML = html;
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
            body: JSON.stringify({ wallet_address: walletAddress, nickname: nick })
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
        body: JSON.stringify({ wallet_address: walletAddress, match_id: matchId, cell_score: score, amount: amount })
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
        if (d.txHash) showTxToast('✅ ' + d.message, d.txHash);
        else showToast('✅ ' + d.message, 4000);
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
      container.style.display = 'block';
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
      container.style.display = 'block';
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

    container.innerHTML = sanitize('<div style="padding:12px">' +
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
            '<div style="font-size:13px;color:var(--text)">' + label + (tx.team_name ? ' · ' + sanitize(tx.team_name) : '') + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted)">' + sanitize(time) + '</div>' +
            '<div style="font-size:10px;color:var(--text-muted)">' + sanitize(tx.status || '') + (tx.tx_hash ? ' · ' + sanitize(tx.tx_hash.slice(0,8)) + '...' : '') + '</div>' +
          '</div>' +
          '<div style="font-size:14px;font-weight:700;color:' + amountColor + ';white-space:nowrap">' + (amount > 0 ? '+' : '') + Number(amount).toFixed(2) + ' USDT</div>' +
        '</div>';
      }).join('') +
    '</div>');
  }

  // ===== BETTING FLOW =====
  var betDialogData = null;

  function openMatch(matchId) {
    currentDetailMatchId = matchId;
    var match = findMatch(matchId);
    if (!match) { showToast('赛事不存在'); return; }

    // Navigate to detail page
    navigateTo('detail');

    // Restore original page-detail HTML if it was replaced by team detail
    var detailPage = document.getElementById('page-detail');
    if (detailPage && _pageDetailOriginalHTML !== null) {
      detailPage.innerHTML = _pageDetailOriginalHTML;
      _pageDetailOriginalHTML = null;
    }

    var home = match.home || match.home_team || '';
    var away = match.away || match.away_team || '';
    var time = match.time || match.match_time || '';
    var venue = match.venue || '';
    var odds = match.odds_home || '--';

    var homeEl = document.getElementById('detailHomeTeam');
    if (homeEl) {
      homeEl.innerHTML = '<a href="javascript:;" onclick="event.stopPropagation();app.openTeamDetail(\'' + home.replace(/'/g, "\\'") + '\')" style="color:inherit;text-decoration:none">' + sanitize(home) + '</a>';
    }
    var awayEl = document.getElementById('detailAwayTeam');
    if (awayEl) {
      awayEl.innerHTML = '<a href="javascript:;" onclick="event.stopPropagation();app.openTeamDetail(\'' + away.replace(/'/g, "\\'") + '\')" style="color:inherit;text-decoration:none">' + sanitize(away) + '</a>';
    }
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
          cell_score: score,
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
    // Search API-loaded data first, then mock fallback
    if (_homeMatchesData && _homeMatchesData.length > 0) {
      var apiMatch = _homeMatchesData.find(function(m) { return m.id === id; });
      if (apiMatch) return apiMatch;
    }
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
        // Record in backend after on-chain success
        apiFetch('/champion-bet/place', {
          method: 'POST',
          body: JSON.stringify({
            team_id: d.teamId,
            bet_type: betTypeIdx + 1,  // 1=champion, 2=runner-up in backend
            amount: amount,
            wallet_address: walletAddress,
            tx_hash: tx.hash
          })
        }).then(function(r) {
          if (!r || r.code !== 0) console.warn('Backend record failed:', r && r.msg);
        }).catch(function(e){ console.warn('Backend sync error:', e.message); });
      } else if (d.matchId !== undefined) {
        // Score bet — cellIndex from dialog
        var cellIdx = d.cellIndex || 0;
        tx = await dapp.placeBet(d.matchId, cellIdx, amount + '');
      } else {
        showToast('无效的投注数据'); return;
      }

      showTxToast('✅ 投注成功!', tx.hash);
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
    if (online) {
      if (!_cachedOnlineUsers) _cachedOnlineUsers = Math.floor(Math.random() * 200 + 50);
      online.textContent = _cachedOnlineUsers;
    }
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
          if (el) el.innerHTML = sanitize('<div style="color:#667eea;font-weight:700">🔥 奖池</div><div>$' + Number(recent).toLocaleString() + '</div>');
        }
      }
    } catch(e) {}
  }

  // ===== LANGUAGE =====
  const i18n = {
    cn: { home:'首页', matches:'赛事', market:'行情', profile:'我的','推荐赛事':'推荐赛事','冠亚预测':'冠亚预测','关于我们':'关于我们','更多 »':'更多 »','服务条款':'服务条款','隐私政策':'隐私政策','确认投注':'确认投注','充值':'充值','提现':'提现','邀请好友':'邀请好友' },
    en: { home:'Home', matches:'Matches', market:'Market', profile:'Me','推荐赛事':'Recommended','冠亚预测':'Champion','关于我们':'About','更多 »':'More »','服务条款':'Terms','隐私政策':'Privacy','确认投注':'Place Bet','充值':'Deposit','提现':'Withdraw','邀请好友':'Invite' },
    vn: { home:'Trang chủ', matches:'Trận đấu', market:'Thị trường', profile:'Tôi','推荐赛事':'Đề xuất','冠亚预测':'Vô địch','关于我们':'Giới thiệu' },
    jp: { home:'ホーム', matches:'試合', market:'マーケット', profile:'マイ','推荐赛事':'おすすめ','冠亚预测':'優勝予想','关于我们':'概要' },
    kr: { home:'홈', matches:'경기', market:'시장', profile:'내정보','推荐赛事':'추천','冠亚预测':'우승예측','关于我们':'소개' },
    cntw: { home:'首頁', matches:'賽事', market:'行情', profile:'我的','推荐赛事':'推薦賽事','冠亚预测':'冠亞預測','关于我们':'關於我們' }
  };

  function setLanguage(langCode) {
    lang = langCode;
    try { localStorage.setItem('19888_lang', langCode); } catch(e) {}
    // Update modal selection (if exists)
    document.querySelectorAll('.global-lang-option').forEach(function(o) {
      o.classList.toggle('selected', o.getAttribute('data-lang') === langCode);
    });
    // Update language bar
    document.querySelectorAll('.lang-item').forEach(function(o) {
      o.classList.toggle('active', o.getAttribute('data-lang') === langCode);
    });
    var modal = document.getElementById('globalLangModal');
    if (modal) modal.classList.remove('active');
    // Translate bottom nav and top tabs
    var dict = i18n[langCode] || i18n.cn;
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      var key = el.getAttribute('data-i18n');
      if (dict[key]) el.textContent = dict[key];
    });
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

  // ===== TEAM DETAIL PAGE =====
  var _pageDetailOriginalHTML = null;
  var _teamNameMap = null;

  async function openTeamDetail(teamName) {
    // Save original page-detail HTML on first call
    var detailPage = document.getElementById('page-detail');
    if (!detailPage) return;
    if (_pageDetailOriginalHTML === null) {
      _pageDetailOriginalHTML = detailPage.innerHTML;
    }

    // Navigate to detail page
    navigateTo('detail');

    // Show loading state
    detailPage.innerHTML = '<div class="team-detail-container" style="padding:16px;max-width:600px;margin:0 auto;text-align:center;color:var(--text-muted,#999)">加载球队信息...</div>';

    // Build team name → ID map if needed
    if (!_teamNameMap) {
      _teamNameMap = {};
      var teamsRes = await apiFetch('/teams');
      if (teamsRes && teamsRes.code === 0 && Array.isArray(teamsRes.data)) {
        for (var i = 0; i < teamsRes.data.length; i++) {
          _teamNameMap[teamsRes.data[i].name] = teamsRes.data[i].id;
        }
      }
      // Also populate from mock data
      for (var j = 0; j < mockChampionTeams.length; j++) {
        if (_teamNameMap[mockChampionTeams[j].name] === undefined) {
          _teamNameMap[mockChampionTeams[j].name] = mockChampionTeams[j].id;
        }
      }
    }

    var teamId = getTeamIdByName(teamName);

    // Fetch team detail and stats in parallel
    var teamData = null;
    var statsData = null;

    if (teamId) {
      var [detailRes, statsRes] = await Promise.all([
        apiFetch('/teams/' + teamId),
        apiFetch('/teams/' + teamId + '/stats')
      ]);
      if (detailRes && detailRes.code === 0) teamData = detailRes.data;
      if (statsRes && statsRes.code === 0) statsData = statsRes.data;
    }

    // Fallback: build mock team data
    if (!teamData) {
      var mockTeam = null;
      for (var k = 0; k < mockChampionTeams.length; k++) {
        if (mockChampionTeams[k].name === teamName) {
          mockTeam = mockChampionTeams[k];
          break;
        }
      }
      if (mockTeam) {
        teamData = {
          id: mockTeam.id,
          name: mockTeam.name,
          logo: null,
          group_name: mockTeam.group || '',
          country: '',
          match_count: 0
        };
      } else {
        teamData = {
          id: null,
          name: teamName,
          logo: null,
          group_name: '',
          country: '',
          match_count: 0
        };
      }
    }

    // Fallback stats
    if (!statsData) {
      statsData = {
        wins: 0,
        draws: 0,
        losses: 0,
        goals_for: 0,
        goals_against: 0,
        win_rate: 0,
        avg_goals_scored: 0,
        avg_goals_conceded: 0,
        form: []
      };
    }

    renderTeamDetail(teamData, statsData);
  }

  function renderTeamDetail(teamData, statsData) {
    var detailPage = document.getElementById('page-detail');
    if (!detailPage) return;

    var name = sanitize(teamData.name || '—');
    var group = sanitize(teamData.group_name || teamData.group || '');
    var country = sanitize(teamData.country || '');
    var logoHtml = teamLogoImg(name, 60);

    // Handle both direct stats format and nested betting_stats format
    var s = statsData.betting_stats || statsData;
    var wins = s.wins || s.won_count || 0;
    var draws = s.draws || 0;
    var losses = s.losses || s.lost_count || 0;
    var goalsFor = s.goals_for || 0;
    var goalsAgainst = s.goals_against || 0;
    var winRate = s.win_rate || (s.total_bets > 0 ? ((wins / s.total_bets) * 100) : 0);
    var avgGoalsFor = s.avg_goals_scored || 0;
    var avgGoalsAgainst = s.avg_goals_conceded || 0;
    var form = statsData.form || s.form || [];

    // Form badges (W/D/L)
    var formHtml = '';
    if (form.length > 0) {
      formHtml = '<div style="display:flex;gap:6px;margin-top:8px;justify-content:center">';
      for (var f = 0; f < form.length; f++) {
        var result = form[f];
        var bg = result === 'W' ? '#03A66D' : (result === 'L' ? '#E53935' : (result === 'D' ? '#FFA502' : '#999'));
        formHtml += '<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:' + bg + ';color:#fff;font-size:12px;font-weight:700">' + result + '</span>';
      }
      formHtml += '</div>';
    }

    var html =
      '<div class="team-detail-container" style="padding:16px;max-width:600px;margin:0 auto">' +
        // Back button
        '<div style="margin-bottom:12px">' +
          '<a href="javascript:;" onclick="app.navigateTo(\'home\')" style="color:var(--accent,#FF6B35);text-decoration:none;font-size:13px">← 返回主页</a>' +
        '</div>' +
        // Team header card
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding:16px;background:var(--surface,#fff);border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.06)">' +
          logoHtml +
          '<div style="flex:1">' +
            '<h2 style="margin:0;font-size:20px;font-weight:700;color:var(--text,#333)">' + name + '</h2>' +
            '<div style="font-size:12px;color:var(--text-muted,#999);margin-top:4px">' +
              (country ? '<span>' + country + '</span>' : '') +
              (group ? (country ? ' · ' : '') + '<span>组别: ' + group + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</div>' +
        // Win/Draw/Loss stat cards
        '<div style="margin-bottom:16px">' +
          '<h3 style="font-size:14px;font-weight:700;margin:0 0 8px 0;color:var(--text,#333)">📊 数据统计</h3>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">' +
            '<div style="background:var(--surface,#fff);border-radius:8px;padding:12px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.04)"><div style="font-size:20px;font-weight:700;color:#03A66D">' + wins + '</div><div style="font-size:11px;color:var(--text-muted,#999)">胜</div></div>' +
            '<div style="background:var(--surface,#fff);border-radius:8px;padding:12px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.04)"><div style="font-size:20px;font-weight:700;color:#FFA502">' + draws + '</div><div style="font-size:11px;color:var(--text-muted,#999)">平</div></div>' +
            '<div style="background:var(--surface,#fff);border-radius:8px;padding:12px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.04)"><div style="font-size:20px;font-weight:700;color:#E53935">' + losses + '</div><div style="font-size:11px;color:var(--text-muted,#999)">负</div></div>' +
          '</div>' +
        '</div>' +
        // Goals for/against
        '<div style="margin-bottom:16px">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div style="background:var(--surface,#fff);border-radius:8px;padding:12px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.04)"><div style="font-size:18px;font-weight:700;color:var(--text,#333)">' + goalsFor + '</div><div style="font-size:11px;color:var(--text-muted,#999)">进球</div></div>' +
            '<div style="background:var(--surface,#fff);border-radius:8px;padding:12px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.04)"><div style="font-size:18px;font-weight:700;color:var(--text,#333)">' + goalsAgainst + '</div><div style="font-size:11px;color:var(--text-muted,#999)">失球</div></div>' +
          '</div>' +
        '</div>' +
        // Avg goals
        '<div style="margin-bottom:16px">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div style="background:var(--surface,#fff);border-radius:8px;padding:12px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.04)"><div style="font-size:18px;font-weight:700;color:var(--text,#333)">' + Number(avgGoalsFor).toFixed(2) + '</div><div style="font-size:11px;color:var(--text-muted,#999)">场均进球</div></div>' +
            '<div style="background:var(--surface,#fff);border-radius:8px;padding:12px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.04)"><div style="font-size:18px;font-weight:700;color:var(--text,#333)">' + Number(avgGoalsAgainst).toFixed(2) + '</div><div style="font-size:11px;color:var(--text-muted,#999)">场均失球</div></div>' +
          '</div>' +
        '</div>' +
        // Win rate
        '<div style="margin-bottom:16px;background:var(--surface,#fff);border-radius:8px;padding:16px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.04)">' +
          '<div style="font-size:28px;font-weight:700;color:var(--accent,#FF6B35)">' + Number(winRate).toFixed(1) + '%</div>' +
          '<div style="font-size:11px;color:var(--text-muted,#999);margin-top:2px">胜率</div>' +
        '</div>' +
        // Recent form
        (form.length > 0 ? '<div style="margin-bottom:16px;background:var(--surface,#fff);border-radius:8px;padding:16px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.04)"><div style="font-size:12px;font-weight:600;color:var(--text-muted,#999);margin-bottom:6px">近期表现</div>' + formHtml + '</div>' : '') +
      '</div>';

    detailPage.innerHTML = html;
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
    updateGasEstimate: updateGasEstimate,
    showApprovalLimitInfo: showApprovalLimitInfo,
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
    pageRecords: pageRecords,
    loadInviteLevels: loadInviteLevels,
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
    // New: Market, Fiat, API Docs, WebSocket
    renderMarketPage: renderMarketPage,
    renderFiatPage: renderFiatPage,
    renderAPIDocs: renderAPIDocs,
    loadPoolStatusData: loadPoolStatusData,
    openTeamDetail: openTeamDetail,
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
      var savedLang = localStorage.getItem('19888_lang');
      if (savedLang) {
        setLanguage(savedLang);
      }
    } catch(e) {}

    console.log('19888 platform initialized');

    // Init WebSocket client for real-time updates
    setTimeout(initWebSocket, 2000);
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

  // Event delegation: match card clicks (data-match-id)
  document.addEventListener('click', function(e) {
    var target = e.target.closest('[data-match-id]');
    if (target) {
      e.preventDefault();
      var mid = parseInt(target.getAttribute('data-match-id'));
      if (mid) openMatch(mid);
    }
  });

  // Global error handler — log but don't swallow
  window.addEventListener('error', function(e) {
    console.error('[19888 Error]', e.message, e.filename, e.lineno);
  });

})();
