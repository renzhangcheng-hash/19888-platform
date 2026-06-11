/**
 * ═══════════════════════════════════════════════════════════
 *  19888 Agent #2 — 链交互状态机 Agent (ChainUX)
 *  职责: 管理所有DApp交互状态、钱包链路、链切换、交易全生命周期
 *  状态数: 52种 (钱包12 + 链切换6 + 授权8 + 交易18 + 资产8)
 * ═══════════════════════════════════════════════════════════
 */

// ── 钱包状态机 (12态) ──
const WALLET_STATES = {
  DISCONNECTED:    { code: 'W00', label: '未连接钱包',       icon: '🔌', action: 'connect' },
  CONNECTING:      { code: 'W01', label: '连接中...',         icon: '⏳', action: 'wait' },
  CONNECTED:       { code: 'W02', label: '已连接',            icon: '✅', action: 'ready' },
  REJECTED:        { code: 'W03', label: '连接被拒绝',        icon: '❌', action: 'retry' },
  DISCONNECTING:   { code: 'W04', label: '断开中...',         icon: '⏳', action: 'wait' },
  RECONNECTING:    { code: 'W05', label: '自动重连中...',     icon: '🔄', action: 'wait' },
  LOCKED:          { code: 'W06', label: '钱包已锁定',        icon: '🔒', action: 'unlock' },
  WRONG_NETWORK:   { code: 'W07', label: '网络不匹配',        icon: '⚠️', action: 'switch' },
  MULTI_WALLET:    { code: 'W08', label: '检测到多钱包',      icon: '🔀', action: 'select' },
  EXPIRED:         { code: 'W09', label: '会话已过期',        icon: '⏰', action: 'reconnect' },
  ERROR:           { code: 'W10', label: '钱包异常',          icon: '💥', action: 'retry' },
  UPGRADE_NEEDED:  { code: 'W11', label: '请升级钱包版本',    icon: '📦', action: 'upgrade' }
};

// ── 链切换状态机 (6态) ──
const CHAIN_STATES = {
  CORRECT:        { code: 'C00', label: '已在正确网络',       action: 'ready' },
  DETECTING:      { code: 'C01', label: '检测网络中...',     action: 'wait' },
  WRONG:          { code: 'C02', label: '请切换到Sepolia',   action: 'prompt' },
  SWITCHING:      { code: 'C03', label: '切换中...',          action: 'wait' },
  ADDING:         { code: 'C04', label: '添加网络中...',     action: 'wait' },
  UNSUPPORTED:    { code: 'C05', label: '不支持的链',         action: 'block' }
};

// ── 授权状态机 (8态) ──
const APPROVAL_STATES = {
  NONE:           { code: 'A00', label: '未授权',             action: 'approve' },
  REQUESTING:     { code: 'A01', label: '请求授权中...',     action: 'wait' },
  APPROVED:       { code: 'A02', label: '已授权',            action: 'ready' },
  INSUFFICIENT:   { code: 'A03', label: '授权额度不足',      action: 'reapprove' },
  UNLIMITED_WARN: { code: 'A04', label: '⚠️ 无限授权风险',   action: 'warn' },
  REJECTED:       { code: 'A05', label: '授权被拒绝',        action: 'retry' },
  REVOKING:       { code: 'A06', label: '取消授权中...',     action: 'wait' },
  REVOKED:        { code: 'A07', label: '已取消授权',        action: 'approve' }
};

// ── 交易全生命周期状态机 (18态) ──
const TX_STATES = {
  IDLE:            { code: 'T00', label: '待提交',            progress: 0 },
  VALIDATING:      { code: 'T01', label: '参数校验中...',     progress: 5 },
  BUILDING:        { code: 'T02', label: '构建交易中...',     progress: 10 },
  AWAITING_SIGN:   { code: 'T03', label: '请在钱包中签名',    progress: 15 },
  SIGN_REJECTED:   { code: 'T04', label: '签名已取消',        progress: 0, isError: true },
  SIGNED:          { code: 'T05', label: '已签名',            progress: 25 },
  BROADCASTING:    { code: 'T06', label: '广播交易中...',     progress: 30 },
  BROADCASTED:     { code: 'T07', label: '已广播',            progress: 40 },
  PENDING_1:       { code: 'T08', label: '确认中 1/3',        progress: 50 },
  PENDING_2:       { code: 'T09', label: '确认中 2/3',        progress: 65 },
  PENDING_3:       { code: 'T10', label: '确认中 3/3',        progress: 80 },
  CONFIRMED:       { code: 'T11', label: '✅ 交易成功',        progress: 100 },
  FAILED_REVERT:   { code: 'T12', label: '合约执行失败',      progress: 0, isError: true },
  FAILED_GAS:      { code: 'T13', label: 'Gas不足',           progress: 0, isError: true },
  FAILED_SLIPPAGE: { code: 'T14', label: '滑点过高',          progress: 0, isError: true },
  FAILED_TIMEOUT:  { code: 'T15', label: '交易超时',          progress: 0, isError: true },
  FAILED_CONGEST:  { code: 'T16', label: '网络拥堵',          progress: 0, isError: true },
  FAILED_UNKNOWN:  { code: 'T17', label: '未知错误',          progress: 0, isError: true }
};

// ── 资产状态 (8态) ──
const ASSET_STATES = {
  AVAILABLE:     { code: 'B00', label: '可用' },
  FROZEN:        { code: 'B01', label: '冻结中' },
  STAKED:        { code: 'B02', label: '质押中' },
  UNLOCKING:     { code: 'B03', label: '解锁中' },
  PENDING_DIV:   { code: 'B04', label: '待分红' },
  PENDING_BURN:  { code: 'B05', label: '待销毁' },
  PENDING_SETTLE:{ code: 'B06', label: '待结算' },
  LOCKED:        { code: 'B07', label: '已锁定' }
};

// ── Agent 实现 ──
class ChainUXAgent {
  constructor() {
    this.name = 'ChainUX';
    this.version = '1.0.0';
    this.currentWallet = WALLET_STATES.DISCONNECTED;
    this.currentChain = CHAIN_STATES.CORRECT;
    this.currentApproval = APPROVAL_STATES.NONE;
    this.currentTx = TX_STATES.IDLE;
    this.transitions = [];
  }

  /**
   * 钱包状态转换
   */
  transitionWallet(newState) {
    const prev = this.currentWallet;
    this.currentWallet = WALLET_STATES[newState] || WALLET_STATES.DISCONNECTED;
    this.transitions.push({
      time: Date.now(),
      component: 'wallet',
      from: prev.code,
      to: this.currentWallet.code,
      label: this.currentWallet.label
    });
    return this.currentWallet;
  }

  /**
   * 链状态转换
   */
  transitionChain(newState) {
    const prev = this.currentChain;
    this.currentChain = CHAIN_STATES[newState] || CHAIN_STATES.CORRECT;
    this.transitions.push({
      time: Date.now(),
      component: 'chain',
      from: prev.code,
      to: this.currentChain.code,
      label: this.currentChain.label
    });
    return this.currentChain;
  }

  /**
   * 交易状态转换
   */
  transitionTx(newState) {
    const prev = this.currentTx;
    this.currentTx = TX_STATES[newState] || TX_STATES.IDLE;
    this.transitions.push({
      time: Date.now(),
      component: 'tx',
      from: prev.code,
      to: this.currentTx.code,
      label: this.currentTx.label,
      progress: this.currentTx.progress,
      isError: this.currentTx.isError || false
    });
    return this.currentTx;
  }

  /**
   * 获取用户可读的错误提示 (合约报错→中文)
   */
  static translateError(revertReason) {
    const map = {
      'insufficient balance': '余额不足，请充值后重试',
      'transfer amount exceeds balance': '转账金额超过余额',
      'allowance exceeded': '授权额度不足，请重新授权',
      'slippage too high': '滑点过高，请调整滑点设置',
      'execution reverted': '合约执行失败，请检查参数',
      'gas required exceeds allowance': 'Gas不足，请提高Gas限额',
      'nonce too low': '交易序列号过期，请刷新页面',
      'already staked': '已存在质押记录',
      'lock period not ended': '锁定期未结束',
      'not owner': '无操作权限',
      'paused': '合约已暂停',
      'blacklisted': '地址已被列入黑名单'
    };
    for (const [key, val] of Object.entries(map)) {
      if (revertReason?.toLowerCase().includes(key)) return val;
    }
    return revertReason || '未知合约错误，请重试';
  }

  /**
   * 获取完整的UX状态快照
   */
  getFullState() {
    return {
      agent: this.name,
      version: this.version,
      wallet: this.currentWallet,
      chain: this.currentChain,
      approval: this.currentApproval,
      transaction: this.currentTx,
      stats: {
        totalTransitions: this.transitions.length,
        walletStates: WALLET_STATES,
        chainStates: CHAIN_STATES,
        txStates: TX_STATES,
        assetStates: ASSET_STATES
      }
    };
  }

  /**
   * 获取当前用户应看到的UI元素
   */
  getUIState() {
    return {
      walletButton: {
        text: this.currentWallet.label,
        icon: this.currentWallet.icon,
        action: this.currentWallet.action,
        disabled: this.currentWallet.code.startsWith('W01')
      },
      chainBanner: this.currentChain.code !== 'C00' ? {
        show: true,
        text: this.currentChain.label,
        action: this.currentChain.action
      } : { show: false },
      txProgress: this.currentTx.code !== 'T00' ? {
        show: true,
        progress: this.currentTx.progress,
        label: this.currentTx.label,
        isError: this.currentTx.isError
      } : { show: false }
    };
  }
}

if (typeof module !== 'undefined') module.exports = { 
  ChainUXAgent, 
  WALLET_STATES, CHAIN_STATES, APPROVAL_STATES, TX_STATES, ASSET_STATES 
};
