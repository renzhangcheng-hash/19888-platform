# 19888 上线后运营SOP — 黄金72小时

## 一、防御层 (Watcher Agent)

| 监控项 | 工具 | 频率 | 动作 |
|--------|------|------|------|
| Owner确权 | `cast owner` | 每5min | 变更→CRITICAL告警 |
| Gas价格 | `cast gas-price` | 每5min | >5gwei→前端提示 |
| 合约余额 | `cast call balanceOf` | 每5min | 异常波动→告警 |
| RPC健康 | `cast block-number` | 每5min | 主RPC失效→切换备用 |

**熔断Payload**: `cast send 0x07Dbf... "pause()" --private-key $KEY`
**升级**: `cast send 0x07Dbf... "upgradeTo(address)" --private-key $KEY`

## 二、客服层 (Support Agent)

- 前端帮助中心: 页脚 "🆘 帮助" → FAQ弹窗
- Telegram: `https://t.me/19888official`
- 常见问题: 交易Revert、钱包连接、充值到账、提现审核
- TX扫描: BscScan链接每次交易后自动显示

## 三、增长层 (Alpha Discovery)

- 收录申请: DappRadar / DefiLlama / CoinGecko
- 公告模板: 固定合约地址, 防钓鱼提醒
- 流量平台: Galxe / Layer3 / QuestN

## 四、每日检查清单

```
09:00  curl 19888.asia → 200?
       curl API/status → ok?
       cast owner LuckyPool → 0x55b6...?
       admin/risk/alerts → 0?
       deployer >0.005 BNB?
```

## 五、紧急联系

- 合约暂停: `POST /api/admin/risk/circuit-break {"action":"engage"}`
- 提现审核: `POST /api/admin/withdrawals/review`
- BscScan: https://bscscan.com/address/0x07Dbf04Db72Ebd0D6a9488cC90934B046C2092e2
