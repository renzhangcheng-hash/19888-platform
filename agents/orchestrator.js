/**
 * ═══════════════════════════════════════════════════════════
 *  19888 Agent #5 — Agent协调器 (Orchestrator)
 *  职责: 管理所有Agent生命周期、调度、通信、监控
 *  模式: 多Agent协作 (Council模式)
 * ═══════════════════════════════════════════════════════════
 */

class AgentOrchestrator {
  constructor() {
    this.name = 'Orchestrator';
    this.version = '1.0.0';
    this.agents = new Map();
    this.status = 'INITIALIZING';
    this.startTime = Date.now();
  }

  /**
   * 注册Agent
   */
  register(agent) {
    this.agents.set(agent.name, agent);
    console.log(`[Orch] Agent ${agent.name} v${agent.version} 注册成功`);
  }

  /**
   * 获取Agent
   */
  get(name) {
    return this.agents.get(name);
  }

  /**
   * 全部Agent状态
   */
  getAllStatus() {
    const statuses = {};
    for (const [name, agent] of this.agents) {
      try {
        statuses[name] = agent.getStatus();
      } catch (e) {
        statuses[name] = { error: e.message };
      }
    }
    return {
      orchestrator: this.name,
      version: this.version,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      agents: statuses,
      agentCount: this.agents.size
    };
  }

  /**
   * 交易全流程 (所有Agent参与)
   */
  async processTransaction(tx) {
    const report = { tx, stages: {}, passed: true };
    
    // Stage 1: 风控检查
    const riskAgent = this.get('Risk');
    if (riskAgent) {
      const riskResult = riskAgent.checkTransaction(tx);
      report.stages.risk = riskResult;
      if (!riskResult.pass) {
        report.passed = false;
        return report;
      }
    }
    
    // Stage 2: 合约安全检查
    const guardian = this.get('Guardian');
    if (guardian) {
      const guardResult = guardian.validateTransaction(tx);
      report.stages.guardian = guardResult;
      if (!guardResult.pass) {
        report.passed = false;
        return report;
      }
    }
    
    // Stage 3: UX状态转换
    const chainUX = this.get('ChainUX');
    if (chainUX) {
      chainUX.transitionTx('BROADCASTING');
    }
    
    return report;
  }

  /**
   * 定时巡检 (所有Agent)
   */
  async patrol() {
    const results = {};
    
    const guardian = this.get('Guardian');
    if (guardian) results.guardian = await guardian.patrol();
    
    const risk = this.get('Risk');
    if (risk) results.risk = risk.dailyReport();
    
    return results;
  }
}

// ── 单例 ──
let instance = null;
function getOrchestrator() {
  if (!instance) instance = new AgentOrchestrator();
  return instance;
}

if (typeof module !== 'undefined') {
  module.exports = { AgentOrchestrator, getOrchestrator };
}
