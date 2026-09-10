# 邮件数据自动化获取方案

> **文档目标**：设计一套自动化邮件数据获取、解析、导入的完整方案。
>
> **核心挑战**：知乎官方通过邮件发送数据，需要实现从邮件到数据库的全链路自动化。
>
> **创建时间**：2025-01-XX  
> **状态**：技术方案（待评审）

---

## 目录

- [一、邮件数据获取方式对比](#一邮件数据获取方式对比)
- [二、推荐方案设计](#二推荐方案设计)
- [三、数据解析与验证](#三数据解析与验证)
- [四、导入流程设计](#四导入流程设计)
- [五、异常处理](#五异常处理)
- [六、人工介入点](#六人工介入点)
- [七、实施方案](#七实施方案)

---

## 一、邮件数据获取方式对比

### 1.1 方案对比

| 方案 | 技术栈 | 优点 | 缺点 | 自动化程度 |
|-----|--------|------|------|-----------|
| **A. 纯人工** | 无 | 简单可靠 | 工作量大，易出错 | ⭐☆☆☆☆ |
| **B. IMAP 自动收取** | Node.js + imap | 全自动，实时性好 | 需要邮箱权限，可能被限制 | ⭐⭐⭐⭐⭐ |
| **C. 企业邮箱 API** | 企业微信/钉钉/飞书 | 稳定，权限可控 | 依赖企业邮箱系统 | ⭐⭐⭐⭐☆ |
| **D. 邮件转发规则** | SMTP + Webhook | 实时性最好 | 需要配置转发规则 | ⭐⭐⭐⭐⭐ |
| **E. 半自动上传** | Web 上传界面 | 灵活，无需邮箱权限 | 需要人工触发 | ⭐⭐⭐☆☆ |

### 1.2 推荐方案

**首选：方案 E（半自动上传）+ 方案 B（IMAP 自动收取，可选）**

**理由**：
- ✅ 快速上线（Web 上传 1 周内可完成）
- ✅ 无需邮箱权限，不依赖外部系统
- ✅ 人工可控，数据质量有保障
- ✅ 后期可升级为 IMAP 全自动

---

## 二、推荐方案设计

### 2.1 方案 E：半自动上传（MVP）

#### 架构图

```
┌──────────────────────────────────────────────────┐
│                半自动上传流程                       │
└──────────────────────────────────────────────────┘

1️⃣ 知乎官方发送邮件
   ↓
2️⃣ 管理员下载附件（Excel/CSV）
   ↓
3️⃣ 登录系统，上传文件
   ↓
┌─────────────────────────────────────────────────┐
│           后端自动处理流程                        │
├─────────────────────────────────────────────────┤
│  4️⃣ 文件格式检测（Excel/CSV/JSON）               │
│     ↓                                           │
│  5️⃣ 数据解析与校验                               │
│     - 字段完整性检查                             │
│     - 数据类型验证                               │
│     - 业务规则校验（如收益总额合理性）             │
│     ↓                                           │
│  6️⃣ 去重检测                                     │
│     - 检查是否重复导入同一天的数据                │
│     ↓                                           │
│  7️⃣ 数据预览                                     │
│     - 显示前 20 行供管理员确认                   │
│     ↓                                           │
│  8️⃣ 管理员确认导入                               │
│     ↓                                           │
│  9️⃣ 批量写入 attribution_tasks 表                │
│     ↓                                           │
│  🔟 触发归因任务队列                              │
└─────────────────────────────────────────────────┘
```

#### 前端界面设计

**页面：系统管理 → 数据导入**

```vue
<template>
  <div class="data-import-page">
    <h2>收益数据导入</h2>
    
    <!-- 步骤 1：上传文件 -->
    <el-upload
      drag
      :accept="'.csv,.xlsx,.xls'"
      :auto-upload="false"
      :on-change="handleFileChange"
    >
      <i class="el-icon-upload"></i>
      <div>将知乎邮件附件拖到此处，或<em>点击上传</em></div>
      <div>支持 .csv / .xlsx / .xls 格式</div>
    </el-upload>
    
    <!-- 步骤 2：数据预览 -->
    <div v-if="previewData" class="preview-section">
      <h3>数据预览（共 {{ totalRows }} 行）</h3>
      <el-table :data="previewData" border>
        <el-table-column prop="date" label="日期" width="120" />
        <el-table-column prop="keyword" label="关键词" width="150" />
        <el-table-column prop="searchVolume" label="搜索量" width="100" />
        <el-table-column prop="conversions" label="转化数" width="100" />
        <el-table-column prop="revenue" label="收益（元）" width="120" />
      </el-table>
      
      <!-- 验证结果 -->
      <el-alert
        v-if="validationErrors.length > 0"
        type="error"
        title="数据验证失败"
        :closable="false"
      >
        <ul>
          <li v-for="err in validationErrors" :key="err">{{ err }}</li>
        </ul>
      </el-alert>
      
      <el-alert
        v-else
        type="success"
        title="数据验证通过"
        :closable="false"
      />
      
      <!-- 操作按钮 -->
      <div class="actions">
        <el-button @click="cancelImport">取消</el-button>
        <el-button
          type="primary"
          :disabled="validationErrors.length > 0"
          :loading="importing"
          @click="confirmImport"
        >
          确认导入 {{ totalRows }} 条数据
        </el-button>
      </div>
    </div>
  </div>
</template>
```

### 2.2 方案 B：IMAP 自动收取（可选升级）

#### 架构图

```
┌──────────────────────────────────────────────────┐
│              IMAP 自动收取流程                     │
└──────────────────────────────────────────────────┘

┌─────────────────┐
│  知乎官方邮箱    │
└────────┬────────┘
         │ 发送邮件
         ▼
┌─────────────────┐
│  企业邮箱        │ ← 如 data@your-company.com
└────────┬────────┘
         │
         │ 定时轮询（每 10 分钟）
         ▼
┌─────────────────────────────────────────────────┐
│          邮件收取服务（Node.js）                  │
├─────────────────────────────────────────────────┤
│  - 使用 imap 库连接邮箱                          │
│  - 搜索未读邮件（发件人 = 知乎官方）              │
│  - 下载附件到临时目录                            │
│  - 标记邮件为已读                                │
└────────┬────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│          附件解析服务                            │
└────────┬────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│          数据验证 + 导入                         │
└─────────────────────────────────────────────────┘
```

#### 技术实现

```typescript
// server/src/jobs/fetchEmailData.ts

import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { logger } from '../utils/logger';

interface EmailConfig {
  user: string;
  password: string;
  host: string;
  port: number;
  tls: boolean;
}

/**
 * 邮件收取任务
 */
export async function fetchEmailData() {
  const config: EmailConfig = {
    user: process.env.EMAIL_USER!,
    password: process.env.EMAIL_PASSWORD!,
    host: process.env.EMAIL_IMAP_HOST!,
    port: parseInt(process.env.EMAIL_IMAP_PORT || '993'),
    tls: true,
  };

  const imap = new Imap(config);

  return new Promise((resolve, reject) => {
    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) return reject(err);

        // 搜索未读邮件，发件人为知乎官方
        imap.search(
          [
            'UNSEEN',
            ['FROM', 'noreply@zhihu.com'], // 假设的知乎发件人
            ['SUBJECT', '知乎推广数据'], // 假设的主题关键词
          ],
          (searchErr, results) => {
            if (searchErr) return reject(searchErr);

            if (results.length === 0) {
              logger.info('No new emails found');
              imap.end();
              return resolve([]);
            }

            const fetch = imap.fetch(results, { bodies: '' });
            const emails: any[] = [];

            fetch.on('message', (msg, seqno) => {
              msg.on('body', (stream) => {
                simpleParser(stream, async (parseErr, parsed) => {
                  if (parseErr) {
                    logger.error({ err: parseErr }, 'Email parse failed');
                    return;
                  }

                  // 提取附件
                  for (const attachment of parsed.attachments || []) {
                    const filename = attachment.filename || 'unknown';
                    
                    // 只处理 CSV/Excel 附件
                    if (/\.(csv|xlsx|xls)$/i.test(filename)) {
                      logger.info({ filename }, 'Found data attachment');
                      
                      // 保存附件到临时目录
                      const filePath = await saveAttachment(
                        attachment.content,
                        filename
                      );
                      
                      // 触发数据解析任务
                      await enqueue('parse-email-data', { filePath });
                      
                      emails.push({ seqno, filename, filePath });
                    }
                  }

                  // 标记为已读
                  imap.addFlags(seqno, ['\\Seen'], (flagErr) => {
                    if (flagErr) logger.error({ err: flagErr }, 'Mark read failed');
                  });
                });
              });
            });

            fetch.once('end', () => {
              imap.end();
              resolve(emails);
            });
          }
        );
      });
    });

    imap.once('error', reject);
    imap.connect();
  });
}

/**
 * 保存附件到临时目录
 */
async function saveAttachment(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const tempDir = path.join(process.cwd(), 'temp', 'email-attachments');
  await fs.mkdir(tempDir, { recursive: true });
  
  const timestamp = Date.now();
  const safeFilename = `${timestamp}_${filename.replace(/[^a-z0-9._-]/gi, '_')}`;
  const filePath = path.join(tempDir, safeFilename);
  
  await fs.writeFile(filePath, buffer);
  
  return filePath;
}
```

---

## 三、数据解析与验证

### 3.1 支持的数据格式

#### 格式 1：CSV（推荐）

```csv
日期,关键词,搜索量,转化数,收益金额
2025-01-20,知乎推广工具,1000,50,5000.00
2025-01-20,知乎引流技巧,800,30,3000.00
2025-01-20,知乎账号运营,1200,60,6000.00
```

#### 格式 2：Excel

| 日期 | 关键词 | 搜索量 | 转化数 | 收益金额 |
|------|--------|--------|--------|----------|
| 2025-01-20 | 知乎推广工具 | 1000 | 50 | 5000.00 |
| 2025-01-20 | 知乎引流技巧 | 800 | 30 | 3000.00 |

### 3.2 字段映射规则

```typescript
// server/src/services/email-data-parser.service.ts

/**
 * 字段映射配置（支持多种列名）
 */
const FIELD_MAPPINGS = {
  date: ['日期', 'date', '统计日期', 'data_date'],
  keyword: ['关键词', 'keyword', '推广关键词', 'search_keyword'],
  searchVolume: ['搜索量', 'search_volume', '搜索次数', 'impressions'],
  conversions: ['转化数', 'conversions', '转化量', 'conversion_count'],
  revenue: ['收益金额', 'revenue', '收益', '佣金', 'commission'],
};

/**
 * 智能字段匹配
 */
function mapFields(headers: string[]): Record<string, number> {
  const mapping: Record<string, number> = {};
  
  for (const [field, aliases] of Object.entries(FIELD_MAPPINGS)) {
    const index = headers.findIndex(h => 
      aliases.some(alias => 
        h.toLowerCase().includes(alias.toLowerCase())
      )
    );
    
    if (index >= 0) {
      mapping[field] = index;
    }
  }
  
  return mapping;
}
```

### 3.3 数据验证规则

```typescript
import { z } from 'zod';

/**
 * 单行数据验证 Schema
 */
const RevenueDataRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD'),
  keyword: z.string().min(1).max(128, '关键词长度不能超过 128 字符'),
  searchVolume: z.number().int().nonnegative('搜索量必须为非负整数'),
  conversions: z.number().int().nonnegative('转化数必须为非负整数'),
  revenue: z.number().nonnegative('收益金额必须为非负数'),
});

/**
 * 批量数据验证
 */
export async function validateRevenueData(
  rows: any[]
): Promise<{ valid: boolean; errors: string[]; data: any[] }> {
  const errors: string[] = [];
  const validData: any[] = [];

  // 1. 必填字段检查
  const requiredFields = ['date', 'keyword', 'revenue'];
  for (const field of requiredFields) {
    if (!rows[0].hasOwnProperty(field)) {
      errors.push(`缺少必填字段：${field}`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, data: [] };
  }

  // 2. 逐行验证
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // Excel 行号（第一行是表头）

    try {
      // 数据类型转换
      const normalized = {
        date: row.date,
        keyword: String(row.keyword).trim(),
        searchVolume: parseInt(row.searchVolume) || 0,
        conversions: parseInt(row.conversions) || 0,
        revenue: parseFloat(row.revenue) || 0,
      };

      // Zod 验证
      const validated = RevenueDataRowSchema.parse(normalized);
      
      // 业务规则验证
      if (validated.conversions > validated.searchVolume) {
        errors.push(`第 ${rowNum} 行：转化数不能大于搜索量`);
        continue;
      }

      if (validated.revenue > validated.conversions * 1000) {
        errors.push(`第 ${rowNum} 行：收益金额异常（单次转化超过 1000 元）`);
        continue;
      }

      validData.push(validated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        errors.push(`第 ${rowNum} 行：${err.errors[0].message}`);
      } else {
        errors.push(`第 ${rowNum} 行：数据格式错误`);
      }
    }
  }

  // 3. 数据日期一致性检查
  const dates = new Set(validData.map(d => d.date));
  if (dates.size > 1) {
    errors.push(`数据包含多个日期：${Array.from(dates).join(', ')}，请确保同一文件只包含一天的数据`);
  }

  // 4. 关键词重复检查
  const keywords = validData.map(d => d.keyword);
  const duplicates = keywords.filter((k, i) => keywords.indexOf(k) !== i);
  if (duplicates.length > 0) {
    errors.push(`数据中存在重复关键词：${[...new Set(duplicates)].join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    data: validData,
  };
}
```

### 3.4 去重检测

```typescript
/**
 * 检查数据是否已导入
 */
export async function checkDuplicateImport(
  date: string,
  keywords: string[]
): Promise<{ isDuplicate: boolean; existingTasks: any[] }> {
  const existing = await rows<any>(
    `SELECT id, keyword, total_revenue 
     FROM attribution_tasks 
     WHERE data_date = ? AND keyword IN (?)`,
    [date, keywords]
  );

  return {
    isDuplicate: existing.length > 0,
    existingTasks: existing,
  };
}
```

---

## 四、导入流程设计

### 4.1 完整流程图

```
┌─────────────────────────────────────────────────┐
│            数据导入完整流程                        │
└─────────────────────────────────────────────────┘

1️⃣ 文件上传
   ↓
2️⃣ 文件存储（临时目录）
   ↓
3️⃣ 格式检测（CSV/Excel）
   ↓
4️⃣ 数据解析（xlsx 或 csv-parser）
   ↓
5️⃣ 字段映射（智能匹配列名）
   ↓
6️⃣ 数据验证
   ├─ 类型检查
   ├─ 必填字段
   ├─ 业务规则
   └─ 去重检测
   ↓
7️⃣ 返回预览数据（前 20 行）
   ↓
8️⃣ 管理员确认
   ↓
9️⃣ 批量插入 attribution_tasks
   ├─ 事务处理
   ├─ 记录导入日志
   └─ 触发归因任务队列
   ↓
🔟 返回导入结果
   ├─ 成功数量
   ├─ 失败数量
   └─ 任务 ID 列表
```

### 4.2 API 设计

#### API 1：上传并解析

```typescript
POST /api/v1/data-import/parse
Content-Type: multipart/form-data

file: revenue_2025-01-20.csv

Response:
{
  "success": true,
  "tempFileId": "temp-20250120-abc123",
  "preview": {
    "date": "2025-01-20",
    "totalRows": 150,
    "rows": [
      {
        "keyword": "知乎推广工具",
        "searchVolume": 1000,
        "conversions": 50,
        "revenue": 5000
      },
      // ... 最多 20 行
    ]
  },
  "validation": {
    "valid": true,
    "errors": [],
    "warnings": [
      "第 15 行：搜索量为 0，请确认数据准确性"
    ]
  },
  "duplicateCheck": {
    "isDuplicate": false,
    "existingCount": 0
  }
}
```

#### API 2：确认导入

```typescript
POST /api/v1/data-import/confirm
{
  "tempFileId": "temp-20250120-abc123",
  "options": {
    "overwriteDuplicates": false,  // 是否覆盖重复数据
    "autoTriggerAttribution": true  // 是否自动触发归因
  }
}

Response:
{
  "success": true,
  "imported": 150,
  "failed": 0,
  "batchId": "import-20250120-001",
  "taskIds": ["task-001", "task-002", ...],
  "message": "成功导入 150 条数据，已自动触发归因任务"
}
```

### 4.3 后端服务实现

```typescript
// server/src/services/data-import.service.ts

import XLSX from 'xlsx';
import csv from 'csv-parser';
import fs from 'fs/promises';
import { Readable } from 'stream';

/**
 * 解析上传的文件
 */
export async function parseUploadedFile(
  filePath: string,
  filename: string
): Promise<{ rows: any[]; format: string }> {
  const ext = filename.split('.').pop()?.toLowerCase();

  if (ext === 'csv') {
    return parseCSV(filePath);
  } else if (ext === 'xlsx' || ext === 'xls') {
    return parseExcel(filePath);
  } else {
    throw new AppError(400, 40001, '不支持的文件格式，仅支持 CSV 和 Excel');
  }
}

/**
 * 解析 CSV 文件
 */
async function parseCSV(filePath: string): Promise<{ rows: any[]; format: string }> {
  const rows: any[] = [];
  const fileContent = await fs.readFile(filePath, 'utf-8');
  const stream = Readable.from(fileContent);

  return new Promise((resolve, reject) => {
    stream
      .pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve({ rows, format: 'csv' }))
      .on('error', reject);
  });
}

/**
 * 解析 Excel 文件
 */
async function parseExcel(filePath: string): Promise<{ rows: any[]; format: string }> {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0]; // 读取第一个 Sheet
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet);

  return { rows, format: 'excel' };
}

/**
 * 批量创建归因任务
 */
export async function batchCreateAttributionTasks(
  data: any[],
  options: { batchId: string; sourceFile: string }
): Promise<{ created: number; taskIds: string[] }> {
  const taskIds: string[] = [];

  await withTransaction(async (conn) => {
    for (const row of data) {
      const [result] = await conn.query<ResultSetHeader>(
        `INSERT INTO attribution_tasks 
         (data_date, keyword, search_volume, conversion_count, total_revenue, 
          source_file, import_batch_id, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          row.date,
          row.keyword,
          row.searchVolume,
          row.conversions,
          Math.round(row.revenue * 100), // 元转分
          options.sourceFile,
          options.batchId,
        ]
      );

      taskIds.push(String(result.insertId));
    }
  });

  return { created: data.length, taskIds };
}
```

---

## 五、异常处理

### 5.1 常见异常场景

| 异常 | 原因 | 处理方式 |
|-----|------|---------|
| **文件格式错误** | 文件损坏或不是标准 CSV/Excel | 返回错误，提示用户重新导出 |
| **字段缺失** | 邮件格式变更，缺少必填字段 | 返回错误，列出缺失字段 |
| **数据类型错误** | 数字字段包含非数字字符 | 跳过该行，记录错误日志 |
| **重复导入** | 同一天数据导入多次 | 提示用户，提供覆盖选项 |
| **收益异常** | 单个关键词收益过高/过低 | 标记警告，允许导入但需审核 |
| **日期格式不一致** | 不同行使用不同日期格式 | 尝试智能解析，失败则拒绝 |

### 5.2 错误恢复机制

```typescript
/**
 * 导入失败回滚
 */
export async function rollbackImport(batchId: string): Promise<void> {
  await withTransaction(async (conn) => {
    // 删除已创建的归因任务
    await conn.query(
      `DELETE FROM attribution_tasks WHERE import_batch_id = ?`,
      [batchId]
    );

    // 删除临时文件
    const tempFiles = await findTempFilesByBatch(batchId);
    for (const file of tempFiles) {
      await fs.unlink(file.path).catch(() => {});
    }

    // 记录回滚日志
    await writeAudit({
      action: 'data_import_rollback',
      details: { batchId },
    });
  });
}
```

---

## 六、人工介入点

### 6.1 必须人工的环节

| 环节 | 原因 | 操作 |
|-----|------|------|
| **下载邮件附件** | IMAP 未启用或邮件格式变更 | 登录邮箱，手动下载 |
| **上传文件** | 半自动模式 | 在系统界面上传 |
| **确认导入** | 避免误导入 | 预览数据后点击确认 |
| **处理验证失败** | 数据格式问题 | 修改文件或联系知乎官方 |

### 6.2 可选人工的环节

| 环节 | 自动化程度 | 人工介入场景 |
|-----|-----------|------------|
| **重复导入处理** | 自动拒绝 | 需要覆盖时人工确认 |
| **异常数据审核** | 自动标记 | 收益异常时人工核查 |
| **字段映射调整** | 自动匹配 | 格式变更时人工配置 |

---

## 七、实施方案

### 7.1 Phase 1：半自动上传（2 周）

**目标**：快速上线，人工上传 + 自动解析

**实施步骤**：

1. **Week 1**：
   - [ ] 前端上传界面开发
   - [ ] 后端解析服务（CSV/Excel）
   - [ ] 数据验证逻辑
   - [ ] 去重检测

2. **Week 2**：
   - [ ] 批量导入逻辑
   - [ ] 触发归因任务
   - [ ] 错误处理和回滚
   - [ ] 测试和上线

**交付物**：
- ✅ 数据导入页面
- ✅ API：`/data-import/parse` 和 `/data-import/confirm`
- ✅ 用户手册

### 7.2 Phase 2：IMAP 自动收取（1 周，可选）

**目标**：减少人工介入，实现全自动

**实施步骤**：

1. **配置邮箱**：
   - [ ] 申请企业邮箱（如 data@company.com）
   - [ ] 配置 IMAP 访问权限
   - [ ] 测试 IMAP 连接

2. **开发邮件收取服务**：
   - [ ] 实现 `fetchEmailData` 任务
   - [ ] 定时任务配置（每 10 分钟）
   - [ ] 附件下载和解析
   - [ ] 自动触发导入流程

3. **测试和监控**：
   - [ ] 发送测试邮件验证
   - [ ] 监控邮件收取成功率
   - [ ] 异常告警机制

**交付物**：
- ✅ IMAP 收取服务
- ✅ 定时任务调度器
- ✅ 监控面板

### 7.3 配置项

```bash
# .env 新增配置

# 邮件收取配置（可选，Phase 2）
EMAIL_USER=data@your-company.com
EMAIL_PASSWORD=your_password
EMAIL_IMAP_HOST=imap.exmail.qq.com
EMAIL_IMAP_PORT=993

# 知乎官方邮件识别
ZHIHU_EMAIL_FROM=noreply@zhihu.com
ZHIHU_EMAIL_SUBJECT=知乎推广数据

# 数据导入配置
DATA_IMPORT_MAX_FILE_SIZE=10485760  # 10MB
DATA_IMPORT_MAX_ROWS=10000
DATA_IMPORT_TEMP_DIR=./temp/uploads
```

### 7.4 数据库迁移

```sql
-- 新增导入批次记录表
CREATE TABLE data_import_batches (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  batch_id VARCHAR(64) UNIQUE NOT NULL,
  
  -- 文件信息
  source_file VARCHAR(255) NOT NULL,
  file_size BIGINT NOT NULL,
  file_format ENUM('csv', 'excel') NOT NULL,
  
  -- 导入统计
  total_rows INT NOT NULL,
  imported_rows INT DEFAULT 0,
  failed_rows INT DEFAULT 0,
  
  -- 状态
  status ENUM('uploading', 'parsing', 'validating', 'importing', 'completed', 'failed', 'rolled_back') DEFAULT 'uploading',
  
  -- 结果
  error_message TEXT NULL,
  validation_errors JSON NULL,
  
  -- 操作人
  imported_by BIGINT NOT NULL,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  
  INDEX idx_status (status),
  INDEX idx_batch_id (batch_id)
) COMMENT '数据导入批次表';
```

---

## 八、总结

### 8.1 推荐方案

**MVP：半自动上传（Phase 1）**
- ✅ 2 周快速上线
- ✅ 无需邮箱权限
- ✅ 人工可控，质量有保障

**升级：IMAP 自动收取（Phase 2，可选）**
- ✅ 进一步减少人工
- ✅ 实时性更好
- ⚠️ 需要邮箱配置

### 8.2 关键决策

| 决策点 | 选项 | 推荐 | 原因 |
|--------|-----|-----|------|
| **数据源** | 人工下载 / IMAP 自动收取 | 先人工，后 IMAP | 快速上线 |
| **文件格式** | 仅 CSV / CSV + Excel | CSV + Excel | 兼容性好 |
| **字段映射** | 固定列名 / 智能匹配 | 智能匹配 | 适应格式变化 |
| **重复导入** | 拒绝 / 覆盖 / 询问 | 询问 | 灵活可控 |
| **验证失败** | 全部拒绝 / 跳过错误行 | 全部拒绝 | 保证数据质量 |

### 8.3 后续优化方向

1. **邮件格式自适应**：训练 AI 识别邮件中的数据表格
2. **OCR 识别**：支持 PDF 格式的邮件附件
3. **数据对账**：自动对比历史数据，发现异常
4. **批量导入优化**：使用 `LOAD DATA INFILE` 提升性能

---

**下一步**：
1. 获取 1-2 份真实邮件样本（脱敏版）
2. 确认字段名称和数据格式
3. 确认邮件发送的规律（时间、频率）
4. 启动 Phase 1 开发
