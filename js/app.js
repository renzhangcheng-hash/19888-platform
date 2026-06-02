/**
 * 1688 反波膽平台 - Application Logic v2
 * API-first with mock fallback. SPA with tab navigation, wallet connect, betting.
 */
(function() {
  'use strict';

  // ==================== CONFIG ====================
  const API_BASE = '/api';
  let apiAvailable = false;

  // ==================== STATE ====================
  let walletAddress = null;
  let walletProvider = null;
  let currentPage = 'home';
  let currentTab = 'recommend';
  let currentLang = 'cn';
  let betRecords = [];
  let userBalance = 0;

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

  function teamLogoUrl(name) {
    const slug = name.replace(/[^a-zA-Z\u4e00-\u9fff]/g, '_').toLowerCase();
    return 'img/teams/' + slug + '.svg';
  }

  function teamLogoImg(name, size) {
    return `<img src="${teamLogoUrl(name)}" width="${size||48}" height="${size||48}" 
      style="border-radius:50%;object-fit:contain;background:var(--bg-input)"
      onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`;
  }

  // ==================== MOCK DATA ====================
  const mockMatches = [
    { id:1, league:'法甲', home:'巴黎圣日耳曼', away:'马赛', time:'03:00', date:'06/04', odds_home:1.82, odds_draw:3.50, odds_away:4.20, status:'upcoming' },
    { id:2, league:'英超', home:'曼城', away:'利物浦', time:'00:30', date:'06/04', odds_home:2.10, odds_draw:3.30, odds_away:3.40, status:'upcoming' },
    { id:3, league:'西甲', home:'皇马', away:'巴萨', time:'04:00', date:'06/05', odds_home:2.40, odds_draw:3.20, odds_away:2.90, status:'upcoming' },
    { id:4, league:'意甲', home:'尤文图斯', away:'国米', time:'02:45', date:'06/05', odds_home:2.15, odds_draw:3.10, odds_away:3.50, status:'upcoming' },
    { id:5, league:'德甲', home:'拜仁慕尼黑', away:'多特蒙德', time:'01:30', date:'06/06', odds_home:1.95, odds_draw:3.60, odds_away:3.80, status:'upcoming' },
    { id:6, league:'友谊赛', home:'巴西', away:'阿根廷', time:'08:00', date:'06/07', odds_home:2.50, odds_draw:3.00, odds_away:2.80, status:'upcoming' },
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

  // ==================== PAGE NAVIGATION ====================
  function navigateTo(page) {
    currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    document.querySelectorAll('.tabbar-item').forEach(i => i.classList.remove('active'));
    const tabMap = { home:0, matches:1, ai:2, records:3, profile:4 };
    const idx = tabMap[page];
    if (idx !== undefined) document.querySelectorAll('.tabbar-item')[idx].classList.add('active');
    window.scrollTo(0, 0);
    if (page === 'matches') renderMatchList();
    if (page === 'profile') renderProfile();
  }

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    const tabMap = { recommend:0, champion:1, about:2 };
    const idx = tabMap[tab];
    if (idx !== undefined) document.querySelectorAll('.tab-nav-item')[idx].classList.add('active');
    if (tab === 'champion') renderChampionBet();
  }

  // ==================== HOME – Match Cards ====================
  function matchCardHTML(m) {
    const timeParts = (m.time || '').split(' ');
    const dateStr = timeParts.length > 1 ? timeParts[0].slice(5) : '';
    const timeStr = timeParts.length > 1 ? timeParts[1].slice(0,5) : (m.time || '--');
    return `
      <div class="match-card" onclick="app.navigateTo('detail'); app.loadMatchDetail(${m.id})">
        <div class="match-league">${m.league}</div>
        <div class="match-content">
          <div class="team">
            <div class="team-logo" style="background:none">${teamLogoImg(m.home, 48)}<span style="display:none;align-items:center;justify-content:center;width:48px;height:48px;border-radius:50%;background:var(--bg-input);color:var(--text-muted);font-size:24px">⚽</span></div>
            <div class="team-name">${m.home}</div>
          </div>
          <div class="match-time">
            <div class="time">${timeStr}</div>
            <div class="date">${dateStr}</div>
            <div class="status">${m.status === 'upcoming' ? '未开赛' : m.status === 'live' ? '直播中' : '已结束'}</div>
          </div>
          <div class="team">
            <div class="team-logo" style="background:none">${teamLogoImg(m.away, 48)}<span style="display:none;align-items:center;justify-content:center;width:48px;height:48px;border-radius:50%;background:var(--bg-input);color:var(--text-muted);font-size:24px">⚽</span></div>
            <div class="team-name">${m.away}</div>
          </div>
        </div>
        <div class="match-odds">
          <div class="odds-tag">主胜<br><span class="val">${m.odds_home || m.odds?.home || '—'}</span></div>
          <div class="odds-tag">平局<br><span class="val">${m.odds_draw || m.odds?.draw || '—'}</span></div>
          <div class="odds-tag">客胜<br><span class="val">${m.odds_away || m.odds?.away || '—'}</span></div>
        </div>
      </div>`;
  }

  async function renderMatchCards() {
    const container = document.getElementById('match-list');
    if (!container) return;
    let data = mockMatches;

    const apiData = await apiCall('/matches');
    if (apiData && apiData.code === 0 && apiData.data.length > 0) {
      data = apiData.data;
    }

    container.innerHTML = data.map(m => matchCardHTML(m)).join('');
  }

  // ==================== CHAMPION BET ====================
  async function renderChampionBet() {
    const grid = document.getElementById('teams-grid');
    if (!grid) return;

    let teams = mockChampionTeams;
    let totalBet = 12850;
    let totalWin = 67420;

    const apiData = await apiCall('/champion-bet/odds');
    if (apiData && apiData.code === 0 && apiData.data) {
      teams = apiData.data.odds || teams;
      totalBet = apiData.data.total_bet || totalBet;
      totalWin = apiData.data.total_potential_win || totalWin;
    }

    grid.innerHTML = teams.map(t => `
      <div class="team-card">
        <div class="t-logo" style="background:none">${teamLogoImg(t.name, 52)}<span style="display:none;align-items:center;justify-content:center;width:52px;height:52px;border-radius:50%;background:var(--bg-input);color:var(--text-muted);font-size:26px">⚽</span></div>
        <div class="t-name">${t.name}</div>
        <div class="odds-row">
          <div><span class="o-label">冠军</span><br><span class="o-val">${t.championship_odds}</span></div>
          <div><span class="o-label">亚军</span><br><span class="o-val">${t.runner_up_odds}</span></div>
        </div>
        <div class="bet-btns">
          <button class="btn-champion" onclick="app.openBetDialog('${t.name}', ${t.id}, 'champion', ${t.championship_odds})">投冠军</button>
          <button class="btn-runnerup" onclick="app.openBetDialog('${t.name}', ${t.id}, 'runnerup', ${t.runner_up_odds})">投亚军</button>
        </div>
      </div>
    `).join('');

    document.getElementById('total-bet').textContent = totalBet.toFixed(2);
    document.getElementById('total-win').textContent = totalWin.toFixed(2);
  }

  // ==================== BET DIALOG ====================
  function openBetDialog(teamName, teamId, betType, odds) {
    const overlay = document.getElementById('bet-dialog-overlay');
    const typeName = betType === 'champion' ? '冠军' : '亚军';
    document.getElementById('bet-team-name').textContent = teamName;
    document.getElementById('bet-type-name').textContent = typeName;
    document.getElementById('bet-odds').textContent = odds;
    document.getElementById('bet-amount-input').value = '';
    document.getElementById('bet-profit').textContent = '0';
    overlay.classList.add('show');
    overlay._betData = { teamName, teamId, betType, odds, typeName };
  }

  function closeBetDialog() {
    document.getElementById('bet-dialog-overlay').classList.remove('show');
  }

  async function confirmBet() {
    const overlay = document.getElementById('bet-dialog-overlay');
    const amount = parseFloat(document.getElementById('bet-amount-input').value);
    if (!amount || amount < 1) { showToast('请输入正确的投注金额'); return; }
    if (!walletAddress) { showToast('请先连接钱包'); return; }

    const data = overlay._betData;
    const odds = data.odds;

    // Try API first
    if (apiAvailable) {
      const res = await apiCall('/champion-bet/place', {
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
        renderChampionBet();
        return;
      }
    }

    // Fallback — local record
    const record = {
      id: Date.now(), team: data.teamName, type: data.typeName,
      amount: amount, odds: odds, potentialWin: (amount * odds).toFixed(2),
      time: new Date().toLocaleString('zh-CN'), status: 'pending'
    };
    betRecords.unshift(record);
    userBalance += amount;
    saveData();
    closeBetDialog();
    showToast('投注成功！');
  }

  function updateBetProfit() {
    const amount = parseFloat(document.getElementById('bet-amount-input').value) || 0;
    const overlay = document.getElementById('bet-dialog-overlay');
    const odds = overlay._betData ? overlay._betData.odds : 0;
    document.getElementById('bet-profit').textContent = amount > 0 ? (amount * odds - amount).toFixed(2) : '0';
  }

  // ==================== MATCH LIST PAGE ====================
  async function renderMatchList() {
    const container = document.getElementById('matches-page-list');
    if (!container) return;

    let data = mockMatches.concat(mockMatches); // Show more in list view
    const apiData = await apiCall('/matches');
    if (apiData && apiData.code === 0 && apiData.data.length > 0) data = apiData.data;

    container.innerHTML = data.map(m => matchCardHTML(m)).join('');
  }

  // ==================== MATCH DETAIL ====================
  async function loadMatchDetail(matchId) {
    let match = mockMatches.find(m => m.id === matchId) || mockMatches[0];
    let grid18 = scoreGrid18.map(score => ({ score, odds: +(1.5 + Math.random() * 8).toFixed(2) }));

    const apiData = await apiCall('/matches/' + matchId);
    if (apiData && apiData.code === 0 && apiData.data) {
      match = apiData.data;
      grid18 = apiData.data.grid_18 || grid18;
    }

    const timeParts = (match.time || '').split(' ');
    document.getElementById('md-league').textContent = match.league;
    document.getElementById('md-home').textContent = match.home;
    document.getElementById('md-away').textContent = match.away;
    document.getElementById('md-time').textContent = timeParts.length > 1 ? timeParts[1].slice(0,5) : (match.time || '--');
    document.getElementById('md-date').textContent = timeParts.length > 1 ? timeParts[0].slice(5) : '';

    const grid = document.getElementById('grid-18');
    grid.innerHTML = grid18.map(cell => `
      <div class="grid-cell" onclick="app.quickBet('${cell.score}', ${cell.odds}, '${match.home} vs ${match.away}')">
        <div class="cell-score">${cell.score}</div>
        <div class="cell-odds">${cell.odds}</div>
      </div>
    `).join('');
  }

  function quickBet(score, odds, matchName) {
    if (!walletAddress) { showToast('请先连接钱包'); return; }
    const amount = 100;
    betRecords.unshift({
      id: Date.now(), team: matchName + ' ' + score, type: '比分投注',
      amount: amount, odds: odds, potentialWin: (amount * odds).toFixed(2),
      time: new Date().toLocaleString('zh-CN'), status: 'pending'
    });
    userBalance += amount;
    saveData();
    showToast(`已投注 ${matchName} ${score}`);
  }

  // ==================== RECORDS PAGE ====================
  async function renderRecords(filter) {
    const container = document.getElementById('records-list');
    if (!container) return;

    let records = betRecords;

    // Try API
    if (apiAvailable && walletAddress) {
      const res = await apiCall('/bets?address=' + encodeURIComponent(walletAddress));
      if (res && res.code === 0 && res.data.length > 0) {
        records = res.data.map(r => ({
          id: r.id, team: r.team_name, type: r.bet_type_name,
          amount: r.amount, odds: r.odds, potentialWin: r.potential_win,
          time: new Date(r.created_at).toLocaleString('zh-CN'), status: r.status
        }));
      }
    }

    if (filter === 'pending') records = records.filter(r => r.status === 'pending');
    if (filter === 'won') records = records.filter(r => r.status === 'won');
    if (filter === 'lost') records = records.filter(r => r.status === 'lost');

    if (records.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="e-icon">📋</div><div class="e-text">暂无投注记录</div></div>';
      return;
    }

    container.innerHTML = records.map(r => {
      const cls = r.status === 'won' ? 'positive' : r.status === 'lost' ? 'negative' : 'pending';
      const txt = r.status === 'won' ? '已赢' : r.status === 'lost' ? '已输' : '进行中';
      return `<div class="record-item">
        <div><div class="r-league">${r.type}</div><div class="r-time">${r.time}</div></div>
        <div class="r-match">${r.team}</div>
        <div class="r-amount"><div>$${r.amount}</div><div class="${cls}">${txt}</div></div>
      </div>`;
    }).join('');
  }

  function filterRecords(filter) {
    document.querySelectorAll('#page-records .record-filter button').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    renderRecords(filter);
  }

  // ==================== PROFILE ====================
  function renderProfile() {
    if (walletAddress) {
      document.getElementById('profile-addr').textContent =
        walletAddress.substring(0, 6) + '...' + walletAddress.substring(walletAddress.length - 4);
      document.getElementById('profile-name').textContent = '1688 用户';
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
  async function connectWallet() {
    try {
      let accounts = [];
      if (typeof window.ethereum !== 'undefined') {
        accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        walletProvider = window.ethereum;
      } else if (typeof window.tpWallet !== 'undefined') {
        accounts = await window.tpWallet.request({ method: 'eth_requestAccounts' });
        walletProvider = window.tpWallet;
      } else if (typeof window.imToken !== 'undefined') {
        accounts = await window.imToken.request({ method: 'eth_requestAccounts' });
        walletProvider = window.imToken;
      } else {
        walletAddress = '0x1688' + Math.random().toString(16).substring(2, 34);
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
      walletAddress = '0x1688' + Math.random().toString(16).substring(2, 34);
      showToast('演示模式：已模拟钱包连接');
      updateWalletUI();
      renderProfile();
    }
  }

  function updateWalletUI() {
    const btn = document.getElementById('wallet-btn');
    const addrSpan = document.getElementById('wallet-addr');
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
    localStorage.setItem('1688_lang', lang);
    document.querySelectorAll('.lang-option').forEach(o => o.classList.remove('selected'));
    document.querySelector(`.lang-option[data-lang="${lang}"]`).classList.add('selected');
    closeLangModal();
    showToast('语言已切换');
  }

  // ==================== UTILS ====================
  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message; toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => toast.classList.remove('show'), 2000);
  }

  function saveData() {
    try { localStorage.setItem('1688_bet_records', JSON.stringify(betRecords)); localStorage.setItem('1688_balance', userBalance); } catch(e) {}
  }
  function loadData() {
    try { const r = localStorage.getItem('1688_bet_records'); if (r) betRecords = JSON.parse(r); userBalance = +localStorage.getItem('1688_balance') || 0; } catch(e) {}
  }

  // ==================== COUNTDOWN ====================
  function updateCountdown() {
    const el = document.getElementById('countdown');
    if (!el) return;
    const diff = new Date('2026-06-11T00:00:00').getTime() - Date.now();
    if (diff <= 0) { el.textContent = '世界杯已开幕！'; return; }
    const d = Math.floor(diff/86400000), h = Math.floor((diff%86400000)/3600000);
    const m = Math.floor((diff%3600000)/60000), s = Math.floor((diff%60000)/1000);
    el.textContent = `世界杯倒计时：${d}天${h}小时${m}分${s}秒`;
  }

  // ==================== INIT ====================
  async function init() {
    loadData();
    const savedLang = localStorage.getItem('1688_lang');
    if (savedLang) {
      currentLang = savedLang;
      document.querySelectorAll('.lang-option').forEach(o => o.classList.remove('selected'));
      const opt = document.querySelector(`.lang-option[data-lang="${savedLang}"]`);
      if (opt) opt.classList.add('selected');
    }

    // Probe API
    apiAvailable = !!(await apiCall('/status'));

    // Dialogs
    document.getElementById('bet-dialog-overlay').addEventListener('click', function(e) { if (e.target === this) closeBetDialog(); });
    document.getElementById('lang-modal').addEventListener('click', function(e) { if (e.target.classList.contains('lang-modal-mask')) closeLangModal(); });
    document.querySelectorAll('.quick-amounts button').forEach(btn => {
      btn.addEventListener('click', function() { document.getElementById('bet-amount-input').value = this.dataset.amount; updateBetProfit(); });
    });
    document.getElementById('bet-amount-input').addEventListener('input', updateBetProfit);
    document.getElementById('btn-confirm-bet').addEventListener('click', confirmBet);
    document.getElementById('btn-cancel-bet').addEventListener('click', closeBetDialog);

    renderMatchCards();
    renderChampionBet();
    renderRecords('all');
    renderProfile();
    updateCountdown();
    setInterval(updateCountdown, 1000);
  }

  window.app = { navigateTo, switchTab, openBetDialog, closeBetDialog, confirmBet, loadMatchDetail, quickBet, filterRecords, connectWallet, toggleWallet, openLangModal, closeLangModal, setLanguage, updateBetProfit };
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
