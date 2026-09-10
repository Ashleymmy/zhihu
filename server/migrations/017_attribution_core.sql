-- 017: P0 归因核心数据表
-- 仅创建归因链路所需的数据结构；本迁移不实现归因计算、不调整定价规则，
-- 也不迁移历史 earnings 数据。

-- 1. 关键词绑定表：记录用户声明使用的推广关键词。
CREATE TABLE IF NOT EXISTS keyword_bindings (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  keyword VARCHAR(128) NOT NULL COMMENT '关键词',
  plan_id BIGINT NOT NULL COMMENT '推广计划ID',
  user_id BIGINT NOT NULL COMMENT '用户ID',
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  bind_at DATETIME NOT NULL COMMENT '绑定时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_keyword_bindings_keyword_status (keyword, status),
  INDEX idx_keyword_bindings_user (user_id),
  CONSTRAINT fk_keyword_bindings_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_keyword_bindings_plan FOREIGN KEY (plan_id) REFERENCES plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='关键词绑定';

-- 2. 作品登记表：记录达人发布的作品和基础质量数据。
CREATE TABLE IF NOT EXISTS creator_works (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  work_title VARCHAR(255) NOT NULL COMMENT '作品标题',
  work_url VARCHAR(512) NOT NULL COMMENT '作品链接',
  platform ENUM('douyin','xiaohongshu','bilibili','weibo','other') NOT NULL,
  keyword VARCHAR(128) NOT NULL COMMENT '使用的关键词',
  plan_id BIGINT NULL COMMENT '推广计划ID',
  creator_id BIGINT NOT NULL COMMENT '达人ID',
  view_count BIGINT NOT NULL DEFAULT 0 COMMENT '浏览量',
  like_count INT NOT NULL DEFAULT 0 COMMENT '点赞数',
  share_count INT NOT NULL DEFAULT 0 COMMENT '转发数',
  quality_score DECIMAL(10,2) NULL COMMENT '质量分数（计算后缓存）',
  published_at DATETIME NOT NULL COMMENT '作品发布时间',
  status ENUM('approved') NOT NULL DEFAULT 'approved',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_creator_works_keyword_published (keyword, published_at),
  INDEX idx_creator_works_creator (creator_id),
  CONSTRAINT fk_creator_works_creator FOREIGN KEY (creator_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='达人作品登记';

-- 3. 归因任务表：邮件/Excel 数据导入后可作为归因处理的输入任务。
CREATE TABLE IF NOT EXISTS attribution_tasks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  data_date DATE NOT NULL COMMENT '数据日期',
  keyword VARCHAR(128) NOT NULL COMMENT '关键词',
  total_revenue BIGINT NOT NULL COMMENT '总收益（分）',
  search_volume INT NOT NULL DEFAULT 0 COMMENT '搜索量',
  conversion_count INT NOT NULL DEFAULT 0 COMMENT '转化数',
  status ENUM('pending','completed','failed') NOT NULL DEFAULT 'pending',
  settlement_batch_id BIGINT NULL COMMENT '结算批次ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attribution_tasks_date_keyword (data_date, keyword),
  INDEX idx_attribution_tasks_status (status),
  INDEX idx_attribution_tasks_batch (settlement_batch_id),
  CONSTRAINT fk_attribution_tasks_batch FOREIGN KEY (settlement_batch_id) REFERENCES settlement_batches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='归因任务';

-- 4. 归因结果表：保存归因引擎产生的用户级分配结果。
CREATE TABLE IF NOT EXISTS attribution_results (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  task_id BIGINT NOT NULL COMMENT '归因任务ID',
  user_id BIGINT NOT NULL COMMENT '用户ID',
  works_count INT NOT NULL COMMENT '作品数量',
  total_quality_score DECIMAL(12,2) NULL COMMENT '作品质量总分',
  attribution_weight DECIMAL(8,6) NOT NULL COMMENT '分配权重（0-1）',
  allocated_revenue BIGINT NOT NULL COMMENT '归因收益（分）',
  settlement_item_id BIGINT NULL COMMENT '结算明细ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_attribution_results_task (task_id),
  INDEX idx_attribution_results_user (user_id),
  CONSTRAINT fk_attribution_results_task FOREIGN KEY (task_id) REFERENCES attribution_tasks(id),
  CONSTRAINT fk_attribution_results_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_attribution_results_item FOREIGN KEY (settlement_item_id) REFERENCES settlement_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='归因结果';

-- 5. 仅补充归因结果关联字段；不改变 earnings 现有金额、定价和状态语义。
ALTER TABLE earnings
  ADD COLUMN attribution_result_id BIGINT NULL COMMENT '归因结果ID',
  ADD COLUMN attribution_method VARCHAR(32) NULL COMMENT '归因方式',
  ADD INDEX idx_earnings_attribution (attribution_result_id);
