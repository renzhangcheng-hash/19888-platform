// 19888 Web3/DApp Module — Multi-chain (Sepolia + Mainnet)
(function() {
  'use strict';

  // ===== CHAIN CONFIGS =====
  const CHAINS = {
    sepolia: {
      chainId: 11155111,
      chainIdHex: '0xaa36a7',
      name: 'Sepolia Testnet',
      rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
      explorer: 'https://sepolia.etherscan.io',
      currency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      contracts: {
        MockUSDT:  '0x98f1609261A1BE6B25e33FBDBa409dF93CD083cf',
        LuckyPool: '0x02fda9c22d6f8733bA507Ed1019d67571626e9DA',
        AntiScoreBet: '0x865C5C27c75eFE75a18EBC0B51F2CA0aEb6597aD',
        ChampionBet: '0x938246dee823cEFe5574E4d195EfAD0467b2ED71',
      },
    },
    mainnet: {
      chainId: 56,
      chainIdHex: '0x38',
      name: 'BSC Mainnet',
      rpcUrl: 'https://bsc-dataseed.binance.org',
      explorer: 'https://bscscan.com',
      currency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
      contracts: {
        // BSC Mainnet — deployed 2026-06-13
        MockUSDT:  '0x55d398326f99059fF775485246999027B3197955', // BSC real USDT
        LuckyPool: '0x07Dbf04Db72Ebd0D6a9488cC90934B046C2092e2',
        AntiScoreBet: '0xc7aE31441B72D40F7EAc9AFBc6adC30D8692caEd',
        ChampionBet: '0xeBF0EcF53c420C3cA85e20f51e13eb5C51BfCF3a',
      },
    },
  };

  // Default to Sepolia for development, switchable via localStorage
  let activeChain = localStorage.getItem('19888_chain') || 'mainnet';
  function getConfig() {
    return CHAINS[activeChain] || CHAINS.sepolia;
  }

  // Legacy compat
  const CHAIN_ID = getConfig().chainId;
  const RPC_URL = getConfig().rpcUrl;
  const CONTRACTS = getConfig().contracts;

  // ===== MINIMAL ABIs =====
  const ERC20_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function balanceOf(address account) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function transfer(address to, uint256 amount) returns (bool)",
  ];

  const LuckyPool_ABI = [
    "function deposit(uint256 amount)",
    "function withdraw(uint256 amount)",
    "function userBalance(address) view returns (uint256)",
    "function usdt() view returns (address)",
    "function poolBalance() view returns (uint256)",
    "function paused() view returns (bool)",
  ];

  const AntiScoreBet_ABI = [
    "function placeBet(uint256 matchId, uint8 cell, uint256 amount)",
    "function betCount() view returns (uint256)",
    "function bets(uint256) view returns (address user, uint256 matchId, uint8 cell, uint256 amount, uint256 odds, uint256 timestamp, bool settled, bool won, uint256 payout, uint256)",
    "function minBet() view returns (uint256)",
    "function matches(uint256) view returns (uint256 id, string home, string away, uint256 startTime, uint8 finalCell, bool settled, bool)",
  ];

  const ChampionBet_ABI = [
    "function placeBet(uint256 teamId, uint8 betType, uint256 amount)",
    "function betCount() view returns (uint256)",
    "function bets(uint256) view returns (address user, uint256 teamId, uint8 betType, uint256 amount, uint256 odds, uint256 timestamp, bool settled, bool won)",
  ];

  // ===== STATE =====
  let walletProvider = null;
  let walletAddress = null;
  let currentChainId = null;
  let contracts = {};

  // ===== PUBLIC API =====
  window.dapp = {
    get walletAddress() { return walletAddress; },
    get contracts() { return contracts; },
    get CONTRACTS() { return getConfig().contracts; },
    get activeChain() { return activeChain; },
    getConfig() { return getConfig(); },

    // ===== NETWORK MANAGEMENT =====

    // Get available chains
    getChains() { return CHAINS; },

    // Switch active chain (persists to localStorage)
    async switchNetwork(network) {
      if (!CHAINS[network]) return false;
      activeChain = network;
      localStorage.setItem('19888_chain', network);
      // Reload contracts with new config
      if (walletAddress) {
        await this._initContracts();
      }
      window.dispatchEvent(new CustomEvent('dapp:networkChanged', { detail: { network } }));
      return true;
    },

    // Get current chain config
    getConfig() { return getConfig(); },

    // ===== WALLET CONNECTION =====

    async connect() {
      try {
        walletProvider = await detectWallet();
        if (!walletProvider) {
          return { success: false, error: '未检测到钱包。请安装MetaMask，或在TP Wallet内置浏览器中打开。' };
        }

        const accounts = await walletProvider.request({ method: 'eth_requestAccounts' });
        walletAddress = accounts[0];
        currentChainId = parseInt(await walletProvider.request({ method: 'eth_chainId' }), 16);

        // Wait for contract init (ethers v6 BrowserProvider)
        await this._initContracts();

        walletProvider.on('accountsChanged', function(acc) {
          walletAddress = acc[0] || null;
          updateWalletUI();
          window.dispatchEvent(new CustomEvent('dapp:accountChanged', { detail: { address: walletAddress } }));
        });
        walletProvider.on('chainChanged', function(_chainId) {
          currentChainId = parseInt(_chainId, 16);
          window.dispatchEvent(new CustomEvent('dapp:chainChanged', { detail: { chainId: currentChainId } }));
        });

        updateWalletUI();
        return { success: true, address: walletAddress, chainId: currentChainId };
      } catch (e) {
        console.error('Wallet connect error:', e.message);
        return { success: false, error: e.message || '连接失败' };
      }
    },

    async _initContracts() {
      if (!walletProvider || !walletAddress) return;
      const cfg = getConfig();
      if (!cfg.contracts.MockUSDT) return;
      try {
        const ethersProvider = new ethers.BrowserProvider(walletProvider);
        const signer = await ethersProvider.getSigner();
        contracts.usdt = new ethers.Contract(cfg.contracts.MockUSDT, ERC20_ABI, signer);
        contracts.pool = new ethers.Contract(cfg.contracts.LuckyPool, LuckyPool_ABI, signer);
        contracts.bet = new ethers.Contract(cfg.contracts.AntiScoreBet, AntiScoreBet_ABI, signer);
        contracts.champion = new ethers.Contract(cfg.contracts.ChampionBet, ChampionBet_ABI, signer);
      } catch(e) {
        console.error('合约初始化失败:', e.message);
      }
    },

    // Switch wallet to target chain
    async switchChain(targetNetwork) {
      const network = targetNetwork || activeChain;
      const cfg = CHAINS[network];
      if (!walletProvider || !cfg) return false;
      try {
        await walletProvider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: cfg.chainIdHex }],
        });
        return true;
      } catch (e) {
        if (e.code === 4902) {
          try {
            await walletProvider.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: cfg.chainIdHex,
                chainName: cfg.name,
                rpcUrls: [cfg.rpcUrl],
                nativeCurrency: cfg.currency,
                blockExplorerUrls: [cfg.explorer],
              }],
            });
            return true;
          } catch (e2) { return false; }
        }
        return false;
      }
    },

    disconnect() {
      walletProvider = null;
      walletAddress = null;
      contracts = {};
      updateWalletUI();
      window.dispatchEvent(new CustomEvent('dapp:accountChanged', { detail: { address: null } }));
    },

    // ===== BALANCE QUERIES =====

    async getUSDTBalance() {
      if (!walletAddress || !contracts.usdt) return '0';
      try {
        const bal = await contracts.usdt.balanceOf(walletAddress);
        return ethers.formatUnits(bal, 18);
      } catch { return '0'; }
    },

    async getPoolBalance() {
      if (!contracts.pool || !walletAddress) return '0';
      try {
        const bal = await contracts.pool.userBalance(walletAddress);
        return ethers.formatUnits(bal, 18);
      } catch { return '0'; }
    },

    async refreshBalances() {
      const usdtBal = await this.getUSDTBalance();
      const poolBal = await this.getPoolBalance();
      window.dispatchEvent(new CustomEvent('dapp:balancesUpdated', {
        detail: { usdt: usdtBal, pool: poolBal }
      }));
      return { usdt: usdtBal, pool: poolBal };
    },

    // ===== ALLOWANCE & APPROVAL =====

    async approveUSDT(amount) {
      if (!contracts.usdt) throw new Error('请先连接钱包');
      const cfg = getConfig();
      const amountWei = ethers.parseUnits(amount, 18);
      const tx = await contracts.usdt.approve(cfg.contracts.LuckyPool, amountWei);
      await tx.wait();
      return tx;
    },

    async checkAllowance() {
      if (!walletAddress || !contracts.usdt) return '0';
      try {
        const cfg = getConfig();
        const allowance = await contracts.usdt.allowance(walletAddress, cfg.contracts.LuckyPool);
        return ethers.formatUnits(allowance, 18);
      } catch { return '0'; }
    },

    // ===== DEPOSIT / WITHDRAW =====

    async deposit(amount) {
      if (!contracts.pool) throw new Error('请先连接钱包');
      const cfg = getConfig();
      const amountWei = ethers.parseUnits(amount, 18);
      const allowance = await contracts.usdt.allowance(walletAddress, cfg.contracts.LuckyPool);
      if (allowance < amountWei) {
        const appTx = await contracts.usdt.approve(cfg.contracts.LuckyPool, amountWei);
        await appTx.wait();
      }
      const tx = await contracts.pool.deposit(amountWei);
      await tx.wait();
      await this.refreshBalances();
      return tx;
    },

    async withdraw(amount) {
      if (!contracts.pool) throw new Error('请先连接钱包');
      const amountWei = ethers.parseUnits(amount, 18);
      const tx = await contracts.pool.withdraw(amountWei);
      await tx.wait();
      await this.refreshBalances();
      return tx;
    },

    // ===== DEPOSIT FLOW =====

    showDepositModal() {
      const modal = document.getElementById('depositModal');
      if (!modal) return;
      const input = document.getElementById('depositAmount');
      if (input) input.value = '100';
      modal.style.display = 'flex';
      const quickBtns = modal.querySelectorAll('.quick-amount');
      quickBtns.forEach(function(btn) {
        btn.onclick = function() {
          const amt = this.getAttribute('data-amt');
          if (input) input.value = amt;
        };
      });
    },

    hideDepositModal() {
      const modal = document.getElementById('depositModal');
      if (modal) modal.style.display = 'none';
    },

    showWithdrawModal() {
      const modal = document.getElementById('withdrawModal');
      if (!modal) return;
      const input = document.getElementById('withdrawAmount');
      if (input) input.value = '';
      modal.style.display = 'flex';
    },

    hideWithdrawModal() {
      const modal = document.getElementById('withdrawModal');
      if (modal) modal.style.display = 'none';
    },

    // ===== BETTING =====

    async executeDeposit(amount) {
      if (!walletAddress) throw new Error('请先连接钱包');
      if (!amount || isNaN(amount) || amount <= 0) throw new Error('请输入有效金额');
      try {
        window.dispatchEvent(new CustomEvent('dapp:txStatus', { detail: { status: 'approving', message: '正在授权 USDT...' } }));
        const appTx = await this.approveUSDT(amount + '');
        window.dispatchEvent(new CustomEvent('dapp:txStatus', { detail: { status: 'depositing', message: '正在充值...' } }));
        const depTx = await this.deposit(amount + '');
        window.dispatchEvent(new CustomEvent('dapp:txStatus', { detail: { status: 'success', message: '充值成功', txHash: depTx.hash } }));
        await this.refreshBalances();
        return { success: true, txHash: depTx.hash };
      } catch (e) {
        window.dispatchEvent(new CustomEvent('dapp:txStatus', { detail: { status: 'error', message: e.reason || e.message || '充值失败' } }));
        throw e;
      }
    },

    async executeWithdraw(amount) {
      if (!walletAddress) throw new Error('请先连接钱包');
      if (!amount || isNaN(amount) || amount <= 0) throw new Error('请输入有效金额');
      try {
        window.dispatchEvent(new CustomEvent('dapp:txStatus', { detail: { status: 'withdrawing', message: '正在提现...' } }));
        const tx = await this.withdraw(amount + '');
        window.dispatchEvent(new CustomEvent('dapp:txStatus', { detail: { status: 'success', message: '提现成功', txHash: tx.hash } }));
        await this.refreshBalances();
        this.hideWithdrawModal();
        return { success: true, txHash: tx.hash };
      } catch (e) {
        window.dispatchEvent(new CustomEvent('dapp:txStatus', { detail: { status: 'error', message: e.reason || e.message || '提现失败' } }));
        throw e;
      }
    },

    async placeBet(matchId, cellIndex, amount) {
      if (!contracts.bet) throw new Error('请先连接钱包');
      const amountWei = ethers.parseUnits(amount, 18);
      const tx = await contracts.bet.placeBet(matchId, cellIndex, amountWei);
      await tx.wait();
      return tx;
    },

    async placeChampionBet(teamId, betType, amount) {
      if (!contracts.champion) throw new Error('请先连接钱包');
      const amountWei = ethers.parseUnits(amount, 18);
      const tx = await contracts.champion.placeBet(teamId, betType, amountWei);
      await tx.wait();
      return tx;
    },

    async getUserBets() {
      if (!contracts.bet || !walletAddress) return [];
      try {
        const count = await contracts.bet.betCount();
        const bets = [];
        for (let i = Number(count) - 1; i >= 0 && bets.length < 20; i--) {
          try {
            const b = await contracts.bet.bets(i);
            if (b.user.toLowerCase() === walletAddress.toLowerCase()) {
              bets.push({
                id: i, matchId: Number(b.matchId), cell: Number(b.cell),
                amount: ethers.formatUnits(b.amount, 18),
                odds: Number(b.odds) / 10000, timestamp: Number(b.timestamp),
                settled: b.settled, won: b.won,
                payout: ethers.formatUnits(b.payout, 18),
              });
            }
          } catch { continue; }
        }
        return bets;
      } catch { return []; }
    },

    async getUserChampionBets() {
      if (!contracts.champion || !walletAddress) return [];
      try {
        const count = await contracts.champion.betCount();
        const bets = [];
        for (let i = Number(count) - 1; i >= 0 && bets.length < 20; i--) {
          try {
            const b = await contracts.champion.bets(i);
            if (b.user.toLowerCase() === walletAddress.toLowerCase()) {
              bets.push({
                id: i, teamId: Number(b.teamId), betType: Number(b.betType),
                amount: ethers.formatUnits(b.amount, 18),
                odds: Number(b.odds) / 10000, timestamp: Number(b.timestamp),
                settled: b.settled, won: b.won,
              });
            }
          } catch { continue; }
        }
        return bets;
      } catch { return []; }
    },
  };

  // ===== HELPERS =====

  // Detect and wait for ethereum provider (handles delayed injection)
  async function detectWallet() {
    // 1. Already available
    if (typeof window.ethereum !== 'undefined') return window.ethereum;
    // 2. TokenPocket desktop extension
    if (typeof window.tp !== 'undefined' && window.tp.ethereum) return window.tp.ethereum;
    // 3. Other providers (Binance, Coinbase, etc.)
    if (typeof window.BinanceChain !== 'undefined') return window.BinanceChain;

    // 4. Wait for mobile wallet injection (TokenPocket, Trust, etc.)
    //    These inject `ethereum` asynchronously after page load
    return new Promise(function(resolve) {
      var timeout = setTimeout(function() { resolve(null); }, 5000);
      if (document.readyState === 'complete') {
        if (typeof window.ethereum !== 'undefined') { clearTimeout(timeout); resolve(window.ethereum); }
        else { clearTimeout(timeout); resolve(null); }
      } else {
        var handler = function() {
          if (typeof window.ethereum !== 'undefined') { clearTimeout(timeout); resolve(window.ethereum); }
          else { clearTimeout(timeout); resolve(null); }
        };
        document.addEventListener('DOMContentLoaded', handler);
        // Also listen for ethereum injection event
        window.addEventListener('ethereum#initialized', handler, { once: true });
      }
    });
  }

  function updateWalletUI() {
    const btn = document.getElementById('walletBtn');
    const addrEl = document.getElementById('walletAddress');
    if (!btn || !addrEl) return;
    if (walletAddress) {
      addrEl.textContent = walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4);
      btn.classList.add('connected');
    } else {
      addrEl.textContent = '';
      btn.classList.remove('connected');
    }
  }

  // ===== MODAL CLOSE LISTENERS =====
  document.addEventListener('DOMContentLoaded', function() {
    var depositCancel = document.getElementById('depositCancel');
    if (depositCancel) depositCancel.addEventListener('click', function() { window.dapp.hideDepositModal(); });
    var depositModal = document.getElementById('depositModal');
    if (depositModal) depositModal.addEventListener('click', function(e) { if (e.target === depositModal) window.dapp.hideDepositModal(); });
    var withdrawCancel = document.getElementById('withdrawCancel');
    if (withdrawCancel) withdrawCancel.addEventListener('click', function() { window.dapp.hideWithdrawModal(); });
    var withdrawModal = document.getElementById('withdrawModal');
    if (withdrawModal) withdrawModal.addEventListener('click', function(e) { if (e.target === withdrawModal) window.dapp.hideWithdrawModal(); });
  });

  // ============================================================
  // DAPP UX MODULE — Network / Gas / Tx Toast / Mobile Links
  // ============================================================

  // --- Network detection + auto-prompt ---
  function checkNetworkOnConnect() {
    if (!walletAddress || !activeChain) return;
    var expectedChainId = getConfig().chainId;
    if (currentChainId !== expectedChainId) {
      showTxToast({
        type: 'warning',
        title: '网络不匹配',
        msg: '当前连接 ' + (CHAINS.mainnet.chainId === currentChainId ? 'BSC主网' : '其他网络') + '，请切换到BSC主网',
        action: { text: '切换网络', fn: function() { window.dapp.switchChain('mainnet'); } }
      });
    }
  }
  window.addEventListener('dapp:chainChanged', checkNetworkOnConnect);

  // --- Transaction Toast (loading→success/failure) ---
  var txToastTimer = null;
  function showTxToast(opts) {
    var el = document.getElementById('txToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'txToast';
      el.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);z-index:10000;max-width:340px;width:90%;padding:14px 18px;border-radius:12px;background:var(--surface,#fff);box-shadow:var(--shadow-md);display:flex;align-items:flex-start;gap:12px;font-size:14px;line-height:1.5;transition:transform .25s ease,opacity .25s ease;opacity:0;pointer-events:none';
      document.body.appendChild(el);
    }
    clearTimeout(txToastTimer);
    var icon = opts.type === 'loading' ? '⏳' : opts.type === 'success' ? '✅' : opts.type === 'error' ? '❌' : '⚠️';
    var bg = opts.type === 'error' ? '#FEF2F2' : opts.type === 'success' ? '#F0FDF4' : opts.type === 'warning' ? '#FFFBEB' : '#EFF6FF';
    el.innerHTML = '<span style="font-size:20px;flex-shrink:0">'+icon+'</span><div style="flex:1"><div style="font-weight:600;margin-bottom:2px">'+opts.title+'</div><div style="color:var(--text-light);font-size:13px">'+opts.msg+'</div>'+(opts.link?'<a href="'+opts.link+'" target="_blank" style="color:var(--primary);font-size:12px;font-weight:500">查看交易 ↗</a>':'')+'</div>'+(opts.action?'<button style="flex-shrink:0;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;border:none;background:var(--primary);color:#fff;cursor:pointer">'+opts.action.text+'</button>':'');
    el.style.background = bg;
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(10px)';
    el.style.pointerEvents = opts.action ? 'auto' : 'none';
    if (opts.action) el.querySelector('button').onclick = opts.action.fn;
    requestAnimationFrame(function() {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
    if (!opts.persist) {
      txToastTimer = setTimeout(function() {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(10px)';
      }, opts.duration || 5000);
    }
  }

  // --- Transaction wrapper with loading/success/error ---
  async function withTxToast(promise, opts) {
    showTxToast({
      type: 'loading',
      title: opts.title || '交易确认中',
      msg: '请在钱包中确认交易...',
      persist: true
    });
    try {
      var tx = await promise;
      showTxToast({
        type: 'loading', title: '交易已提交',
        msg: '等待区块确认中...',
        persist: true
      });
      var receipt = await tx.wait();
      var explorerUrl = getConfig().explorer + '/tx/' + tx.hash;
      showTxToast({
        type: 'success',
        title: opts.success || '交易成功',
        msg: (opts.successMsg || '') + '',
        link: explorerUrl,
        duration: 8000
      });
      return { success: true, tx: tx, receipt: receipt };
    } catch (e) {
      var errMsg = parseTxError(e);
      showTxToast({
        type: 'error',
        title: '交易失败',
        msg: errMsg,
        duration: 8000
      });
      return { success: false, error: errMsg };
    }
  }

  // --- User-friendly error messages ---
  function parseTxError(e) {
    var msg = (e.reason || e.message || '').toLowerCase();
    if (msg.includes('user rejected') || msg.includes('user denied')) return '你在钱包中取消了交易';
    if (msg.includes('insufficient funds')) return '余额不足，请充值后重试';
    if (msg.includes('gas required exceeds')) return 'Gas费不足，请确保钱包有足够的BNB';
    if (msg.includes('nonce too low')) return '交易顺序错误，请刷新页面重试';
    if (msg.includes('internal json-rpc')) return '网络异常，请检查RPC连接';
    if (msg.includes('call exception')) return '合约调用失败，请检查参数';
    return e.reason || e.message || '未知错误';
  }

  // --- Mobile wallet deep links ---
  function getMobileWalletDeepLink() {
    var ua = navigator.userAgent || '';
    var dappUrl = encodeURIComponent(window.location.origin);
    if (ua.includes('TokenPocket') || ua.includes('TPWallet')) {
      return null; // Already in TP Wallet dapp browser
    }
    if (ua.includes('TrustWallet') || ua.includes('Trust')) {
      return 'https://link.trustwallet.com/open_url?coin_id=20000714&url=' + dappUrl;
    }
    if (ua.includes('MetaMask') || ua.includes('Mobile')) {
      return 'https://metamask.app.link/dapp/' + window.location.host;
    }
    return null;
  }

  // --- Network badge (injected by app.js when needed) ---
  function injectNetworkBadge() {
    var el = document.getElementById('networkBadge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'networkBadge';
      el.style.cssText = 'position:fixed;top:50px;right:12px;z-index:9999;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;pointer-events:none;transition:all .3s';
      document.body.appendChild(el);
    }
    if (activeChain === 'mainnet' && currentChainId === 56) {
      el.textContent = 'BSC';
      el.style.background = '#F0FDF4'; el.style.color = '#16A34A';
    } else if (activeChain === 'sepolia') {
      el.textContent = '测试网';
      el.style.background = '#FFFBEB'; el.style.color = '#D97706';
    } else {
      el.textContent = '⚠ 错误网络';
      el.style.background = '#FEF2F2'; el.style.color = '#DC2626';
    }
  }
  window.addEventListener('dapp:chainChanged', injectNetworkBadge);
  window.addEventListener('dapp:accountChanged', function() {
    if (walletAddress) injectNetworkBadge();
    else { var b = document.getElementById('networkBadge'); if (b) b.remove(); }
  });

  // --- Expose to window.dapp ---
  var _origConnect = window.dapp.connect;
  window.dapp.connect = async function() {
    var result = await _origConnect.call(window.dapp);
    if (result.success) {
      injectNetworkBadge();
      checkNetworkOnConnect();
    }
    return result;
  };
  window.dapp.withTxToast = withTxToast;
  window.dapp.showTxToast = showTxToast;
  window.dapp.getMobileDeepLink = getMobileWalletDeepLink;
  window.dapp.injectNetworkBadge = injectNetworkBadge;
  window.dapp.parseTxError = parseTxError;

})();
