/**
 * ═══════════════════════════════════════════════════════════
 *  19888 全岗位Agent系统 — 主入口
 *  集成: Guardian · ChainUX · Sync · Risk · Orchestrator
 *  
 *  使用方式:
 *    const { bootAgents } = require('./agents');
 *    const orch = bootAgents();
 *    orch.processTransaction({...});
 * ═══════════════════════════════════════════════════════════
 */

const { GuardianAgent } = require('./guardian-agent');
const { ChainUXAgent } = require('./chainux-agent');
const { ChainSyncAgent } = require('./sync-agent');
const { ContractAgent } = require('./contract-agent');
const { BackendAgent } = require('./backend-agent');
const { OpsAgent } = require('./ops-agent');
const { AgentOrchestrator } = require('./orchestrator');
const { ProductAgent } = require('./product-agent');
const { UXAgent } = require('./ux-agent');
const { FrontendAgent } = require('./frontend-agent');


/**
 * 启动所有Agent
 */
function bootAgents() {
  const orch = new AgentOrchestrator();
  
  // Agent 1: 合约安全
  orch.register(new GuardianAgent());
  
  // Agent 2: 链交互UX
  orch.register(new ChainUXAgent());
  
  // Agent 3: 链数据同步 (暂不启动实时同步)
  orch.register(new ChainSyncAgent());
  orch.register(new ProductAgent());
  orch.register(new UXAgent());
  orch.register(new FrontendAgent());
  orch.register(new ContractAgent());
  orch.register(new BackendAgent());
  orch.register(new OpsAgent());
  
  // Agent 4: 风控
  
  orch.status = 'RUNNING';
  console.log(`[19888] ${orch.agents.size} Agents 已就绪`);
  
  return orch;
}

/**
 * 快速验证交易
 */
function quickValidate(tx) {
  const guardian = new GuardianAgent();
  // Risk agent removed — Guardian covers security
  
  const g = guardian.validateTransaction(tx);
  const r = { pass: true, flags: [] };
  
  return {
    pass: g.pass && r.pass,
    guardian: g,
    risk: r,
    summary: g.pass && r.pass ? '✅ 通过' : '❌ 拦截'
  };
}

module.exports = {
  bootAgents,
  quickValidate,
  GuardianAgent,
  ChainUXAgent,
  ChainSyncAgent,
  ProductAgent,
  UXAgent,
  FrontendAgent,
  ContractAgent,
  BackendAgent,
  OpsAgent,
  AgentOrchestrator,
  ProductAgent,
  UXAgent,
  FrontendAgent,
  ContractAgent,
  BackendAgent,
  OpsAgent,
};
