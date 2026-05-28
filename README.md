# GCC Sales Dashboard - 2026年5月

GCC大区销售团队业绩看板，支持多层级下钻分析（大组→小组→个人）。

## 技术栈

- 前端：HTML + ECharts + 原生CSS
- 数据处理：Node.js + xlsx
- 托管：Cloudflare Workers
- 鉴权：Cloudflare Access（邮箱OTP）+ Workers API
- 加密：AES-256-GCM

## 快速开始（本地调试）

```bash
# 1. 安装依赖
npm install

# 2. 处理数据
node scripts/process_data.js

# 3. 本地预览
node serve.js
# 浏览器打开 http://localhost:3000
```

## 部署到 Cloudflare（公网访问）

### 前置条件

- Cloudflare 账号（免费）
- GitHub 账号
- Node.js v18+
- wrangler CLI v4+

### 步骤

```bash
# 1. 登录 Cloudflare
npx wrangler login

# 2. 创建 KV namespace
npx wrangler kv namespace create AUTH_KV
npx wrangler kv namespace create DASHBOARD_DATA
# 将返回的 id 填入 wrangler.toml

# 3. 设置加密密钥
npx wrangler secret put ENCRYPTION_KEY

# 4. 上传数据到 KV
npx wrangler kv key put --binding=AUTH_KV "auth_config" --path=auth_config.json --remote
npx wrangler kv key put --binding=DASHBOARD_DATA "dashboard_enc" --path=public/data/dashboard.enc --remote

# 5. 部署 Worker
npx wrangler deploy

# 6. 配置 Cloudflare Access（零信任网关）
#    Cloudflare Dashboard → Zero Trust → Access → Applications
#    → Add an application → Self-hosted
#    Application URL: 你的 Worker 域名
#    Policy: 只允许白名单邮箱
#    Session Duration: 8 hours
```

## 日常更新数据

```bash
# 1. 替换数据源文件（BI看板订单数据.xlsx、Raw Data.csv）
# 2. 运行处理脚本
node scripts/process_data.js
# 3. 上传加密数据
npx wrangler kv key put --binding=DASHBOARD_DATA "dashboard_enc" --path=public/data/dashboard.enc --remote
# 4. 推送代码（如果有代码变更）
git add .
git commit -m "update data"
git push
```

或者直接双击 `更新数据.bat`

## 权限管理

```bash
# 生成权限配置
node scripts/generate_auth.js
# 上传到 KV
npx wrangler kv key put --binding=AUTH_KV "auth_config" --path=auth_config.json --remote
```

| 角色 | 可见数据 |
|------|----------|
| admin | 全部数据 |
| group_leader | 本大组所有小组和CC |
| tl | 本小组所有CC |
| cc | 仅自己的数据 |

## 安全说明

- ✅ 原始数据文件（xlsx/csv）不上传到 Git
- ✅ 线上数据 AES-256-GCM 加密存储
- ✅ 密钥存在 Workers 环境变量，不暴露
- ✅ Cloudflare Access 零信任网关保护
- ✅ 全程 HTTPS 传输
- ✅ 自带 DDoS 防护和 WAF
