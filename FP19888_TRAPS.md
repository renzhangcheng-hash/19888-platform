# FP19888 陷阱索引 — 第一性原理深度审计

> 审计日期: 2026-06-12 | FP版本: V1 | 陷阱数: 8  
> 方法论: 特斯拉第一性原理 — 质疑一切假设，从基本真理推导

---

## 🟋 致命级 (Survival Critical)

### FP-V19888-1: API_BASE静态初始化 → 隧道URL变化后前端永久失效

**状态**: ✅ 已修复  
**严重度**: 🔴 致命  
**文件**: `js/app.js:18`

**根因**: `const API_BASE = resolveApiBase()` 在IIFE初始化时求值一次。cloudflared隧道重启后URL变化，前端在用户不刷新页面的情况下永久使用旧URL → API调用全部失败 → 用户看到mock数据误以为正常。

**FP推导**: 
```
假设: API_BASE不变 → 隧道URL稳定
现实: cloudflared quick tunnel每次重启换URL
矛盾: const值 ← → 动态URL
结论: API_BASE必须是函数调用，每次请求实时解析
```

**修复**: 将`apiFetch`中的`API_BASE`引用改为`resolveApiBase()`实时调用。

---

### FP-V19888-2: JWT_SECRET随机化 → 每次重启所有token失效

**状态**: ⚠️ 待修复  
**严重度**: 🔴 致命  
**文件**: `backend/server.js:35`

**根因**: `process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex')` — 未设置环境变量时，每次重启生成新密钥 → 所有已签发JWT瞬间失效 → 所有用户被迫重新登录。

**FP推导**:
```
假设: 无env则随机生成 → 重启后token仍有效
现实: 随机生成→每次重启新密钥→旧token校验失败
矛盾: 随机值用于持久化验证 ≠ 一次性nonce
结论: fallback必须是固定值或拒绝启动
```

**建议修复**: ①使用固定fallback值(不如随机安全但保证可用) ②启动时检测:无env则打印警告并拒绝启动 ③持久化密钥到文件

---

## 🟧 高危级 (Data Integrity)

### FP-V19888-3: Mock数据静默替代API数据 → 用户无法区分真假

**状态**: ✅ 已修复  
**严重度**: 🟠 高危  
**文件**: `js/app.js:376,394,437`

**根因**: `apiFetch`失败后调用方静默fallback到`mockMatches/mockChampionTeams` → 用户看到的比赛数据可能是假的但不知道 → 如下注则基于假数据决策。

**FP推导**:
```
假设: API不可用时静默降级=更好体验
现实: 下注决策需要真实赔率→假赔率=错误决策→资金损失
矛盾: "更好体验" ← → "假数据风险"
结论: 必须明确标注"API离线-展示示例数据"
```

**修复**: API失败时在UI顶部显示红色横幅"⚠️ API离线 — 展示示例数据，不可下注"。

---

### FP-V19888-4: 静默except空catch → localStorage失败无感知

**状态**: ✅ 已修复  
**严重度**: 🟠 高危  
**文件**: `js/app.js:88`

**根因**: `try { localStorage.setItem(...) } catch(e) {}` — localStorage满/隐私模式下静默失败 → URL缓存永不工作 → 每次API请求都尝试失败URL再fallback → 增延迟8秒/请求。

**FP推导**:
```
假设: localStorage.setItem总是成功
现实: 隐私模式/存储满/配额超限均抛异常
矛盾: 静默吞噬 ← → 需感知故障
结论: catch中至少console.warn，并降级到内存缓存
```

**修复**: catch中添加`console.warn`标记，新增内存fallback Map。

---

## 🟡 中危级 (Security / Reliability)

### FP-V19888-5: Admin密码硬编码在seed数据 → 源码泄露=权限失控

**状态**: ⚠️ 待修复  
**严重度**: 🟡 中危  
**文件**: `backend/server.js:315`

**根因**: `hashPassword('19888admin')` — seed数据中硬编码默认admin密码。攻击者读取源码(开源/GitHub泄露/备份文件) → 直接知道admin密码。

**建议修复**: 默认密码记录在`.env`中，seed时检查环境变量。

---

### FP-V19888-6: 隧道SIGPIPE脆弱性 → pipe读取=隧道死亡

**状态**: ℹ️ 已知但未完全防护  
**严重度**: 🟡 中危  
**文件**: 基础设施

**根因**: `cloudflared tunnel ... 2>&1 | head -20` → head退出→管道关闭→cloudflared收到SIGPIPE→隧道死亡 → 前端API全断。

**FP推导**:
```
假设: pipe安全 → 读取够了就关
现实: cloudflared是长连接进程 → 管道关闭=SIGPIPE=进程被杀
矛盾: "管道是安全的IPC" ← → "SIGPIPE杀进程"
结论: 必须用文件重定向(> file)而非管道(| cmd)
```

---

### FP-V19888-7: API请求无重试 → 瞬时网络波动=永久失败

**状态**: ⚠️ 待修复  
**严重度**: 🟡 中危  
**文件**: `js/app.js:62-99`

**根因**: apiFetch尝试fallback链(2个URL)，每个只试一次。网络瞬时波动(移动网络切塔/WiFi切换/cloudflared冷启动) → 两个URL都超时 → 返回null → UI回退到mock数据但无重试。

**建议修复**: 每个URL重试2次(总计4次尝试)，指数退避1s/2s。

---

### FP-V19888-8: walletAddress全局可变 → 并发操作状态不一致

**状态**: ℹ️ 已知  
**严重度**: 🟡 中危  
**文件**: `js/app.js:28-30`

**根因**: `let walletAddress = null; let walletProvider = null` — 全局可变状态，任何异步操作可修改。快速切换钱包 → 两次操作使用不同地址 → 投注记到错误账户。

**建议修复**: 操作前拷贝当前地址快照；投注确认时显示目标地址。

---

## 审计层覆盖

| 层 | 名称 | 发现陷阱 |
|---|------|---------|
| L0 | 物理层 | #6 (SIGPIPE) |
| L1 | 配置层 | #1 (API_BASE), #2 (JWT), #5 (Admin密码) |
| L2 | 代码质量 | #3 (Mock静默), #4 (except:pass), #7 (无重试), #8 (全局状态) |
| L3 | 安全层 | #5 (硬编码密码) |
| L4 | 数据完整性 | #3 (假数据标注) |
| L5 | 恢复能力 | #1 (URL更新), #7 (重试) |

---

## 修复优先级

```
生存 > 安全 > 数据完整性 > 用户体验
  #1    #2     #3,#4         #7,#8
  #6    #5
```

