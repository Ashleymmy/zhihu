# 归因引擎与现有定价策略整合方案

> **文档目标**：将新的归因引擎与系统现有的 `pricing_rules` 定价体系深度整合，实现统一的收益分配链路。
>
> **核心思路**：归因引擎负责"关键词收益 → 达人收益"的拆分，定价规则负责"达人收益 → 最终入账"的计算。
>
> **创建时间**：2025-01-XX  
> **状态**：技术方案（已整合现有代码）

---

## 目录

- [一、现有定价策略分析](#一现有定价策略分析)
- [二、归因引擎与定价规则的协作](#二归因引擎与定价规则的协作)
- [三、完整的收益计算链路](#三完整的收益计算链路)
- [四、数据模型扩展](#四数据模型扩展)
- [五、实现方案](#五实现方案)
- [六、API 设计](#六api-设计)
- [七、示例场景](#七示例场景)

---

## 一、现有定价策略分析

### 1.1 现有系统架构

系统已经有完整的定价规则体系（`pricing_rules` 表），用于处理：

```
知乎官方收益 → 定价规则 → 达人应得 → 团长抽成 → 最终入账
```

#### 核心表结构

**`pricing_rules`** - 定价规则表
```sql
CREATE TABLE pricing_rules (
  id BIGINT PRIMARY KEY,
  target_user_id BIGINT NULL,              -- 指定用户（NULL = 角色默认规则）
  target_role ENUM('leader','creator'),    -- 目标角色
  method ENUM('fixed','percentage'),       -- 计算方式
  unit_price DECIMAL(18,4) NULL,           -- 固定单价（元）
  percentage DECIMAL(9,6) NULL,            -- 百分比（0-1）
  status ENUM('active','disabled'),
  priority INT DEFAULT 0,                  -- 优先级
  ...
)
```

#### 现有计算逻辑

**方式 1：固定单价（`fixed`）**
```typescript
// 每个转化固定金额
达人收益 = unit_price × 转化数
```

**方式 2：百分比（`percentage`）**
```typescript
// 按知乎官方收益的比例
达人收益 = 知乎官方收益 × percentage
```

#### 团长抽成逻辑

```typescript
// 达人有团长时
团长收益 = 达人应得 × 团长抽成比例
达人最终收益 = 达人应得 - 团长收益
```

### 1.2 现有流程的局限性

**问题**：现有流程假设"知乎官方收益"可以直接对应到"具体达人"，但实际情况是：

```
❌ 知乎官方数据（邮件）：
   关键词: 知乎推广工具
   收益: 5000 元
   
   → 无法直接知道是哪个达人产生的！
```

**需要的中间层**：归因引擎

---

## 二、归因引擎与定价规则的协作

### 2.1 双层架构设计

```
┌─────────────────────────────────────────────────┐
│          完整的收益计算链路                        │
└─────────────────────────────────────────────────┘

第 1 层：归因引擎（新增）
┌─────────────────────────────────────────────────┐
│  输入：关键词汇总收益（邮件数据）                   │
│  ↓                                              │
│  归因算法：根据作品数量/质量分配                   │
│  ↓                                              │
│  输出：每个达人的"归因收益"（来源金额）             │
└─────────────────────────────────────────────────┘
               ↓
第 2 层：定价规则（现有）
┌─────────────────────────────────────────────────┐
│  输入：达人的"归因收益"（= source_amount）         │
│  ↓                                              │
│  定价规则：fixed 或 percentage                   │
│  ↓                                              │
│  输出：达人应得 + 团长抽成                         │
└─────────────────────────────────────────────────┘
               ↓
第 3 层：收益入账（现有）
┌─────────────────────────────────────────────────┐
│  写入 earnings 表（达人 + 团长）                  │
└─────────────────────────────────────────────────┘
```

### 2.2 关键概念映射

| 概念 | 说明 | 对应字段 |
|-----|------|---------|
| **关键词收益** | 知乎邮件中的汇总收益 | `attribution_tasks.total_revenue` |
| **归因收益** | 归因引擎分配给达人的金额 | `attribution_results.allocated_revenue` |
| **来源金额** | 定价规则的输入（= 归因收益） | `settlement_items.source_amount` |
| **达人应得** | 定价规则计算后的金额 | `relay_logs.relay_amount` |
| **最终入账** | 扣除团长抽成后的金额 | `earnings.amount` |

---

## 三、完整的收益计算链路

### 3.1 流程图

```
┌──────────────────────────────────────────────────┐
│             完整流程（7 步）                       │
└──────────────────────────────────────────────────┘

1️⃣ 邮件数据导入
   知乎邮件 → attribution_tasks
   关键词: 知乎推广工具, 收益: 5000 元

2️⃣ 归因引擎计算
   查询该关键词下的所有作品
   根据作品质量计算每个达人的"归因收益"
   
   结果示例：
   达人 A: 2500 元（50% 权重）
   达人 B: 1500 元（30% 权重）
   达人 C: 1000 元（20% 权重）
   
   写入 → attribution_results

3️⃣ 生成结算批次（自动）
   将归因结果转换为 settlement_batch
   每个 attribution_task 对应一个 batch
   
   settlement_items:
   达人 A: source_amount = 2500 元
   达人 B: source_amount = 1500 元
   达人 C: source_amount = 1000 元

4️⃣ 应用定价规则（自动）
   对每个达人，查询 pricing_rules
   
   示例：达人定价规则 = 60% percentage
   达人 A 应得 = 2500 × 0.6 = 1500 元
   达人 B 应得 = 1500 × 0.6 = 900 元
   达人 C 应得 = 1000 × 0.6 = 600 元

5️⃣ 团长抽成（自动）
   如果达人有团长，查询团长定价规则
   
   示例：团长抽成 = 10% percentage
   达人 A 团长抽成 = 1500 × 0.1 = 150 元
   达人 A 最终 = 1500 - 150 = 1350 元

6️⃣ 写入 earnings（自动）
   为每个达人和团长生成 earnings 记录
   
   earnings:
   达人 A: 1350 元 (status: pending)
   团长 X: 150 元 (status: pending)
   达人 B: 900 元
   ...

7️⃣ 管理员审核（人工）
   审核归因结果是否合理
   如果合理，批准 → earnings.status = confirmed
   如果不合理，调整或拒绝
```

### 3.2 数据流示例

**输入**（邮件数据）：
```json
{
  "date": "2025-01-20",
  "keyword": "知乎推广工具",
  "searchVolume": 1000,
  "conversions": 50,
  "revenue": 5000  // 元
}
```

**步骤 1**：写入 `attribution_tasks`
```sql
INSERT INTO attribution_tasks 
  (data_date, keyword, total_revenue, ...) 
VALUES 
  ('2025-01-20', '知乎推广工具', 500000, ...);  -- 5000元 = 500000分
```

**步骤 2**：归因引擎计算，写入 `attribution_results`
```sql
-- 达人 A（5个作品，质量分2500）
INSERT INTO attribution_results 
  (task_id, user_id, works_count, total_quality_score, attribution_weight, allocated_revenue)
VALUES 
  (1, 101, 5, 2500, 0.5, 250000);  -- 2500元 = 250000分

-- 达人 B（3个作品，质量分1500）
INSERT INTO attribution_results 
  (task_id, user_id, works_count, total_quality_score, attribution_weight, allocated_revenue)
VALUES 
  (1, 102, 3, 1500, 0.3, 150000);  -- 1500元
```

**步骤 3**：生成 `settlement_batch`（自动）
```sql
-- 批次
INSERT INTO settlement_batches 
  (title, period_start, period_end, created_by) 
VALUES 
  ('归因批次-知乎推广工具-2025-01-20', '2025-01-20', '2025-01-20', 1);

-- 明细
INSERT INTO settlement_items 
  (batch_id, creator_id, source_amount) 
VALUES 
  (1, 101, 2500.0000),  -- 达人A的"归因收益"
  (1, 102, 1500.0000);  -- 达人B的"归因收益"
```

**步骤 4-6**：应用定价规则，写入 `earnings`（复用现有 `approveBatch` 逻辑）

```typescript
// 假设定价规则：
// 达人规则：percentage = 0.6（60%）
// 团长规则：percentage = 0.1（10%）

// 达人 A
source_amount = 2500 元
creator_amount = 2500 × 0.6 = 1500 元
leader_amount = 1500 × 0.1 = 150 元
final_creator_amount = 1500 - 150 = 1350 元

// 写入 earnings
INSERT INTO earnings (user_id, amount, status, source_ref)
VALUES 
  (101, 135000, 'pending', 'attribution:task-1:result-1'),  -- 达人A：1350元
  (201, 15000, 'pending', 'attribution:task-1:result-1:leader');  -- 团长X：150元
```

---

## 四、数据模型扩展

### 4.1 复用现有表

**不需要新增**定价相关的表，完全复用：
- ✅ `pricing_rules` - 定价规则
- ✅ `settlement_batches` - 结算批次
- ✅ `settlement_items` - 结算明细
- ✅ `relay_logs` - 计算日志
- ✅ `earnings` - 收益记录

### 4.2 新增归因表（与现有表对接）

#### 表 1：`attribution_tasks`（归因任务）

```sql
CREATE TABLE attribution_tasks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  
  -- 原始数据（邮件）
  data_date DATE NOT NULL,
  keyword VARCHAR(128) NOT NULL,
  total_revenue BIGINT NOT NULL COMMENT '总收益（分）',
  search_volume INT NOT NULL DEFAULT 0,
  conversion_count INT NOT NULL DEFAULT 0,
  
  -- 归因状态
  status ENUM('pending', 'processing', 'completed', 'failed', 'manual') DEFAULT 'pending',
  confidence_score DECIMAL(5, 2) NULL COMMENT '置信度（0-100）',
  
  -- 关联结算批次（归因完成后自动创建）
  settlement_batch_id BIGINT NULL COMMENT '对应的结算批次ID',
  
  -- 审核
  reviewed_by BIGINT NULL,
  reviewed_at DATETIME NULL,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY uk_date_keyword (data_date, keyword),
  INDEX idx_status (status),
  INDEX idx_batch (settlement_batch_id),
  
  FOREIGN KEY (settlement_batch_id) REFERENCES settlement_batches(id)
) COMMENT '归因任务（邮件数据导入后创建）';
```

#### 表 2：`attribution_results`（归因结果）

```sql
CREATE TABLE attribution_results (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  
  task_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  
  -- 归因依据
  works_count INT NOT NULL,
  total_quality_score DECIMAL(12, 2) NULL,
  attribution_weight DECIMAL(8, 6) NOT NULL COMMENT '分配权重（0-1）',
  
  -- 归因收益（= settlement_items.source_amount）
  allocated_revenue BIGINT NOT NULL COMMENT '归因收益（分）',
  
  -- 关联结算明细
  settlement_item_id BIGINT NULL COMMENT '对应的结算明细ID',
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_task (task_id),
  INDEX idx_user (user_id),
  INDEX idx_item (settlement_item_id),
  
  FOREIGN KEY (task_id) REFERENCES attribution_tasks(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (settlement_item_id) REFERENCES settlement_items(id)
) COMMENT '归因结果明细';
```

#### 表 3：`keyword_bindings`（关键词绑定）

```sql
CREATE TABLE keyword_bindings (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  
  keyword VARCHAR(128) NOT NULL,
  plan_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  user_type ENUM('admin', 'leader', 'creator') NOT NULL,
  
  is_exclusive BOOLEAN DEFAULT FALSE,
  status ENUM('active', 'inactive') DEFAULT 'active',
  
  bind_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_keyword (keyword),
  INDEX idx_user (user_id)
) COMMENT '关键词绑定记录';
```

#### 表 4：`creator_works`（作品登记）

```sql
CREATE TABLE creator_works (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  
  work_title VARCHAR(255) NOT NULL,
  work_url VARCHAR(512) NOT NULL,
  platform ENUM('douyin', 'xiaohongshu', 'bilibili', 'weibo', 'other') NOT NULL,
  
  keyword VARCHAR(128) NOT NULL,
  plan_id BIGINT NULL,
  creator_id BIGINT NOT NULL,
  
  -- 作品质量数据
  view_count BIGINT DEFAULT 0,
  like_count INT DEFAULT 0,
  share_count INT DEFAULT 0,
  quality_score DECIMAL(10, 2) NULL,
  
  published_at DATETIME NOT NULL,
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_keyword (keyword, published_at),
  INDEX idx_creator (creator_id)
) COMMENT '达人作品登记';
```

---

## 五、实现方案

### 5.1 归因引擎核心逻辑

```typescript
/**
 * 归因引擎：将关键词收益拆分到达人，并自动生成结算批次
 */
export async function performAttributionWithSettlement(taskId: string) {
  return withTransaction(async (conn) => {
    // 1. 获取归因任务
    const task = await getAttributionTask(conn, taskId);
    
    // 2. 执行归因算法（计算每个达人的"归因收益"）
    const attributionResults = await calculateAttribution(conn, task);
    
    // 3. 写入 attribution_results
    for (const result of attributionResults) {
      await conn.query(
        `INSERT INTO attribution_results 
         (task_id, user_id, works_count, total_quality_score, attribution_weight, allocated_revenue)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [taskId, result.userId, result.worksCount, result.qualityScore, result.weight, result.revenue]
      );
    }
    
    // 4. 自动创建结算批次（关键：将归因结果转为定价规则的输入）
    const batchId = await createSettlementBatchFromAttribution(conn, task, attributionResults);
    
    // 5. 更新归因任务状态
    await conn.query(
      `UPDATE attribution_tasks 
       SET status = 'completed', settlement_batch_id = ? 
       WHERE id = ?`,
      [batchId, taskId]
    );
    
    // 6. 自动审批结算批次（应用定价规则）
    await approveSettlementBatch(conn, batchId);
    
    return { taskId, batchId, results: attributionResults };
  });
}

/**
 * 将归因结果转换为结算批次
 */
async function createSettlementBatchFromAttribution(
  conn: PoolConnection,
  task: AttributionTask,
  results: AttributionResult[]
): Promise<string> {
  // 1. 创建结算批次
  const [batchResult] = await conn.query<ResultSetHeader>(
    `INSERT INTO settlement_batches 
     (title, period_start, period_end, created_by, status)
     VALUES (?, ?, ?, ?, 'draft')`,
    [
      `归因批次-${task.keyword}-${task.dataDate}`,
      task.dataDate,
      task.dataDate,
      1 // 系统自动创建
    ]
  );
  
  const batchId = String(batchResult.insertId);
  
  // 2. 创建结算明细（归因收益 = 来源金额）
  for (const result of results) {
    const [itemResult] = await conn.query<ResultSetHeader>(
      `INSERT INTO settlement_items 
       (batch_id, creator_id, source_amount, note)
       VALUES (?, ?, ?, ?)`,
      [
        batchId,
        result.userId,
        (result.revenue / 100).toFixed(4), // 分转元，保留4位小数
        `归因自关键词「${task.keyword}」`
      ]
    );
    
    // 3. 反向关联：记录 settlement_item_id
    await conn.query(
      `UPDATE attribution_results 
       SET settlement_item_id = ? 
       WHERE task_id = ? AND user_id = ?`,
      [itemResult.insertId, task.id, result.userId]
    );
  }
  
  return batchId;
}

/**
 * 归因算法（质量加权）
 */
async function calculateAttribution(
  conn: PoolConnection,
  task: AttributionTask
): Promise<AttributionResult[]> {
  // 1. 查找使用该关键词的作品（30天内）
  const [works] = await conn.query<WorkRow[]>(
    `SELECT w.*, u.parent_id 
     FROM creator_works w
     JOIN users u ON u.id = w.creator_id
     WHERE w.keyword = ? 
       AND w.status = 'approved'
       AND w.published_at >= DATE_SUB(?, INTERVAL 30 DAY)
       AND w.published_at <= ?`,
    [task.keyword, task.dataDate, task.dataDate]
  );
  
  if (works.length === 0) {
    throw new AppError(422, 42218, '该关键词无可归因的作品');
  }
  
  // 2. 计算每个作品的质量分
  const worksWithScore = works.map(w => ({
    ...w,
    qualityScore: calculateQualityScore(w)
  }));
  
  // 3. 按达人分组统计
  const userStats = new Map<string, { 
    userId: string, 
    worksCount: number, 
    totalScore: number 
  }>();
  
  for (const work of worksWithScore) {
    const userId = String(work.creator_id);
    const existing = userStats.get(userId);
    
    if (existing) {
      existing.worksCount++;
      existing.totalScore += work.qualityScore;
    } else {
      userStats.set(userId, {
        userId,
        worksCount: 1,
        totalScore: work.qualityScore
      });
    }
  }
  
  // 4. 计算分配权重和收益
  const totalScore = Array.from(userStats.values())
    .reduce((sum, u) => sum + u.totalScore, 0);
  
  const results: AttributionResult[] = [];
  let allocatedTotal = 0n;
  
  for (const stats of userStats.values()) {
    const weight = stats.totalScore / totalScore;
    const revenue = BigInt(Math.floor(Number(task.totalRevenue) * weight));
    
    results.push({
      userId: stats.userId,
      worksCount: stats.worksCount,
      qualityScore: stats.totalScore,
      weight,
      revenue
    });
    
    allocatedTotal += revenue;
  }
  
  // 5. 处理尾差（确保总额守恒）
  const diff = task.totalRevenue - allocatedTotal;
  if (diff !== 0n && results.length > 0) {
    results[0].revenue += diff;
  }
  
  return results;
}
```

### 5.2 定价规则应用（复用现有）

```typescript
/**
 * 审批结算批次（复用现有的 approveBatch 逻辑）
 * 
 * 此函数会：
 * 1. 读取 settlement_items（来源金额 = 归因收益）
 * 2. 应用 pricing_rules（达人规则 + 团长规则）
 * 3. 写入 earnings（达人应得 + 团长抽成）
 * 4. 记录 relay_logs（计算日志）
 */
async function approveSettlementBatch(
  conn: PoolConnection,
  batchId: string
) {
  // 直接调用现有的 approveBatch 逻辑
  // （已在 relay.service.ts 中实现）
  
  // 这里会自动：
  // - 查询每个达人的 pricing_rules
  // - 计算达人应得（source_amount × percentage 或 fixed）
  // - 查询团长的 pricing_rules
  // - 计算团长抽成
  // - 写入 earnings 表
  
  await approveBatch({ sub: '1', role: 'admin' } as AuthUser, batchId);
}
```

---

## 六、API 设计

### API 1：导入邮件数据并触发归因

```typescript
POST /api/v1/attribution/import-and-process
Content-Type: multipart/form-data

file: revenue_2025-01-20.csv

Response:
{
  "success": true,
  "tasksCreated": 150,
  "tasksProcessed": 145,
  "tasksFailed": 5,
  "batchesCreated": 145,
  "earningsGenerated": 320  // 达人 + 团长
}
```

### API 2：查看归因任务详情

```typescript
GET /api/v1/attribution/tasks/:taskId

Response:
{
  "task": {
    "id": "1",
    "keyword": "知乎推广工具",
    "totalRevenue": 500000,  // 分
    "dataDate": "2025-01-20",
    "status": "completed",
    "confidenceScore": 88.5
  },
  "attributionResults": [
    {
      "userId": "101",
      "username": "creator_a",
      "worksCount": 5,
      "qualityScore": 2500,
      "attributionWeight": 0.5,
      "allocatedRevenue": 250000,  // 归因收益（分）
      "settlementItem": {
        "id": "201",
        "sourceAmount": 2500.0000  // 来源金额（元）
      }
    }
  ],
  "settlementBatch": {
    "id": "301",
    "status": "approved",
    "totalSource": 5000.0000,
    "totalRelay": 3000.0000  // 应用定价规则后的总金额
  },
  "earnings": [
    {
      "userId": "101",
      "role": "creator",
      "amount": 135000,  // 达人最终收益（分）
      "status": "pending"
    },
    {
      "userId": "201",
      "role": "leader",
      "amount": 15000,  // 团长抽成（分）
      "status": "pending"
    }
  ]
}
```

---

## 七、示例场景

### 场景：完整的归因和结算流程

#### 输入数据

**邮件数据**：
```
日期: 2025-01-20
关键词: 知乎推广工具
搜索量: 1000
转化数: 50
收益: 5000 元
```

**作品数据**（系统内已登记）：
```
达人 A: 5 个作品，总质量分 2500
达人 B: 3 个作品，总质量分 1500
达人 C: 2 个作品，总质量分 1000
```

**定价规则**（系统内已配置）：
```
达人规则: percentage = 0.6（60%）
团长规则: percentage = 0.1（10%）
```

**团队结构**：
```
达人 A → 团长 X
达人 B → 团长 X
达人 C → 无团长（散户）
```

---

#### 执行流程

**步骤 1：导入邮件数据**

```sql
INSERT INTO attribution_tasks 
  (data_date, keyword, total_revenue, search_volume, conversion_count)
VALUES 
  ('2025-01-20', '知乎推广工具', 500000, 1000, 50);
```

**步骤 2：归因引擎计算**

```
总质量分 = 2500 + 1500 + 1000 = 5000

达人 A:
  权重 = 2500 / 5000 = 0.5
  归因收益 = 5000 × 0.5 = 2500 元

达人 B:
  权重 = 1500 / 5000 = 0.3
  归因收益 = 5000 × 0.3 = 1500 元

达人 C:
  权重 = 1000 / 5000 = 0.2
  归因收益 = 5000 × 0.2 = 1000 元
```

写入 `attribution_results`：
```sql
INSERT INTO attribution_results VALUES
  (1, 101, 5, 2500, 0.5, 250000),  -- 达人A
  (1, 102, 3, 1500, 0.3, 150000),  -- 达人B
  (1, 103, 2, 1000, 0.2, 100000);  -- 达人C
```

**步骤 3：生成结算批次**

```sql
-- 批次
INSERT INTO settlement_batches VALUES
  (301, '归因批次-知乎推广工具-2025-01-20', '2025-01-20', '2025-01-20', 'draft', ...);

-- 明细
INSERT INTO settlement_items VALUES
  (1, 301, 101, 2500.0000, '归因自关键词「知乎推广工具」'),
  (2, 301, 102, 1500.0000, '归因自关键词「知乎推广工具」'),
  (3, 301, 103, 1000.0000, '归因自关键词「知乎推广工具」');
```

**步骤 4：应用定价规则**

```
达人 A:
  来源金额 = 2500 元
  应得 = 2500 × 0.6 = 1500 元
  团长抽成 = 1500 × 0.1 = 150 元
  最终 = 1500 - 150 = 1350 元

达人 B:
  来源金额 = 1500 元
  应得 = 1500 × 0.6 = 900 元
  团长抽成 = 900 × 0.1 = 90 元
  最终 = 900 - 90 = 810 元

达人 C（无团长）:
  来源金额 = 1000 元
  应得 = 1000 × 0.6 = 600 元
  团长抽成 = 0 元
  最终 = 600 元

团长 X（汇总）:
  抽成 = 150 + 90 = 240 元
```

**步骤 5：写入 earnings**

```sql
INSERT INTO earnings (user_id, amount, status, source_ref) VALUES
  (101, 135000, 'pending', 'attribution:task-1:result-1'),       -- 达人A: 1350元
  (201, 24000, 'pending', 'attribution:task-1:result-1:leader'), -- 团长X: 240元
  (102, 81000, 'pending', 'attribution:task-1:result-2'),        -- 达人B: 810元
  (103, 60000, 'pending', 'attribution:task-1:result-3');        -- 达人C: 600元
```

---

#### 最终结果

| 用户 | 角色 | 归因收益 | 定价规则 | 应得 | 团长抽成 | 最终入账 |
|-----|------|---------|---------|-----|---------|---------|
| 达人 A | creator | 2500元 | 60% | 1500元 | -150元 | **1350元** |
| 达人 B | creator | 1500元 | 60% | 900元 | -90元 | **810元** |
| 达人 C | creator | 1000元 | 60% | 600元 | 0元 | **600元** |
| 团长 X | leader | - | 10% | - | +240元 | **240元** |
| **合计** | - | **5000元** | - | **3000元** | - | **3000元** |

**验证**：
- ✅ 归因收益总额 = 2500 + 1500 + 1000 = 5000 元（与邮件一致）
- ✅ 最终入账总额 = 1350 + 810 + 600 + 240 = 3000 元（定价规则调整后）
- ✅ 团长抽成 = 150 + 90 = 240 元（正确）

---

## 八、优势与亮点

### 8.1 复用现有体系

✅ **无需重复造轮子**
- 完全复用 `pricing_rules` 表和逻辑
- 复用 `settlement_batches` 批次管理
- 复用 `relay_logs` 审计日志
- 复用 `earnings` 收益入账

✅ **统一的定价管理**
- 管理员只需要在一个地方配置定价规则
- 定价规则的修改自动应用到归因结果
- 历史数据可追溯（relay_logs）

### 8.2 灵活的业务规则

✅ **支持多种定价方式**
- 固定单价（fixed）
- 百分比（percentage）
- 按用户定制（target_user_id）
- 按角色统一（target_role）

✅ **自动化处理**
- 邮件数据导入 → 归因 → 结算批次 → 应用定价 → 生成收益
- 全流程自动化，减少人工操作

### 8.3 可审计与可追溯

✅ **完整的审计链路**
```
邮件数据 → attribution_tasks
         ↓
归因计算 → attribution_results
         ↓
结算批次 → settlement_batches + settlement_items
         ↓
定价规则 → pricing_rules（命中规则）
         ↓
计算日志 → relay_logs（详细记录）
         ↓
最终入账 → earnings
```

✅ **可追溯到源头**
- 每笔收益可以追溯到具体的关键词
- 每笔收益可以追溯到具体的作品
- 每笔收益可以追溯到应用的定价规则

---

## 九、总结

### 9.1 核心设计思想

**分层解耦**：
1. **归因层**：负责"关键词 → 达人"的归因（新增）
2. **定价层**：负责"达人归因收益 → 最终入账"的计算（复用现有）
3. **结算层**：负责提现和财务管理（现有）

**数据映射**：
```
归因收益（attribution_results.allocated_revenue）
    ↓ 映射为
来源金额（settlement_items.source_amount）
    ↓ 应用
定价规则（pricing_rules）
    ↓ 输出
最终入账（earnings.amount）
```

### 9.2 关键优势

1. ✅ **复用现有体系**，无需重构定价逻辑
2. ✅ **统一管理**，定价规则集中配置
3. ✅ **自动化程度高**，减少人工操作
4. ✅ **可审计**，完整的数据链路追踪
5. ✅ **灵活扩展**，支持多种定价方式

### 9.3 实施建议

**Phase 1（MVP）**：
- 实现归因引擎核心算法
- 自动生成 settlement_batch
- 复用现有 approveBatch 逻辑

**Phase 2（优化）**：
- 归因算法优化（质量分数调整）
- 置信度评估
- 人工审核界面

**Phase 3（完善）**：
- 异常监控
- 申诉流程
- 数据报表

---

**下一步**：
1. 评审本方案
2. 确认归因算法的权重系数
3. 确认是否需要调整现有定价规则
4. 开始开发
