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
      chainId: 1,
      chainIdHex: '0x1',
      name: 'Ethereum Mainnet',
      rpcUrl: 'https://eth.llamarpc.com',
      explorer: 'https://etherscan.io',
      currency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      contracts: {
        // TODO: Deploy contracts to mainnet and update addresses here
        MockUSDT:  '',
        LuckyPool: '',
        AntiScoreBet: '',
        ChampionBet: '',
      },
    },
  };

  // Default to Sepolia for development, switchable via localStorage
  let activeChain = localStorage.getItem('19888_chain') || 'sepolia';
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

    // ===== NETWORK MANAGEMENT =====

    // Get available chains
    getChains() { return CHAINS; },

    // Switch active chain (persists to localStorage)
    switchNetwork(network) {
      if (!CHAINS[network]) return false;
      activeChain = network;
      localStorage.setItem('19888_chain', network);
      // Reload contracts with new config
      if (walletAddress) {
        this._initContracts();
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
          return { success: false, error: '未检测到钱包。请安装MetaMask或TP Wallet。' };
        }

        const accounts = await walletProvider.request({ method: 'eth_requestAccounts' });
        walletAddress = accounts[0];
        currentChainId = parseInt(await walletProvider.request({ method: 'eth_chainId' }), 16);

        this._initContracts();

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

    _initContracts() {
      if (!walletProvider || !walletAddress) return;
      const cfg = getConfig();
      // Only init if contract addresses are set (mainnet will have empty strings until deployed)
      if (!cfg.contracts.MockUSDT) return;
      walletProvider.getSigner().then(function(signer) {
        contracts.usdt = new ethers.Contract(cfg.contracts.MockUSDT, ERC20_ABI, signer);
        contracts.pool = new ethers.Contract(cfg.contracts.LuckyPool, LuckyPool_ABI, signer);
        contracts.bet = new ethers.Contract(cfg.contracts.AntiScoreBet, AntiScoreBet_ABI, signer);
        contracts.champion = new ethers.Contract(cfg.contracts.ChampionBet, ChampionBet_ABI, signer);
      }).catch(function(){});
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
      const quickBtns = modal.querySelectorAll('.quick-amt');
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
  async function detectWallet() {
    return typeof window.ethereum !== 'undefined' ? window.ethereum : null;
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

})();
