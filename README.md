# 1688 反波膽競猜平台

> 不猜结果，反猜意外 · 让每一脚射门都有价值

SABA Sports 旗下 Web3 体育预测平台。反波膽 + 正波膽 + AI 智投。

## 快速启动

### 方式 1: 直接打开 (纯前端)
```bash
open index.html
```
前端完整可用 — mock 数据 + localStorage 持久化，钱包连接有演示模式。

### 方式 2: PHP 开发服务器 (含后端 API)
```bash
cd /path/to/1688-platform
php -S localhost:8080
```
然后访问 http://localhost:8080

### 方式 3: Apache/Nginx 部署
将项目目录设为 web root，确保 .htaccess 已启用或配置 URL 重写。

## 项目结构

```
1688-platform/
├── index.html          # 主 SPA (6 页面合一)
├── css/
│   └── style.css       # 完整样式 (dark theme)
├── js/
│   └── app.js          # 应用逻辑 + mock 数据
├── api/
│   ├── index.php       # PHP REST API
│   └── data/           # JSON 文件存储 (自动创建)
└── img/                # 图片资源
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/wallet/connect | 钱包登录/注册 |
| GET | /api/matches | 赛事列表 |
| GET | /api/matches/{id} | 单场比赛 + 18格赔率 |
| GET | /api/champion-bet/odds | 冠亚预测赔率 |
| POST | /api/champion-bet/place | 下注 |
| GET | /api/bets?address=0x... | 用户投注记录 |
| GET | /api/user/balance?address=0x... | 用户余额 |
| GET | /api/status | 健康检查 |

## 配色方案

1688 品牌色系:
- 背景: #0B0E11 (深黑)
- 主色: #DC143C (中国红)
- 辅色: #DAA520 (金)
- 高亮: #FFD700 (亮金)
