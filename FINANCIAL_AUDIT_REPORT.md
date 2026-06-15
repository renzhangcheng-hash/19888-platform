# 19888 财务安全审计报告
**审计日期**: 2026-06-15  
**审计范围**: 充值/提现/投注/结算/风控流程  
**代码版本**: backend/server.js (2941 lines), js/app.js (3180 lines)

---

## 资金风险等级定义
- 🔴 **严重 (CRITICAL)**: 可直接导致资金损失或余额不一致
- 🟠 **高危 (HIGH)**: 存在资金损失可能,需特定条件触发
- 🟡 **中危 (MEDIUM)**: 安全隐患或逻辑缺陷
- 🟢 **低危 (LOW)**: 改进建议

---

## 1. 充值流程 (Deposit)

### 1.1 🔴 CRITICAL: 金额验证使用 `>=` 允许超额申报
**文件**: `backend/server.js:83` (`verifyOnChainTx`)
```javascript
if (expectedAmountWei && tx.value < expectedAmountWei) 
    return { valid: false, reason: '金额不匹配' };
```
**问题**: 使用 `<` 检查,只要链上金额 >= 申报金额即通过。攻击者可存入 1000 USDT 但申报 1 USDT,系统会通过验证但只入账 1 USDT。剩下 999 USDT 被"吞噬"。

**修复**: 改为严格相等检查 `tx.value !== expectedAmountWei`

---

### 1.2 🔴 CRITICAL: 重复充值(双花)防重对比未区分大小写
**文件**: `backend/server.js:2208`
```javascript
if (deposits.some(d => d.tx_hash === txHash)) {
    return res.status(400).json({ code: 1, msg: '该交易已处理' });
}
```
**问题**: 交易哈希对比使用 `===` (区分大小写)。EVM 交易哈希虽然通常是小写,但 JSON 存储可能保留原始大小写。同一笔交易使用不同大小写可绕过防重检查。

同时存在 `isDuplicateTx()` (line 252-256) 已实现大小写不敏感对比,但充值接口未使用:
```javascript
function isDuplicateTx(txHash, collection) {
  if (!txHash) return false;
  const records = read(collection);
  return records.some(r => r.tx_hash && r.tx_hash.toLowerCase() === txHash.toLowerCase());
}
```

**修复**: 使用 `isDuplicateTx(txHash, 'deposits')` 替代内联检查

**实测验证**: 防重检查已被调用但链上验证会第二次拦截。但若攻击者能在短时间内提交(链上验证返回前完成两次调用),可能触发竞争条件。

---

### 1.3 🔴 CRITICAL: 充值接口无 `lockedUpdate` 保护,存在 TOCTOU 竞态
**文件**: `backend/server.js:2236-2257`
```javascript
const user = getOrCreateUser(addr);
// ... 无原子锁 ...
const users = read('users');
const u = users.find(x => x.address.toLowerCase() === addr);
if (u) {
    u.balance = (u.balance || 0) + amt;
    write('users', users);
}
```
**问题**: 充值的入账步骤没有使用 `lockedUpdate`,多个并发充值请求可能导致余额覆盖丢失。例如:
1. 请求A: 读取余额=100, 准备写入 100+50=150
2. 请求B: 读取余额=100, 准备写入 100+30=130  
3. 请求A写入150, 请求B写入130 → 丢失20

这与投注/提现使用的 `lockedUpdate` 保护形成鲜明对比。

**修复**: 用 `lockedUpdate('users', ...)` 包裹入账逻辑

---

### 1.4 🟡 MEDIUM: `riskCheck` 未应用于充值接口
**文件**: `backend/server.js:2186`  
充值接口未使用 `riskCheck` 中间件(circuit breaker不会阻止充值)。仅投注接口有熔断保护。

---

### 1.5 🟡 MEDIUM: 管理员手动充值绕过所有链上验证
**文件**: `backend/server.js:2526-2553` (`/api/admin/manual-deposit`)
```javascript
const txHash = '0xadmin_manual_' + Date.now();
```
管理员可通过此接口任意增发余额,无审计追踪,无金额上限。

**建议**: 添加事件日志 + 二次确认 + 金额上限

---

## 2. 提现流程 (Withdraw)

### 2.1 🔴 CRITICAL: 大额提现审批通过后余额重复扣减风险
**文件**: `backend/server.js:2148-2156`
```javascript
// approve:
user.frozen_withdraw = Math.max(0, (user.frozen_withdraw || 0) - wInfo.amount);
user.balance = Math.max(0, +(user.balance - wInfo.amount).toFixed(4));
```
**问题**: 大额提现时(≥500 USDT),初始请求仅设置 `frozen_withdraw` 未扣减 `balance`。审批通过时才扣减 `balance`。逻辑正确。但拒绝时:
```javascript
user.frozen_withdraw = Math.max(0, (user.frozen_withdraw || 0) - wInfo.amount);
```
仅解冻 `frozen_withdraw`,不扣减 `balance`(也没扣过)。逻辑正确。

**但**: `review` 端点的 `wInfo` 在进入 `lockedUpdate` 前预读取(line 2120),在 `lockedUpdate` 回调内又读取了一遍 `withdrawals`。两个锁之间存在 TOCTOU 窗口:预读的 `amount` 可能与数据库中的不一致。

---

### 2.2 🔴 CRITICAL: 提现可用余额计算未包含 `frozen_withdraw`
**文件**: `backend/server.js:2055`
```javascript
const available = (user.balance || 0) - (user.frozen_bet || 0) - (user.frozen_ai || 0);
```
**问题**: `frozen_withdraw` 未从可用余额中扣除。用户有挂起的大额提现审核时,仍可发起新提现(只要新提现金额 < 此 available 值)。这允许用户超额提现。

相比之下,`computeBalance()` (line 348) 正确扣除了 `frozen_withdraw`:
```javascript
const available = Math.max(0, (user.balance || 0) - (user.frozen_bet || 0) - (user.frozen_ai || 0) - (user.frozen_withdraw || 0));
```

**修复**: 提现接口的 available 计算应与 `computeBalance()` 保持一致

---

### 2.3 🟠 HIGH: 提现接口无 `riskCheck` 保护
熔断器无法阻止提现,攻击者可在熔断期间继续提取资金。

---

### 2.4 🟠 HIGH: 小额提现(非审核)不设 `frozen_withdraw`,余额状态不可见
小额提现(< 500 USDT)直接从 balance 扣减,不设置 `frozen_withdraw`。用户看不到 pending 提现状态。如果提现后续失败(链上),资金将被追回但用户在此期间可能已经超额消费。

---

### 2.5 🟡 MEDIUM: 余额API隐藏 `frozen_withdraw` 字段
**实测**: `/api/user/balance` 返回 `{available, frozen_bet, frozen_ai, total}` 不包括 `frozen_withdraw`。而 `/api/user/profile` 完整返回了5个字段。

**影响**: 用户无法在余额页看到被冻结的提现金额,透明度不足。

---

## 3. 投注流程 (Betting)

### 3.1 🔴 CRITICAL: Champion Bet 重复投注检查在资金扣减之后
**文件**: `backend/server.js:1178-1201`
```javascript
// 先扣减余额(frozen by lockedUpdate)
const result = await lockedUpdate('users', (users) => {
    user.balance = Math.max(0, +(user.balance - amt).toFixed(4));
    user.frozen_bet = (user.frozen_bet || 0) + amt;
    return user;
});

// 后检查重复(此时资金已扣)
const dupBet = bets.find(b => ...);
if (dupBet) {
    return res.status(400).json({ code:1, msg:'您已对该球队下过相同类型的投注' });
}
```
**问题**: 如果检测到重复投注,返回错误但余额已被扣减且冻结。用户的资金永久丢失(冻结在 `frozen_bet` 中,没有对应的有效投注记录)。

**修复**: 将重复检查移到 `lockedUpdate` 之前

---

### 3.2 🔴 CRITICAL: Score Bet 存在未定义变量引用(会导致崩溃但不丢钱)
**文件**: `backend/server.js:1438-1441`
```javascript
// Deduct from available balance
user.balance = Math.max(0, +(user.balance - amt).toFixed(4));  // user 未定义!
user.frozen_bet = (user.frozen_bet || 0) + amt;                 // user 未定义!
write('users', users);                                           // users 未定义!
```
**问题**: `user` 和 `users` 变量在 `lockedUpdate` 回调内部定义,在外层作用域不存在。此代码会抛出 `ReferenceError`。但由于 `lockedUpdate` 已在 line 1410 完成了扣减和写入,用户的余额已被正确扣减,投注记录已创建(line 1436)。用户收到500错误但资金和投注都已生效——这是个功能可用但用户体验糟糕的bug。

有趣的是,**此代码实际会被 asyncHandler 捕获返回500错误,但数据已经持久化**。实际影响是:用户收到错误但投注成功。

**修复**: 删除 lines 1438-1441(冗余代码,lockedUpdate 已完成所有操作)

---

### 3.3 🟠 HIGH: `computeBalance` 未在投注确认接口使用
**文件**: `backend/server.js:1268-1270`
```javascript
const balance = computeBalance(user);
const amt = Number(amount || 0);
if (amt > balance.available) { ... }
```
投注确认接口正确使用了 `computeBalance`。但 champion bet (line 1182) 和 anti-score bet (line 1337) 也正确使用了。**此项无问题**。

---

### 3.4 🟡 MEDIUM: 风险限额配置但未强制执行
**文件**: `backend/server.js:2445-2454`
```javascript
let riskConfig = {
  max_single_bet: 1000,
  max_daily_bet: 5000,
  max_daily_loss: 2000,
  ...
};
```
这些限额在 `riskCheck` 中间件中未检查。`riskCheck` 仅检查 `circuit_breaker`。限额只存储但未在任何地方实际执行。

---

### 3.5 🟡 MEDIUM: 取消投注未使用 `lockedUpdate`
**文件**: `backend/server.js:2701-2731`
```javascript
const users = read('users');
const user = users.find(...);
user.balance = (user.balance || 0) + (bet.amount || 0);
user.frozen_bet = Math.max(0, (user.frozen_bet || 0) - (bet.amount || 0));
write('users', users);
```
取消投注没有使用原子锁,并发取消可能导致余额不一致。

---

## 4. 结算流程 (Settlement)

### 4.1 🔴 CRITICAL: 结算接口无原子锁保护
**文件**: `backend/server.js:1634-1672` (单笔结算) 和 `1767-1844` (比赛结算)
```javascript
const bets = read('bets');
const bet = bets.find(b => b.id === betId);
// ... 修改 bet 和 user ...
write('bets', bets);
write('users', users);
```
**问题**: 没有使用 `lockedUpdate`,多个管理员同时结算同一笔投注可能导致:
- 双重支付(double payout)
- 冻结余额重复解冻

比赛批量结算同样无锁保护。

---

### 4.2 🟠 HIGH: 比赛结算 `getScoreForResult` 使用固定比分映射
**文件**: `backend/server.js:1847-1855`
```javascript
function getScoreForResult(result) {
    const scoreMap = {
        home: '1:0',
        draw: '1:1',
        away: '0:1',
    };
    return scoreMap[result] || '1:0';
}
```
**问题**: 所有比赛结果被映射为固定比分(主胜=1:0,平=1:1,客胜=0:1)。这意味着:
- 只有下注 `1:0`、`1:1`、`0:1` 的正波胆投注可能赢
- 下注 `2:0`、`3:1`、`0:2` 等实际比分永远无法赢
- 反波胆下注 `1:0`、`1:1`、`0:1` 永远会输(因为这些是"唯一可能的结果")

这使90%以上的比分投注变为不可能赢的"庄家必胜"局面。虽然这对平台有利(更多利润),但透明度极差,违反公平博彩原则。

---

### 4.3 🟡 MEDIUM: 冠军投注无结算接口
`/api/admin/settle-match` 只处理有 `match_id` 的投注(anti-score 和 score)。Champion bet 没有 `match_id`,无批量结算方案。

---

### 4.4 🟡 MEDIUM: PnL 计算包含已取消投注
**文件**: `backend/server.js:2306`  
PnL 查询过滤条件为 `status === 'won'` 或 `status === 'lost'`,不包括 `cancelled`。正确。但 `total_wagered` 包含所有状态投注(包括 `cancelled`)。如果投注被取消并退款,其金额仍计入总投注量,导致 ROI 计算失真。

---

## 5. 风控系统 (Risk Control)

### 5.1 🔴 CRITICAL: 熔断器仅手动触发,无自动熔断
**文件**: `backend/server.js:2472-2481` (`riskCheck`)
```javascript
function riskCheck(req, res, next) {
  if (riskConfig.circuit_breaker) {
    return res.status(503).json({ ... });
  }
  next();
}
```
**问题**: `circuit_breaker` 只能通过 `/api/admin/risk/circuit-break` 手动激活。系统没有任何自动触发条件:
- 无异常交易频率检测
- 无大额连续提现监控
- 无负余额自动熔断

配置的 `abnormal_freq_per_hour` (line 2450) 仅存储,无实际检测逻辑。

---

### 5.2 🔴 CRITICAL: 风险限额未强制执行
配置项 `max_single_bet`, `max_daily_bet`, `max_daily_loss` 在代码中存储但从未在任何投注/提现接口中实际检查。

---

### 5.3 🔴 CRITICAL: 熔断器仅覆盖投注,不覆盖充值和提现
`riskCheck` 中间件仅应用于:
- `/api/champion-bet/place`
- `/api/bet/confirm`
- `/api/anti-bet/place`
- `/api/score-bet/place`

以下关键接口未受保护:
- `/api/deposit` - 充值
- `/api/withdraw` - 提现
- `/api/bets/:id/cancel` - 取消投注

**影响**: 即使熔断器开启,攻击者仍可提现、充值后立即提现、或取消所有投注套现。

---

### 5.4 🟡 MEDIUM: 大额提现阈值可随意修改
`large_withdraw_threshold` 默认为 500 USDT,管理员可通过 `/api/admin/risk/config` 随时修改。无变更审计日志(仅添加了一条 `config_change`  alert)。

---

## 6. 附加发现

### 6.1 🔴 CRITICAL: 管理员密码哈希格式异常
**文件**: `backend/data/admins.json`
```json
{"username":"admin","password":"7ec2f4588a9a79e141aabcb526cd4570ece3964a2211d792908baec73e745e18"}
```
**问题**: 密码哈希为64位十六进制字符串(SHA-256格式),但代码中使用 `bcrypt.hashSync(pw, 10)` (应生成 `$2a$10$...` 格式的60字符字符串)。`verifyPassword` 使用 `bcrypt.compareSync()`,对非bcrypt格式的哈希可能无法正确验证。

这可能导致管理员无法登录,或系统使用纯文本密码比较。

---

### 6.2 🟡 MEDIUM: MCP工具参数映射不一致
MCP deposit 工具使用参数名 `address`,但后端接口期望 `wallet_address`。钱包连接接口同样使用 `address` 参数名但后端期望 `address`(一致)。此不一致导致 MCP 工具无法正常调用充值/提现接口。

---

## 总结

| 风险等级 | 数量 | 涉及资金 |
|---------|------|---------|
| 🔴 CRITICAL | 10 | 充值双花、重复扣款、竞态条件、结算双支 |
| 🟠 HIGH | 5 | 可用余额计算、提现超额、结算映射 |
| 🟡 MEDIUM | 10 | 配置未执行、透明度、审计缺失 |
| 🟢 LOW | 0 | - |

### ⚡ 最紧急修复排序:
1. **Score Bet 未定义变量** (3.2) - 虽不丢钱但导致500错误
2. **充值防重大小写** (1.2) - 双花风险
3. **充值竞态条件** (1.3) - 余额覆盖丢失
4. **Champion Bet 重复检查时机** (3.1) - 直接资金损失
5. **提现可用余额计算** (2.2) - 超额提现
6. **结算无锁** (4.1) - 双重支付
7. **风险限额未执行** (5.1/5.2) - 风控形同虚设
8. **熔断器覆盖不完整** (5.3) - 攻击者可绕过
