# GCC销售团队5月业绩看板 - 需求文档

## 1. 项目概述

### 1.1 背景
GCC大区（海湾地区）销售团队需要一个动态数据看板，实时追踪2026年5月的销售业绩完成情况，支持从大组→小组→个人的多层级下钻分析。

### 1.2 目标
- 实时展示团队及个人的业绩达成率、单量完成率
- 支持按大组/小组/个人维度切换查看
- 区分MKT（市场）和REF（转介绍）两条业绩线
- 提供漏斗转化分析（注册→约课→出席→付费）

### 1.3 用户
- 主要用户：GCC大区管理层、大组长（Iris、JOCC-assaf03）
- 次要用户：小组TL、CC个人

---

## 2. 数据源说明

| 数据源 | 文件 | 更新频率 | 说明 |
|--------|------|----------|------|
| 人员指标 | target.xlsx | 月初设定 | 57人的月度KPI目标 |
| 组织映射 | mapping.xlsx | 按需更新 | 大组↔小组对应关系 |
| 学员池 | Raw Data.csv | 每日更新 | 17.7万条学员全生命周期数据 |
| 订单明细 | BI看板订单数据.xlsx | 每日更新 | 当月成交订单 |

---

## 3. 数据逻辑

### 3.1 关键关联关系

```
target.xlsx [CRM账号] ←→ BI看板订单数据.xlsx [销售名称]
target.xlsx [七级部门] ←→ mapping.xlsx [小组]
target.xlsx [七级部门] ←→ Raw Data.csv [末次（当前）分配CC员工组名称]
target.xlsx [CRM账号] ←→ Raw Data.csv [末次（当前）分配CC员工姓名]
```

### 3.2 核心指标计算逻辑

#### A. 业绩达成（基于 BI看板订单数据）

日期取值字段：`支付时间(ymdhms)`

| 指标 | 计算逻辑 |
|------|----------|
| **Total业绩** | SUM(支付金额 美元) WHERE 销售名称 = CC的CRM账号 AND 订单状态 = 'success' |
| **MKT业绩** | SUM(支付金额 美元) WHERE 销售渠道类别 = '市场' |
| **REF业绩（CC推荐业绩）** | SUM(支付金额 美元) WHERE 销售渠道类别 = '转介绍' |
| **单量** | COUNT(订单编号) WHERE 销售名称 = CC的CRM账号 AND 订单状态 = 'success' |

> 注意：不剔除退款订单。

#### B. 达成率计算

| 指标 | 公式 |
|------|------|
| **业绩达成率** | 实际Total业绩 / 5月财务标（total） × 100% |
| **单量达成率** | 实际单量 / 5月单量指标 × 100% |
| **REF达成率** | 实际REF业绩 / 5月财务标（Ref） × 100% |
| **挑战标达成率** | 实际Total业绩 / 5月挑战业绩 × 100% |

#### C. 漏斗指标（基于 Raw Data）

筛选条件：`末次（当前）分配CC员工组名称` 属于GCC 8个小组

| 指标 | 计算逻辑 |
|------|----------|
| **注册量** | COUNT(学员ID) WHERE 注册日期 在5月 |
| **约课量** | COUNT(学员ID) WHERE 首次体验课约课日期 在5月 |
| **出席量** | COUNT(学员ID) WHERE 首次体验课出席日期 在5月 |
| **大单有效学员** | COUNT(学员ID) WHERE 是否1v1大单付费 = 1 |

以上指标需支持按以下维度拆分：
- **当前国家名称**：按学员所在国家维度聚合
- **一级渠道（重分类）**：
  - "转介绍"：原始值为"海外转介绍"或"转介绍"
  - "市场"：其他所有值

#### D. 日期处理

数据中日期为Excel序列号格式，需转换：
- Excel日期序列号 → JavaScript Date：`new Date((serialNum - 25569) * 86400 * 1000)`
- 5月范围判断：序列号 46143（2026-05-01）至 46173（2026-05-31）
- BI订单数据日期取值：`支付时间(ymdhms)` 字段

### 3.3 渠道分类逻辑

基于 Raw Data 的`一级渠道`字段重新分类：

| 看板分类 | Raw Data 一级渠道原始值 | BI订单对应字段 |
|----------|------------------------|----------------|
| **转介绍（REF）** | "海外转介绍" 或 "转介绍" | 销售渠道类别 = '转介绍' |
| **市场（MKT）** | 其他所有值（如"海外业务"等） | 销售渠道类别 = '市场' |

target表中指标对应关系：
- `CC推荐业绩` → 对应 BI数据中销售渠道类别='转介绍' 的业绩
- `5月财务标（Ref）` → REF业绩目标
- `MKT` → MKT业绩目标

### 3.4 组织层级

```
GCC大区
├── Iris（大组）
│   ├── ME-JOCC20小组
│   ├── ME-JOCC24小组
│   ├── ME-JOCC35小组
│   └── ME-JOCC85小组
└── JOCC-assaf03（大组）
    ├── ME-JOCC22小组
    ├── ME-JOCC27小组
    ├── ME-JOCC54小组
    └── ME-JOCC75小组
```

---

## 4. 看板页面设计

### 4.1 页面一：总览仪表盘

| 模块 | 内容 |
|------|------|
| **顶部KPI卡片** | 总业绩/总目标、总单量/目标单量、整体达成率、日均业绩 |
| **业绩进度条** | 按大组展示Total/MKT/REF三线达成进度 |
| **日趋势图** | 每日累计业绩曲线 vs 目标线（线性推算） |
| **大组对比** | Iris vs JOCC-assaf03 的核心指标对比 |

### 4.2 页面二：小组明细

| 模块 | 内容 |
|------|------|
| **小组排名** | 8个小组按达成率排序 |
| **小组卡片** | 每个小组的业绩/单量/达成率/人均产出 |
| **漏斗对比** | 各小组注册→约课→出席→付费转化对比 |

### 4.3 页面三：个人明细

| 模块 | 内容 |
|------|------|
| **个人排行榜** | 按业绩/单量/达成率排序 |
| **个人详情卡** | 选中CC后展示：目标、实际、达成率、订单列表 |
| **TL vs CC对比** | 按岗位类型分组对比 |

### 4.4 筛选器

- 大组筛选（Iris / JOCC-assaf03 / 全部）
- 小组筛选（8个小组多选）
- 岗位筛选（TL / CC / player coach）
- 渠道筛选（市场 / 转介绍 / 全部）
- 国家筛选（按当前国家名称，如科威特、阿联酋等）
- 日期范围（默认当月至今）

---

## 5. 系统架构

### 5.1 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                     Cloudflare 安全层                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Cloudflare Access（零信任网关）                          │  │
│  │  - 邮箱 OTP 一次性验证码登录                              │  │
│  │  - 只有白名单邮箱才能访问                                 │  │
│  │  - 自带 DDoS 防护 + WAF 防火墙                          │  │
│  └────────────────────────────────────────────────────────┘  │
│                            │                                  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Cloudflare Workers（鉴权中间层）                         │  │
│  │  - 验证用户身份 → 返回角色和数据权限范围                    │  │
│  │  - AES-256 解密数据 → 按权限过滤 → 返回前端               │  │
│  │  - 密钥存储在 Workers 环境变量中，不暴露给前端             │  │
│  └────────────────────────────────────────────────────────┘  │
│                            │                                  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Cloudflare Pages（静态托管）                             │  │
│  │  - dashboard.html（前端看板页面）                          │  │
│  │  - 加密后的 dashboard_data.enc（密文数据）                 │  │
│  │  - 原始 JSON 不直接暴露                                   │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                            │
┌──────────────────────────────────────────────────────────────┐
│                     本地开发环境（你的电脑）                     │
│  ┌─────────────────────┐  ┌────────────────────────────┐    │
│  │  数据源文件            │  │  Node.js 处理脚本            │    │
│  │  - target.xlsx        │  │  - 读取源文件                │    │
│  │  - mapping.xlsx       │→→│  - 清洗/关联/聚合            │    │
│  │  - Raw Data.csv       │  │  - AES加密                  │    │
│  │  - BI看板订单数据.xlsx  │  │  - 输出加密JSON             │    │
│  └─────────────────────┘  └────────────────────────────┘    │
│                                       │                       │
│                              git push 部署                     │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 技术选型

| 层级 | 技术 | 作用 |
|------|------|------|
| 前端展示 | HTML + ECharts + TailwindCSS | 图表渲染、响应式布局 |
| 数据处理 | Node.js + xlsx 库 | 本地读取Excel/CSV，生成JSON |
| 数据加密 | AES-256-GCM | 加密处理后的JSON |
| 静态托管 | Cloudflare Pages | 全球CDN分发，HTTPS |
| 鉴权网关 | Cloudflare Access | 邮箱OTP零信任验证 |
| API中间层 | Cloudflare Workers | 解密+权限过滤+数据下发 |
| 版本管理 | Git + GitHub Private Repo | 代码和加密数据版本控制 |

### 5.3 安全设计

#### 5.3.1 访问控制（三层防护）

```
第1层：Cloudflare Access（网关级）
  └── 只有白名单邮箱能进入页面
  └── 每次访问需邮箱验证码（OTP）
  └── 支持设置Session有效期（如8小时）

第2层：Workers API 鉴权（应用级）
  └── 验证 Cloudflare Access JWT Token
  └── 从 Token 中提取用户邮箱
  └── 查询权限配置，确定可见数据范围

第3层：数据加密（存储级）
  └── JSON数据 AES-256-GCM 加密后托管
  └── 密钥仅存在 Workers 环境变量中
  └── 即使源码泄露，无密钥无法解密
```

#### 5.3.2 数据安全措施

| 措施 | 说明 |
|------|------|
| 传输加密 | 全程 HTTPS（TLS 1.3） |
| 存储加密 | AES-256-GCM 加密JSON，密钥在Workers环境变量 |
| 访问审计 | Cloudflare 自带访问日志，记录谁何时访问 |
| 代码仓库 | GitHub Private Repo，仅你能访问 |
| 源数据隔离 | 原始Excel/CSV不上传，只上传加密后的产物 |
| DDoS防护 | Cloudflare 企业级防护，自动拦截 |
| WAF防火墙 | 自动拦截SQL注入、XSS等攻击 |

### 5.4 文件结构

```
06-看板-kiro/
├── 数据源/（不上传到Git，仅本地保留）
│   ├── target.xlsx
│   ├── mapping.xlsx
│   ├── Raw Data.csv
│   └── BI看板订单数据.xlsx
├── scripts/
│   ├── process_data.js        # 数据处理+加密脚本
│   └── generate_auth.js       # 生成权限配置
├── public/（部署到 Cloudflare Pages）
│   ├── index.html             # 看板主页面
│   └── data/
│       └── dashboard.enc      # AES加密后的数据文件
├── workers/
│   └── api.js                 # Cloudflare Worker（解密+鉴权+过滤）
├── auth_config.json           # 用户-权限映射（部署到Workers KV）
├── .gitignore                 # 排除数据源文件
├── wrangler.toml              # Cloudflare 部署配置
├── package.json
├── README.md
└── 需求文档-GCC销售看板.md
```

### 5.5 数据处理流程

```
本地执行（你的电脑）：
1. 读取 mapping.xlsx → 构建 大组-小组 映射字典
2. 读取 target.xlsx → 构建 CC人员目标字典（key: CRM账号）
3. 读取 BI看板订单数据.xlsx → 按销售名称聚合业绩/单量
4. 读取 Raw Data.csv → 按CC组/CC人筛选5月数据，计算漏斗指标
5. 合并所有维度 → 生成完整 dashboard_data.json
6. AES-256-GCM 加密 → 输出 public/data/dashboard.enc
7. git push → 自动部署到 Cloudflare Pages

线上执行（用户访问时）：
1. 用户访问看板 URL → Cloudflare Access 拦截
2. 输入邮箱 → 收到 OTP 验证码 → 验证通过
3. 前端加载 → 请求 Workers API 获取数据
4. Workers 验证 JWT → 读取加密数据 → 解密 → 按权限过滤
5. 返回该用户可见范围的数据 → 前端渲染图表
```

---

## 6. 部署与更新操作流程

### 6.1 首次部署（一次性）

```
步骤1：注册 Cloudflare 账号（免费）
        > https://dash.cloudflare.com/sign-up

步骤2：创建 GitHub Private Repo
        > 在 GitHub 新建私有仓库

步骤3：Cloudflare Pages 绑定 GitHub Repo
        > Cloudflare Dashboard → Pages → Create → 连接 GitHub

步骤4：配置 Cloudflare Access
        > Zero Trust → Access → Applications → Add
        > 设置邮箱白名单（团队成员的邮箱）
        > Session 有效期设为 8 小时

步骤5：部署 Worker
        > 安装 wrangler CLI：npm install -g wrangler
        > 配置加密密钥：wrangler secret put ENCRYPTION_KEY
        > 部署：wrangler deploy

步骤6：本地初始化
        > npm install
        > 将4个数据源文件放入 数据源/ 目录
        > node scripts/process_data.js
        > git push（自动触发 Cloudflare Pages 部署）
```

### 6.2 日常更新数据

```
步骤1：替换数据源文件
        > 更新 BI看板订单数据.xlsx 和 Raw Data.csv

步骤2：运行处理脚本
        > node scripts/process_data.js

步骤3：推送部署
        > git add public/data/dashboard.enc
        > git commit -m "更新5月x日数据"
        > git push
        （Cloudflare Pages 约30秒自动部署完成）
```

### 6.3 管理访问权限

```
新增团队成员：
  > Cloudflare Dashboard → Zero Trust → Access → 添加邮箱到白名单
  > 编辑 auth_config.json 添加角色映射
  > git push 生效

移除成员：
  > Cloudflare Access 白名单删除邮箱（立即生效，无法再登录）
```

---

## 7. 权限设计

### 7.1 角色与数据权限

| 角色 | 可见范围 | 对应人员 | Cloudflare Access |
|------|----------|----------|-------------------|
| **管理员** | 全部数据（大区级） | 大区负责人 | ✅ 邮箱白名单 |
| **大组长** | 本大组所有小组及CC数据 | Iris、JOCC-assaf03 | ✅ 邮箱白名单 |
| **小组TL** | 本小组所有CC数据 | 各小组TL | ✅ 邮箱白名单 |
| **CC** | 仅自己的数据 | 普通CC | ✅ 邮箱白名单 |

### 7.2 双层认证机制

```
第1层（网关）：Cloudflare Access
  - 访问看板URL时自动拦截
  - 输入邮箱 → 收到一次性验证码 → 输入验证
  - 通过后获得 Session（8小时有效）
  - 不在白名单的邮箱直接拒绝

第2层（应用）：Workers 数据权限过滤
  - 从 Cloudflare Access JWT 中提取邮箱
  - 查询 auth_config.json 获取角色和可见范围
  - 只返回该角色权限内的数据
```

### 7.3 权限配置文件

`auth_config.json`（部署到 Workers KV 存储）：
```json
{
  "users": {
    "admin@company.com": { "role": "admin", "scope": "all", "name": "管理员" },
    "iris@company.com": { "role": "group_leader", "scope": "Iris", "name": "Iris" },
    "assaf@company.com": { "role": "group_leader", "scope": "JOCC-assaf03", "name": "Assaf" },
    "baha@company.com": { "role": "tl", "scope": "ME-JOCC20小组", "name": "Baha" },
    "dais@company.com": { "role": "cc", "scope": "JOCC-abdalahdais", "name": "Abdallah" }
  }
}
```

### 7.4 安全审计

- Cloudflare 自动记录每次访问日志（IP、时间、邮箱）
- 异常访问（如频繁失败验证）自动告警
- 可随时在 Cloudflare Dashboard 查看访问记录

---

## 8. 交付物

| 文件 | 说明 |
|------|------|
| `scripts/process_data.js` | 数据处理+AES加密脚本 |
| `scripts/generate_auth.js` | 根据target.xlsx生成权限配置 |
| `public/index.html` | 看板前端页面（ECharts图表） |
| `workers/api.js` | Cloudflare Worker（解密+鉴权+过滤） |
| `auth_config.json` | 用户角色权限映射 |
| `wrangler.toml` | Cloudflare 部署配置 |
| `package.json` | 项目依赖 |
| `.gitignore` | 排除数据源文件 |
| `README.md` | 完整部署和使用指南 |

---

## 9. 成本估算

| 项目 | 费用 |
|------|------|
| Cloudflare Pages | 免费（无限站点、无限带宽） |
| Cloudflare Workers | 免费（每日10万次请求额度） |
| Cloudflare Access | 免费（50用户以内） |
| GitHub Private Repo | 免费 |
| **合计** | **¥0/月** |

> 你的团队57人，完全在 Cloudflare 免费额度内。
