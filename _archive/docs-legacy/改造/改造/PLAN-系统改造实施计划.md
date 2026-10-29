# 系统改造实施计划

> **文档目标**：制定完整的系统改造计划，指导从当前状态到目标状态的迁移。
>
> **核心任务**：废弃无效功能、实现归因引擎、接入邮件数据、完善作品管理。
>
> **创建时间**：2025-01-XX  
> **状态**：实施计划（待评审）

---

## 目录

- [一、改造总览](#一改造总览)
- [二、现有代码清理](#二现有代码清理)
- [三、新功能实施](#三新功能实施)
- [四、数据迁移](#四数据迁移)
- [五、测试策略](#五测试策略)
- [六、上线方案](#六上线方案)
- [七、风险控制](#七风险控制)

---

## 一、改造总览

### 1.1 改造范围

```
┌─────────────────────────────────────────────────┐
│              系统改造全景图                        │
└─────────────────────────────────────────────────┘

【废弃模块】（标记为 Deprecated）
  ❌ 审核状态同步（推广计划 + 作品）
  ❌ 自动拉取收益数据
  ❌ 实时转化数据接口
  
【改造模块】（重构或增强）
  🔄 作品管理（新增关键词绑定）
  🔄 收益管理（接入邮件数据）
  🔄 团队管理（支持关键词归因）
  
【新增模块】
  ✨ 关键词绑定系统
  ✨ 作品登记与质量采集
  ✨ 邮件数据导入
  ✨ 归因引擎核心
  ✨ 归因审核工作台
```

### 1.2 改造时间线

```
┌─────────────────────────────────────────────────┐
│         改造时间线（共 6 周）                      │
├─────────────────────────────────────────────────┤
│                                                 │
│  Week 1-2: 数据模型设计 + 代码清理                │
│    - 数据库表设计                                │
│    - 废弃功能标记                                │
│    - API 接口设计                                │
│                                                 │
│  Week 3-4: 核心功能开发                          │
│    - 关键词绑定系统                              │
│    - 作品登记系统                                │
│    - 邮件数据导入                                │
│    - 归因引擎 MVP                                │
│                                                 │
│  Week 5: 前端界面开发                            │
│    - 关键词管理页面                              │
│    - 作品登记页面                                │
│    - 数据导入页面                                │
│    - 归因审核页面                                │
│                                                 │
│  Week 6: 测试 + 上线                             │
│    - 集成测试                                    │
│    - 用户培训                                    │
│    - 灰度发布                                    │
│    - 全量上线                                    │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 二、现有代码清理

### 2.1 需要废弃的代码

#### 文件清单

```
server/src/jobs/
  ❌ syncPlanStatus.ts          # 推广计划审核状态同步
  ❌ syncCompositionStatus.ts   # 作品审核状态同步
  ⚠️  syncMetrics.ts             # 部分保留（只保留目录同步）

server/src/services/
  ⚠️  plans.service.ts           # 删除审核状态查询逻辑
  ⚠️  compositions.service.ts    # 删除审核状态同步逻辑

apps/platform-admin/src/views/
  ⚠️  SystemToolsView.vue        # 删除"同步审核状态"按钮

docs/
  ⚠️  zhihu-audit-status-*.md    # 标记为已废弃
```

#### 处理方式

**方式 1：直接删除（激进）**
```bash
# 完全删除无用代码
git rm server/src/jobs/syncPlanStatus.ts
git rm server/src/jobs/syncCompositionStatus.ts
```

**方式 2：标记废弃（稳妥）⭐ 推荐**
```typescript
// server/src/jobs/syncPlanStatus.ts

/**
 * @deprecated 此功能已废弃
 * 
 * 原因：知乎官方不提供审核状态查询 API
 * 废弃日期：2025-01-XX
 * 迁移指南：无需替代，审核状态通过人工跟进
 */
export async function syncPlanStatus() {
  logger.warn('syncPlanStatus is deprecated and will be removed in v2.0');
  return { status: 'deprecated', message: '此功能已废弃' };
}
```

### 2.2 需要修改的代码

#### 修改 1：定时任务调度器

```typescript
// server/src/jobs/index.ts

export function startScheduler() {
  if (task) return;
  
  // ❌ 删除：审核状态同步定时任务
  // settleTask = cron.schedule('0 3 * * *', () => { ... });
  
  // ✅ 保留：数据拉取和结算
  task = cron.schedule('0 2 * * *', () => {
    // 只保留目录同步（渠道、任务）
    void (async () => {
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());
      // 注意：syncMetrics 需要重构，只同步目录，不拉取收益数据
      await enqueue('sync-catalog', { source: 'cron' }, { jobId: `catalog-daily-${day}` });
    })();
  }, { timezone: config.timezone });
}
```

#### 修改 2：Plans 服务层

```typescript
// server/src/services/plans.service.ts

// ❌ 删除：审核状态查询相关代码
export async function listPlans(user: AuthUser, query: ListQuery) {
  // ... 保留原有查询逻辑
  
  // ❌ 删除这段
  // const plans = plans.map(p => ({
  //   ...p,
  //   zhihuAuditStatus: p.zhihu_status_json?.auditStatus,
  //   zhihuRejectReason: p.zhihu_status_json?.rejectReason
  // }));
  
  // ✅ 简化返回
  return plans;
}
```

#### 修改 3：前端界面

```vue
<!-- apps/platform-admin/src/views/PlansView.vue -->

<template>
  <!-- ❌ 删除：审核状态显示 -->
  <!-- <div v-if="plan.zhihuAuditStatus" class="audit-status">
    <el-tag :type="getAuditStatusType(plan.zhihuAuditStatus)">
      {{ plan.zhihuAuditStatus }}
    </el-tag>
  </div> -->
  
  <!-- ✅ 保留：基础状态 -->
  <div class="plan-status">
    <el-tag :type="getStatusType(plan.status)">
      {{ statusLabels[plan.status] }}
    </el-tag>
  </div>
</template>
```

### 2.3 数据库表清理

```sql
-- ❌ 不建议删除字段（向后兼容）
-- ALTER TABLE plans DROP COLUMN zhihu_status_json;

-- ✅ 建议：保留字段，但停止更新
-- 理由：历史数据仍有参考价值，删除字段需要大量数据迁移

-- 如果确实要清理，使用此脚本
-- ALTER TABLE plans DROP COLUMN zhihu_status_json;
-- ALTER TABLE compositions DROP COLUMN zhihu_status_json;
```

---

## 三、新功能实施

### 3.1 数据库表创建

#### 执行顺序

```sql
-- 1. 关键词绑定表
CREATE TABLE keyword_bindings ( ... );

-- 2. 作品登记表
CREATE TABLE creator_works ( ... );

-- 3. 归因任务表
CREATE TABLE attribution_tasks ( ... );

-- 4. 归因结果表
CREATE TABLE attribution_results ( ... );

-- 5. 导入批次表
CREATE TABLE data_import_batches ( ... );

-- 6. 扩展现有 earnings 表
ALTER TABLE earnings ADD COLUMN attribution_result_id BIGINT NULL;
ALTER TABLE earnings ADD COLUMN attribution_method VARCHAR(32) NULL;
```

完整 SQL 见：`server/migrations/008_attribution_system.sql`

### 3.2 后端功能开发

#### 模块 1：关键词绑定系统

**文件**：`server/src/services/keyword-binding.service.ts`

**核心功能**：
```typescript
// 创建关键词绑定
export async function createBinding(user: AuthUser, input: CreateBindingInput);

// 查询用户的关键词列表
export async function listMyBindings(user: AuthUser, query: PageQuery);

// 检查关键词是否可用（是否被独占）
export async function checkKeywordAvailability(keyword: string, userId: string);

// 解绑关键词
export async function unbindKeyword(user: AuthUser, bindingId: string);
```

**路由**：`server/src/routes/keyword-bindings.ts`

```typescript
router.post('/', requireAuth, requirePermission('create_plan'), createBindingHandler);
router.get('/', requireAuth, listBindingsHandler);
router.get('/check', requireAuth, checkAvailabilityHandler);
router.delete('/:id', requireAuth, unbindKeywordHandler);
```

#### 模块 2：作品登记系统

**文件**：`server/src/services/creator-works.service.ts`

**核心功能**：
```typescript
// 达人登记作品
export async function submitWork(user: AuthUser, input: SubmitWorkInput);

// 查询作品列表（支持按关键词、达人筛选）
export async function listWorks(user: AuthUser, query: WorksQuery);

// 更新作品质量数据（浏览量、点赞数等）
export async function updateWorkMetrics(workId: string, metrics: WorkMetrics);

// 管理员审核作品
export async function reviewWork(admin: AuthUser, workId: string, action: 'approve' | 'reject', notes?: string);
```

**路由**：`server/src/routes/creator-works.ts`

```typescript
router.post('/', requireAuth, submitWorkHandler);
router.get('/', requireAuth, listWorksHandler);
router.get('/:id', requireAuth, getWorkHandler);
router.patch('/:id/metrics', requireAuth, updateMetricsHandler);
router.post('/:id/review', requireAuth, requirePermission('admin'), reviewWorkHandler);
```

#### 模块 3：邮件数据导入

**文件**：`server/src/services/data-import.service.ts`

**核心功能**：
```typescript
// 解析上传的文件
export async function parseUploadedFile(filePath: string, filename: string);

// 验证数据
export async function validateRevenueData(rows: any[]);

// 批量创建归因任务
export async function batchCreateAttributionTasks(data: any[], options: ImportOptions);

// 查询导入历史
export async function listImportBatches(query: PageQuery);
```

**路由**：`server/src/routes/data-import.ts`

```typescript
router.post('/parse', requireAuth, requirePermission('admin'), upload.single('file'), parseFileHandler);
router.post('/confirm', requireAuth, requirePermission('admin'), confirmImportHandler);
router.get('/batches', requireAuth, requirePermission('admin'), listBatchesHandler);
```

#### 模块 4：归因引擎核心

**文件**：`server/src/services/attribution.service.ts`

**核心功能**：
```typescript
// 执行归因算法
export async function performAttribution(taskId: string);

// 计算质量分数
export function calculateQualityScore(work: CreatorWork): number;

// 计算置信度
export function calculateConfidence(task: AttributionTask, works: CreatorWork[], results: AttributionResult[]): number;

// 查询待审核的归因任务
export async function listPendingTasks(query: PageQuery);

// 审核归因结果
export async function reviewAttribution(admin: AuthUser, taskId: string, action: 'approve' | 'reject', adjustments?: any[]);
```

**路由**：`server/src/routes/attribution.ts`

```typescript
router.get('/tasks', requireAuth, requirePermission('admin'), listTasksHandler);
router.get('/tasks/:id', requireAuth, requirePermission('admin'), getTaskHandler);
router.post('/tasks/:id/process', requireAuth, requirePermission('admin'), processTaskHandler);
router.post('/tasks/:id/review', requireAuth, requirePermission('admin'), reviewTaskHandler);
```

#### 模块 5：队列任务

**文件**：`server/src/jobs/processAttribution.ts`

```typescript
import { Job } from 'bull';
import { performAttribution } from '../services/attribution.service';
import { logger } from '../utils/logger';

/**
 * 归因任务处理器（异步队列）
 */
export async function processAttribution(job: Job<{ taskId: string }>) {
  const { taskId } = job.data;
  
  logger.info({ taskId }, 'Processing attribution task');
  
  try {
    const result = await performAttribution(taskId);
    
    logger.info({ taskId, confidence: result.confidence }, 'Attribution completed');
    
    return result;
  } catch (error) {
    logger.error({ taskId, error }, 'Attribution failed');
    throw error;
  }
}
```

### 3.3 前端界面开发

#### 页面 1：关键词管理（达人/团长）

**文件**：`apps/platform-creator/src/views/KeywordBindingsView.vue`

**功能**：
- 查看已绑定的关键词列表
- 绑定新关键词（选择推广计划）
- 查看关键词使用统计（作品数、预估收益）
- 解绑关键词

**布局**：
```
┌─────────────────────────────────────────────┐
│  我的关键词                    [+ 绑定新关键词] │
├─────────────────────────────────────────────┤
│  关键词        推广计划    作品数   预估收益    │
│  知乎推广工具   P001       5       1200元     │
│  知乎引流技巧   P002       3       800元      │
│  ...                                        │
└─────────────────────────────────────────────┘
```

#### 页面 2：作品登记（达人）

**文件**：`apps/platform-creator/src/views/WorkSubmitView.vue`

**功能**：
- 填写作品信息（标题、链接、平台）
- 选择使用的关键词（从已绑定列表）
- 填写作品数据（浏览量、点赞数）
- 提交审核

**表单**：
```vue
<el-form :model="form">
  <el-form-item label="作品标题" required>
    <el-input v-model="form.title" />
  </el-form-item>
  
  <el-form-item label="作品链接" required>
    <el-input v-model="form.url" placeholder="https://..." />
  </el-form-item>
  
  <el-form-item label="发布平台" required>
    <el-select v-model="form.platform">
      <el-option label="抖音" value="douyin" />
      <el-option label="小红书" value="xiaohongshu" />
      <el-option label="B站" value="bilibili" />
    </el-select>
  </el-form-item>
  
  <el-form-item label="使用关键词" required>
    <el-select v-model="form.keyword">
      <el-option
        v-for="binding in myBindings"
        :key="binding.keyword"
        :label="binding.keyword"
        :value="binding.keyword"
      />
    </el-select>
  </el-form-item>
  
  <el-form-item label="发布时间" required>
    <el-date-picker v-model="form.publishedAt" type="datetime" />
  </el-form-item>
  
  <el-form-item label="浏览量">
    <el-input-number v-model="form.viewCount" :min="0" />
  </el-form-item>
  
  <el-form-item label="点赞数">
    <el-input-number v-model="form.likeCount" :min="0" />
  </el-form-item>
  
  <el-button type="primary" @click="submitWork">提交</el-button>
</el-form>
```

#### 页面 3：数据导入（管理员）

**文件**：`apps/platform-admin/src/views/DataImportView.vue`

**功能**：
- 上传邮件附件（CSV/Excel）
- 数据预览和验证
- 确认导入
- 查看导入历史

详见《邮件数据自动化方案》中的界面设计。

#### 页面 4：归因审核（管理员）

**文件**：`apps/platform-admin/src/views/AttributionReviewView.vue`

**功能**：
- 查看待审核的归因任务（按置信度排序）
- 查看归因详情（每个达人的分配结果）
- 手动调整分配比例
- 批准或拒绝归因结果

**布局**：
```
┌─────────────────────────────────────────────────┐
│  归因审核                        筛选: [待审核▼]  │
├─────────────────────────────────────────────────┤
│  日期       关键词        总收益   置信度   状态   │
│  2025-01-20 知乎推广工具  5000元   75%     待审核 │
│  2025-01-20 知乎引流技巧  3000元   92%     待审核 │
│  ...                                            │
└─────────────────────────────────────────────────┘

【点击某行，展开详情】
┌─────────────────────────────────────────────────┐
│  归因详情 - 知乎推广工具                          │
├─────────────────────────────────────────────────┤
│  达人        作品数  质量分  分配比例  分配收益   │
│  达人A       5      2500    50%       2500元    │
│  达人B       3      1500    30%       1500元    │
│  达人C       2      1000    20%       1000元    │
│                                                 │
│  [手动调整] [批准归因] [拒绝归因]                 │
└─────────────────────────────────────────────────┘
```

---

## 四、数据迁移

### 4.1 迁移脚本

#### 脚本 1：创建新表

```bash
# server/migrations/008_attribution_system.sql

-- 完整建表语句见《归因引擎设计方案》
```

#### 脚本 2：迁移历史数据（可选）

```sql
-- 如果有历史收益数据，需要创建归因任务

INSERT INTO attribution_tasks (
  data_date, keyword, search_volume, conversion_count, total_revenue,
  status, attribution_method, source_file
)
SELECT 
  DATE(created_at) as data_date,
  '历史数据' as keyword,
  0 as search_volume,
  0 as conversion_count,
  amount as total_revenue,
  'manual' as status,
  'legacy_migration' as attribution_method,
  'migration_script' as source_file
FROM earnings
WHERE created_at < '2025-01-01'
GROUP BY DATE(created_at);
```

### 4.2 数据清理

```sql
-- 清理无效的审核状态数据（可选）
UPDATE plans SET zhihu_status_json = NULL WHERE zhihu_status_json IS NOT NULL;
UPDATE compositions SET zhihu_status_json = NULL WHERE zhihu_status_json IS NOT NULL;
```

---

## 五、测试策略

### 5.1 单元测试

```typescript
// server/tests/unit/attribution.service.spec.ts

describe('Attribution Service', () => {
  it('should calculate quality score correctly', () => {
    const work = {
      viewCount: 1000,
      likeCount: 50,
      shareCount: 10,
      commentCount: 20
    };
    
    const score = calculateQualityScore(work);
    
    expect(score).toBe(1000 * 0.5 + 50 * 2 + 10 * 5 + 20 * 3); // 670
  });
  
  it('should distribute revenue correctly', async () => {
    const task = {
      keyword: '知乎推广工具',
      totalRevenue: 500000, // 5000元
      dataDate: '2025-01-20'
    };
    
    const results = await performAttribution(task.id);
    
    const totalAllocated = results.reduce((sum, r) => sum + r.allocatedRevenue, 0);
    expect(totalAllocated).toBe(task.totalRevenue); // 总额守恒
  });
});
```

### 5.2 集成测试

```typescript
// server/tests/integration/data-import.spec.ts

describe('Data Import', () => {
  it('should import CSV file successfully', async () => {
    const csvContent = `日期,关键词,搜索量,转化数,收益金额
2025-01-20,知乎推广工具,1000,50,5000.00`;
    
    const filePath = await createTempFile(csvContent, 'test.csv');
    
    const result = await parseUploadedFile(filePath, 'test.csv');
    
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].keyword).toBe('知乎推广工具');
  });
});
```

### 5.3 端到端测试

```typescript
// 测试完整流程：上传数据 → 归因 → 审核 → 生成收益
describe('E2E: Revenue Attribution Flow', () => {
  it('should complete full attribution flow', async () => {
    // 1. 达人绑定关键词
    await createBinding(creator, { keyword: '知乎推广工具', planId: 'P001' });
    
    // 2. 达人登记作品
    await submitWork(creator, {
      keyword: '知乎推广工具',
      viewCount: 10000,
      likeCount: 500
    });
    
    // 3. 管理员导入邮件数据
    const importResult = await importRevenueData(admin, csvFile);
    
    // 4. 自动触发归因
    const task = await getAttributionTask(importResult.taskIds[0]);
    expect(task.status).toBe('completed');
    
    // 5. 管理员审核归因
    await reviewAttribution(admin, task.id, 'approve');
    
    // 6. 验证收益已生成
    const earnings = await getEarnings(creator);
    expect(earnings).toHaveLength(1);
    expect(earnings[0].amount).toBeGreaterThan(0);
  });
});
```

---

## 六、上线方案

### 6.1 上线步骤

#### 阶段 1：灰度发布（Week 6 前半周）

```
1️⃣ 部署到测试环境
   - 运行数据库迁移
   - 部署新代码
   - 配置环境变量

2️⃣ 小范围内测（5-10 人）
   - 邀请 2-3 个团长和达人
   - 完整走一遍流程
   - 收集反馈和 Bug

3️⃣ 修复问题
   - 紧急修复关键 Bug
   - 优化用户体验

4️⃣ 生产环境部署
   - 选择低峰时段（凌晨 2-4 点）
   - 运行数据库迁移
   - 部署新代码
   - 烟雾测试
```

#### 阶段 2：全量上线（Week 6 后半周）

```
5️⃣ 功能开关打开
   - 通过配置开关控制新功能可见性
   - 逐步开放给所有用户

6️⃣ 用户培训
   - 发布操作手册
   - 录制视频教程
   - 在线答疑

7️⃣ 监控观察
   - 监控系统指标（错误率、响应时间）
   - 监控业务指标（归因准确率、争议率）
   - 及时响应用户反馈
```

### 6.2 回滚预案

```sql
-- 如果上线后发现严重问题，执行回滚

-- 1. 关闭新功能（配置开关）
UPDATE system_config SET value = 'false' WHERE key = 'attribution_enabled';

-- 2. 回滚数据库（如果有破坏性变更）
-- 不建议回滚建表操作，只回滚数据变更
DELETE FROM attribution_tasks WHERE created_at > '2025-01-XX';
DELETE FROM attribution_results WHERE created_at > '2025-01-XX';

-- 3. 回滚代码
git revert <commit-hash>
# 或
git reset --hard <previous-commit>

-- 4. 重新部署旧版本
```

### 6.3 上线检查清单

**部署前**：
- [ ] 代码已通过所有测试
- [ ] 数据库迁移脚本已验证
- [ ] 环境变量已配置
- [ ] 监控告警已设置
- [ ] 回滚方案已准备

**部署时**：
- [ ] 数据库备份已完成
- [ ] 数据库迁移已执行
- [ ] 新代码已部署
- [ ] 服务已重启
- [ ] 烟雾测试已通过

**部署后**：
- [ ] 监控指标正常
- [ ] 错误日志无异常
- [ ] 用户反馈良好
- [ ] 关键功能可用

---

## 七、风险控制

### 7.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|-----|-----|-----|---------|
| **数据库迁移失败** | 低 | 高 | 在测试环境完整验证；生产环境迁移前备份 |
| **归因算法不准确** | 中 | 中 | 人工审核机制；逐步优化算法 |
| **性能问题** | 低 | 中 | 异步队列处理；数据库索引优化 |
| **数据丢失** | 低 | 高 | 定期备份；事务保护 |

### 7.2 业务风险

| 风险 | 概率 | 影响 | 缓解措施 |
|-----|-----|-----|---------|
| **用户不接受新流程** | 中 | 中 | 充分培训；渐进式推广 |
| **收益分配争议** | 中 | 高 | 申诉机制；人工仲裁 |
| **邮件格式变更** | 低 | 中 | 智能字段匹配；格式监控 |
| **历史数据无法归因** | 高 | 低 | 标记为"历史数据"，不强制归因 |

### 7.3 应急预案

#### 预案 1：归因引擎故障

**现象**：归因任务大量失败

**应对**：
1. 暂停自动归因（关闭队列）
2. 切换到人工分配模式
3. 排查问题根因
4. 修复后重新处理失败任务

#### 预案 2：数据导入错误

**现象**：导入的数据有误（如金额错误）

**应对**：
1. 立即停止导入
2. 回滚错误的导入批次
3. 核对原始邮件数据
4. 重新导入正确数据

#### 预案 3：用户大量投诉

**现象**：达人认为收益分配不合理

**应对**：
1. 收集具体案例
2. 核查归因逻辑是否有误
3. 暂时冻结争议收益
4. 人工复核并调整
5. 优化归因算法

---

## 八、后续迭代规划

### 8.1 短期优化（1-2 个月内）

1. **归因算法优化**
   - 根据实际运营数据调整权重系数
   - 增加更多质量维度（评论质量、转发质量）
   - A/B 测试不同算法效果

2. **自动化增强**
   - IMAP 邮件自动收取
   - 作品数据自动采集（爬虫或 API）
   - 异常数据自动告警

3. **用户体验优化**
   - 简化作品登记流程
   - 增加数据可视化（收益趋势图、作品效果对比）
   - 移动端适配

### 8.2 中期规划（3-6 个月内）

1. **智能归因**
   - 机器学习模型预测转化贡献度
   - 基于用户画像的归因权重调整
   - 多触点归因模型

2. **数据分析**
   - 关键词效果分析报告
   - 达人表现评分体系
   - ROI 计算和优化建议

3. **系统集成**
   - 与抖音、小红书 API 对接（自动获取作品数据）
   - 财务系统对接（自动生成发票）

### 8.3 长期规划（6 个月以上）

1. **平台化**
   - 开放 API 给第三方工具
   - 支持更多推广平台
   - 多代理商模式

2. **AI 赋能**
   - 智能推荐关键词
   - 自动生成推广文案
   - 作品效果预测

---

## 九、总结

### 9.1 关键里程碑

```
✅ Week 1-2: 设计完成，代码清理完成
✅ Week 3-4: 核心功能开发完成
✅ Week 5:   前端界面开发完成
✅ Week 6:   测试、上线、稳定运行
```

### 9.2 成功标准

**技术指标**：
- 归因准确率 > 90%
- 系统响应时间 < 500ms
- 错误率 < 0.1%

**业务指标**：
- 用户满意度 > 85%
- 人工干预率 < 20%
- 争议率 < 5%

**运营指标**：
- 数据导入自动化率 > 80%
- 作品登记率 > 70%
- 关键词利用率 > 60%

### 9.3 交付清单

**代码交付**：
- [ ] 后端服务代码（5 个新模块）
- [ ] 前端界面代码（4 个新页面）
- [ ] 数据库迁移脚本
- [ ] 单元测试 + 集成测试

**文档交付**：
- [ ] 用户操作手册
- [ ] 管理员手册
- [ ] API 文档
- [ ] 运维手册

**培训材料**：
- [ ] 操作视频教程
- [ ] FAQ 文档
- [ ] 常见问题解决方案

---

**下一步行动**：
1. 评审本计划，确认时间线
2. 分配开发任务
3. 启动 Week 1 工作
4. 每周同步进度和风险

---

**附录**：
- 附录 A：数据库表设计详细 SQL
- 附录 B：API 接口完整文档
- 附录 C：前端组件设计稿
- 附录 D：测试用例清单
