CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('boss','leader','member') NOT NULL,
  parent_id BIGINT NULL,
  display_name VARCHAR(64) NOT NULL,
  phone VARCHAR(20) NULL,
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
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
-- 004_identity_rbac.sql
-- M1 身份域：角色迁移（boss→admin、member→creator）、roles 表、
-- mcn_accounts、project_members、token_sessions（Refresh Token 轮换）。
-- 只做加法与角色值回填，不删除任何旧表旧列。

-- 1. users.role 扩展枚举并回填目标值（旧值仍在枚举中，服务端双读兜底）
ALTER TABLE users MODIFY role ENUM('boss','leader','member','admin','creator') NOT NULL;
UPDATE users SET role = 'admin' WHERE role = 'boss';
UPDATE users SET role = 'creator' WHERE role = 'member';

-- 2. 角色表与 users.role_id 回填
CREATE TABLE IF NOT EXISTS roles (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  role_key VARCHAR(50) NOT NULL UNIQUE,
  role_name VARCHAR(50) NOT NULL,
  description TEXT NULL,
  level INT NOT NULL DEFAULT 0,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO roles (role_key, role_name, description, level, is_system) VALUES
  ('admin', '超级管理员', '拥有所有权限', 0, 1),
  ('leader', '团长', '管理达人，查看中继后收益', 1, 1),
  ('creator', '达人', '创作内容，查看分发收益', 2, 1)
ON DUPLICATE KEY UPDATE role_name = VALUES(role_name);

ALTER TABLE users
  ADD COLUMN role_id BIGINT NULL AFTER role,
  ADD COLUMN email VARCHAR(100) NULL AFTER username,
  ADD COLUMN mcn_account_id BIGINT NULL AFTER parent_id,
  ADD INDEX idx_users_role_id (role_id),
  ADD INDEX idx_users_mcn_account (mcn_account_id);

UPDATE users u JOIN roles r ON r.role_key = u.role SET u.role_id = r.id;

ALTER TABLE users
  ADD CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id);

-- 3. MCN 账户（与 users 循环引用：先建表后补 FK）
CREATE TABLE IF NOT EXISTS mcn_accounts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  account_key VARCHAR(64) NOT NULL,
  account_name VARCHAR(128) NOT NULL,
  owner_user_id BIGINT NOT NULL,
  status ENUM('active','suspended','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_mcn_accounts_key (account_key),
  KEY idx_mcn_accounts_owner (owner_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE mcn_accounts
  ADD CONSTRAINT fk_mcn_accounts_owner FOREIGN KEY (owner_user_id) REFERENCES users(id);

ALTER TABLE users
  ADD CONSTRAINT fk_users_mcn_account FOREIGN KEY (mcn_account_id) REFERENCES mcn_accounts(id);

-- 4. 项目成员（行级可见性的唯一依据；无成员记录时 fail closed）
CREATE TABLE IF NOT EXISTS project_members (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  member_role ENUM('owner','admin','member','viewer') NOT NULL DEFAULT 'member',
  joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  left_at DATETIME(3) NULL,
  UNIQUE KEY uk_project_user (project_id, user_id),
  CONSTRAINT fk_project_members_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. Refresh Token 会话（轮换 + 复用检测 + family 撤销）
CREATE TABLE IF NOT EXISTS token_sessions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  family_id CHAR(36) NOT NULL,
  token_id CHAR(36) NOT NULL,
  refresh_token_hash BINARY(32) NOT NULL,
  rotated_from_id BIGINT NULL,
  expires_at DATETIME(3) NOT NULL,
  last_used_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  revoke_reason VARCHAR(64) NULL,
  reuse_detected_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_token_sessions_token (token_id),
  KEY idx_token_sessions_family (family_id, revoked_at),
  KEY idx_token_sessions_user (user_id, expires_at),
  CONSTRAINT fk_token_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_token_sessions_rotated_from FOREIGN KEY (rotated_from_id) REFERENCES token_sessions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- M1: 项目课程关联表（最小闭环）
-- 暂时复用 001 的 projects 表作为挂载点，course 信息内联存储

CREATE TABLE IF NOT EXISTS project_courses (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL COMMENT '关联的项目 ID（复用 001 projects）',
  course_name VARCHAR(128) NOT NULL COMMENT '课程名称',
  course_url VARCHAR(512) NULL COMMENT '课程链接',
  display_order INT NOT NULL DEFAULT 0 COMMENT '显示顺序',
  is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  CONSTRAINT fk_project_courses_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  INDEX idx_project_courses_project (project_id),
  INDEX idx_project_courses_order (project_id, display_order)
) ENGINE=InnoDB COMMENT='项目课程关联（M1 最小闭环）';

-- 达人入团申请：creator 向 leader 发起申请，leader/admin 审批通过后建立 parent_id 归属

CREATE TABLE IF NOT EXISTS team_applications (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  creator_id BIGINT NOT NULL COMMENT '申请的达人用户 ID',
  leader_id BIGINT NOT NULL COMMENT '目标团长用户 ID',
  message VARCHAR(500) NULL COMMENT '申请留言',
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  handled_by BIGINT NULL COMMENT '审批人用户 ID',
  handled_at DATETIME NULL COMMENT '审批时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_team_applications_creator FOREIGN KEY (creator_id) REFERENCES users(id),
  CONSTRAINT fk_team_applications_leader FOREIGN KEY (leader_id) REFERENCES users(id),
  INDEX idx_team_applications_leader_status (leader_id, status),
  INDEX idx_team_applications_creator (creator_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='达人入团申请';

-- 入团申请增加"已撤回"状态：达人主动撤回与团长驳回是不同含义

ALTER TABLE team_applications
  MODIFY COLUMN status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending';

-- 010: 系统公告

CREATE TABLE IF NOT EXISTS announcements (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(128) NOT NULL,
  content VARCHAR(2000) NOT NULL,
  status ENUM('published','offline') NOT NULL DEFAULT 'published',
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_announcements_creator FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_announcements_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统公告';
