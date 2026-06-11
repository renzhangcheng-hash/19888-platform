/**
 * 19888 Agent — 产品团队 (Musk First-Principles v2.0)
 * 
 * Musk原则:
 * 1. 删除一切不必要功能 — "最好的功能是没有功能"
 * 2. 从物理极限推导 — 用户最快完成任务的路径是什么？
 * 3. 质疑每一个需求 — 这个功能真的有人用吗？5问法追踪根因
 * 4. 不做竞品分析 — 从零推导最优方案
 */

class ProductAgent {
  constructor() {
    this.version = "2.0.0-musk";
    this.name = "Product";
    
    this.muskPrinciples = {
      delete: "删除所有不产生价值的PM流程",
      physics: "从用户目标反推，不是从竞品复制",
      question: "每个需求问5次'为什么'，直到找到根因",
      derive: "不参考任何竞品，从零推导最优方案"
    };
  }

  askFiveWhys(feature) {
    const roots = {
      'show balance': '用户想知道还有多少钱',
      'connect wallet': '用户需要身份验证',
      'place bet': '用户想参与竞猜',
      'leaderboard': '用户需要社交证明',
    };
    let current = feature;
    const chain = [];
    for (let i = 1; i <= 5; i++) {
      const root = roots[current] || current;
      chain.push({ level: i, question: current, root });
      if (root === current) break;
      current = root;
    }
    return { keep: chain.length >= 3, chain, verdict: chain.length >= 3 ? 'KEEP' : 'DELETE — no real user need' };
  }

  simplifyRoadmap(roadmap) {
    return roadmap.filter(item => {
      const a = this.askFiveWhys(item.name);
      item.keep = a.keep; item.verdict = a.verdict;
      return a.keep;
    });
  }

  deriveOptimalUX(userGoal) {
    const PHYSICS = { eyeRecognition: 200, fingerTap: 300, decision: 500 };
    const goals = {
      place_bet: { minClicks: 3, optimalMs: 2400 },
      check_balance: { minClicks: 1, optimalMs: 200 },
      view_results: { minClicks: 2, optimalMs: 1100 }
    };
    return goals[userGoal] || { minClicks: Infinity, optimalMs: Infinity };
  }

  getDashboardMetrics() {
    return {
      onChain: ['TVL','activeAddresses','txVolume','burnAmount','stakingRatio'],
      offChain: ['DAU','newUsers','betVolume','retention','ARPDAU'],
      alerts: ['TVL drop > 20%','tx failure > 5%','new address spike']
    };
  }

  getStatus() { return { agent: this.name, version: this.version, principles: this.muskPrinciples }; }
}

module.exports = { ProductAgent };
