// 19888 Web3/DApp Module — Sepolia Contract Integration
(function() {
  'use strict';

  // ===== SEPOLIA CONFIG =====
  const CHAIN_ID = 11155111;
  const RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com';

  const CONTRACTS = {
    MockUSDT:  '0x98f1609261A1BE6B25e33FBDBa409dF93CD083cf',
    LuckyPool: '0x02fda9c22d6f8733bA507Ed1019d67571626e9DA',
    AntiScoreBet: '0x865C5C27c75eFE75a18EBC0B51F2CA0aEb6597aD',
    ChampionBet: '0x938246dee823cEFe5574E4d195EfAD0467b2ED71',
  };

  // ===== MINIMAL ABIs (only functions used by frontend) =====
  const ERC20_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function balanceOf(address account) view returns (uint256)",
    "function decimals() view returns (uint8)",
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
    get CONTRACTS() { return CONTRACTS; },

    // Connect wallet
    async connect() {
      try {
        walletProvider = await detectWallet();
        if (!walletProvider) {
          return { success: false, error: '未检测到钱包。请安装MetaMask或TP Wallet。' };
        }

        const accounts = await walletProvider.request({ method: 'eth_requestAccounts' });
        walletAddress = accounts[0];
        currentChainId = parseInt(await walletProvider.request({ method: 'eth_chainId' }), 16);
        
        // Setup contract instances
        const signer = await getSigner();
        contracts.usdt = new ethers.Contract(CONTRACTS.MockUSDT, ERC20_ABI, signer);
        contracts.pool = new ethers.Contract(CONTRACTS.LuckyPool, LuckyPool_ABI, signer);
        contracts.bet = new ethers.Contract(CONTRACTS.AntiScoreBet, AntiScoreBet_ABI, signer);
        contracts.champion = new ethers.Contract(CONTRACTS.ChampionBet, ChampionBet_ABI, signer);

        // Listen for account changes
        walletProvider.on('accountsChanged', function(acc) {
          walletAddress = acc[0] || null;
          updateWalletUI();
        });
        walletProvider.on('chainChanged', function() { window.location.reload(); });

        updateWalletUI();
        return { success: true, address: walletAddress };
      } catch (e) {
        console.error('Wallet connect error:', e.message);
        return { success: false, error: e.message || '连接失败' };
      }
    },

    // Switch to Sepolia
    async switchChain() {
      if (!walletProvider) return false;
      try {
        await walletProvider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0xaa36a7' }], // 11155111 in hex
        });
        return true;
      } catch (e) {
        if (e.code === 4902) {
          try {
            await walletProvider.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: '0xaa36a7',
                chainName: 'Sepolia',
                rpcUrls: [RPC_URL],
                nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
                blockExplorerUrls: ['https://sepolia.etherscan.io'],
              }],
            });
            return true;
          } catch (e2) { return false; }
        }
        return false;
      }
    },

    // Get USDT balance
    async getUSDTBalance() {
      if (!walletAddress || !contracts.usdt) return '0';
      try {
        const bal = await contracts.usdt.balanceOf(walletAddress);
        return ethers.formatUnits(bal, 18);
      } catch { return '0'; }
    },

    // Get pool balance
    async getPoolBalance() {
      if (!contracts.pool) return '0';
      try {
        const bal = await contracts.pool.userBalance(walletAddress);
        return ethers.formatUnits(bal, 18);
      } catch { return '0'; }
    },

    // Approve USDT
    async approveUSDT(amount) {
      if (!contracts.usdt) throw new Error('请先连接钱包');
      const amountWei = ethers.parseUnits(amount, 18);
      const tx = await contracts.usdt.approve(CONTRACTS.LuckyPool, amountWei);
      await tx.wait();
      return tx;
    },

    // Check allowance
    async checkAllowance() {
      if (!walletAddress || !contracts.usdt) return '0';
      try {
        const allowance = await contracts.usdt.allowance(walletAddress, CONTRACTS.LuckyPool);
        return ethers.formatUnits(allowance, 18);
      } catch { return '0'; }
    },

    // Deposit USDT to LuckyPool
    async deposit(amount) {
      if (!contracts.pool) throw new Error('请先连接钱包');
      const amountWei = ethers.parseUnits(amount, 18);

      // Check allowance first
      const allowance = await contracts.usdt.allowance(walletAddress, CONTRACTS.LuckyPool);
      if (allowance < amountWei) {
        // Auto-approve
        const appTx = await contracts.usdt.approve(CONTRACTS.LuckyPool, amountWei);
        await appTx.wait();
      }

      const tx = await contracts.pool.deposit(amountWei);
      await tx.wait();
      return tx;
    },

    // Place anti-score bet (18-grid)
    async placeBet(matchId, cellIndex, amount) {
      if (!contracts.bet) throw new Error('请先连接钱包');
      const amountWei = ethers.parseUnits(amount, 18);
      const tx = await contracts.bet.placeBet(matchId, cellIndex, amountWei);
      await tx.wait();
      return tx;
    },

    // Place champion bet
    async placeChampionBet(teamId, betType, amount) {
      if (!contracts.champion) throw new Error('请先连接钱包');
      const amountWei = ethers.parseUnits(amount, 18);
      const tx = await contracts.champion.placeBet(teamId, betType, amountWei);
      await tx.wait();
      return tx;
    },

    // Get user's bets
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
                id: i,
                matchId: Number(b.matchId),
                cell: Number(b.cell),
                amount: ethers.formatUnits(b.amount, 18),
                odds: Number(b.odds) / 10000,
                timestamp: Number(b.timestamp),
                settled: b.settled,
                won: b.won,
                payout: ethers.formatUnits(b.payout, 18),
              });
            }
          } catch { continue; }
        }
        return bets;
      } catch { return []; }
    },

    // Get user's champion bets
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
                id: i,
                teamId: Number(b.teamId),
                betType: Number(b.betType),
                amount: ethers.formatUnits(b.amount, 18),
                odds: Number(b.odds) / 10000,
                timestamp: Number(b.timestamp),
                settled: b.settled,
                won: b.won,
              });
            }
          } catch { continue; }
        }
        return bets;
      } catch { return []; }
    },

    // Disconnect
    disconnect() {
      walletProvider = null;
      walletAddress = null;
      contracts = {};
      updateWalletUI();
    },
  };

  // ===== HELPERS =====
  async function detectWallet() {
    if (typeof window.ethereum !== 'undefined') {
      return window.ethereum;
    }
    return null;
  }

  async function getSigner() {
    const provider = new ethers.BrowserProvider(walletProvider);
    return await provider.getSigner();
  }

  function updateWalletUI() {
    const btn = document.getElementById('walletBtn');
    const addrEl = document.getElementById('walletAddress');
    if (!btn || !addrEl) return;

    if (walletAddress) {
      const short = walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4);
      addrEl.textContent = short;
      btn.classList.add('connected');
    } else {
      addrEl.textContent = '';
      btn.classList.remove('connected');
    }
  }

})();
