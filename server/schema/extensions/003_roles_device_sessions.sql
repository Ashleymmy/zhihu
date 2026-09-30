ALTER TABLE users MODIFY role ENUM('boss','leader','member','admin','creator','developer','operator') NOT NULL;
INSERT INTO roles(role_key,role_name,description,level,is_system) VALUES
 ('developer','开发者','最高权限，可管理管理员；不受设备数量限制',50,1),
 ('operator','运营管理员','业务运营权限；不可管理同级或更高权限账号',30,1)
ON DUPLICATE KEY UPDATE role_name=VALUES(role_name),description=VALUES(description),level=VALUES(level);
UPDATE roles SET role_name='管理员',description='账号及业务管理权限',level=40 WHERE role_key='admin';
UPDATE roles SET level=20 WHERE role_key='leader';
UPDATE roles SET level=10 WHERE role_key='creator';

CREATE TABLE login_sessions (
 id CHAR(36) PRIMARY KEY,
 user_id BIGINT NOT NULL,
 client_type ENUM('web','mobile') NOT NULL,
 client_id_hash CHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 expires_at DATETIME(3) NOT NULL,
 revoked_at DATETIME(3) NULL,
 revoke_reason VARCHAR(64) NULL,
 INDEX ix_login_user_type(user_id,client_type,revoked_at),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Old access tokens lack a device-bound session ID and require a fresh login.
UPDATE token_sessions SET revoked_at=NOW(3),revoke_reason='device_policy_enabled' WHERE revoked_at IS NULL;
