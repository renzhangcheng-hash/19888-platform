# 19888 应急响应手册 · ERS v1.0

## 🔴 严重级别定义

| 级别 | 定义 | 响应时间 |
|------|------|:--:|
| P0 | 资金损失/合约被攻 | 即时 |
| P1 | 服务不可用 | 15分钟 |
| P2 | 功能异常 | 1小时 |
| P3 | 体验问题 | 24小时 |

---

## P0: 合约被攻/资金异常

### 症状
- 大额非预期转出
- 合约方法被异常调用
- Pool余额异常下降

### 响应
1. **立即**: `cast send <合约> "pause()" --private-key $PK` 暂停所有合约
2. **验证**: BscScan确认交易确认
3. **通知**: Telegram @19888official 公告
4. **取证**: 导出事件日志+交易记录
5. **恢复**: 修复漏洞→重新部署→迁移资金→解除暂停

### 相关合约
```
LuckyPool:      0x07Dbf04Db72Ebd0D6a9488cC90934B046C2092e2
AntiScoreBet:   0xc7aE31441B72D40F7EAc9AFBc6adC30D8692caEd
ScoreBet:       0xc64E68996b39de6a09A572d35f144Ff5ae891457
ChampionBet:    0xeBF0EcF53c420C3cA85e20f51e13eb5C51BfCF3a
AIVault:        0x7E6E5506D36aB213E8Df121490A25aE47Ca825Ea
VIPStaking:     0x99d1DDce8aDC1946f265CB4e75529AC372851A48
```

---

## P1: 服务不可用

### 症状
- Render 后端 5xx
- Netlify 前端无法访问
- RPC 全节点断开

### 响应
1. **Render**: `curl https://one9888-api.onrender.com/api/status`
2. **Netlify**: `curl https://19888.netlify.app`
3. **RPC切换**: 环境变量 `RPC_URLS` → 自动fallback
4. **重启**: `hermes gateway restart` → cron恢复

---

## P2: 功能异常

### 充值/提现问题
1. 验证 `admins.json` hash正确 (`node -e "require('bcryptjs').compareSync('19888admin',hash)"`)
2. 检查 `users.json` 数据完整性
3. 重启后端服务

### 投注问题
1. 检查 `matches.json` 数据完整性
2. 验证合约未暂停: `cast call <合约> "paused()(bool)"`

---

## P3: 常规维护

### 每日检查清单
- [ ] Render API 200
- [ ] BSC RPC 可达
- [ ] Pool余额正常
- [ ] Cron 全部active
- [ ] 无磁盘/内存告警

### 项目密钥
```
JWT_SECRET: 已固化 backend/.env
Admin: admin / 19888admin
Deployer: 0x55b6... (MetaMask)
```
