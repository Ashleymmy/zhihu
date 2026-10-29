CREATE TABLE IF NOT EXISTS platform_support_qrcodes (
 channel VARCHAR(16) PRIMARY KEY,
 contact_name VARCHAR(80) NOT NULL DEFAULT '',
 mime_type VARCHAR(32) NOT NULL,
 content MEDIUMBLOB NOT NULL,
 content_hash CHAR(64) NOT NULL,
 updated_by BIGINT NOT NULL,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CHECK(channel IN ('wechat','feishu'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
