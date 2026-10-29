# 归因引擎设计方案

> **文档目标**：设计一套完整的收益归因系统，解决"一个关键词多个达人使用"的分配问题。
>
> **核心挑战**：知乎只提供关键词级汇总数据，我们需要将收益拆分到具体的团长和达人。
>
> **创建时间**：2025-01-XX  
> **状态**：技术方案（待评审）

---

## 目录

- [一、问题定义](#一问题定义)
- [二、归因模型设计](#二归因模型设计)
- [三、数据模型设计](#三数据模型设计)
- [四、归因算法](#四归因算法)
- [五、实现方案](#五实现方案)
- [六、人工介入点](#六人工介入点)
- [七、异常处理](#七异常处理)

---

## 一、问题定义

### 1.1 核心问题

**输入**（知乎邮件数据）：
```json
{
  "date": "2025-01-20",
  "keyword": "知乎推广工具",
  "searchVolume": 1000,
  "conversions": 50,
  "revenue": 500000  // 单位：分（5000元）
}
```

**输出**（需要系统计算）：
```json
[
  {
    "userId": "leader-001",
    "userType": "leader",
    "keyword": "知乎推广工具",
    "revenue": 100000,  // 1000元（20%）
    "conversionCount": 10,
    "worksCount": 5
  },
  {
    "userId": "creator-001",
    "userType": "creator",
    "parentLeaderId": "leader-001",
    "keyword": "知乎推广工具",
    "revenue": 80000,  // 800元（16%）
    "conversionCount": 8,
    "worksCount": 4
  },
  // ... 更多达人
]
```

### 1.2 约束条件

| 约束 | 描述 |
|-----|------|
| **数据源单一** | 只有关键词级汇总，无作品级、达人级数据 |
| **关键词复用** | 多个团长/达人可使用同一关键词 |
| **时间滞后** | 邮件数据 T+1 天到达，归因需关联历史作品 |
| **无直接追踪** | 知乎不提供点击追踪、用户 ID 等精细数据 |
| **总额守恒** | 拆分后的收益总和必须等于原始收益 |

---

## 二、归因模型设计

### 2.1 归因维度

我们需要建立 **多维度** 的归因依据：

```
┌─────────────────────────────────────────────────┐
│               归因维度矩阵                        │
├─────────────────────────────────────────────────┤
│ 1️⃣ 关键词使用权（必需）                           │
│    - 谁在系统中"绑定"了这个关键词？                │
│    - 权重基础：是否有使用权                        │
├─────────────────────────────────────────────────┤
│ 2️⃣ 作品数量（核心）                               │
│    - 这个关键词下发布了多少作品？                   │
│    - 权重计算：作品数量比例                        │
├─────────────────────────────────────────────────┤
│ 3️⃣ 作品质量（可选）                               │
│    - 作品的浏览量、点赞数、转发数                   │
│    - 权重计算：质量分数加权                        │
├─────────────────────────────────────────────────┤
│ 4️⃣ 时间窗口（必需）                               │
│    - 作品发布时间是否在统计周期内？                 │
│    - 过滤条件：排除过期作品                        │
├─────────────────────────────────────────────────┤
│ 5️⃣ 团长抽成（业务规则）                           │
│    - 团长是否参与分成？比例多少？                   │
│    - 后处理：从达人收益中扣除                      │
└─────────────────────────────────────────────────┘
```

### 2.2 归因策略与定价规则的整合

> **重要说明**：归因引擎与系统现有的 `pricing_rules`（定价规则）是**分层协作**的关系。
> 详细的整合方案请参见 [《归因引擎与现有定价策略整合方案》](./SOLUTION-归因引擎与定价策略整合方案.md)

#### 双层架构

```
第 1 层：归因引擎（本文档）
  职责：将"关键词汇总收益"拆分到"具体达人"
  输入：邮件数据（关键词、总收益）
  输出：每个达人的"归因收益"（allocated_revenue）
  
第 2 层：定价规则（现有 pricing_rules 表）
  职责：将"达人归因收益"转换为"最终入账"
  输入：达人的"归因收益"（= source_amount）
  输出：达人应得 + 团长抽成
```

**关键概念**：
- **归因收益**：归因引擎分配给达人的金额（基于作品贡献度）
- **来源金额**：定价规则的输入（= 归因收益，写入 `settlement_items.source_amount`）
- **达人应得**：定价规则计算后的金额（如：source_amount × 60%）
- **最终入账**：扣除团长抽成后的金额（写入 `earnings.amount`）

---

#### 方案 A：纯作品数量分配（简单）

**适用场景**：初期快速上线，业务规则简单

**规则**：
- 按作品数量平均分配归因收益
- 不考虑作品质量

**公式**：
```
第 1 步：归因引擎计算
归因收益 = (达人作品数 / 总作品数) × 关键词总收益

第 2 步：应用定价规则（复用现有 pricing_rules）
达人应得 = 归因收益 × percentage（如 60%）
  或
达人应得 = 固定单价 × 转化数（如 50 元/次）

第 3 步：团长抽成（复用现有逻辑）
团长抽成 = 达人应得 × 团长比例（如 10%）
达人最终 = 达人应得 - 团长抽成
```

**优点**：
- ✅ 实现简单
- ✅ 规则透明
- ✅ 与现有定价规则无缝整合

**缺点**：
- ❌ 不公平（刷作品数量即可）
- ❌ 不鼓励优质内容

---

#### 方案 B：作品质量加权分配（推荐）⭐

**适用场景**：有作品质量数据（浏览量、互动量）

**规则**：
- 每个作品有质量分数（基于浏览、点赞、转发）
- 按质量分数加权分配归因收益
- 归因收益通过定价规则转换为最终入账

**公式**：
```
第 1 步：归因引擎计算
作品质量分 = (浏览量 × 0.5) + (点赞数 × 2) + (转发数 × 5)
归因收益 = (达人作品质量总分 / 全部作品质量总分) × 关键词总收益

第 2 步：应用定价规则（复用现有 pricing_rules）
达人应得 = 归因收益 × percentage（如 60%）

第 3 步：团长抽成（复用现有逻辑）
团长抽成 = 达人应得 × 团长比例（如 10%）
达人最终 = 达人应得 - 团长抽成
```

**完整示例**：
```
关键词收益：5000 元

达人 A（5 个作品，质量分 2500）：
  归因收益 = 5000 × (2500/5000) = 2500 元  ← 第 1 层：归因引擎
  达人应得 = 2500 × 0.6 = 1500 元          ← 第 2 层：定价规则 60%
  团长抽成 = 1500 × 0.1 = 150 元           ← 第 2 层：团长规则 10%
  达人最终 = 1500 - 150 = 1350 元 ✅
  
团长收益 = 150 元 ✅
```

**优点**：
- ✅ 更公平，鼓励优质内容
- ✅ 符合实际转化逻辑
- ✅ 与现有定价规则无缝整合
- ✅ 定价规则可独立调整（不影响归因逻辑）

**缺点**：
- ⚠️ 需要采集作品质量数据
- ⚠️ 计算复杂度稍高

---

#### 方案 C：人工指定分配（兜底）

**适用场景**：无法自动归因时的人工干预

**规则**：
- 管理员手动指定每个达人的归因收益
- 系统应用定价规则完成后续计算

**公式**：
```
第 1 步：人工指定
管理员手动设置：达人 A 归因收益 = 2000 元

第 2 步：自动应用定价规则
达人应得 = 2000 × 0.6 = 1200 元
团长抽成 = 1200 × 0.1 = 120 元
达人最终 = 1200 - 120 = 1080 元
```

**优点**：
- ✅ 灵活性最高
- ✅ 可处理特殊情况
- ✅ 仍然应用统一的定价规则

**缺点**：
- ❌ 工作量大
- ❌ 不可扩展

---

### 2.3 推荐方案：混合模式（整合定价规则）

```
┌─────────────────────────────────────────────────┐
│       完整流程（归因引擎 + 定价规则）               │
├─────────────────────────────────────────────────┤
│                                                 │
│  1️⃣ 邮件数据导入                                 │
│     知乎邮件 → attribution_tasks                │
│     ↓                                           │
│  2️⃣ 归因引擎计算（方案 B - 质量加权）              │
│     计算每个达人的"归因收益"                      │
│     ↓                                           │
│  3️⃣ 置信度评估                                   │
│     - 高置信度（>90%）→ 自动通过                  │
│     - 中置信度（60-90%）→ 管理员审核              │
│     - 低置信度（<60%）→ 人工分配（方案 C）         │
│     ↓                                           │
│  4️⃣ 生成结算批次（自动）                          │
│     归因收益 → settlement_batch + items         │
│     ↓                                           │
│  5️⃣ 应用定价规则（自动，复用现有逻辑）              │
│     达人定价规则（percentage 或 fixed）           │
│     团长抽成规则                                  │
│     ↓                                           │
│  6️⃣ 写入收益表                                   │
│     earnings（达人 + 团长）                      │
│     ↓                                           │
│  7️⃣ 达人查看收益                                 │
│                                                 │
└─────────────────────────────────────────────────┘
```

**关键优势**：
- ✅ 归因逻辑与定价规则分离（各司其职）
- ✅ 定价规则集中管理（一处修改，全局生效）
- ✅ 完整的审计链路（每步可追溯）

**置信度计算**：
```typescript
置信度 = (
  (有作品的达人数 / 总达人数) × 0.4 +
  (有质量数据的作品数 / 总作品数) × 0.4 +
  (时间匹配度) × 0.2
)
```

---

## 三、数据模型设计

### 3.1 核心表结构

#### 表 1：关键词绑定表 `keyword_bindings`

记录谁在使用哪个关键词。

```sql
CREATE TABLE keyword_bindings (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  keyword VARCHAR(128) NOT NULL COMMENT '关键词',
  plan_id BIGINT NOT NULL COMMENT '推广计划ID（外键）',
  
  -- 使用者信息
  user_id BIGINT NOT NULL COMMENT '用户ID（团长或达人）',
  user_type ENUM('admin', 'leader', 'creator') NOT NULL COMMENT '用户类型',
  parent_leader_id BIGINT NULL COMMENT '所属团长ID（达人填写）',
  
  -- 使用权限
  is_exclusive BOOLEAN DEFAULT FALSE COMMENT '是否独占（团长可独占）',
  status ENUM('active', 'inactive', 'expired') DEFAULT 'active',
  
  -- 时间信息
  bind_at DATETIME NOT NULL COMMENT '绑定时间',
  expire_at DATETIME NULL COMMENT '过期时间（可选）',
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_keyword (keyword),
  INDEX idx_user (user_id, user_type),
  INDEX idx_status (status, keyword)
) COMMENT '关键词绑定表';
```

#### 表 2：作品登记表 `creator_works`

达人发布的作品记录。

```sql
CREATE TABLE creator_works (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  
  -- 作品信息
  work_title VARCHAR(255) NOT NULL COMMENT '作品标题',
  work_url VARCHAR(512) NOT NULL COMMENT '作品链接',
  platform ENUM('douyin', 'xiaohongshu', 'bilibili', 'weibo', 'other') NOT NULL,
  
  -- 关键词关联
  keyword VARCHAR(128) NOT NULL COMMENT '使用的关键词',
  plan_id BIGINT NULL COMMENT '关联的推广计划ID',
  
  -- 发布者信息
  creator_id BIGINT NOT NULL COMMENT '达人ID',
  leader_id BIGINT NULL COMMENT '所属团长ID',
  
  -- 作品质量数据（用于归因）
  view_count BIGINT DEFAULT 0 COMMENT '浏览量',
  like_count INT DEFAULT 0 COMMENT '点赞数',
  share_count INT DEFAULT 0 COMMENT '转发数',
  comment_count INT DEFAULT 0 COMMENT '评论数',
  quality_score DECIMAL(10, 2) NULL COMMENT '质量分数（计算后缓存）',
  
  -- 时间信息
  published_at DATETIME NOT NULL COMMENT '作品发布时间',
  submitted_at DATETIME NOT NULL COMMENT '系统登记时间',
  
  -- 状态
  status ENUM('pending', 'approved', 'rejected', 'deleted') DEFAULT 'pending',
  review_notes TEXT NULL COMMENT '审核备注',
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_keyword (keyword, published_at),
  INDEX idx_creator (creator_id, keyword),
  INDEX idx_status (status),
  INDEX idx_published (published_at)
) COMMENT '达人作品登记表';
```

#### 表 3：归因任务表 `attribution_tasks`

每次邮件数据导入后创建的归因任务。

```sql
CREATE TABLE attribution_tasks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  
  -- 原始数据
  data_date DATE NOT NULL COMMENT '数据日期',
  keyword VARCHAR(128) NOT NULL COMMENT '关键词',
  search_volume INT NOT NULL COMMENT '搜索量',
  conversion_count INT NOT NULL COMMENT '转化数',
  total_revenue BIGINT NOT NULL COMMENT '总收益（分）',
  
  -- 归因状态
  status ENUM('pending', 'processing', 'completed', 'failed', 'manual') DEFAULT 'pending',
  attribution_method ENUM('auto-count', 'auto-quality', 'manual') NULL COMMENT '归因方式',
  confidence_score DECIMAL(5, 2) NULL COMMENT '置信度分数（0-100）',
  
  -- 归因结果统计
  total_works_count INT NULL COMMENT '参与作品数',
  total_users_count INT NULL COMMENT '参与用户数',
  allocated_revenue BIGINT DEFAULT 0 COMMENT '已分配收益（分）',
  unallocated_revenue BIGINT NULL COMMENT '未分配收益（分）',
  
  -- 审核信息
  reviewed_by BIGINT NULL COMMENT '审核人ID',
  reviewed_at DATETIME NULL COMMENT '审核时间',
  review_notes TEXT NULL COMMENT '审核备注',
  
  -- 元数据
  source_file VARCHAR(255) NULL COMMENT '数据来源文件',
  import_batch_id VARCHAR(64) NULL COMMENT '导入批次ID',
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY uk_date_keyword (data_date, keyword),
  INDEX idx_status (status),
  INDEX idx_date (data_date)
) COMMENT '归因任务表';
```

#### 表 4：归因结果明细表 `attribution_results`

每个归因任务的详细分配结果。

```sql
CREATE TABLE attribution_results (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  
  -- 关联归因任务
  task_id BIGINT NOT NULL COMMENT '归因任务ID',
  
  -- 用户信息
  user_id BIGINT NOT NULL COMMENT '用户ID',
  user_type ENUM('admin', 'leader', 'creator') NOT NULL,
  username VARCHAR(64) NOT NULL COMMENT '用户名（冗余）',
  display_name VARCHAR(128) NULL COMMENT '显示名称（冗余）',
  parent_leader_id BIGINT NULL COMMENT '所属团长ID',
  
  -- 归因依据
  works_count INT NOT NULL COMMENT '作品数量',
  total_quality_score DECIMAL(12, 2) NULL COMMENT '作品质量总分',
  attribution_weight DECIMAL(8, 6) NOT NULL COMMENT '分配权重（0-1）',
  
  -- 收益分配
  allocated_revenue BIGINT NOT NULL COMMENT '分配收益（分）',
  conversion_count INT NOT NULL COMMENT '预估转化数',
  
  -- 团长抽成（仅达人有）
  leader_commission_rate DECIMAL(5, 4) NULL COMMENT '团长抽成比例',
  leader_commission BIGINT NULL COMMENT '团长抽成金额（分）',
  final_revenue BIGINT NOT NULL COMMENT '最终收益（扣除抽成后）',
  
  -- 状态
  status ENUM('pending', 'confirmed', 'paid', 'cancelled') DEFAULT 'pending',
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_task (task_id),
  INDEX idx_user (user_id, status),
  INDEX idx_leader (parent_leader_id),
  
  FOREIGN KEY (task_id) REFERENCES attribution_tasks(id)
) COMMENT '归因结果明细表';
```

#### 表 5：收益记录表 `earnings`（现有表扩展）

```sql
-- 在现有 earnings 表中新增字段
ALTER TABLE earnings ADD COLUMN attribution_result_id BIGINT NULL COMMENT '归因结果ID';
ALTER TABLE earnings ADD COLUMN attribution_method VARCHAR(32) NULL COMMENT '归因方式';
ALTER TABLE earnings ADD INDEX idx_attribution (attribution_result_id);
```

---

## 四、归因算法

### 4.1 算法流程

```typescript
/**
 * 归因引擎核心算法
 */
async function performAttribution(task: AttributionTask): Promise<AttributionResult[]> {
  // 第 1 步：查找使用该关键词的所有用户
  const bindings = await findKeywordBindings(task.keyword, task.dataDate);
  
  // 第 2 步：查找该关键词下的所有作品（时间窗口内）
  const works = await findWorksInTimeWindow(
    task.keyword,
    task.dataDate,
    TIME_WINDOW_DAYS // 例如 30 天
  );
  
  // 第 3 步：计算每个作品的质量分数
  const worksWithScore = works.map(work => ({
    ...work,
    qualityScore: calculateQualityScore(work)
  }));
  
  // 第 4 步：按用户分组统计
  const userStats = groupByUser(worksWithScore);
  
  // 第 5 步：计算分配权重
  const totalQualityScore = sumBy(worksWithScore, 'qualityScore');
  const results = userStats.map(user => {
    const weight = user.totalQualityScore / totalQualityScore;
    const allocatedRevenue = Math.floor(task.totalRevenue * weight);
    const conversionCount = Math.floor(task.conversionCount * weight);
    
    return {
      userId: user.userId,
      userType: user.userType,
      worksCount: user.worksCount,
      totalQualityScore: user.totalQualityScore,
      attributionWeight: weight,
      allocatedRevenue,
      conversionCount,
      // 如果是达人，计算团长抽成
      ...(user.userType === 'creator' && user.leaderId 
        ? calculateLeaderCommission(user, allocatedRevenue)
        : {}
      )
    };
  });
  
  // 第 6 步：处理尾差（确保总额守恒）
  const totalAllocated = sumBy(results, 'allocatedRevenue');
  const diff = task.totalRevenue - totalAllocated;
  if (diff !== 0 && results.length > 0) {
    // 把尾差分配给收益最高的用户
    results[0].allocatedRevenue += diff;
  }
  
  // 第 7 步：计算置信度
  const confidence = calculateConfidence(task, works, results);
  
  return { results, confidence };
}
```

### 4.2 质量分数计算

```typescript
/**
 * 作品质量分数计算（可调整权重）
 */
function calculateQualityScore(work: CreatorWork): number {
  const weights = {
    viewCount: 0.5,    // 浏览量权重
    likeCount: 2.0,    // 点赞权重
    shareCount: 5.0,   // 转发权重
    commentCount: 3.0  // 评论权重
  };
  
  return (
    work.viewCount * weights.viewCount +
    work.likeCount * weights.likeCount +
    work.shareCount * weights.shareCount +
    work.commentCount * weights.commentCount
  );
}
```

### 4.3 置信度计算

```typescript
/**
 * 归因置信度计算
 */
function calculateConfidence(
  task: AttributionTask,
  works: CreatorWork[],
  results: AttributionResult[]
): number {
  let score = 0;
  
  // 因子 1：作品覆盖率（40%）
  const bindingsCount = await countKeywordBindings(task.keyword);
  const usersWithWorks = new Set(works.map(w => w.creatorId)).size;
  const coverageRate = bindingsCount > 0 ? usersWithWorks / bindingsCount : 0;
  score += coverageRate * 40;
  
  // 因子 2：质量数据完整度（40%）
  const worksWithQualityData = works.filter(w => w.viewCount > 0 || w.likeCount > 0).length;
  const qualityDataRate = works.length > 0 ? worksWithQualityData / works.length : 0;
  score += qualityDataRate * 40;
  
  // 因子 3：时间匹配度（20%）
  const worksInWindow = works.filter(w => isInTimeWindow(w.publishedAt, task.dataDate)).length;
  const timeMatchRate = works.length > 0 ? worksInWindow / works.length : 0;
  score += timeMatchRate * 20;
  
  return Math.min(100, Math.max(0, score));
}
```

---

## 五、实现方案

### 5.1 系统架构

```
┌─────────────────────────────────────────────────┐
│            归因引擎系统架构                        │
└─────────────────────────────────────────────────┘

┌─────────────┐
│ 邮件数据源   │ → CSV/Excel 文件
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ 数据导入服务     │ → 解析并入库到 attribution_tasks
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ 归因调度器       │ → Bull 队列 (job: attribution-task)
└──────┬──────────┘
       │
       ▼
┌─────────────────────────────────────────────────┐
│              归因引擎核心                         │
├─────────────────────────────────────────────────┤
│  1️⃣ 关键词绑定查询                                │
│  2️⃣ 作品数据查询（时间窗口过滤）                   │
│  3️⃣ 质量分数计算                                  │
│  4️⃣ 权重分配算法                                  │
│  5️⃣ 团长抽成计算                                  │
│  6️⃣ 置信度评估                                    │
└──────┬──────────────────────────────────────────┘
       │
       ├─ 高置信度 → 自动确认 → 写入 earnings 表
       │
       ├─ 中置信度 → 待审核队列 → 管理员审核
       │
       └─ 低置信度 → 人工分配 → 管理员手动操作
```

### 5.2 API 设计

#### API 1：关键词绑定

```typescript
POST /api/v1/keywords/bind
{
  "keyword": "知乎推广工具",
  "planId": "123",
  "isExclusive": false  // 团长可独占
}

Response:
{
  "id": "456",
  "keyword": "知乎推广工具",
  "userId": "789",
  "status": "active"
}
```

#### API 2：作品登记

```typescript
POST /api/v1/works
{
  "title": "知乎推广全攻略",
  "url": "https://douyin.com/video/123456",
  "platform": "douyin",
  "keyword": "知乎推广工具",
  "publishedAt": "2025-01-20T10:00:00Z",
  "viewCount": 10000,
  "likeCount": 500
}

Response:
{
  "id": "work-001",
  "status": "pending",  // 待审核
  "qualityScore": 5250.0
}
```

#### API 3：导入邮件数据

```typescript
POST /api/v1/attribution/import
Content-Type: multipart/form-data

file: revenue_2025-01-20.csv

Response:
{
  "batchId": "batch-20250120-001",
  "tasksCreated": 150,
  "status": "processing"
}
```

#### API 4：触发归因

```typescript
POST /api/v1/attribution/tasks/:taskId/process

Response:
{
  "taskId": "task-001",
  "status": "completed",
  "confidence": 85.5,
  "resultsCount": 12,
  "totalAllocated": 500000
}
```

#### API 5：归因结果审核

```typescript
GET /api/v1/attribution/tasks?status=pending&confidence=<90

Response:
{
  "list": [
    {
      "id": "task-001",
      "keyword": "知乎推广工具",
      "totalRevenue": 500000,
      "confidence": 75.2,
      "resultsCount": 8
    }
  ]
}

POST /api/v1/attribution/tasks/:taskId/approve
{
  "adjustments": [  // 可选：手动调整
    {
      "userId": "creator-001",
      "allocatedRevenue": 120000
    }
  ]
}
```

---

## 六、人工介入点

### 6.1 必须人工的环节

| 环节 | 原因 | 操作方式 |
|-----|------|---------|
| **低置信度归因审核** | 数据不完整，无法自动准确分配 | 管理员在「归因审核」页面查看并调整 |
| **异常数据处理** | 收益异常高/低，或数据不匹配 | 系统标记异常，人工核查原因 |
| **分配规则调整** | 业务规则变更（如团长抽成比例） | 管理员在「系统设置」修改规则 |
| **争议仲裁** | 达人对分配结果有异议 | 申诉流程，管理员裁决 |

### 6.2 可选人工的环节

| 环节 | 自动化程度 | 人工介入场景 |
|-----|-----------|------------|
| **作品审核** | 自动通过 + 抽查 | 发现刷量作品时人工拒绝 |
| **中等置信度归因** | 自动分配 + 人工确认 | 管理员快速浏览后批准 |
| **关键词绑定审核** | 自动通过 | 发现滥用时人工干预 |

---

## 七、异常处理

### 7.1 常见异常场景

#### 场景 1：关键词无人使用

**问题**：邮件数据中某关键词有收益，但系统内无人绑定该关键词。

**处理**：
```typescript
if (bindings.length === 0) {
  // 收益进入"未归因池"
  await createUnallocatedRevenue({
    keyword: task.keyword,
    revenue: task.totalRevenue,
    reason: 'no_bindings'
  });
  
  // 通知管理员
  await notifyAdmin('关键词无归因', task);
}
```

#### 场景 2：关键词有绑定但无作品

**问题**：用户绑定了关键词但没有登记作品。

**处理**：
```typescript
if (works.length === 0 && bindings.length > 0) {
  // 降级为按绑定数量平均分
  return distributeEqually(task, bindings);
  
  // 或进入人工审核
  task.status = 'manual';
  task.confidence = 0;
}
```

#### 场景 3：收益分配有尾差

**问题**：由于浮点运算，分配总额不等于原始总额。

**处理**：
```typescript
const diff = task.totalRevenue - totalAllocated;
if (diff !== 0) {
  // 尾差归属于收益最高的用户
  results.sort((a, b) => b.allocatedRevenue - a.allocatedRevenue);
  results[0].allocatedRevenue += diff;
}
```

#### 场景 4：作品时间窗口外

**问题**：作品发布时间距离数据日期太久（如 60 天前）。

**处理**：
```typescript
const TIME_WINDOW_DAYS = 30;

const validWorks = works.filter(work => {
  const daysDiff = dateDiff(task.dataDate, work.publishedAt);
  return daysDiff >= 0 && daysDiff <= TIME_WINDOW_DAYS;
});

if (validWorks.length < works.length) {
  // 记录被过滤的作品
  await logFilteredWorks(works.length - validWorks.length, '时间窗口外');
}
```

### 7.2 异常监控

```typescript
// 归因异常监控指标
const metrics = {
  // 未归因收益占比
  unallocatedRatio: unallocatedRevenue / totalRevenue,
  
  // 低置信度任务占比
  lowConfidenceRatio: lowConfidenceTasks / totalTasks,
  
  // 人工干预率
  manualInterventionRate: manualTasks / totalTasks,
  
  // 争议率
  disputeRate: disputedResults / totalResults
};

// 告警阈值
if (metrics.unallocatedRatio > 0.1) {  // 超过 10%
  await alertAdmin('未归因收益过高');
}
```

---

## 八、总结与后续

### 8.1 关键决策点

| 决策 | 选项 | 推荐 | 原因 |
|-----|-----|-----|------|
| **归因方式** | 数量 / 质量加权 / 人工 | 质量加权 | 更公平，可扩展 |
| **团长抽成** | 固定比例 / 按业绩浮动 | 固定比例 | 实现简单，规则清晰 |
| **时间窗口** | 7天 / 30天 / 全部 | 30天 | 平衡准确性与覆盖度 |
| **置信度阈值** | 高60/低40 / 高80/低60 | 高90/低60 | 确保质量 |

### 8.2 实施优先级

**Phase 1（MVP - 2 周）**：
- ✅ 关键词绑定功能
- ✅ 作品登记功能
- ✅ 简单归因算法（按作品数量）
- ✅ 人工审核界面

**Phase 2（优化 - 2 周）**：
- ✅ 质量加权算法
- ✅ 置信度评估
- ✅ 自动化流程

**Phase 3（完善 - 1 周）**：
- ✅ 异常监控
- ✅ 申诉流程
- ✅ 数据报表

### 8.3 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|-----|-----|-----|---------|
| **归因不准确** | 中 | 高 | 人工审核 + 申诉机制 |
| **作品数据缺失** | 高 | 中 | 降级到数量分配 |
| **质量数据造假** | 中 | 中 | 抽查 + 异常检测 |
| **计算性能问题** | 低 | 低 | 异步队列 + 批处理 |

---

**下一步**：
1. 评审本方案，确认业务逻辑
2. 明确团长抽成规则
3. 确认时间窗口和权重系数
4. 设计管理员审核界面原型
