/**
 * ═══════════════════════════════════════════════════════════
 *  19888 Agent #3 — 链数据同步 Agent (Sync)
 *  职责: 区块轮询、交易解析、事件监听、数据入库、对账
 *  执行频率: 每区块 / 每15s轮询
 * ═══════════════════════════════════════════════════════════
 */

class ChainSyncAgent {
  constructor(rpcUrl = 'https://ethereum-sepolia-rpc.publicnode.com') {
    this.name = 'ChainSync';
    this.version = '1.0.0';
    this.rpcUrl = rpcUrl;
    this.lastBlock = 0;
    this.syncedBlocks = 0;
    this.missedBlocks = 0;
    this.errors = [];
    this.contracts = [];
    this.listeners = {};
  }

  /**
   * 注册需要监听的合约
   */
  registerContract(address, abi, name) {
    this.contracts.push({ address, abi, name });
    console.log(`[Sync] 注册合约: ${name} (${address})`);
  }

  /**
   * 监听合约事件
   */
  onEvent(contractName, eventName, handler) {
    const key = `${contractName}:${eventName}`;
    this.listeners[key] = this.listeners[key] || [];
    this.listeners[key].push(handler);
  }

  /**
   * 获取当前区块高度
   */
  async getBlockNumber() {
    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1
      })
    });
    const data = await res.json();
    return parseInt(data.result, 16);
  }

  /**
   * 解析交易中的事件日志
   */
  parseEvents(txReceipt, contract) {
    const events = [];
    if (!txReceipt.logs) return events;
    
    for (const log of txReceipt.logs) {
      if (log.address && contract.address && log.address.toLowerCase() === contract.address.toLowerCase()) {
        events.push({
          contract: contract.name,
          address: log.address,
          topics: log.topics,
          data: log.data,
          blockNumber: parseInt(log.blockNumber, 16),
          transactionHash: log.transactionHash
        });
      }
    }
    return events;
  }

  /**
   * 同步单个区块
   */
  async syncBlock(blockNumber) {
    try {
      // 1. 获取区块
      const blockRes = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getBlockByNumber',
          params: ['0x' + blockNumber.toString(16), true],
          id: 1
        })
      });
      const block = (await blockRes.json()).result;
      if (!block) { this.missedBlocks++; return null; }

      // 2. 过滤合约相关交易
      const relevantTxs = [];
      for (const tx of block.transactions) {
        const toLower = (tx.to || '').toLowerCase();
        for (const contract of this.contracts) {
          if (contract.address && toLower === contract.address.toLowerCase()) {
            relevantTxs.push({ transaction: tx, contract });
            break;
          }
        }
      }

      // 3. 触发事件监听器
      for (const item of relevantTxs) {
        const input = item.transaction.input || '0x';
        const methodId = input.slice(0, 10);
        
        // 匹配事件处理器
        for (const [key, handlers] of Object.entries(this.listeners)) {
          const [contractName, eventName] = key.split(':');
          if (contractName === item.contract.name) {
            for (const handler of handlers) {
              handler({
                contract: item.contract.name,
                methodId,
                from: item.transaction.from,
                to: item.transaction.to,
                value: parseInt(item.transaction.value || '0x0', 16),
                blockNumber,
                hash: item.transaction.hash,
                timestamp: parseInt(block.timestamp, 16) * 1000
              });
            }
          }
        }
      }

      this.syncedBlocks++;
      this.lastBlock = blockNumber;
      return { blockNumber, txCount: relevantTxs.length };
    } catch (e) {
      this.missedBlocks++;
      this.errors.push({ blockNumber, error: e.message, time: Date.now() });
      return null;
    }
  }

  /**
   * 批量同步 (补块)
   */
  async syncRange(fromBlock, toBlock) {
    const results = [];
    for (let b = fromBlock; b <= toBlock; b++) {
      const result = await this.syncBlock(b);
      results.push(result);
      if (b % 10 === 0) await new Promise(r => setTimeout(r, 100)); // 限速
    }
    return results;
  }

  /**
   * 启动实时同步
   */
  async startLiveSync() {
    this.status = 'SYNCING';
    console.log('[Sync] 启动实时同步...');
    
    const poll = async () => {
      try {
        const currentBlock = await this.getBlockNumber();
        if (currentBlock > this.lastBlock) {
          for (let b = this.lastBlock + 1; b <= currentBlock; b++) {
            await this.syncBlock(b);
          }
        }
      } catch (e) {
        console.error('[Sync] 同步异常:', e.message);
      }
      this._timer = setTimeout(poll, 15000); // 15s轮询
    };
    
    this.lastBlock = await this.getBlockNumber() - 1;
    poll();
  }

  stop() {
    if (this._timer) clearTimeout(this._timer);
    this.status = 'STOPPED';
  }

  getStatus() {
    return {
      agent: this.name,
      version: this.version,
      status: this.status || 'IDLE',
      lastBlock: this.lastBlock,
      syncedBlocks: this.syncedBlocks,
      missedBlocks: this.missedBlocks,
      contracts: this.contracts.length,
      listeners: Object.keys(this.listeners).length,
      recentErrors: this.errors.slice(-5)
    };
  }
}

if (typeof module !== 'undefined') module.exports = { ChainSyncAgent };
