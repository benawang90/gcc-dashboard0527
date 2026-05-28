# GCC Sales Dashboard - 2026年5月

GCC大区销售团队业绩看板，支持多层级下钻分析（大组→小组→个人）。

## 技术栈

- 前端：HTML + ECharts + 原生CSS
- 数据处理：Node.js + xlsx
- 托管：Cloudflare Pages
- 鉴权：Cloudflare Access（邮箱OTP）+ Workers API
- 加密：AES-256-GCM

## 快速开始（本地调试）

```bash
# 1. 安装依赖
npm install

# 2. 处理数据
node scripts/process_data.js

# 3. 打开看板（本地模式无需鉴权）
# 用浏览器打开 public/index.html
```

## 部署到 Cloudflare（公网访问）

### 前置条件

- Cloudflare 账号（免费）
- GitHub 账号
- Node.js v18+
- wrangler CLI v4+（已安装 v4.93.1 ✓）

### 步骤

```bash
# 1. 登录 Cloudflare
npx wrangler login

# 2. 创建 KV namespace（存储权限配置）
npx wrangler kv namespace create AUTH_KV
# 返回结果示例：
# { binding = "AUTH_KV", id = "xxxxxxxxxxxx" }
# 将返回的 id 填入 wrangler.toml 中的 kv_namespaces.id

# 3. 设置加密密钥（会提示你输入一个强密码）
npx wrangler secret put ENCRYPTION_KEY

# 4. 上传权限配置到 KV
npx wrangler kv key put --binding=AUTH_KV "auth_config" --path=auth_config.json

# 5. 部署 Worker
npx wrangler deploy

# 6. 连接 GitHub Repo 到 Cloudflare Pages
#    Cloudflare Dashboard → Pages → Create → Connect to Git
#    Framework preset: None
#    Build command: (留空)
#    Build output directory: public
#    Root directory: (留空或设为项目根目录)

# 7. 配置 Cloudflare Access（零信任网关）
#    Cloudflare Dashboard → Zero Trust → Access → Applications
#    → Add an application → Self-hosted
#    Application URL: 你的 Pages 域名（如 gcc-dashboard.pages.dev）
#    Policy name: GCC Team Only
#    Action: Allow
#    Include → Emails: 添加团队成员邮箱
#    Session Duration: 8 hours
```

### 配置 Cloudflare Access 邮箱白名单

1. 进入 Cloudflare Zero Trust Dashboard
2. Access → Applications → 添加应用
3. Policy 设置：
   - Include: Emails ending in `@yourcompany.com`
   - 或逐个添加允许的邮箱
4. Session Duration: 8 hours

## 日常更新数据

```bash
# 1. 替换数据源文件
#    - BI看板订单数据.xlsx（最新订单）
#    - Raw Data.csv（最新学员数据）

# 2. 重新处理数据
node scripts/process_data.js

# 3. 推送部署
git add public/data/dashboard.enc
git commit -m "update: 5月XX日数据"
git push
# Cloudflare Pages 约30秒自动部署完成
```

## 权限管理

```bash
# 生成/更新权限配置
node scripts/generate_auth.js

# 编辑 auth_config.json 修改邮箱和角色

# 上传到 KV（wrangler v4 语法）
npx wrangler kv key put --binding=AUTH_KV "auth_config" --path=auth_config.json

# 新增/移除成员的 Cloudflare Access 白名单：
# Cloudflare Dashboard → Zero Trust → Access → Applications → 编辑 Policy
```

### 角色说明

| 角色 | 可见数据 |
|------|----------|
| admin | 全部数据 |
| group_leader | 本大组所有小组和CC |
| tl | 本小组所有CC |
| cc | 仅自己的数据 |

## 文件结构

```
├── public/              # 部署到 Cloudflare Pages
│   ├── index.html       # 看板前端
│   └── data/
│       ├── dashboard_data.json  # 未加密（本地调试用）
│       └── dashboard.enc        # AES加密（线上使用）
├── workers/
│   └── api.js           # Cloudflare Worker（鉴权+解密）
├── scripts/
│   ├── process_data.js  # 数据处理+加密
│   └── generate_auth.js # 生成权限配置
├── auth_config.json     # 用户权限映射
├── wrangler.toml        # Cloudflare 部署配置
└── .gitignore           # 排除数据源文件
```

## 安全说明

- ✅ 原始数据文件（xlsx/csv）不上传到 Git
- ✅ 线上数据 AES-256-GCM 加密存储
- ✅ 密钥存在 Workers 环境变量，不暴露
- ✅ Cloudflare Access 零信任网关保护
- ✅ 全程 HTTPS 传输
- ✅ 自带 DDoS 防护和 WAF
