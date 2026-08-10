CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('boss','leader','member') NOT NULL,
  parent_id BIGINT NULL,
  display_name VARCHAR(64) NOT NULL,
  phone VARCHAR(20) NULL,
  zhihu_uid VARCHAR(64) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  must_change_pwd TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_by BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_parent FOREIGN KEY (parent_id) REFERENCES users(id),
  INDEX idx_users_parent (parent_id),
  INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS projects (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(64) NOT NULL,
  slug VARCHAR(32) NOT NULL UNIQUE,
  api_base_url VARCHAR(255) NOT NULL,
  sign_method ENUM('hmac_sha256','oauth2') NOT NULL DEFAULT 'hmac_sha256',
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  config_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO projects (name, slug, api_base_url, sign_method, config_json)
VALUES ('知乎', 'zhihu', 'https://open.zhihu.com', 'hmac_sha256', JSON_OBJECT('withdrawalMinAmount', 0))
ON DUPLICATE KEY UPDATE name = VALUES(name);

CREATE TABLE IF NOT EXISTS channels (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  zhihu_channel_id VARCHAR(32) NOT NULL,
  parent_channel_id VARCHAR(32) NULL,
  generation TINYINT NOT NULL,
  name VARCHAR(128) NOT NULL,
  owner_id BIGINT NULL,
  commission_rate DECIMAL(6,4) NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  synced_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_channels_zhihu (project_id, zhihu_channel_id),
  INDEX idx_channels_owner (owner_id),
  CONSTRAINT fk_channels_owner FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tasks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  zhihu_task_id VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  popularize_type TINYINT NULL,
  settle_type VARCHAR(32) NULL,
  unit_price DECIMAL(12,4) NULL,
  start_time DATETIME NULL,
  end_time DATETIME NULL,
  status VARCHAR(32) NULL,
  raw_json JSON NULL,
  synced_at DATETIME NOT NULL,
  UNIQUE KEY uk_tasks_zhihu (project_id, zhihu_task_id),
  INDEX idx_tasks_time (start_time, end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plans (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  zhihu_plan_id VARCHAR(32) NULL,
  zhihu_task_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  second_channel_id VARCHAR(32) NULL,
  keyword VARCHAR(128) NOT NULL,
  landing_url VARCHAR(1024) NOT NULL,
  popularize_type TINYINT NOT NULL,
  owner_id BIGINT NOT NULL,
  created_by BIGINT NOT NULL,
  name VARCHAR(255) NULL,
  status ENUM('pending','active','paused','rejected','ended') NOT NULL DEFAULT 'pending',
  reject_reason VARCHAR(512) NULL,
  daily_budget DECIMAL(12,2) NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  sync_status ENUM('local','syncing','synced','failed') NOT NULL DEFAULT 'local',
  sync_error VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_plans_channel_keyword (channel_id, keyword),
  UNIQUE KEY uk_plans_zhihu (project_id, zhihu_plan_id),
  INDEX idx_plans_owner (owner_id),
  INDEX idx_plans_keyword (keyword),
  INDEX idx_plans_status (status),
  CONSTRAINT fk_plans_owner FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS compositions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  plan_id BIGINT NOT NULL,
  owner_id BIGINT NOT NULL,
  zhihu_composition_id VARCHAR(32) NULL,
  media_type TINYINT NOT NULL,
  media_account VARCHAR(128) NOT NULL,
  composition_type TINYINT NOT NULL,
  composition_sub_type TINYINT NOT NULL,
  title VARCHAR(255) NULL,
  promo_url VARCHAR(1024) NOT NULL,
  release_time DATETIME NULL,
  status ENUM('pending','active','rejected','ended') NOT NULL DEFAULT 'pending',
  reject_reason VARCHAR(512) NULL,
  sync_status ENUM('local','syncing','synced','failed') NOT NULL DEFAULT 'local',
  sync_error VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_comp_zhihu (zhihu_composition_id),
  INDEX idx_comp_plan (plan_id),
  INDEX idx_comp_owner (owner_id),
  CONSTRAINT fk_comp_plan FOREIGN KEY (plan_id) REFERENCES plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS daily_metrics (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  keyword VARCHAR(128) NOT NULL,
  plan_id BIGINT NULL,
  owner_id BIGINT NULL,
  stat_date DATE NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  conversions BIGINT NOT NULL DEFAULT 0,
  earning DECIMAL(14,4) NOT NULL DEFAULT 0,
  raw_json JSON NULL,
  fetched_at DATETIME NOT NULL,
  UNIQUE KEY uk_metrics_dim (project_id, channel_id, keyword, stat_date),
  INDEX idx_metrics_owner_date (owner_id, stat_date),
  INDEX idx_metrics_date (stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS earnings (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  plan_id BIGINT NULL,
  settle_date DATE NOT NULL,
  amount DECIMAL(14,4) NOT NULL,
  status ENUM('pending','confirmed','paid') NOT NULL DEFAULT 'pending',
  source_ref VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_earnings_dedup (user_id, project_id, plan_id, settle_date),
  INDEX idx_earnings_user_date (user_id, settle_date),
  CONSTRAINT fk_earnings_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  pay_method ENUM('alipay','wechat') NOT NULL,
  pay_account VARCHAR(128) NOT NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  remark VARCHAR(512) NULL,
  handled_by BIGINT NULL,
  handled_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wd_user (user_id, status),
  CONSTRAINT fk_wd_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NULL,
  action VARCHAR(64) NOT NULL,
  resource_type VARCHAR(32) NOT NULL,
  resource_id VARCHAR(64) NULL,
  detail_json JSON NULL,
  ip VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_user_time (user_id, created_at),
  INDEX idx_audit_action (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
