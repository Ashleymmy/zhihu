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
