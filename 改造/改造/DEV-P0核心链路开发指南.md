# P0 核心链路开发指南

> **目标**：9 天内完成最小可用系统（MVP），保证核心业务能跑通  
> **原则**：够用即可，不做过度设计，后续按需迭代

---

## 📋 模块 0-1：数据库表结构（0.5 天）

### 任务清单

- [ ] 创建迁移脚本 `010_attribution_core.sql`
- [ ] 本地测试迁移
- [ ] 编写回滚脚本 `010_attribution_core.down.sql`

### 建表 SQL

```sql
-- 010_attribution_core.sql

-- 1. 归因任务表（邮件数据导入后创建）
CREATE TABLE IF NOT EXISTS attribution_tasks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  
  -- 原始数据（邮件）
  data_date DATE NOT NULL COMMENT '数据日期',
  keyword VARCHAR(128) NOT NULL COMMENT '关键词',
  total_revenue BIGINT NOT NULL COMMENT '总收益（分）',
  search_volume INT NOT NULL DEFAULT 0 COMMENT '搜索量',
  conversion_count INT NOT NULL DEFAULT 0 COMMENT '转化数',
  
  -- 归因状态（P0 只用 pending/completed/failed）
  status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
  
  -- 关联结算批次
  settlement_batch_id BIGINT NULL COMMENT '结算批次ID',
  
  -- 时间戳
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY uk_date_keyword (data_date, keyword),
  INDEX idx_status (status),
  INDEX idx_batch (settlement_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='归因任务';

-- 2. 归因结果表（归因引擎计算后写入）
CREATE TABLE IF NOT EXISTS attribution_results (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  
  task_id BIGINT NOT NULL COMMENT '归因任务ID',
  user_id BIGINT NOT NULL COMMENT '用户ID',
  
  -- 归因依据
  works_count INT NOT NULL COMMENT '作品数量',
  total_quality_score DECIMAL(12, 2) NULL COMMENT '作品质量总分',
  attribution_weight DECIMAL(8, 6) NOT NULL COMMENT '分配权重（0-1）',
  
  -- 归因收益（分）
  allocated_revenue BIGINT NOT NULL COMMENT '归因收益（分）',
  
  -- 关联结算明细
  settlement_item_id BIGINT NULL COMMENT '结算明细ID',
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_task (task_id),
  INDEX idx_user (user_id),
  
  FOREIGN KEY (task_id) REFERENCES attribution_tasks(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='归因结果';

-- 3. 关键词绑定表（达人声明使用关键词）
CREATE TABLE IF NOT EXISTS keyword_bindings (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  
  keyword VARCHAR(128) NOT NULL COMMENT '关键词',
  plan_id BIGINT NOT NULL COMMENT '推广计划ID',
  user_id BIGINT NOT NULL COMMENT '用户ID',
  
  -- P0 简化：不做独占，所有人都能用
  status ENUM('active', 'inactive') DEFAULT 'active',
  
  bind_at DATETIME NOT NULL COMMENT '绑定时间',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_keyword (keyword, status),
  INDEX idx_user (user_id),
  
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (plan_id) REFERENCES plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='关键词绑定';

-- 4. 作品登记表（达人发布作品后登记）
CREATE TABLE IF NOT EXISTS creator_works (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  
  -- 作品信息
  work_title VARCHAR(255) NOT NULL COMMENT '作品标题',
  work_url VARCHAR(512) NOT NULL COMMENT '作品链接',
  platform ENUM('douyin', 'xiaohongshu', 'bilibili', 'weibo', 'other') NOT NULL,
  
  -- 关键词关联
  keyword VARCHAR(128) NOT NULL COMMENT '使用的关键词',
  plan_id BIGINT NULL COMMENT '推广计划ID',
  
  -- 发布者
  creator_id BIGINT NOT NULL COMMENT '达人ID',
  
  -- 作品质量数据（用于归因）
  view_count BIGINT DEFAULT 0 COMMENT '浏览量',
  like_count INT DEFAULT 0 COMMENT '点赞数',
  share_count INT DEFAULT 0 COMMENT '转发数',
  quality_score DECIMAL(10, 2) NULL COMMENT '质量分数（计算后缓存）',
  
  -- 时间
  published_at DATETIME NOT NULL COMMENT '作品发布时间',
  
  -- P0 简化：不做审核，直接 approved
  status ENUM('approved') DEFAULT 'approved',
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_keyword (keyword, published_at),
  INDEX idx_creator (creator_id),
  
  FOREIGN KEY (creator_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='达人作品登记';

-- 5. 扩展现有 attribution_tasks 表，增加外键
ALTER TABLE attribution_tasks 
  ADD CONSTRAINT fk_attribution_batch 
  FOREIGN KEY (settlement_batch_id) REFERENCES settlement_batches(id);

ALTER TABLE attribution_results 
  ADD CONSTRAINT fk_attribution_item 
  FOREIGN KEY (settlement_item_id) REFERENCES settlement_items(id);
```

### 回滚脚本

```sql
-- 010_attribution_core.down.sql

ALTER TABLE attribution_results DROP FOREIGN KEY fk_attribution_item;
ALTER TABLE attribution_tasks DROP FOREIGN KEY fk_attribution_batch;

DROP TABLE IF EXISTS creator_works;
DROP TABLE IF EXISTS keyword_bindings;
DROP TABLE IF EXISTS attribution_results;
DROP TABLE IF EXISTS attribution_tasks;
```

---

## 📧 模块 0-2：邮件数据导入（2 天）

### 后端 API（1.5 天）

#### 文件：`server/src/services/data-import.service.ts`

```typescript
import XLSX from 'xlsx';
import { rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { AuthUser } from '../types';
import { ResultSetHeader } from 'mysql2/promise';

/**
 * 解析上传的文件（P0 简化版：只支持 Excel）
 */
export async function parseUploadedFile(
  filePath: string,
  filename: string
): Promise<{ rows: any[] }> {
  const ext = filename.split('.').pop()?.toLowerCase();
  
  if (ext !== 'xlsx' && ext !== 'xls') {
    throw new AppError(400, 40001, '只支持 Excel 文件（.xlsx / .xls）');
  }
  
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet);
  
  if (rows.length === 0) {
    throw new AppError(400, 40002, 'Excel 中没有数据');
  }
  
  return { rows };
}

/**
 * 验证并导入数据（P0 简化版：基础验证）
 */
export async function importRevenueData(
  user: AuthUser,
  rows: any[]
): Promise<{ imported: number; taskIds: string[] }> {
  // P0 简化：假设字段名是固定的
  const requiredFields = ['日期', '关键词', '收益'];
  
  for (const field of requiredFields) {
    if (!rows[0].hasOwnProperty(field)) {
      throw new AppError(400, 40003, `缺少必填字段：${field}`);
    }
  }
  
  const taskIds: string[] = [];
  
  await withTransaction(async (conn) => {
    for (const row of rows) {
      const date = String(row['日期']).trim();
      const keyword = String(row['关键词']).trim();
      const revenue = parseFloat(String(row['收益'])) || 0;
      
      if (!date || !keyword || revenue <= 0) {
        continue; // P0 简化：跳过无效行
      }
      
      // 插入归因任务
      const [result] = await conn.query<ResultSetHeader>(
        `INSERT INTO attribution_tasks 
         (data_date, keyword, total_revenue, search_volume, conversion_count, status)
         VALUES (?, ?, ?, ?, ?, 'pending')
         ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`, // P0 简化：重复则跳过
        [date, keyword, Math.round(revenue * 100), 0, 0]
      );
      
      taskIds.push(String(result.insertId));
    }
  });
  
  return { imported: taskIds.length, taskIds };
}
```

#### 文件：`server/src/routes/data-import.ts`

```typescript
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { requireAuth, requirePermission } from '../middleware/auth';
import { parseUploadedFile, importRevenueData } from '../services/data-import.service';
import { enqueue } from '../queue';

const router = Router();

// 配置文件上传
const upload = multer({
  dest: 'temp/uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

/**
 * 上传并导入邮件数据
 */
router.post(
  '/upload',
  requireAuth,
  requirePermission('admin'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: '请上传文件' });
      }
      
      // 1. 解析文件
      const { rows } = await parseUploadedFile(req.file.path, req.file.originalname);
      
      // 2. 导入数据
      const { imported, taskIds } = await importRevenueData(req.user!, rows);
      
      // 3. 触发归因任务（异步）
      for (const taskId of taskIds) {
        await enqueue('process-attribution', { taskId });
      }
      
      res.json({
        success: true,
        imported,
        message: `成功导入 ${imported} 条数据，已触发归因任务`
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
```

#### 注册路由：`server/src/app.ts`

```typescript
import dataImportRoutes from './routes/data-import';

app.use('/api/v1/data-import', dataImportRoutes);
```

### 前端页面（0.5 天）

#### 文件：`apps/platform-admin/src/views/DataImportView.vue`

```vue
<template>
  <div class="data-import-page">
    <h2>收益数据导入</h2>
    
    <el-upload
      ref="uploadRef"
      drag
      :action="`${apiBaseUrl}/api/v1/data-import/upload`"
      :headers="{ Authorization: `Bearer ${token}` }"
      :accept="'.xlsx,.xls'"
      :limit="1"
      :on-success="handleSuccess"
      :on-error="handleError"
    >
      <i class="el-icon-upload"></i>
      <div>将知乎邮件附件拖到此处，或<em>点击上传</em></div>
      <template #tip>
        <div>支持 .xlsx / .xls 格式，文件需包含【日期、关键词、收益】字段</div>
      </template>
    </el-upload>
    
    <el-alert
      v-if="result"
      :type="result.success ? 'success' : 'error'"
      :title="result.message"
      :closable="false"
      style="margin-top: 20px"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();
const token = authStore.token;
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

const uploadRef = ref();
const result = ref<{ success: boolean; message: string } | null>(null);

function handleSuccess(response: any) {
  result.value = {
    success: true,
    message: response.message || '导入成功'
  };
  uploadRef.value?.clearFiles();
}

function handleError(error: any) {
  result.value = {
    success: false,
    message: error.message || '导入失败'
  };
}
</script>
```

---

## 🔑 模块 0-3：关键词绑定（1.5 天）

### 后端 API（1 天）

#### 文件：`server/src/services/keyword-binding.service.ts`

```typescript
import { rows, withTransaction } from '../db';
import { AuthUser } from '../types';
import { AppError } from '../middleware/errors';
import { ResultSetHeader } from 'mysql2/promise';

/**
 * 绑定关键词
 */
export async function createBinding(
  user: AuthUser,
  input: { keyword: string; planId: string }
) {
  return withTransaction(async (conn) => {
    // 检查 plan 是否存在
    const [plan] = await conn.query(
      'SELECT id FROM plans WHERE id = ? LIMIT 1',
      [input.planId]
    );
    
    if (!plan) {
      throw new AppError(404, 40401, '推广计划不存在');
    }
    
    // 插入绑定记录（P0 简化：允许重复绑定）
    const [result] = await conn.query<ResultSetHeader>(
      `INSERT INTO keyword_bindings 
       (keyword, plan_id, user_id, bind_at, status)
       VALUES (?, ?, ?, NOW(), 'active')`,
      [input.keyword, input.planId, user.sub]
    );
    
    return { id: String(result.insertId) };
  });
}

/**
 * 查询我的关键词
 */
export async function listMyBindings(user: AuthUser) {
  return rows(
    `SELECT kb.id, kb.keyword, kb.plan_id, kb.bind_at,
            p.name AS plan_name
     FROM keyword_bindings kb
     LEFT JOIN plans p ON p.id = kb.plan_id
     WHERE kb.user_id = ? AND kb.status = 'active'
     ORDER BY kb.bind_at DESC`,
    [user.sub]
  );
}

/**
 * 解绑关键词
 */
export async function unbindKeyword(user: AuthUser, bindingId: string) {
  const [result] = await rows(
    'UPDATE keyword_bindings SET status = ? WHERE id = ? AND user_id = ?',
    ['inactive', bindingId, user.sub]
  );
  
  if (result.affectedRows === 0) {
    throw new AppError(404, 40401, '绑定记录不存在');
  }
}
```

#### 文件：`server/src/routes/keyword-bindings.ts`

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { createBinding, listMyBindings, unbindKeyword } from '../services/keyword-binding.service';

const router = Router();

// 创建绑定
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const result = await createBinding(req.user!, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// 查询我的绑定
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const list = await listMyBindings(req.user!);
    res.json(list);
  } catch (error) {
    next(error);
  }
});

// 解绑
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    await unbindKeyword(req.user!, req.params.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
```

### 前端页面（0.5 天）

#### 文件：`apps/platform-creator/src/views/KeywordBindingsView.vue`

```vue
<template>
  <div class="keywords-page">
    <h2>我的关键词</h2>
    
    <el-button type="primary" @click="showDialog = true">+ 绑定新关键词</el-button>
    
    <el-table :data="keywords" style="margin-top: 20px">
      <el-table-column prop="keyword" label="关键词" />
      <el-table-column prop="plan_name" label="推广计划" />
      <el-table-column prop="bind_at" label="绑定时间" />
      <el-table-column label="操作">
        <template #default="{ row }">
          <el-button size="small" @click="unbind(row.id)">解绑</el-button>
        </template>
      </el-table-column>
    </el-table>
    
    <!-- 绑定对话框 -->
    <el-dialog v-model="showDialog" title="绑定关键词">
      <el-form :model="form">
        <el-form-item label="关键词">
          <el-input v-model="form.keyword" placeholder="知乎推广工具" />
        </el-form-item>
        <el-form-item label="推广计划">
          <el-select v-model="form.planId" placeholder="选择推广计划">
            <el-option
              v-for="plan in plans"
              :key="plan.id"
              :label="plan.name"
              :value="plan.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" @click="submit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { http } from '@/utils/http';
import { ElMessage } from 'element-plus';

const keywords = ref([]);
const plans = ref([]);
const showDialog = ref(false);
const form = ref({ keyword: '', planId: '' });

async function loadKeywords() {
  keywords.value = await http.get('/api/v1/keyword-bindings');
}

async function loadPlans() {
  plans.value = await http.get('/api/v1/plans'); // 假设有这个接口
}

async function submit() {
  await http.post('/api/v1/keyword-bindings', form.value);
  ElMessage.success('绑定成功');
  showDialog.value = false;
  form.value = { keyword: '', planId: '' };
  loadKeywords();
}

async function unbind(id: string) {
  await http.delete(`/api/v1/keyword-bindings/${id}`);
  ElMessage.success('解绑成功');
  loadKeywords();
}

onMounted(() => {
  loadKeywords();
  loadPlans();
});
</script>
```

---

## 📝 模块 0-4：作品登记（2 天）

### 后端 API（1.5 天）

#### 文件：`server/src/services/creator-works.service.ts`

```typescript
import { rows, withTransaction } from '../db';
import { AuthUser } from '../types';
import { AppError } from '../middleware/errors';
import { ResultSetHeader } from 'mysql2/promise';

/**
 * 计算作品质量分
 */
function calculateQualityScore(work: {
  viewCount: number;
  likeCount: number;
  shareCount: number;
}): number {
  return (
    work.viewCount * 0.5 +
    work.likeCount * 2.0 +
    work.shareCount * 5.0
  );
}

/**
 * 提交作品
 */
export async function submitWork(
  user: AuthUser,
  input: {
    title: string;
    url: string;
    platform: string;
    keyword: string;
    planId?: string;
    publishedAt: string;
    viewCount?: number;
    likeCount?: number;
    shareCount?: number;
  }
) {
  const qualityScore = calculateQualityScore({
    viewCount: input.viewCount || 0,
    likeCount: input.likeCount || 0,
    shareCount: input.shareCount || 0
  });
  
  return withTransaction(async (conn) => {
    const [result] = await conn.query<ResultSetHeader>(
      `INSERT INTO creator_works 
       (work_title, work_url, platform, keyword, plan_id, creator_id,
        view_count, like_count, share_count, quality_score, published_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      [
        input.title,
        input.url,
        input.platform,
        input.keyword,
        input.planId || null,
        user.sub,
        input.viewCount || 0,
        input.likeCount || 0,
        input.shareCount || 0,
        qualityScore,
        input.publishedAt
      ]
    );
    
    return { id: String(result.insertId), qualityScore };
  });
}

/**
 * 查询我的作品
 */
export async function listMyWorks(user: AuthUser) {
  return rows(
    `SELECT id, work_title, work_url, platform, keyword, 
            view_count, like_count, share_count, quality_score,
            published_at, created_at
     FROM creator_works
     WHERE creator_id = ?
     ORDER BY created_at DESC
     LIMIT 100`,
    [user.sub]
  );
}
```

#### 文件：`server/src/routes/creator-works.ts`

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { submitWork, listMyWorks } from '../services/creator-works.service';

const router = Router();

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const result = await submitWork(req.user!, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const list = await listMyWorks(req.user!);
    res.json(list);
  } catch (error) {
    next(error);
  }
});

export default router;
```

### 前端页面（0.5 天）

#### 文件：`apps/platform-creator/src/views/WorkSubmitView.vue`

```vue
<template>
  <div class="work-submit-page">
    <h2>作品登记</h2>
    
    <el-form :model="form" label-width="120px">
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
          <el-option label="微博" value="weibo" />
        </el-select>
      </el-form-item>
      
      <el-form-item label="使用关键词" required>
        <el-select v-model="form.keyword">
          <el-option
            v-for="kb in keywords"
            :key="kb.id"
            :label="kb.keyword"
            :value="kb.keyword"
          />
        </el-select>
      </el-form-item>
      
      <el-form-item label="发布时间" required>
        <el-date-picker
          v-model="form.publishedAt"
          type="datetime"
          placeholder="选择发布时间"
        />
      </el-form-item>
      
      <el-form-item label="浏览量">
        <el-input-number v-model="form.viewCount" :min="0" />
      </el-form-item>
      
      <el-form-item label="点赞数">
        <el-input-number v-model="form.likeCount" :min="0" />
      </el-form-item>
      
      <el-form-item label="转发数">
        <el-input-number v-model="form.shareCount" :min="0" />
      </el-form-item>
      
      <el-form-item>
        <el-button type="primary" @click="submit">提交</el-button>
        <el-button @click="reset">重置</el-button>
      </el-form-item>
    </el-form>
    
    <!-- 作品列表 -->
    <h3 style="margin-top: 40px">我的作品</h3>
    <el-table :data="works">
      <el-table-column prop="work_title" label="标题" />
      <el-table-column prop="keyword" label="关键词" />
      <el-table-column prop="platform" label="平台" />
      <el-table-column prop="quality_score" label="质量分" />
      <el-table-column prop="published_at" label="发布时间" />
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { http } from '@/utils/http';
import { ElMessage } from 'element-plus';

const keywords = ref([]);
const works = ref([]);
const form = ref({
  title: '',
  url: '',
  platform: '',
  keyword: '',
  publishedAt: '',
  viewCount: 0,
  likeCount: 0,
  shareCount: 0
});

async function loadKeywords() {
  keywords.value = await http.get('/api/v1/keyword-bindings');
}

async function loadWorks() {
  works.value = await http.get('/api/v1/creator-works');
}

async function submit() {
  await http.post('/api/v1/creator-works', form.value);
  ElMessage.success('提交成功');
  reset();
  loadWorks();
}

function reset() {
  form.value = {
    title: '',
    url: '',
    platform: '',
    keyword: '',
    publishedAt: '',
    viewCount: 0,
    likeCount: 0,
    shareCount: 0
  };
}

onMounted(() => {
  loadKeywords();
  loadWorks();
});
</script>
```

---

## 🧠 模块 0-5：归因引擎核心（3 天）

### 队列任务（2 天）

#### 文件：`server/src/jobs/processAttribution.ts`

```typescript
import { Job } from 'bull';
import { rows, withTransaction } from '../db';
import { approveBatch } from '../services/relay.service';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

interface WorkRow extends RowDataPacket {
  creator_id: string;
  quality_score: number;
}

interface UserStat {
  userId: string;
  worksCount: number;
  totalScore: number;
}

/**
 * P0 归因引擎核心（简化版）
 */
export async function processAttribution(job: Job<{ taskId: string }>) {
  const { taskId } = job.data;
  
  try {
    await withTransaction(async (conn) => {
      // 1. 获取归因任务
      const [task] = await conn.query<RowDataPacket[]>(
        'SELECT * FROM attribution_tasks WHERE id = ? LIMIT 1',
        [taskId]
      );
      
      if (!task || task[0].status !== 'pending') {
        throw new Error('任务不存在或已处理');
      }
      
      const taskData = task[0];
      
      // 2. 查找该关键词的作品（30 天内）
      const [works] = await conn.query<WorkRow[]>(
        `SELECT creator_id, quality_score
         FROM creator_works
         WHERE keyword = ?
           AND status = 'approved'
           AND published_at >= DATE_SUB(?, INTERVAL 30 DAY)
           AND published_at <= ?`,
        [taskData.keyword, taskData.data_date, taskData.data_date]
      );
      
      if (works.length === 0) {
        await conn.query(
          `UPDATE attribution_tasks SET status = 'failed' WHERE id = ?`,
          [taskId]
        );
        throw new Error('该关键词无可归因的作品');
      }
      
      // 3. 按达人分组统计
      const userStats = new Map<string, UserStat>();
      
      for (const work of works) {
        const userId = String(work.creator_id);
        const existing = userStats.get(userId);
        
        if (existing) {
          existing.worksCount++;
          existing.totalScore += Number(work.quality_score);
        } else {
          userStats.set(userId, {
            userId,
            worksCount: 1,
            totalScore: Number(work.quality_score)
          });
        }
      }
      
      // 4. 计算权重和分配
      const totalScore = Array.from(userStats.values())
        .reduce((sum, u) => sum + u.totalScore, 0);
      
      const results: {
        userId: string;
        worksCount: number;
        qualityScore: number;
        weight: number;
        revenue: bigint;
      }[] = [];
      
      let allocatedTotal = 0n;
      
      for (const stats of userStats.values()) {
        const weight = stats.totalScore / totalScore;
        const revenue = BigInt(Math.floor(Number(taskData.total_revenue) * weight));
        
        results.push({
          userId: stats.userId,
          worksCount: stats.worksCount,
          qualityScore: stats.totalScore,
          weight,
          revenue
        });
        
        allocatedTotal += revenue;
      }
      
      // 5. 处理尾差
      const diff = BigInt(taskData.total_revenue) - allocatedTotal;
      if (diff !== 0n && results.length > 0) {
        results[0].revenue += diff;
      }
      
      // 6. 写入 attribution_results
      for (const result of results) {
        await conn.query(
          `INSERT INTO attribution_results 
           (task_id, user_id, works_count, total_quality_score, attribution_weight, allocated_revenue)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            taskId,
            result.userId,
            result.worksCount,
            result.qualityScore,
            result.weight,
            String(result.revenue)
          ]
        );
      }
      
      // 7. 创建结算批次（关键：对接现有定价体系）
      const [batchResult] = await conn.query<ResultSetHeader>(
        `INSERT INTO settlement_batches 
         (title, period_start, period_end, created_by, status)
         VALUES (?, ?, ?, 1, 'draft')`,
        [
          `归因批次-${taskData.keyword}-${taskData.data_date}`,
          taskData.data_date,
          taskData.data_date
        ]
      );
      
      const batchId = String(batchResult.insertId);
      
      // 8. 创建结算明细（归因收益 = 来源金额）
      for (const result of results) {
        const [itemResult] = await conn.query<ResultSetHeader>(
          `INSERT INTO settlement_items 
           (batch_id, creator_id, source_amount, note)
           VALUES (?, ?, ?, ?)`,
          [
            batchId,
            result.userId,
            (Number(result.revenue) / 100).toFixed(4), // 分转元
            `归因自关键词「${taskData.keyword}」`
          ]
        );
        
        // 反向关联
        await conn.query(
          `UPDATE attribution_results 
           SET settlement_item_id = ?
           WHERE task_id = ? AND user_id = ?`,
          [itemResult.insertId, taskId, result.userId]
        );
      }
      
      // 9. 更新任务状态
      await conn.query(
        `UPDATE attribution_tasks 
         SET status = 'completed', settlement_batch_id = ?
         WHERE id = ?`,
        [batchId, taskId]
      );
      
      // 10. 自动审批结算批次（应用定价规则）
      await approveBatch(
        { sub: '1', role: 'admin' } as any,
        batchId,
        undefined,
        conn
      );
      
      console.log(`Attribution task ${taskId} completed, batch ${batchId} created`);
    });
  } catch (error) {
    console.error(`Attribution task ${taskId} failed:`, error);
    throw error;
  }
}
```

#### 注册队列任务：`server/src/jobs/index.ts`

```typescript
import { processAttribution } from './processAttribution';

export function registerJobs() {
  // ... 现有任务
  registerJob('process-attribution', processAttribution);
}
```

### 测试（1 天）

#### 文件：`server/tests/attribution.spec.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { processAttribution } from '../src/jobs/processAttribution';

describe('归因引擎', () => {
  beforeEach(async () => {
    // 准备测试数据
    // TODO: 插入测试用的 attribution_tasks、creator_works
  });
  
  it('应该正确计算归因收益', async () => {
    // TODO: 测试归因算法
  });
  
  it('应该正确生成结算批次', async () => {
    // TODO: 测试结算批次生成
  });
  
  it('应该正确应用定价规则', async () => {
    // TODO: 测试定价规则应用
  });
});
```

---

## ✅ 验收测试清单

### 端到端测试

```
场景：完整的归因流程

前置条件：
1. 定价规则已配置（达人 60%，团长 10%）
2. 达人 A 有团长 X
3. 达人 B 有团长 X
4. 达人 C 无团长

步骤：
1. 达人 A 绑定关键词"知乎推广工具"
2. 达人 A 登记 5 个作品，总质量分 2500
3. 达人 B 绑定同一关键词
4. 达人 B 登记 3 个作品，总质量分 1500
5. 达人 C 绑定同一关键词
6. 达人 C 登记 2 个作品，总质量分 1000
7. 管理员上传邮件数据：关键词"知乎推广工具"，收益 5000 元
8. 系统自动归因

预期结果：
✅ attribution_tasks 表有 1 条记录（status = completed）
✅ attribution_results 表有 3 条记录：
   - 达人 A: allocated_revenue = 250000（2500元）
   - 达人 B: allocated_revenue = 150000（1500元）
   - 达人 C: allocated_revenue = 100000（1000元）
✅ settlement_batches 表有 1 条记录（status = approved）
✅ settlement_items 表有 3 条记录：
   - 达人 A: source_amount = 2500.0000
   - 达人 B: source_amount = 1500.0000
   - 达人 C: source_amount = 1000.0000
✅ earnings 表有 5 条记录：
   - 达人 A: amount = 135000（1350元）
   - 团长 X: amount = 15000（150元，来自达人A）
   - 达人 B: amount = 81000（810元）
   - 团长 X: amount = 9000（90元，来自达人B）
   - 达人 C: amount = 60000（600元）
✅ 达人 A 在前端看到收益：1350 元
✅ 达人 B 在前端看到收益：810 元
✅ 达人 C 在前端看到收益：600 元
✅ 团长 X 在前端看到收益：240 元
```

---

## 📝 开发注意事项

### 1. 代码风格

- 遵循现有项目的代码风格
- 使用 TypeScript 严格模式
- 所有 async 函数必须 try-catch

### 2. 错误处理

```typescript
// ✅ 正确
try {
  await someOperation();
} catch (error) {
  logger.error({ error }, 'Operation failed');
  throw new AppError(500, 50001, '操作失败');
}

// ❌ 错误
await someOperation(); // 没有错误处理
```

### 3. 数据库事务

```typescript
// ✅ 正确：使用事务
await withTransaction(async (conn) => {
  await conn.query(...);
  await conn.query(...);
});

// ❌ 错误：不用事务
await db.query(...);
await db.query(...); // 如果第二个失败，第一个已经提交
```

### 4. P0 简化原则

- ❌ 不做数据预览（P1）
- ❌ 不做去重检测（P1）
- ❌ 不做作品审核（P1）
- ❌ 不做置信度评估（P1）
- ❌ 不做人工调整（P1）

**够用即可，后续迭代！**

---

## 🚀 开发流程

### Day 1
```
上午：创建数据库表 + 测试迁移
下午：关键词绑定后端 API
```

### Day 2
```
上午：关键词绑定前端页面
下午：作品登记后端 API
```

### Day 3
```
上午：作品登记前端页面
下午：邮件数据导入后端
```

### Day 4
```
上午：邮件数据导入前端
下午：归因引擎核心算法
```

### Day 5
```
上午：结算批次对接
下午：联调测试
```

### Day 6-7
```
集成测试 + Bug 修复 + 部署上线
```

---

**P0 开发指南完成！开始开发吧！** 🚀
