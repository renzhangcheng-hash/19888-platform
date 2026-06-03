/**
 * 19888 反波膽平台 - Application Logic v3 (Enhanced)
 * API-first with mock fallback. SPA with tab navigation, wallet connect, betting.
 * Enhanced with: live odds flash, smooth page transitions, sound FX, skeleton screens, ripple touch.
 */
(function() {
  'use strict';

  // Load admin-managed data if available
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
  const API_BASE = '/api';
  let apiAvailable = false;

  // ==================== STATE ====================
  let walletAddress = null;
  let walletProvider = null;
  let currentPage = 'home';
  let currentTab = 'recommend';
  let currentLang = 'cn';

  // USDT / BSC
  const BSC_RPC = 'https://bsc-dataseed.binance.org/';
  const USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';
  const USDT_DECIMALS = 18;
  const PLATFORM_ADDRESS = '0x4B16c5dE96eB2117bBE5Fd171E4d20361976F324';
  let usdtBalance = 0;

  async function getUSDTBalance(address) {
    try {
      const r = await fetch(BSC_RPC, {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:USDT_ADDRESS,data:'0x70a08231000000000000000000000000'+address.replace('0x','')},'latest']})});
      const j = await r.json();
      if (j.result) return parseInt(j.result,16)/1e18;
    } catch(e) {}
    return 0;
  }

  async function refreshBalance() {
    if (!walletAddress) return;
    const bal = await getUSDTBalance(walletAddress);
    usdtBalance = bal;
    const el = document.getElementById('profile-balance');
    if (el) el.textContent = bal.toFixed(2) + ' USDT';
    return bal;
  }

  function showDepositModal() {
    let div = document.getElementById('deposit-modal');
    if (!div) {
      div = document.createElement('div'); div.id = 'deposit-modal'; div.className = 'dialog-overlay';
      div.innerHTML = '<div class="dialog" style="max-width:340px"><div class="dialog-header">💳 USDT 充值</div><div class="dialog-body" style="text-align:center;padding:20px"><p style="color:var(--text2);font-size:12px;margin-bottom:12px">向以下地址转账 USDT（BSC/BEP-20）</p><div style="background:#F7F8FA;padding:12px;border-radius:8px;word-break:break-all;font-size:11px;margin-bottom:12px;user-select:all">'+PLATFORM_ADDRESS+'</div><p style="color:var(--red);font-size:11px">⚠️ 仅支持 BSC 链 USDT</p><p style="color:var(--red);font-size:11px">其他链转账将永久丢失</p></div><div class="dialog-footer"><button class="btn-cancel" onclick="this.closest(\' .dialog-overlay\').style.display=\'none\'">关闭</button></div></div>';
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
    const addr = document.getElementById('w-addr').value.trim();
    const amount = parseFloat(document.getElementById('w-amount').value);
    if (!addr || addr.length < 10) { showToast('请输入有效地址'); return; }
    if (isNaN(amount) || amount < 10) { showToast('最低提现 10 USDT'); return; }
    const records = JSON.parse(localStorage.getItem('19888_withdraw_requests') || '[]');
    records.push({ address:addr, amount, wallet:walletAddress, time:new Date().toISOString(), status:'pending' });
    localStorage.setItem('19888_withdraw_requests', JSON.stringify(records));
    showToast('提现申请已提交！管理员审核后到账');
    document.getElementById('withdraw-modal').style.display = 'none';
  }
  let betRecords = [];
  let userBalance = 0;
  let betCart = []; // [{score, odds, matchName, amount}]
  let oddsFlashTimer = null;  // NEW: timer for odds flash animation
  let audioCtx = null;        // NEW: Web Audio API context (lazy init)

  // ==================== API ====================
  async function apiCall(endpoint, opts = {}) {
    try {
      const res = await fetch(API_BASE + endpoint, {
        headers: { 'Content-Type': 'application/json', ...opts.headers },
        ...opts
      });
      const data = await res.json();
      apiAvailable = true;
      return data;
    } catch(e) {
      apiAvailable = false;
      return null;
    }
  }

  // ==================== TEAM FLAGS (emoji) ====================
  const TEAM_FLAGS = {
    "巴西": "🇧🇷", "阿根廷": "🇦🇷", "法国": "🇫🇷", "英格兰": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    "西班牙": "🇪🇸", "德国": "🇩🇪", "葡萄牙": "🇵🇹", "荷兰": "🇳🇱",
    "克罗地亚": "🇭🇷", "比利时": "🇧🇪", "格鲁吉亚": "🇬🇪", "罗马尼亚": "🇷🇴",
    "摩洛哥": "🇲🇦", "马达加斯加": "🇲🇬", "威尔士": "🏴󠁧󠁢󠁷󠁬󠁳󠁿", "加纳": "🇬🇭",
  };

  // ==================== FLAG EMOJIS ====================
  const FLAGS = {
    "巴西":"🇧🇷","阿根廷":"🇦🇷","法国":"🇫🇷","英格兰":"🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    "西班牙":"🇪🇸","德国":"🇩🇪","葡萄牙":"🇵🇹","荷兰":"🇳🇱",
    "克罗地亚":"🇭🇷","比利时":"🇧🇪","格鲁吉亚":"🇬🇪","罗马尼亚":"🇷🇴",
    "摩洛哥":"🇲🇦","马达加斯加":"🇲🇬","威尔士":"🏴󠁧󠁢󠁷󠁬󠁳󠁿","加纳":"🇬🇭",
  };

  function teamLogoUrl(name) {
    const slug = name.replace(/[^a-zA-Z\u4e00-\u9fff]/g, '_').toLowerCase();
    return 'img/teams/' + slug + '.png';
  }

  function teamLogoImg(name, size) {
    const s = size || 50;
    // National team → flag emoji
    if (FLAGS[name]) {
      return '<span style="display:inline-flex;align-items:center;justify-content:center;width:' + s + 'px;height:' + s + 'px;border-radius:50%;background:linear-gradient(135deg,#E8EBF5,#DDE1F0);font-size:' + Math.round(s*0.58) + 'px;flex-shrink:0;overflow:hidden">' + FLAGS[name] + '</span>';
    }
    // Club team → PNG file with initials fallback
    const url = teamLogoUrl(name);
    const initials = name.replace(/\s/g,'').slice(0,3).toUpperCase() || '⚽';
    const fallback = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#E8EBF5"/><text x="50" y="58" text-anchor="middle" font-size="' + (initials.length > 2 ? '28' : '38') + '" fill="#999" font-family="Arial" font-weight="900">' + initials + '</text></svg>');
    return '<img src="' + url + '" width="' + s + '" height="' + s + '" style="border-radius:50%;object-fit:contain;background:#E8EBF5;flex-shrink:0" alt="' + name + '" loading="lazy" onerror="this.onerror=null;this.src=\'' + fallback + '\'">';
  }

  // ==================== MOCK DATA ====================
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

  // ==================== ENHANCED: SOUND EFFECTS (Web Audio API) ====================
  function getAudioCtx() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch(e) {
        audioCtx = null;
      }
    }
    return audioCtx;
  }

  // Play a pleasant success chime when bet is confirmed
  function playSuccessSound() {
    const ctx = getAudioCtx();
    if (!ctx) return;

    // Resume context if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;

    // Three-tone ascending chime: C5 → E5 → G5
    const notes = [
      { freq: 523.25, start: 0,    dur: 0.12 },
      { freq: 659.25, start: 0.1,  dur: 0.12 },
      { freq: 783.99, start: 0.2,  dur: 0.25 }
    ];

    notes.forEach(function(note) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.start);

      // Quick attack, slow decay for pleasant chime
      gain.gain.setValueAtTime(0, now + note.start);
      gain.gain.linearRampToValueAtTime(0.3, now + note.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + note.start + note.dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + note.start);
      osc.stop(now + note.start + note.dur + 0.05);
    });
  }

  // Play a subtle click/tap sound for UI interactions
  function playClickSound() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

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

  // ==================== ENHANCED: RIPPLE EFFECT (Touch Feedback) ====================
  function createRipple(e) {
    const target = e.currentTarget;
    // Remove any existing ripples
    const oldRipple = target.querySelector('.ripple-effect');
    if (oldRipple) oldRipple.remove();

    const ripple = document.createElement('span');
    ripple.className = 'ripple-effect';

    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + 'px';

    // Get click/touch position
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

    target.style.position = target.style.position || 'relative';
    target.style.overflow = target.style.overflow || 'hidden';
    target.appendChild(ripple);

    // Remove after animation
    ripple.addEventListener('animationend', function() {
      ripple.remove();
    });
  }

  // Attach ripple to all interactive elements
  function initRippleEffects() {
    document.querySelectorAll('.match-card, .grid-cell, .team-card, button, .btn-champion, .btn-runnerup, .tabbar-item, .tab-nav-item, .record-filter button, .record-item, .lang-option, .quick-amounts button')
      .forEach(function(el) {
        // Avoid double-binding
        if (el._hasRipple) return;
        el._hasRipple = true;
        el.addEventListener('pointerdown', createRipple, { passive: true });
      });
  }

  // ==================== ENHANCED: ODDS FLASH ANIMATION ====================
  function startOddsFlash() {
    // Clear any existing timer
    if (oddsFlashTimer) clearInterval(oddsFlashTimer);

    oddsFlashTimer = setInterval(function() {
      // Flash odds values on all visible odds display elements
      var allOdds = document.querySelectorAll('.odds-tag .val, .cell-odds, .o-val');

      // Randomly pick 1-3 odds elements to "flash" (simulate live odds change)
      var count = 1 + Math.floor(Math.random() * 3);
      var indices = [];
      while (indices.length < count && indices.length < allOdds.length) {
        var idx = Math.floor(Math.random() * allOdds.length);
        if (indices.indexOf(idx) === -1) indices.push(idx);
      }

      indices.forEach(function(i) {
        var el = allOdds[i];
        if (!el) return;

        // Read current value
        var current = parseFloat(el.textContent) || 1.0;
        // Slight random fluctuation: ±1-5%
        var delta = current * (Math.random() * 0.05) * (Math.random() > 0.5 ? 1 : -1);
        var newVal = Math.max(1.01, current + delta);

        // Flash class: green for increase, red for decrease
        el.classList.remove('flash-up', 'flash-down');
        void el.offsetWidth; // force reflow
        if (delta >= 0) {
          el.classList.add('flash-up');
          el.textContent = newVal.toFixed(2);
        } else {
          el.classList.add('flash-down');
          el.textContent = newVal.toFixed(2);
        }
      });
    }, 2000 + Math.random() * 1000); // every 2-3 seconds
  }

  function stopOddsFlash() {
    if (oddsFlashTimer) {
      clearInterval(oddsFlashTimer);
      oddsFlashTimer = null;
    }
  }

  // ==================== ENHANCED: SMOOTH PAGE TRANSITIONS ====================
  function navigateTo(page) {
    if (currentPage === page) return;

    var oldPage = currentPage;
    currentPage = page;

    // Determine transition direction based on navigation
    var pageOrder = ['home', 'matches', 'detail', 'ai', 'records', 'profile'];
    var oldIdx = pageOrder.indexOf(oldPage);
    var newIdx = pageOrder.indexOf(page);
    var direction = (newIdx >= oldIdx) ? 'forward' : 'backward';

    var allPages = document.querySelectorAll('.page');
    var targetPage = document.getElementById('page-' + page);

    if (!targetPage) return;

    // Phase 1: Prepare entering page (offscreen)
    targetPage.style.transition = 'none';
    if (direction === 'forward') {
      targetPage.style.transform = 'translateX(30px)';
    } else {
      targetPage.style.transform = 'translateX(-30px)';
    }
    targetPage.style.opacity = '0';
    targetPage.classList.add('active');

    // Force reflow
    void targetPage.offsetWidth;

    // Phase 2: Animate old page out
    allPages.forEach(function(p) {
      if (p !== targetPage && p.classList.contains('active')) {
        p.style.transition = 'opacity 0.2s ease, transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
        if (direction === 'forward') {
          p.style.transform = 'translateX(-20px)';
        } else {
          p.style.transform = 'translateX(20px)';
        }
        p.style.opacity = '0';

        // Remove after transition
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

    // Phase 3: Animate new page in (slight delay for stagger)
    setTimeout(function() {
      targetPage.style.transition = 'opacity 0.3s ease 0.05s, transform 0.3s cubic-bezier(0.4, 0, 0.2, 1) 0.05s';
      targetPage.style.transform = 'translateX(0)';
      targetPage.style.opacity = '1';

      var cleanup = function() {
        targetPage.style.transition = '';
        targetPage.style.transform = '';
        targetPage.style.opacity = '';
        targetPage.removeEventListener('transitionend', cleanup);
      };
      targetPage.addEventListener('transitionend', cleanup, { once: false });
    }, 50);

    // Update tabbar active state
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

    // Play subtle click for page nav
    playClickSound();
  }

  function switchTab(tab) {
    if (currentTab === tab) return;
    currentTab = tab;

    // Fade transition for tab content
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
    if (tab === 'champion') renderChampionBet();
  }

  // ==================== HOME – Match Cards ====================
  function matchCardHTML(m) {
    var timeParts = (m.time || '').split(' ');
    var dateStr = timeParts.length > 1 ? timeParts[0].slice(5) : '';
    var timeStr = timeParts.length > 1 ? timeParts[1].slice(0,5) : (m.time || '--');
    var isLive = m.status === 'live';
    var statusText = m.status === 'live' ? '🔴 直播中' : m.status === 'finished' ? '已结束' : '未开赛';
    return '\n      <div class="match-card' + (isLive ? ' live' : '') + '" onclick="app.navigateTo(\'detail\'); app.loadMatchDetail(' + m.id + ')" title="' + (m.venue || '') + '">\n        <div class="match-league">' + m.league + (isLive ? ' <span style="color:var(--red);font-weight:700">LIVE</span>' : '') + '</div>\n        <div class="match-content">\n          <div class="team">\n            <div class="team-logo" style="background:none">' + teamLogoImg(m.home, 50) + '</div>\n            <div class="team-name">' + m.home + '</div>\n          </div>\n          <div class="match-time">\n            <div class="time">' + timeStr + '</div>\n            <div class="date">' + dateStr + '</div>\n            <div class="status" style="color:' + (isLive ? 'var(--red)' : 'var(--text-muted)') + '">' + statusText + '</div>\n          </div>\n          <div class="team">\n            <div class="team-logo" style="background:none">' + teamLogoImg(m.away, 50) + '</div>\n            <div class="team-name">' + m.away + '</div>\n          </div>\n        </div>\n        <div class="match-odds">\n          <div class="odds-tag">主胜<br><span class="val">' + (m.odds_home || (m.odds && m.odds.home) || '—') + '</span></div>\n          <div class="odds-tag">平局<br><span class="val">' + (m.odds_draw || (m.odds && m.odds.draw) || '—') + '</span></div>\n          <div class="odds-tag">客胜<br><span class="val">' + (m.odds_away || (m.odds && m.odds.away) || '—') + '</span></div>\n        </div>\n      </div>';
  }

  // ==================== ENHANCED: SKELETON SCREEN ====================
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

  // Detail page skeleton
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

  // Match list skeleton
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
    if (apiData && apiData.code === 0 && apiData.data.length > 0) {
      data = apiData.data;
    }

    // Small delay so skeleton is visible
    await new Promise(function(r) { setTimeout(r, 400); });

    container.classList.remove('skeleton-loading');
    container.innerHTML = data.map(function(m) { return matchCardHTML(m); }).join('');
    initRippleEffects();
  }

  // ==================== CHAMPION BET ====================
  async function renderChampionBet() {
    var grid = document.getElementById('teams-grid');
    if (!grid) return;

    // Show skeleton while loading
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
      return '\n      <div class="team-card">\n        <div class="t-logo" style="background:none">' + teamLogoImg(t.name, 56) + '<span style="display:none;align-items:center;justify-content:center;width:52px;height:52px;border-radius:50%;background:var(--bg-input);color:var(--text-muted);font-size:26px">⚽</span></div>\n        <div class="t-name">' + t.name + '</div>\n        <div class="odds-row">\n          <div><span class="o-label">冠军</span><br><span class="o-val">' + t.championship_odds + '</span></div>\n          <div><span class="o-label">亚军</span><br><span class="o-val">' + t.runner_up_odds + '</span></div>\n        </div>\n        <div class="bet-btns">\n          <button class="btn-champion" onclick="app.openBetDialog(\'' + t.name + '\', ' + t.id + ', \'champion\', ' + t.championship_odds + ')">投冠军</button>\n          <button class="btn-runnerup" onclick="app.openBetDialog(\'' + t.name + '\', ' + t.id + ', \'runnerup\', ' + t.runner_up_odds + ')">投亚军</button>\n        </div>\n      </div>\n    ';
    }).join('');

    document.getElementById('total-bet').textContent = totalBet.toFixed(2);
    document.getElementById('total-win').textContent = totalWin.toFixed(2);
    initRippleEffects();
  }

  // ==================== BET DIALOG ====================
  function openBetDialog(teamName, teamId, betType, odds) {
    var overlay = document.getElementById('bet-dialog-overlay');
    var typeName = betType === 'champion' ? '冠军' : '亚军';
    document.getElementById('bet-team-name').textContent = teamName;
    document.getElementById('bet-type-name').textContent = typeName;
    document.getElementById('bet-odds').textContent = odds;
    document.getElementById('bet-amount-input').value = '';
    document.getElementById('bet-profit').textContent = '0';
    overlay.classList.add('show');
    overlay._betData = { teamName: teamName, teamId: teamId, betType: betType, odds: odds, typeName: typeName };
  }

  function closeBetDialog() {
    document.getElementById('bet-dialog-overlay').classList.remove('show');
  }

  async function confirmBet() {
    var overlay = document.getElementById('bet-dialog-overlay');
    var amount = parseFloat(document.getElementById('bet-amount-input').value);
    if (!amount || amount < 1) { showToast('请输入正确的投注金额'); return; }
    if (!walletAddress) { showToast('请先连接钱包'); return; }

    var data = overlay._betData;
    var odds = data.odds;

    // Try API first
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

    // Fallback — local record
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

  function updateBetProfit() {
    var amount = parseFloat(document.getElementById('bet-amount-input').value) || 0;
    var overlay = document.getElementById('bet-dialog-overlay');
    var odds = overlay._betData ? overlay._betData.odds : 0;
    document.getElementById('bet-profit').textContent = amount > 0 ? (amount * odds - amount).toFixed(2) : '0';
  }

  // ==================== MATCH LIST PAGE ====================
  async function renderMatchList() {
    var container = document.getElementById('matches-page-list');
    if (!container) return;

    showSkeletons(container, 6);
    var data = mockMatches.concat(mockMatches); // Show more in list view
    var apiData = await apiCall('/matches');
    if (apiData && apiData.code === 0 && apiData.data.length > 0) data = apiData.data;

    await new Promise(function(r) { setTimeout(r, 350); });
    container.classList.remove('skeleton-loading');
    container.innerHTML = data.map(function(m) { return matchCardHTML(m); }).join('');
    initRippleEffects();
  }

  // ==================== MATCH DETAIL ====================
  async function loadMatchDetail(matchId) {
    var match = mockMatches.find(function(m) { return m.id === matchId; }) || mockMatches[0];
    var grid18 = scoreGrid18.map(function(score) { return { score: score, odds: +(1.5 + Math.random() * 8).toFixed(2) }; });

    // Show skeleton for grid
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
  }

  function quickBet(score, odds, matchName) {
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    addToCart(score, odds, matchName);
    playClickSound();
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

  function submitCart() {
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    if (betCart.length === 0) return;

    var total = betCart.reduce(function(s, b) { return s + b.amount; }, 0);
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
    showToast('已提交 ' + total + ' USDT 投注！🎉');
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
        // Random rotation
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
        indicator.textContent = '⟳ 刷新中...';
        await renderMatchCards();
        indicator.classList.remove('active');
        indicator.textContent = '↓ 下拉刷新';
      }
      pullStart = 0;
    }, { passive: true });
  }

  // ==================== RECORDS PAGE ====================
  async function renderRecords(filter) {
    var container = document.getElementById('records-list');
    if (!container) return;

    // Skeleton
    container.innerHTML = Array(4).fill(0).map(function() {
      return '<div class="record-item" style="pointer-events:none">' +
        '<div style="margin-bottom:6px"><div class="skeleton-line shimmer" style="width:40%;height:12px;border-radius:3px;margin-bottom:4px"></div><div class="skeleton-line shimmer" style="width:50%;height:10px;border-radius:3px"></div></div>' +
        '<div class="skeleton-line shimmer" style="width:70%;height:14px;border-radius:3px;margin-bottom:8px"></div>' +
        '<div style="display:flex;justify-content:space-between"><div class="skeleton-line shimmer" style="width:60px;height:16px;border-radius:3px"></div><div class="skeleton-line shimmer" style="width:40px;height:16px;border-radius:3px"></div></div>' +
      '</div>';
    }).join('');

    var records = betRecords;

    // Try API
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
      container.innerHTML = '<div class="empty-state"><div class="e-icon">📋</div><div class="e-text">暂无投注记录</div></div>';
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
      document.getElementById('wallet-status').innerHTML = '<div class="m-left"><span class="m-icon">👛</span> 钱包连接</div><span style="color:var(--green);margin-right:10px">● 已连接</span>';
    } else {
      document.getElementById('profile-addr').textContent = '未连接';
      document.getElementById('profile-name').textContent = '请连接钱包';
      document.getElementById('profile-balance').textContent = '0.00';
      document.getElementById('wallet-status').innerHTML = '<div class="m-left"><span class="m-icon">👛</span> 钱包连接</div><span style="color:var(--text-muted);margin-right:10px">○ 未连接</span>';
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
      let accounts = [];
      const provider = detectWallet();
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
        // Register with backend
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

  // ==================== INIT ====================
  async function init() {
    loadData();
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
    document.getElementById('bet-dialog-overlay').addEventListener('click', function(e) { if (e.target === this) closeBetDialog(); });
    document.getElementById('lang-modal').addEventListener('click', function(e) { if (e.target.classList.contains('lang-modal-mask')) closeLangModal(); });
    document.querySelectorAll('.quick-amounts button').forEach(function(btn) {
      btn.addEventListener('click', function() { document.getElementById('bet-amount-input').value = this.dataset.amount; updateBetProfit(); });
    });
    document.getElementById('bet-amount-input').addEventListener('input', updateBetProfit);
    document.getElementById('btn-confirm-bet').addEventListener('click', confirmBet);
    document.getElementById('btn-cancel-bet').addEventListener('click', closeBetDialog);

    // Initialize ripple effect on all interactive elements
    initRippleEffects();

    // Start enhanced features
    startOddsFlash();

    renderMatchCards();
    renderChampionBet();
    renderRecords('all');
    renderProfile();
    updateCountdown();
    updateBadges();
    initPullRefresh();
    setInterval(updateCountdown, 1000);

    // Render sparkline for AI page
    var sparkData = [2.1,1.8,3.2,2.9,4.1,3.5,2.7,5.0,4.3,3.1,6.2,5.8,4.0,7.5,6.1];
    renderSparkline('sparkline-ai', sparkData, 'var(--green)');

    // Re-init ripple on dynamic content updates via MutationObserver
    var observer = new MutationObserver(function() {
      initRippleEffects();
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
    // Enhanced public helpers
    playSuccessSound: playSuccessSound,
    createRipple: createRipple
  };

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
