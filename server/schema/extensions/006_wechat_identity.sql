ALTER TABLE login_sessions MODIFY client_type ENUM('web','mobile','mini') NOT NULL;

CREATE TABLE wechat_identities (
 app_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 open_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 user_id BIGINT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(app_id,open_id),
 UNIQUE KEY ux_wechat_user(app_id,user_id),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE wechat_bridge_nonces (
 nonce CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 expires_at DATETIME(3) NOT NULL,
 INDEX ix_bridge_expiry(expires_at)
) ENGINE=InnoDB;

ALTER TABLE member_invitations ADD source ENUM('web','mini') NOT NULL DEFAULT 'web';
CREATE TABLE mini_invitation_codes (
 invitation_id BIGINT PRIMARY KEY,
 code CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 token_hash CHAR(64) NOT NULL,
 FOREIGN KEY(invitation_id) REFERENCES member_invitations(id)
) ENGINE=InnoDB;
CREATE TABLE wechat_profiles (
 user_id BIGINT PRIMARY KEY,
 contact VARCHAR(128) NOT NULL DEFAULT '',
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mini_uploads (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 user_id BIGINT NOT NULL,
 project_id BIGINT NOT NULL,
 account_id BIGINT NOT NULL,
 purpose VARCHAR(32) NOT NULL,
 filename VARCHAR(255) NOT NULL,
 total_bytes INT NULL,
 finished BOOLEAN NOT NULL DEFAULT FALSE,
 expires_at DATETIME(3) NOT NULL,
 INDEX ix_mini_upload_expiry(expires_at),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE mini_upload_chunks (
 upload_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 chunk_index INT NOT NULL,
 content MEDIUMBLOB NOT NULL,
 PRIMARY KEY(upload_id,chunk_index),
 FOREIGN KEY(upload_id) REFERENCES mini_uploads(id) ON DELETE CASCADE
) ENGINE=InnoDB;
