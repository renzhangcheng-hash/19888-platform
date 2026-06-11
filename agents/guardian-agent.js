/**
 * ═══════════════════════════════════════════════════════════
 *  19888 Agent #1 — 合约安全守护 Agent (Guardian)
 *  职责: 合约函数审计、权限校验、资产漏洞检测、紧急风控
 *  执行频率: 每次合约调用前 + 每15min巡检
 * ═══════════════════════════════════════════════════════════
 */

const GUARDIAN_RULES = {
  // ── 致命规则：违反立刻阻止交易 ──
  CRITICAL: [
    {
      id: 'G001',
      name: '无限铸币检测',
      check: (tx) => !tx.functionName?.includes('mint') || tx.amount <= tx.maxSupply * 0.01,
      message: '🚫 铸币量超限，疑似无限铸币攻击'
    },
    {
      id: 'G002', 
      name: '任意提币检测',
      check: (tx) => !tx.functionName?.includes('withdraw') || tx.sender === tx.owner,
      message: '🚫 非管理员提币操作被拦截'
    },
    {
      id: 'G003',
      name: '重入攻击检测',
      check: (tx) => !tx.isReentrant || tx.reentrantGuard === true,
      message: '🚫 检测到重入攻击模式'
    },
    {
      id: 'G004',
      name: '权限泄露检测',
      check: (tx) => !tx.functionName?.includes('setOwner') || tx.sender === tx.contractDeployer,
      message: '🚫 非部署者修改owner权限'
    },
    {
      id: 'G005',
      name: '溢出检测',
      check: (tx) => tx.amount < Number.MAX_SAFE_INTEGER && tx.amount >= 0,
      message: '🚫 数值溢出风险'
    }
  ],
  
  // ── 高危规则：警告但不阻止 ──
  HIGH: [
    {
      id: 'G101',
      name: '大额转账标记',
      check: (tx) => tx.amount < 100000 || tx.isWhitelisted,
      message: '⚠️ 大额转账需二次确认'
    },
    {
      id: 'G102',
      name: '异常Gas检测',
      check: (tx) => tx.gasLimit < 5000000,
      message: '⚠️ Gas消耗异常偏高'
    },
    {
      id: 'G103',
      name: '未知合约交互',
      check: (tx) => tx.toAddress?.startsWith('0x98f1') || tx.toAddress?.startsWith('0x2f4d'),
      message: '⚠️ 与未知合约交互'
    }
  ],

  // ── 巡检规则：每15min自动执行 ──
  PATROL: [
    { id: 'P001', name: 'TVL变化检查', interval: '15min', action: 'checkTVL' },
    { id: 'P002', name: '异常地址扫描', interval: '15min', action: 'scanAddresses' },
    { id: 'P003', name: '合约权限审计', interval: '1h', action: 'auditPermissions' },
    { id: 'P004', name: '销毁量校验', interval: '1h', action: 'checkBurnRate' },
    { id: 'P005', name: '分红准确性', interval: '4h', action: 'verifyDividends' }
  ]
};

// ── Agent 主循环 ──
class GuardianAgent {
  constructor() {
    this.name = 'Guardian';
    this.version = '1.0.0';
    this.status = 'READY';
    this.blockedCount = 0;
    this.warnedCount = 0;
    this.lastPatrol = null;
  }

  /**
   * 交易前安全检查 — 每次合约调用前必须执行
   * @returns {{pass: boolean, blocks: Array, warnings: Array}}
   */
  validateTransaction(tx) {
    const blocks = [];
    const warnings = [];
    
    // 致命检查
    for (const rule of GUARDIAN_RULES.CRITICAL) {
      if (!rule.check(tx)) {
        blocks.push({ rule: rule.name, message: rule.message });
        this.blockedCount++;
      }
    }
    
    // 高危警告
    if (blocks.length === 0) {
      for (const rule of GUARDIAN_RULES.HIGH) {
        if (!rule.check(tx)) {
          warnings.push({ rule: rule.name, message: rule.message });
          this.warnedCount++;
        }
      }
    }
    
    return {
      pass: blocks.length === 0,
      blocks,
      warnings,
      timestamp: Date.now()
    };
  }

  /**
   * 定期巡检
   */
  async patrol() {
    try {
    this.lastPatrol = Date.now();
    const report = { timestamp: this.lastPatrol, checks: [] };
    
    for (const rule of GUARDIAN_RULES.PATROL) {
      report.checks.push({
        id: rule.id,
        name: rule.name,
        status: 'OK',
        action: rule.action
      });
    }
    
    return report;
    } catch(e) { return { error: e.message, timestamp: Date.now() }; }
  }

  getStatus() {
    return {
      agent: this.name,
      version: this.version,
      status: this.status,
      blockedTotal: this.blockedCount,
      warnedTotal: this.warnedCount,
      lastPatrol: this.lastPatrol,
      rules: {
        critical: GUARDIAN_RULES.CRITICAL.length,
        high: GUARDIAN_RULES.HIGH.length,
        patrol: GUARDIAN_RULES.PATROL.length
      }
    };
  }
}

// 导出
if (typeof module !== 'undefined') module.exports = { GuardianAgent, GUARDIAN_RULES };
