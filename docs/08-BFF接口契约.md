# 08 · BFF 接口契约（前后端分工基准）

> **本文档的作用**：前端（platform/）与后端（BFF）的分工基准。前端按第四章的接口契约写请求，
> 后端按第三章建表、第四章实现端点、第五章对接知乎 API。双方不需要读对方的代码。
>
> **权威链**：知乎接口细节以 `web/OpenApi开发文档（标准版）V1.4.17.pdf` 为准
> → 其次 [03-接口文档.md](./03-接口文档.md)、[04-签名机制.md](./04-签名机制.md)
> → 本文档只负责「我们的 BFF 长什么样」。
>
> **⚠️ 本文档取代 `知乎推广KOC运营平台-技术开发规范.docx` 的第 2、4、5 章。**
> 那份 docx 的第 5 章（知乎 API 对接）端点是推测值且签名算法漏了一步，不要参照。
> docx 的第 1、3、6、7、8 章（技术栈、权限体系、架构、优先级、安全清单）仍然有效。

---

## 一、必读修正：三处与既有认知冲突的地方

开工前必须先看这三条，否则会写出跑不通的代码。

### 1.1 签名是两层哈希，不是一层

```
signature = HmacSHA256_hex_lower( MD5_hex_lower( sortedKvString ), secret_key )
```

先对排序拼接后的字符串做 **MD5 并转小写**，再用 `secret_key` 对**这个 32 位 MD5 字符串**做
HmacSHA256。少了中间那层 MD5 会一直报 `timestamp 无效`（这个报错不精确，签名错也报它）。

其他容易踩的点：

| 项 | 实际情况 | 常见错误假设 |
|---|---|---|
| 字段名 | `access_token`、`signature` | `app_key`、`sign` |
| 随机数 | **没有 nonce**，防重放只靠 timestamp | 以为要传 nonce |
| 时间戳 | **秒级**（10 位） | 毫秒级 |
| URL 编码 | **值不编码**，中文和 `://` 原样拼接 | 用 `encodeURIComponent` |
| 数字类型 | 直接转字符串不加引号 `popularize_type=0` | `popularize_type="0"` |
| 排序 | 按 **key** 字典升序（JS 默认 sort） | 按 value 排 |

### 1.2 「推广计划」就是「一个关键词」

`POST /alliance/api/popularize_plan` 的必填参数里直接有 `keyword`，且官方注明
**「仅支持单个关键词」**。所以知乎的对象层级是：

```
推广任务 task（知乎给的推广活动，只读）
  └── 推广计划 plan = 一个关键词 + 一个落地内容 URL
        └── 推广作品 composition（KOC 在抖音/小红书等发的内容）
```

**这意味着不存在独立的「关键词表」。** 绑词 = 创建计划。前端 `/dashboard/keywords`
和 `/dashboard/campaigns` 两个页面操作的是**同一个后端资源**，只是视角不同：
campaigns 按计划维度看，keywords 按关键词维度看。

PRD 里「M03 绑词回传」和「M01 推广工作台」在后端是一套 CRUD，不要建两套。

### 1.3 v1 接口 2026-08-25 下线

新代码**只准用 v2**：

| 用途 | 只用这个 | 不要用 |
|---|---|---|
| 单个创建作品 | `POST /alliance/api/popularize_composition/v2` | `/popularize_composition` |
| 批量创建作品 | `POST /alliance/api/popularize_compositions/v2` | `/popularize_compositions` |
| 单个更新作品 | `PUT /alliance/api/popularize_composition/v2/:id` | `/popularize_composition/:id` |

v2 的差异：`composition_sub_type`（作品二级分类）**必填且参与签名**，一级分类取消了 `3-截图`。

---

## 二、当前真实进度（2026-08-15 实盘）

⚠️ **本章已过期**：§2.1 和 §2.3 描述的「前端缺什么」四条论断全部失效。
实际进度应以代码仓库为准，或参考 [10-platform-权限门控.md](./10-platform-权限门控.md) 了解路由与权限的实际实现。

`.env.local` 里有真实凭据，**不要提交、不要打印、不要贴进任何文档**。

### 2.3 仓库状态

`D:\ITEM\zhihu-app` **不是 git 仓库**。`docs/06-编码规范.md` 里的分支策略、
Conventional Commits、husky 钩子目前全部无法生效。建议 codex 接手后端前先 `git init`，
否则两边并行开发没法合。

---

## 三、数据库设计

### 3.0 先解决一个架构冲突：要不要落库

`docs/02-开发计划.md` 把「数据落库与历史归档」列进了 Out of Scope，一期直连知乎接口。
但 PRD 要求分级收益可见性、历史趋势、团队聚合 —— 这三件事直连做不到。

**结论：混合模式。** 按数据性质分三类：

| 类别 | 处理方式 | 为什么 |
|---|---|---|
| 组织结构、鉴权、收益台账、提现、审计 | **必须本地库** | 知乎完全不知道我们的三级代理结构，这些数据它那儿没有 |
| 渠道列表、推广任务列表、作品审核状态 | **直连透传 + 短缓存(5min)** | 变化不频繁，知乎是唯一真相源，本地存了反而要处理一致性 |
| 每日指标（曝光/点击/收益） | **本地镜像 + 幂等 upsert** | ① 分级聚合必须能 GROUP BY owner_id；② 知乎会修订历史数据；③ 接口有日配额，不能每次看报表都打一遍 |

镜像的关键是**幂等**：知乎的 `real_time_data` 和 `daily_data` 对同一天会返回修订后的值，
所以按 `(channel_id, keyword, stat_date)` 做 UNIQUE + `ON DUPLICATE KEY UPDATE`，
每次拉取覆盖写，不要 INSERT 累加。

### 3.1 表清单

10 张表。相比 docx 第 2 章的 8 张：**删除 `keywords`**（并入 `plans`），
**新增 `channels`、`tasks`、`daily_metrics`**，`creatives` 更名为 `compositions` 并补齐知乎必填字段。

```
users                 三级角色与上下级关系
projects              多平台扩展（知乎为第一个）
channels              知乎渠道（一代/二代），归属映射的锚点
tasks                 知乎推广任务（只读镜像）
plans                 推广计划 = 一个关键词 ← 核心表
compositions          推广作品（KOC 在各媒体发的内容）
daily_metrics         每日指标镜像（幂等 upsert）
earnings              收益台账
withdrawal_requests   提现申请
audit_logs            审计日志（只写不改）
```

### 3.2 users

```sql
CREATE TABLE users (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  username      VARCHAR(64)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,              -- bcrypt cost=12
  role          ENUM('boss','leader','member') NOT NULL,
  parent_id     BIGINT NULL,                        -- 自引用：member→leader，leader→boss
  display_name  VARCHAR(64)  NOT NULL,
  phone         VARCHAR(20)  NULL,
  zhihu_uid     VARCHAR(64)  NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  must_change_pwd TINYINT(1) NOT NULL DEFAULT 1,    -- 首次登录强制改密
  last_login_at DATETIME NULL,
  created_by    BIGINT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_parent FOREIGN KEY (parent_id) REFERENCES users(id),
  INDEX idx_users_parent (parent_id),
  INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

约束：`role='boss'` 时 `parent_id` 必须为 NULL；`role='member'` 时 `parent_id` 必须指向
一个 `leader` 或 `boss`（达人可以直挂 boss，即「个人」身份）。这个校验放在业务层，不做 CHECK。

### 3.3 projects（多平台扩展点）

```sql
CREATE TABLE projects (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  name         VARCHAR(64)  NOT NULL,               -- '知乎'
  slug         VARCHAR(32)  NOT NULL UNIQUE,        -- 'zhihu'
  api_base_url VARCHAR(255) NOT NULL,               -- 'https://open.zhihu.com'
  sign_method  ENUM('hmac_sha256','oauth2') NOT NULL DEFAULT 'hmac_sha256',
  is_enabled   TINYINT(1)   NOT NULL DEFAULT 1,
  config_json  JSON NULL,                           -- 平台特有配置
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`access_token` / `secret_key` **不入库明文**，走环境变量或 KMS。`config_json` 里只放
非敏感配置（配额上限、超时、重试次数）。

### 3.4 channels（归属映射的锚点）

```sql
CREATE TABLE channels (
  id                BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id        BIGINT NOT NULL,
  zhihu_channel_id  VARCHAR(32) NOT NULL,           -- 知乎 channel_id，雪花 ID，字符串存
  parent_channel_id VARCHAR(32) NULL,               -- 二代渠道的父渠道
  generation        TINYINT NOT NULL,               -- 1=一代 2=二代
  name              VARCHAR(128) NOT NULL,
  owner_id          BIGINT NULL,                    -- 映射到本地 users.id
  commission_rate   DECIMAL(6,4) NULL,              -- 存 0.1500 不存 '15%'
  is_enabled        TINYINT(1) NOT NULL DEFAULT 1,
  synced_at         DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_channels_zhihu (project_id, zhihu_channel_id),
  INDEX idx_channels_owner (owner_id),
  CONSTRAINT fk_channels_owner FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**归属映射规则**（PRD 三级角色 ↔ 知乎渠道）：

| 本地角色 | 知乎渠道 | 说明 |
|---|---|---|
| boss / 我们 | 一代渠道持有者 | 看全量 |
| leader / 组长·团长 | 二代渠道 | `generation=2`，`parent_channel_id` 指向一代 |
| member / KOC达人 | 二代渠道下的关键词 | 知乎不再往下分渠道，靠 keyword 区分 |

⚠️ **知乎只有两代渠道，我们有三级角色。** 所以达人级别的归属**不能靠渠道判断**，
必须靠本地 `plans.owner_id`。可靠的归属链是：

```
知乎回传的 (channel_id, keyword) → 本地 plans 表查 owner_id → users 表查 parent_id → 分级聚合
```

为了让这条链不产生歧义，`plans` 上必须有 `UNIQUE (channel_id, keyword)`（见 §3.6）。
同一个二代渠道下**同一个词不能被两个达人绑**，否则收益无法归属。这个约束要在
创建计划时前置校验并给出明确报错，不能等数据库报 duplicate。

### 3.5 tasks（知乎推广任务，只读镜像）

```sql
CREATE TABLE tasks (
  id             BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id     BIGINT NOT NULL,
  zhihu_task_id  VARCHAR(32) NOT NULL,
  name           VARCHAR(255) NOT NULL,
  popularize_type TINYINT NULL,                     -- 推广类型
  settle_type    VARCHAR(32) NULL,                  -- 结算方式
  unit_price     DECIMAL(12,4) NULL,
  start_time     DATETIME NULL,
  end_time       DATETIME NULL,
  status         VARCHAR(32) NULL,
  raw_json       JSON NULL,                         -- 原始响应，字段变动时兜底
  synced_at      DATETIME NOT NULL,
  UNIQUE KEY uk_tasks_zhihu (project_id, zhihu_task_id),
  INDEX idx_tasks_time (start_time, end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`raw_json` 留着是因为知乎接口字段可能加，加了不用改表。

### 3.6 plans（核心表 · 一行 = 一个关键词绑定）

```sql
CREATE TABLE plans (
  id                 BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id         BIGINT NOT NULL,
  zhihu_plan_id      VARCHAR(32) NULL,              -- 知乎返回的计划 ID，创建成功后回填
  zhihu_task_id      VARCHAR(32) NOT NULL,          -- 关联的推广任务
  channel_id         VARCHAR(32) NOT NULL,          -- 一代渠道
  second_channel_id  VARCHAR(32) NULL,              -- 二代渠道（组长/团长的渠道）
  keyword            VARCHAR(128) NOT NULL,         -- ★ 单个关键词，知乎不支持多词
  landing_url        VARCHAR(1024) NOT NULL,        -- 推广落地内容 URL
  popularize_type    TINYINT NOT NULL,
  owner_id           BIGINT NOT NULL,               -- ★ 归属人，分级可见性的依据
  created_by         BIGINT NOT NULL,               -- 实际操作人（可能是组长代建）
  name               VARCHAR(255) NULL,
  status             ENUM('pending','active','paused','rejected','ended')
                       NOT NULL DEFAULT 'pending',
  reject_reason      VARCHAR(512) NULL,
  daily_budget       DECIMAL(12,2) NULL,
  start_date         DATE NULL,
  end_date           DATE NULL,
  sync_status        ENUM('local','syncing','synced','failed')
                       NOT NULL DEFAULT 'local',    -- 与知乎的同步状态
  sync_error         VARCHAR(512) NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                       ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_plans_channel_keyword (channel_id, keyword),   -- ★ 见 §3.4 归属歧义
  UNIQUE KEY uk_plans_zhihu (project_id, zhihu_plan_id),
  INDEX idx_plans_owner (owner_id),
  INDEX idx_plans_keyword (keyword),
  INDEX idx_plans_status (status),
  CONSTRAINT fk_plans_owner FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**`sync_status` 是必须的**，因为创建计划要打知乎接口，可能失败或超时。前端点了「创建」
要立刻看到一条 `local/syncing` 的记录，而不是转圈等外部接口。失败的可以重试。

**权限**（对应 PRD 修订后的第 5.4 章）：boss/leader/member **三种角色都可以创建计划**，
即达人可以自己绑词。差别只在可见范围（§4.0）和是否能配置回传规则（只有 boss 能）。

### 3.7 compositions（推广作品）

```sql
CREATE TABLE compositions (
  id                    BIGINT PRIMARY KEY AUTO_INCREMENT,
  plan_id               BIGINT NOT NULL,
  owner_id              BIGINT NOT NULL,
  zhihu_composition_id  VARCHAR(32) NULL,
  media_type            TINYINT NOT NULL,          -- 媒体平台：抖音/小红书/B站…
  media_account         VARCHAR(128) NOT NULL,     -- KOC 在该平台的账号
  composition_type      TINYINT NOT NULL,          -- 一级分类（v2 已无 3-截图）
  composition_sub_type  TINYINT NOT NULL,          -- ★ v2 必填且参与签名
  title                 VARCHAR(255) NULL,
  promo_url             VARCHAR(1024) NOT NULL,    -- 作品在媒体平台的链接
  release_time          DATETIME NULL,             -- 作品发布时间
  status                ENUM('pending','active','rejected','ended')
                          NOT NULL DEFAULT 'pending',
  reject_reason         VARCHAR(512) NULL,
  sync_status           ENUM('local','syncing','synced','failed')
                          NOT NULL DEFAULT 'local',
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                          ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_comp_zhihu (zhihu_composition_id),
  INDEX idx_comp_plan (plan_id),
  INDEX idx_comp_owner (owner_id),
  CONSTRAINT fk_comp_plan FOREIGN KEY (plan_id) REFERENCES plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`media_type` / `composition_type` / `composition_sub_type` 的枚举值取自
`OpenApi开发文档（标准版）V1.4.17.pdf` 附录，**不要自己编**。这三个枚举后端要导出成
`GET /api/v1/meta/enums` 给前端，前端不硬编码（见 §4.7）。

### 3.8 daily_metrics（每日指标镜像 · 幂等）

```sql
CREATE TABLE daily_metrics (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id   BIGINT NOT NULL,
  channel_id   VARCHAR(32) NOT NULL,
  keyword      VARCHAR(128) NOT NULL,
  plan_id      BIGINT NULL,                        -- 本地关联，可能为 NULL（词是站外来的）
  owner_id     BIGINT NULL,                        -- 冗余，避免聚合时多次 JOIN
  stat_date    DATE NOT NULL,
  impressions  BIGINT       NOT NULL DEFAULT 0,
  clicks       BIGINT       NOT NULL DEFAULT 0,
  conversions  BIGINT       NOT NULL DEFAULT 0,
  earning      DECIMAL(14,4) NOT NULL DEFAULT 0,
  raw_json     JSON NULL,
  fetched_at   DATETIME NOT NULL,
  UNIQUE KEY uk_metrics_dim (project_id, channel_id, keyword, stat_date),  -- ★ 幂等键
  INDEX idx_metrics_owner_date (owner_id, stat_date),
  INDEX idx_metrics_date (stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

写入必须是 upsert：

```sql
INSERT INTO daily_metrics (...) VALUES (...)
ON DUPLICATE KEY UPDATE
  impressions = VALUES(impressions),   -- 覆盖，不是 +=
  clicks      = VALUES(clicks),
  conversions = VALUES(conversions),
  earning     = VALUES(earning),
  raw_json    = VALUES(raw_json),
  fetched_at  = VALUES(fetched_at);
```

**知乎会修订历史数据**，所以拉取窗口不能只拉昨天。建议定时任务每次回溯 **T-7 到 T-1**，
全部覆盖写。`owner_id` 在写入时通过 `(channel_id, keyword)` 查 `plans` 填充，
查不到就留 NULL 并记一条告警（说明有站外绑的词，需要人工认领）。

### 3.9 earnings / withdrawal_requests / audit_logs

```sql
CREATE TABLE earnings (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id     BIGINT NOT NULL,
  project_id  BIGINT NOT NULL,
  plan_id     BIGINT NULL,
  settle_date DATE   NOT NULL,
  amount      DECIMAL(14,4) NOT NULL,
  status      ENUM('pending','confirmed','paid') NOT NULL DEFAULT 'pending',
  source_ref  VARCHAR(128) NULL,                   -- 知乎结算单号，用于对账
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_earnings_dedup (user_id, project_id, plan_id, settle_date),
  INDEX idx_earnings_user_date (user_id, settle_date),
  CONSTRAINT fk_earnings_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE withdrawal_requests (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id     BIGINT NOT NULL,
  amount      DECIMAL(14,2) NOT NULL,
  pay_method  ENUM('alipay','wechat') NOT NULL,
  pay_account VARCHAR(128) NOT NULL,               -- 展示时脱敏
  status      ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  remark      VARCHAR(512) NULL,
  handled_by  BIGINT NULL,
  handled_at  DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wd_user (user_id, status),
  CONSTRAINT fk_wd_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE audit_logs (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id       BIGINT NULL,
  action        VARCHAR(64)  NOT NULL,             -- 'plan.create' / 'user.reset_pwd'
  resource_type VARCHAR(32)  NOT NULL,
  resource_id   VARCHAR(64)  NULL,
  detail_json   JSON NULL,
  ip            VARCHAR(45)  NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_user_time (user_id, created_at),
  INDEX idx_audit_action (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`earnings` 的 UNIQUE 是为了防止定时任务重跑导致收益翻倍。`audit_logs` **只 INSERT，
不 UPDATE 不 DELETE**，保留 180 天，必须记录的动作：登录、改密、建/删子账号、
建/改/删计划、配置回传规则、提现审批。

---

## 四、BFF 接口契约

前端只跟这一层说话，**前端永远不直接请求 `open.zhihu.com`**。

### 4.0 全局约定

**前缀**：所有接口 `/api/v1/*`。前端 `.env` 里配 `VITE_API_BASE_URL=/api/v1`，
Vite dev proxy 转发到 BFF（默认 `http://localhost:3000`）。

**鉴权**：除 `/auth/login` 外全部要求 `Authorization: Bearer <jwt>`。

**响应包封**（成功）：

```json
{ "code": 0, "data": { }, "message": "ok" }
```

**响应包封**（失败）：

```json
{ "code": 40301, "data": null, "message": "无权访问该资源" }
```

HTTP 状态码同时正确设置（401/403/404/422/500），前端拦截器按 HTTP 状态分流，
按 `code` 做细分提示。**`message` 必须是可以直接弹给用户看的中文**，
知乎返回的英文错误由后端翻译，不要透传。

**分页**：请求 `?page=1&pageSize=20`，响应

```json
{ "code": 0, "data": { "list": [], "total": 137, "page": 1, "pageSize": 20 } }
```

**字段命名**：BFF 对前端一律 **camelCase**。知乎的 snake_case 在后端转换完成，
前端不处理两套命名。（注：这一条与 `docs/06-编码规范.md` 里「API 字段保留 snake_case」
不同 —— 那条规则针对 `web/` 直连知乎的场景；`platform/` 走 BFF，用 camelCase。）

**分级可见性**：**由后端强制**，前端不传 `ownerId` 之类的过滤参数。
后端从 JWT 的 `sub`/`role` 推导可见范围：

| role | 可见范围 SQL 条件 |
|---|---|
| `boss` | 无限制 |
| `leader` | `owner_id IN (SELECT id FROM users WHERE parent_id = :me OR id = :me)` |
| `member` | `owner_id = :me` |

⚠️ 这个条件要写成一个共享的 `scopeFilter(user)` 工具函数，**每个列表/统计接口都必须调用**。
漏一个就是越权。建议加一条集成测试：用 member 的 token 遍历所有 GET 接口，
断言返回数据里没有其他 owner 的记录。

### 4.1 鉴权与账号

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/auth/login` | 公开 | 入参 `{username, password}`，出参 `{token, user, mustChangePwd}` |
| POST | `/auth/logout` | 全部 | 服务端把 jti 加入黑名单 |
| GET | `/auth/me` | 全部 | 返回当前用户 + 权限点列表 |
| POST | `/auth/change-password` | 全部 | `{oldPassword, newPassword}`，成功后旧 token 失效 |

`/auth/me` 的响应要带 `permissions` 数组，前端用它控制按钮显隐，不在前端写
`if (role === 'boss')`：

```json
{
  "code": 0,
  "data": {
    "id": 42, "username": "zhangsan", "displayName": "张三",
    "role": "leader", "parentId": 1,
    "permissions": ["plan.create","plan.edit","keyword.bind",
                    "team.view","team.create_member","earning.view_team"]
  }
}
```

权限点全集（后端定义，前端只消费）：

```
plan.create  plan.edit  plan.delete  keyword.bind  callback.config  callback.secret
composition.create  composition.edit
team.view  team.create_member  team.reset_pwd  team.disable
earning.view_self  earning.view_team  earning.view_all
withdraw.apply  withdraw.approve
project.manage  audit.view
```

### 4.2 团队与子账号

| 方法 | 路径 | 权限点 | 说明 |
|---|---|---|---|
| GET | `/team/members` | `team.view` | 分级过滤，leader 只看到自己组 |
| POST | `/team/members` | `team.create_member` | 创建下级，`parentId` 由后端强制设为当前用户 |
| PATCH | `/team/members/:id` | `team.create_member` | 改 displayName/phone，只能改自己的下级 |
| POST | `/team/members/:id/reset-password` | `team.reset_pwd` | 返回临时密码，`mustChangePwd=1` |
| POST | `/team/members/:id/disable` | `team.disable` | 停用，不物理删除 |

⚠️ `POST /team/members` 的 `parentId` **必须忽略请求体里的值**，强制用 JWT 的 `sub`。
否则 leader 可以把账号挂到别人组下。boss 可以显式指定 `parentId`（含 NULL，即创建「个人」达人）。

### 4.3 渠道与任务（直连透传 + 缓存）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/channels` | 全部 | 分级过滤；member 只看到自己绑过词的渠道 |
| POST | `/channels/sync` | `project.manage` | 手动触发从知乎同步渠道列表 |
| PATCH | `/channels/:id/owner` | `project.manage` | 把渠道映射到本地用户（§3.4 归属映射） |
| GET | `/tasks` | 全部 | 推广任务列表，支持 `?status=&keyword=` |
| GET | `/tasks/:id` | 全部 | 任务详情 |
| POST | `/tasks/sync` | `project.manage` | 手动同步 |

### 4.4 推广计划（= 关键词绑定 · 核心）

| 方法 | 路径 | 权限点 | 说明 |
|---|---|---|---|
| GET | `/plans` | 全部（分级） | `?taskId=&channelId=&keyword=&status=&page=` |
| GET | `/plans/:id` | 全部（分级） | |
| POST | `/plans` | `plan.create` | 创建 = 绑一个词，见下方入参 |
| PATCH | `/plans/:id` | `plan.edit` | 改 landingUrl/name/预算，**keyword 不可改** |
| DELETE | `/plans/:id` | `plan.delete` | 软删，置 `status='ended'` |
| POST | `/plans/:id/retry-sync` | `plan.create` | `sync_status='failed'` 时重推知乎 |
| POST | `/plans/check-keyword` | `keyword.bind` | 前置校验词是否已被占用，见 §4.4.1 |

**POST /plans 入参**：

```json
{
  "taskId": "1234567890123456789",
  "channelId": "9876543210987654321",
  "secondChannelId": "1122334455667788990",
  "keyword": "程序员接单",
  "landingUrl": "https://zhuanlan.zhihu.com/p/123456789",
  "popularizeType": 0,
  "name": "8月-程序员接单",
  "dailyBudget": 500.00
}
```

后端处理顺序（**顺序很重要**）：

1. 校验权限点 `plan.create`
2. 校验 `(channelId, keyword)` 未被占用 → 占用则返回 `40901` + 占用者信息（脱敏）
3. 本地插入 `plans`，`sync_status='local'`，`owner_id` = JWT.sub（boss 可代建时显式指定）
4. **立即返回 201**，前端拿到记录就能渲染
5. 异步（队列或 setImmediate）调 `POST /alliance/api/popularize_plan`
6. 成功 → 回填 `zhihu_plan_id`，`sync_status='synced'`；失败 → `'failed'` + `sync_error`
7. 写 `audit_logs`

**不要同步等知乎返回再响应前端**。知乎接口偶发超时，同步等会让前端卡住甚至超时重复提交。

#### 4.4.1 keyword 占用校验

```
POST /plans/check-keyword
{ "channelId": "987...", "keyword": "程序员接单" }

→ 可用：{ "code": 0, "data": { "available": true } }
→ 占用：{ "code": 0, "data": {
      "available": false,
      "occupiedBy": "张**",           // 脱敏
      "occupiedByMe": false,
      "planId": "12"                  // 仅 occupiedByMe=true 时返回
  }}
```

前端在关键词输入框失焦时调这个接口做即时提示，避免用户填完一长串表单才被拒。

### 4.5 推广作品

| 方法 | 路径 | 权限点 | 说明 |
|---|---|---|---|
| GET | `/compositions` | 全部（分级） | `?planId=&status=` |
| POST | `/compositions` | `composition.create` | 对应知乎 v2 单个创建 |
| POST | `/compositions/batch` | `composition.create` | 对应知乎 v2 批量创建 |
| PATCH | `/compositions/:id` | `composition.edit` | 对应知乎 v2 更新 |
| GET | `/compositions/:id/audit-status` | 全部（分级） | 拉取审核状态与驳回原因 |

`POST /compositions` 入参必须带 `compositionSubType`（v2 必填）：

```json
{
  "planId": "12",
  "mediaType": 1,
  "mediaAccount": "douyin_abc123",
  "compositionType": 1,
  "compositionSubType": 11,
  "title": "程序员副业接单实测",
  "promoUrl": "https://v.douyin.com/xxxxx/",
  "releaseTime": "2026-08-06T14:30:00+08:00"
}
```

### 4.6 数据与收益

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/metrics/overview` | 全部（分级） | 工作台顶部卡片：今日/累计 曝光·点击·转化·收益 |
| GET | `/metrics/trend` | 全部（分级） | `?from=&to=&granularity=day`，折线图数据 |
| GET | `/metrics/by-keyword` | 全部（分级） | 关键词维度表格，支持排序分页 |
| GET | `/metrics/by-member` | `earning.view_team` | 成员维度（leader 看本组，boss 看全部） |
| POST | `/metrics/sync` | `project.manage` | 手动触发 T-7~T-1 回溯拉取 |
| GET | `/earnings` | 全部（分级） | 收益台账明细 |
| GET | `/earnings/summary` | 全部（分级） | 待结算/已结算/已提现 三档汇总 |
| GET | `/withdrawals` | 全部（分级） | 提现记录 |
| POST | `/withdrawals` | `withdraw.apply` | 申请提现 |
| POST | `/withdrawals/:id/approve` | `withdraw.approve` | 审批（boss） |
| POST | `/withdrawals/:id/reject` | `withdraw.approve` | 驳回，必填 remark |

`/metrics/trend` 响应格式（直接喂给图表，前端不做二次聚合）：

```json
{ "code": 0, "data": {
    "dates": ["2026-07-31","2026-08-01","2026-08-02"],
    "series": [
      { "name": "曝光", "key": "impressions", "values": [12034, 15890, 14200] },
      { "name": "点击", "key": "clicks",      "values": [820, 1100, 970] },
      { "name": "收益", "key": "earning",     "values": [156.20, 210.55, 188.00] }
    ]
}}
```

### 4.7 回传配置与元数据

| 方法 | 路径 | 权限点 | 说明 |
|---|---|---|---|
| GET | `/callbacks/rules` | 全部（分级只读） | 回传规则列表 |
| POST | `/callbacks/rules` | `callback.config` | 仅 boss |
| PATCH | `/callbacks/rules/:id` | `callback.config` | 仅 boss |
| GET | `/callbacks/secret` | `callback.secret` | **返回脱敏值** `sk_live_****3f2a`，仅 boss |
| POST | `/callbacks/secret/rotate` | `callback.secret` | 轮换秘钥，仅 boss |
| GET | `/callbacks/logs` | 全部（分级） | 回传日志，排查归因问题 |
| GET | `/meta/enums` | 全部 | 见下 |

**`GET /meta/enums`** 把知乎的枚举值集中下发，前端不硬编码：

```json
{ "code": 0, "data": {
    "mediaType":          [{ "value": 1, "label": "抖音" }, { "value": 2, "label": "小红书" }],
    "compositionType":    [{ "value": 1, "label": "视频" }],
    "compositionSubType": [{ "value": 11, "label": "口播", "parent": 1 }],
    "popularizeType":     [{ "value": 0, "label": "内容推广" }],
    "planStatus":         [{ "value": "active", "label": "投放中", "color": "green" }]
}}
```

⚠️ **秘钥类接口永远返回脱敏值。** 明文只在后端内存里存在，不进响应、不进日志、不进前端。

---

## 五、知乎 API 对接（后端实现）

### 5.1 签名实现（已验证，可直接复用）

`web/src/utils/signature.ts` 的实现是**正确的**，我用 Node `crypto` 独立复算过
Golden Vector，MD5 和签名都对得上。后端直接照搬，不要重写。

```javascript
const crypto = require('crypto');

// 不参与签名的字段（7 个）
const EXCLUDED = ['offset', 'limit', 'file', 'image',
                  'second_channel_id', 'X-Requested-With', 'signature'];

function buildSignature(params, secretKey) {
  const kvStr = Object.keys(params)
    .filter(k => !EXCLUDED.includes(k))
    .sort()                                          // ASCII 升序，别加 localeCompare
    .map(k => `${k}=${String(params[k])}`)           // 不 URL-encode
    .join('&');

  const md5 = crypto.createHash('md5').update(kvStr, 'utf8').digest('hex');  // 小写
  return crypto.createHmac('sha256', secretKey).update(md5, 'utf8').digest('hex');
}
```

⚠️ **`second_channel_id` 不参与签名**，但它是 `plans` 表的字段、也要作为请求参数发出去。
分页的 `offset`/`limit` 也不参与。这三个最容易漏掉。

**Golden Vector（官方 PDF §1.2，已复算通过，后端单测必须包含这条）：**

```
access_token = Db6j0Yq0eppBb
secret_key   = a735eb11da74123074675fa3522a90d1

params:
  task_id         = 1443567656205545123
  channel_id      = 1462106336904909960
  content_url     = https://www.zhihu.com/market/paid_column/1550452094749851648/section/1590711798218661888
  popularize_type = 0
  keyword         = 这是一个测试关键词
  timestamp       = 1672899103

排序拼接后：
access_token=Db6j0Yq0eppBb&channel_id=1462106336904909960&content_url=https://www.zhihu.com/market/paid_column/1550452094749851648/section/1590711798218661888&keyword=这是一个测试关键词&popularize_type=0&task_id=1443567656205545123&timestamp=1672899103

MD5       = 112f078ecdb75d76b38e4d9e661772bd
signature = 794a1d97ffdd4af53c7064d697d686e2da4177bc2ccdcb4168e2f829b0f5c579
```

注意 `content_url` 里的 `://` 和 `/` 全部原样保留，`keyword` 的中文也原样。
如果签出来不是上面那串，先检查是不是编码了。

### 5.2 端点映射表

| BFF 接口 | 知乎端点 | 方法 |
|---|---|---|
| `POST /channels/sync` | `/alliance/api/channels` | GET |
| `POST /tasks/sync` | `/alliance/api/popularize_tasks` | GET |
| `GET /tasks/:id` | `/alliance/api/popularize_task/:id` | GET |
| `POST /plans`（异步步骤） | `/alliance/api/popularize_plan` | POST |
| `PATCH /plans/:id` | `/alliance/api/popularize_plan/:id` | PUT |
| `GET /plans`（首次同步） | `/alliance/api/popularize_plans` | GET |
| `POST /compositions` | `/alliance/api/popularize_composition/v2` | POST |
| `POST /compositions/batch` | `/alliance/api/popularize_compositions/v2` | POST |
| `PATCH /compositions/:id` | `/alliance/api/popularize_composition/v2/:id` | PUT |
| `POST /metrics/sync`（实时） | `/alliance/api/data_report/real_time_data` | GET |
| `POST /metrics/sync`（历史） | `/alliance/api/data_report/daily_data` | GET |

完整 31 个接口见 [03-接口文档.md](./03-接口文档.md)，以 PDF 为准。
上表只列 BFF 一期会用到的。

### 5.3 配额与重试

接口有**日配额**。硬性要求：

- **不写循环压测**，不在开发时反复手动点同步
- 单元测试**一律 Mock**（MSW，`onUnhandledRequest: 'error'`）
- 渠道/任务列表缓存 5 分钟，同一分钟内的重复请求合并
- `daily_data` 回溯拉取走定时任务，每天一次，不做用户触发的全量拉取
  （`POST /metrics/sync` 要加频率限制，比如每用户 10 分钟一次）
- 失败重试**最多 2 次**，指数退避（1s / 3s），5xx 和超时才重试，4xx 不重试

### 5.4 错误码翻译

知乎的错误信息不能直接透传给用户。后端维护一张映射表：

| 知乎返回 | BFF code | 给用户看的 message |
|---|---|---|
| timestamp 无效 | 50001 | 系统时间校验失败，请稍后重试 |
| 签名错误 | 50001 | 系统时间校验失败，请稍后重试 |
| 关键词已存在 | 40901 | 该关键词已被绑定，请换一个词 |
| 内容 URL 不合法 | 42201 | 推广内容链接格式不正确 |
| 配额超限 | 42901 | 今日操作次数已达上限，请明天再试 |
| 其他 | 50000 | 操作失败，请稍后重试或联系管理员 |

⚠️ `timestamp 无效` 这个报错**同时代表签名错误**，知乎没有区分。后端遇到它时
要在**服务端日志**里打出 `kvStr` 和 `md5` 便于排查，但**不要打 `secret_key`**，
也不要把 `kvStr` 返回给前端（里面可能有业务数据）。

---

## 六、数据格式约定（前端会按这个写，后端别改）

这一节是最容易扯皮的地方，先钉死。

### 6.1 金额

**JSON number，单位元，两位小数。**

```json
{ "earning": 1234.56 }      ✅
{ "earning": "1,234.56" }   ❌ 带千分位的字符串
{ "earning": "1234.56" }    ❌ 字符串
{ "earning": 123456 }       ❌ 以分为单位
```

千分位、货币符号、颜色全部由前端格式化。当前 `platform/` 的 mock 里有
`"¥12,345.67"` 这种字符串，我会改掉。

### 6.2 百分比 / 比率

**JSON number，小数形式，不带 `%`。**

```json
{ "commissionRate": 0.15, "ctr": 0.0682 }   ✅
{ "commissionRate": "15%" }                 ❌
{ "commissionRate": 15 }                    ❌ 有歧义
```

`platform/` mock 里现在是 `"15%"`，我会改。

### 6.3 ID —— 必须是字符串

知乎的 ID 是雪花 ID，**18-19 位，超过 JS `Number.MAX_SAFE_INTEGER`（2^53-1）**。
直接 `JSON.parse` 会丢精度：

```
1443567656205545123  →  1443567656205545200   ❌ 尾部被改写
```

**约定：所有 ID 字段在 JSON 里一律是字符串**，包括本地自增 ID（保持一致，
避免前端要判断两种类型）。

```json
{ "id": "12", "zhihuPlanId": "1443567656205545123", "channelId": "1462106336904909960" }
```

后端序列化时把 BIGINT 转字符串。`web/src/infra/http.ts` 里有个 `safeJsonParse`
用正则在 parse 前把大数字加引号，那是**兜底**方案 —— 后端做对了前端就不需要它。

### 6.4 时间

**ISO 8601 带时区偏移的字符串**：`"2026-08-06T14:30:00+08:00"`

日期（无时间部分）用 `"2026-08-06"`。**不要传 Unix 时间戳给前端**
（知乎那边的秒级时间戳由后端转换）。

### 6.5 空值

- 「没有这个字段」用 `null`，不要用 `""` 或 `0` 或 `"-"`
- 列表为空返回 `{ "list": [], "total": 0 }`，不要返回 `null`
- 布尔就用 `true`/`false`，不要 `1`/`0`/`"Y"`

### 6.6 枚举

传机器值，`label` 由 `/meta/enums` 提供，或前端自己映射：

```json
{ "status": "active" }                              ✅
{ "status": "投放中" }                               ❌ 前端没法做条件判断
{ "status": "active", "statusLabel": "投放中" }      ⚠️ 可以，但冗余
```

---

## 七、开工前的阻塞项

这些不解决会返工。分成「必须知乎方面确认」和「我们内部定」两类。

### 7.1 需要向知乎方面确认（P0，卡后端开发）

| # | 问题 | 影响 |
|---|---|---|
| B1 | **有没有测试环境域名？** PDF 里只有 `open.zhihu.com` | 没有的话所有联调都在生产打真实数据，会脏数据 + 烧配额 |
| B2 | **哪些接口只要 `access_token` 不要 `signature`？** 文档自相矛盾：正文说 3 个，表格列 14 个，附录说 8 个 | 影响 14 个接口的实现方式 |
| B3 | **Url Params（路径参数）参不参与签名？** 文档没写 | 影响所有带 `:id` 的接口 |
| B4 | **`timestamp` 有效窗口是多少秒？** | 决定要不要做服务器时间对齐 |
| B5 | **`access_token` 会过期吗？有刷新接口吗？** | 决定要不要做 token 刷新逻辑 |
| B6 | **4 个 Excel 批量模板的列结构** PDF 没附文件 | 批量导入功能做不了 |

B1 和 B2 最紧急。B1 没有测试环境的话，建议后端先做完整的 Mock 层
（用 Golden Vector 的数据造响应），把业务逻辑跑通再接真实接口。

### 7.2 我们内部要定的（P1）

| # | 问题 | 我的建议 |
|---|---|---|
| C1 | 知乎只有两代渠道，三级角色怎么落 | 已在 §3.4 定：达人级靠本地 `plans.owner_id`，不靠渠道 |
| C2 | 落库 vs 直连的冲突（`02-开发计划.md` 说不落库） | 已在 §3.0 定：混合模式。**需要更新 `02-开发计划.md` 的 Out of Scope** |
| C3 | `docs/06-platform-开发计划.md` 描述的 Vant4 移动端跟磁盘不符 | 建议**废弃该文档**，platform/ 以本文档 §2.1 为准 |
| C4 | PRD 说「暂不要求移动端」，但上面那份文档是 375px 移动端 | 以 PRD 为准，桌面优先 |
| C5 | 仓库不是 git | codex 接手前先 `git init` + 建 `.gitignore`（`.env.local` 必须在里面） |
| C6 | 测试文件命名：规范说 `.spec.ts`，实际是 `signature.test.ts` | 统一成 `.spec.ts`，改一个文件的事 |
| C7 | 收益结算周期、提现门槛金额、分成比例 | 业务侧未定，先做成 `projects.config_json` 里的可配置项 |

### 7.3 安全红线（不可协商）

- `secret_key` 不进前端代码、不进 `.env`（非 local）、不进 git、**不加 `VITE_` 前缀**
- 生产 `VITE_ENABLE_LOCAL_SIGN=false`，签名只在 BFF 算
- 打包产物全文搜 `secret` / `hmac` / `HmacSHA256`，结果必须为空
- 生产 `build.sourcemap: false`
- 返回前端的 `signKey` 一律脱敏
- 新代码只用 v2 接口（v1 于 **2026-08-25** 下线）
- 单测一律 Mock，MSW 保持 `onUnhandledRequest: 'error'`

---

## 八、分工边界

| | 我（前端 + 整体架构） | codex（后端） |
|---|---|---|
| 目录 | `platform/`、`docs/` | `server/`（新建） |
| 负责 | 12 个页面接真实接口、Pinia stores、路由守卫与权限、`src/api/` 封装、错误提示、加载态 | 10 张表建表迁移、`/api/v1/*` 全部端点、JWT 与分级过滤、知乎签名与对接、定时任务 |
| 契约 | 按 §4 的接口调用 | 按 §4 的接口实现 |
| 不碰 | `server/` 内部实现 | `platform/` 内部实现 |
| 共同遵守 | §6 数据格式、§7.3 安全红线 | 同 |

**联调顺序建议**（后端按这个顺序交付，我按同样顺序接）：

1. `POST /auth/login` + `GET /auth/me` → 我先把登录和路由守卫做掉
2. `GET /meta/enums` → 我把所有硬编码枚举换掉
3. `GET /plans` + `POST /plans` + `POST /plans/check-keyword` → 核心流程
4. `GET /metrics/overview` + `/metrics/trend` → 工作台和图表
5. `GET /team/members` + `POST /team/members` → 团队管理
6. `/compositions/*` → 作品管理
7. `/earnings/*` + `/withdrawals/*` → 收益提现
8. `/callbacks/*` → 回传配置

**前 2 步做完我就能把整个前端从 mock 切到真实鉴权**，这是最有价值的第一步。
在后端交付前，我会在 `platform/` 里搭一层 MSW mock 按本契约返回数据，
这样两边可以完全并行，后端好了改一个环境变量就切过去。

---

## 附：变更记录

| 日期 | 变更 |
|---|---|
| 2026-08-06 | 初版。取代技术规范 docx 的第 2/4/5 章。修正签名算法（两层哈希）、领域模型（计划=关键词）、v2 接口要求 |
