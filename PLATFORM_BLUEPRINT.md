# 19888 平台全系统蓝图

> 版本: v2.0 | 更新: 2026-06-12 | 后端: 2181行 Express.js | 前端: SPA (Netlify)  
> 方法论: 第一性原理体系 — 从基本真理推导，生存优先于收益

---

## 架构全景

```
┌──────────────────────────────────────────────────────────────────┐
│                    19888.asia (Netlify SPA)                       │
│  index.html + 19888.css + app.js + web3.js + ethers.js        │
└──────────────────────────┬───────────────────────────────────────┘
                           │ Cloudflare Tunnel
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│              Backend (Express.js :3088, localhost)                │
│  ┌─────────┬──────────┬──────────┬──────────┬──────────┐        │
│  │ 用户系统 │ 赛事系统  │ 竞猜系统  │ 财务系统  │ 后台系统  │        │
│  │ 钱包连接 │ 比赛大厅  │ 冠亚/反波 │ 充值提现  │ JWT管理   │        │
│  │ 个人中心 │ 赔率引擎  │ 胆/比分  │ PnL核算  │ 赛事管理  │        │
│  │ VIP系统  │ 18格生成  │ 双阶段确认│ 交易记录  │ 用户管理  │        │
│  │ 代理系统 │ AI预测   │ 链上验证  │ 资金池   │ 结算引擎  │        │
│  └─────────┴──────────┴──────────┴──────────┴──────────┘        │
│                                                                    │
│  ┌──────────────────────────────────────────────────────┐        │
│  │              风控系统 (Risk Control)                   │        │
│  │  额度限制 · 频率限制 · 异常检测 · 熔断机制              │        │
│  └──────────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│             Sepolia Testnet (Chain ID: 11155111)                  │
│  LuckyPool · ChampionBet · AntiScoreBet · ScoreBet               │
│  (Foundry + Solidity, ethers.js v6 交互)                          │
└──────────────────────────────────────────────────────────────────┘
```

---

## 1. 用户系统 + 钱包系统

### 数据模型 (`users.json`)
```json
{
  "address": "0x...",          // 钱包地址 (主键)
  "nickname": "用户A1B2C3",    // 昵称
  "avatar": "",                // 头像URL
  "balance": 100.00,           // 总余额 USDT
  "frozen_bet": 50.00,         // 冻结-投注
  "frozen_ai": 0,              // 冻结-AI托管
  "ai_hosting_active": false,  // AI托管状态
  "ai_hosting_settings": {},   // AI托管配置
  "invite_code": "19888_xxx",  // 邀请码
  "invite_count": 0,           // 邀请人数
  "invited_by": "0x...",       // 被谁邀请
  "vip_level": 0,              // VIP等级 [0-5]
  "total_wagered": 0,          // 累计投注
  "total_deposited": 0,        // 累计充值
  "created_at": "ISO8601",
  "last_login": "ISO8601"
}
```

### 现有端点
| 端点 | 方法 | 功能 | 状态 |
|------|------|------|:---:|
| `/api/wallet/connect` | POST | 钱包连接/注册 | ✅ |
| `/api/user/balance` | GET | 余额查询 | ✅ |
| `/api/user/profile` | GET/POST | 个人信息 | ✅ |
| `/api/user/pnl` | GET | 盈亏统计 | ✅ |

### 待实现
| 端点 | 功能 | 优先级 |
|------|------|:---:|
| `/api/user/transactions` | 交易流水 | 🟡 |
| `/api/user/settings` | 用户设置 | 🟢 |
| `/api/user/logout` | 登出 | 🟢 |

### FP推导
```
假设: 钱包地址=用户 → 安全
现实: 前端可伪造任意地址调用API
矛盾: 无签名验证 ← → 身份不可靠
结论: 非关键操作可接受(展示数据)，充值/提现必须链上验证 ✅
```

---

## 2. 充值提现

### 数据模型
```
deposits.json    — 充值记录 (tx_hash, amount, status: confirmed/failed)
withdrawals.json — 提现记录 (to_address, amount, status: pending→completed)
```

### 现有端点
| 端点 | 方法 | 功能 | 状态 |
|------|------|------|:---:|
| `/api/deposit` | POST | 充值 (链上tx验证) | ✅ |
| `/api/deposit/history` | GET | 充值历史 | ✅ |
| `/api/withdraw` | POST | 提现申请 | ✅ |
| `/api/withdraw/history` | GET | 提现历史 | ✅ |

### 风控规则
| 规则 | 值 | 说明 |
|------|:---:|------|
| 最小充值 | 0.01 USDT | |
| 最大充值 | 10,000 USDT | 单笔 |
| 最小提现 | 1 USDT | |
| 提现冷却 | 24h | 同地址 |
| 链上确认 | ≥1 block | Sepolia |

### FP推导
```
假设: tx_hash存在=支付完成
现实: 需验证to地址/金额/确认数
矛盾: 轻信前端 ← → 资金安全
结论: 三重验证: tx存在 + 接收地址匹配 + 金额匹配 ✅
```

---

## 3. 赛事大厅

### 数据模型 (`matches.json`)
```json
{
  "id": 1,
  "league": "世界杯 A组",
  "home": "巴西",
  "away": "阿根廷",
  "time": "2026-06-15 20:00",
  "odds_home": 2.50,     // 主胜赔率
  "odds_draw": 3.00,     // 平局赔率
  "odds_away": 2.80,     // 客胜赔率
  "status": "upcoming",  // upcoming|live|finished
  "result": null,        // home|draw|away (结算后)
  "settled_at": null
}
```

### 现有端点
| 端点 | 方法 | 功能 | 状态 |
|------|------|------|:---:|
| `/api/matches` | GET | 赛事列表 | ✅ |
| `/api/matches/:id` | GET | 赛事详情+18格 | ✅ |
| `/api/teams` | GET | 球队列表 | ✅ |
| `/api/teams/:id` | GET | 球队详情 | ✅ |
| `/api/teams/:id/stats` | GET | 球队统计 | ✅ |

### 18格赔率引擎
```
输入: 真实足球比分概率分布
算法: odds = 1/(1-prob) × (1-house_edge)
庄家优势: 15%
输出: 18格赔率 [1.01, 25.00]
```

---

## 4. 竞猜系统

### 四种玩法

| 玩法 | 端点 | 说明 | 状态 |
|------|------|------|:---:|
| 🏆 冠亚预测 | `/api/champion-bet/place` | 预测冠军/亚军 | ✅ |
| ⚽ 反波胆 | `/api/anti-bet/place` | 18格选不中 | ✅ |
| 🎯 比分竞猜 | `/api/score-bet/place` | 18格选中 | ✅ |
| 🔗 双阶段确认 | `/api/bet/confirm` | 链上tx验证 | ✅ |

### 数据模型 (`bets.json`)
```json
{
  "id": 1,
  "address": "0x...",
  "game_type": "champion|anti-score|score",
  "team_id": 1,
  "team_name": "巴西",
  "bet_type": 1,           // 1=冠军 2=亚军
  "amount": 50,
  "odds": 5.50,
  "potential_win": 275.00,
  "status": "pending|won|lost",
  "tx_hash": "0x...",
  "match_id": null,
  "cell_score": null,
  "created_at": "ISO8601",
  "settled_at": null
}
```

### 风控规则
| 规则 | 值 |
|------|:---:|
| 最小投注 | 1 USDT |
| 最大投注 | 10,000 USDT |
| 重复下注 | 禁止 (同用户+同球队+同类型+pending) |
| 余额不足 | 拒绝 |

---

## 5. 订单系统

### 订单生命周期
```
pending ──────→ won ──────→ 用户余额+potential_win
    │
    └──────→ lost ──────→ 用户frozen_bet释放
```

### 现有端点
| 端点 | 方法 | 功能 | 状态 |
|------|------|------|:---:|
| `/api/bets` | GET | 用户投注列表 | ✅ |
| `/api/bet-records` | GET | 投注记录(分页+筛选) | ✅ |
| `/api/bet/confirm` | POST | 链上确认 | ✅ |

### 待实现
| 端点 | 功能 | 优先级 |
|------|------|:---:|
| `/api/bets/:id/cancel` | 取消投注 (结算前) | 🟡 |

---

## 6. VIP系统 ⚠️ 待建设

### 等级设计
| 等级 | 名称 | 累计投注 | 充值返佣 | 提现优先 | 专属赔率 |
|:---:|------|:---:|:---:|:---:|:---:|
| 0 | 普通 | 0 | 0% | ❌ | ❌ |
| 1 | 青铜 | ≥500 | 0.5% | ❌ | ❌ |
| 2 | 白银 | ≥2,000 | 1% | ❌ | ❌ |
| 3 | 黄金 | ≥10,000 | 2% | ✅ | +2% |
| 4 | 铂金 | ≥50,000 | 3% | ✅ | +5% |
| 5 | 钻石 | ≥200,000 | 5% | ✅ 即时 | +10% |

### 待实现端点
| 端点 | 功能 |
|------|------|
| `GET /api/vip/status` | VIP等级+权益 |
| `GET /api/vip/benefits` | 权益明细 |
| `GET /api/vip/progress` | 升级进度 |

---

## 7. 代理系统 ✅ 基础可用

### 现有端点
| 端点 | 方法 | 功能 | 状态 |
|------|------|------|:---:|
| `/api/invite/generate-code` | POST | 生成邀请码 | ✅ |
| `/api/invite/stats` | GET | 邀请统计 | ✅ |
| `/api/invite/referral-tracking` | POST | 记录推荐 | ✅ |
| `/api/invite/claim-reward` | POST | 领取返佣 | ✅ |

### 返佣规则
```
一级返佣: 被邀请人投注额 × 5%
二级返佣: 间接邀请人投注额 × 2%
```

### 待实现
| 功能 | 优先级 |
|------|:---:|
| 代理等级体系 | 🟡 |
| 团队业绩面板 | 🟡 |
| 返佣自动结算 | 🟡 |

---

## 8. 财务系统

### 资金流
```
用户充值 → balance↑
用户投注 → balance↓ frozen_bet↑
投注赢   → balance↑ frozen_bet↓
投注输   → frozen_bet↓ (balance已扣)
AI托管   → frozen_ai↑
提现     → balance↓
```

### 现有端点
| 端点 | 功能 | 状态 |
|------|------|:---:|
| `GET /api/user/balance` | 余额 (available/frozen/total) | ✅ |
| `GET /api/user/pnl` | 盈亏 (PnL/ROI/胜率/按玩法) | ✅ |
| `GET /api/deposit/history` | 充值记录 | ✅ |
| `GET /api/withdraw/history` | 提现记录 | ✅ |
| `GET /api/admin/stats` | 平台统计 | ✅ |

### 待实现
| 端点 | 功能 | 优先级 |
|------|------|:---:|
| `GET /api/finance/daily-report` | 日报 | 🟡 |
| `GET /api/finance/pool` | 资金池状态 | 🟡 |

---

## 9. 风控系统 ⚠️ 待建设

### FP风控框架

```
生存 > 风控 > 信号质量 > 频率 > 收益率
```

### 风控层设计

| 层级 | 名称 | 功能 | 状态 |
|:---:|------|------|:---:|
| L1 | 参数校验 | 金额/地址/格式验证 | ✅ |
| L2 | 频率限制 | 200req/15min全局 + 5req/15min管理 | ✅ |
| L3 | 业务规则 | 重复下注检查/余额检查/最小金额 | ✅ |
| L4 | 链上验证 | tx存在性+地址+金额三重验证 | ✅ |
| L5 | 异常检测 | ⚠️ 大额交易告警/异常模式识别 | ❌ |
| L6 | 熔断机制 | ⚠️ 单日亏损上限/连续亏损暂停 | ❌ |
| L7 | 平台风控 | ⚠️ 总资金池监控/赔率偏差检测 | ❌ |

### 待实现端点
| 端点 | 功能 | 优先级 |
|------|------|:---:|
| `GET /api/admin/risk/alerts` | 风控告警列表 | 🔴 |
| `POST /api/admin/risk/circuit-break` | 手动熔断 | 🟡 |
| `GET /api/admin/risk/daily-limits` | 限额配置 | 🟡 |

### 建议规则
| 规则 | 阈值 | 动作 |
|------|:---:|------|
| 单注上限 | 1,000 USDT | 拒绝 |
| 单日投注上限 | 5,000 USDT | 拒绝 |
| 单日亏损上限 | 2,000 USDT | 熔断24h |
| 大额提现 | >500 USDT | 人工审核 |
| 异常频率 | >50注/小时 | 临时冻结 |

---

## 10. 后台系统

### 现有端点 (全部JWT保护)
| 端点 | 方法 | 功能 | 状态 |
|------|------|------|:---:|
| `/api/admin/login` | POST | 管理员登录 | ✅ |
| `/api/admin/verify` | GET | Token验证 | ✅ |
| `/api/admin/matches` | GET/POST | 赛事CRUD | ✅ |
| `/api/admin/matches/:id` | PUT/DELETE | 赛事编辑 | ✅ |
| `/api/admin/create-match` | POST | 快速创建 | ✅ |
| `/api/admin/settle-match` | POST | 结算比赛 | ✅ |
| `/api/admin/teams` | GET/PUT | 球队管理 | ✅ |
| `/api/admin/bets` | GET | 投注列表 | ✅ |
| `/api/admin/bets/:id/settle` | PUT | 单笔结算 | ✅ |
| `/api/admin/users` | GET | 用户列表 | ✅ |
| `/api/admin/ai-pool` | GET | AI池状态 | ✅ |
| `/api/admin/stats` | GET | 平台统计 | ✅ |

### 待实现
| 端点 | 功能 | 优先级 |
|------|------|:---:|
| `POST /api/admin/risk/circuit-break` | 风控熔断 | 🔴 |
| `POST /api/admin/users/ban` | 封禁用户 | 🟡 |
| `GET /api/admin/finance/report` | 财务报表 | 🟡 |
| `POST /api/admin/broadcast` | 全站公告 | 🟢 |

---

## 系统依赖图

```
        ┌──────────┐
        │  前端SPA  │
        └────┬─────┘
             │
    ┌────────┼────────┐
    ▼        ▼        ▼
┌──────┐ ┌──────┐ ┌──────┐
│钱包连接│ │赛事大厅│ │个人中心│
└──┬───┘ └──┬───┘ └──┬───┘
   │        │        │
   └────────┼────────┘
            ▼
    ┌───────────────┐
    │   竞猜引擎     │ ← 赔率计算
    │  (4种玩法)     │ ← 18格生成
    └───────┬───────┘
            │
    ┌───────┼───────┐
    ▼       ▼       ▼
┌──────┐┌──────┐┌──────┐
│订单系统││财务系统││风控系统│
│pending││PnL   ││熔断   │
│→won   ││余额  ││限频   │
│→lost  ││流水  ││检测   │
└──┬───┘└──┬───┘└──┬───┘
   │       │       │
   └───────┼───────┘
           ▼
    ┌──────────────┐
    │   后台管理     │
    │  JWT Auth     │
    │  结算/管理     │
    └──────────────┘
           │
           ▼
    ┌──────────────┐
    │  Sepolia链    │
    │  合约验证     │
    └──────────────┘
```

---

## 完成度总览

| 系统 | 完成度 | 端点 | 说明 |
|------|:---:|:---:|------|
| 用户系统 | 95% | 6 | +交易流水 |
| 充值提现 | 95% | 4 | +提现历史 |
| 赛事大厅 | 95% | 6 | |
| 竞猜系统 | 95% | 6 | +取消投注 |
| 订单系统 | 95% | 4 | +取消+交易流水 |
| **VIP系统** | **100%** | 3 | 6级梯度+前端VIP卡 |
| 代理系统 | 95% | 6 | 6级代理+收入面板 |
| 财务系统 | 95% | 7 | 日报+资金池+平台PnL |
| **风控系统** | **100%** | 4 | 熔断+告警+限额+日监控 |
| 后台系统 | 95% | 16 | +风控面板+财务面板 |

**总体完成度**: **~96%**  |  端点总数: **62**  |  全部核心系统就绪

### v3.0 新增 (2026-06-12)

| 系统 | 新增端点 | 功能 |
|------|:---:|------|
| VIP | 3 | `/api/vip/status` `/api/vip/levels` + 前端VIP卡片 |
| 风控 | 4 | `/api/admin/risk/alerts` `circuit-break` `config` GET/POST |
| 代理 | 2 | `/api/invite/levels` `/api/invite/earnings` |
| 财务 | 2 | `/api/finance/daily-report` `/api/finance/pool-status` |
| 订单 | 2 | `/api/bets/:id/cancel` `/api/user/transactions` |

### 风控验证

```
熔断启用 → 所有投注返回 code:99 "系统熔断中"
熔断解除 → 投注恢复正常
告警日志 → 200条上限自动循环
```

---

## 下一优先级 (FP推导)

```
生存 > 安全 > 数据完整性 > 功能完整性 > 用户体验

1. 🔴 风控系统 L5-L7  — 异常检测 + 熔断 + 平台风控
2. 🟡 VIP系统        — 用户留存 + 激励体系
3. 🟡 代理系统完善     — 等级 + 自动返佣
4. 🟢 财务日报        — 运营可视化
```

---

> *"质疑一切假设。从概率论/Kelly/博弈论基本真理推导，不类比不借鉴。"*  
> — FP-V1 19888 审计信条
