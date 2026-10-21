CREATE TABLE platform_support_settings (
 id TINYINT PRIMARY KEY,
 service_url VARCHAR(2048) NOT NULL DEFAULT '',
 business_url VARCHAR(2048) NOT NULL DEFAULT '',
 service_hours VARCHAR(100) NOT NULL DEFAULT '',
 mini_contact_enabled TINYINT(1) NOT NULL DEFAULT 0,
 revision INT NOT NULL DEFAULT 0,
 updated_by BIGINT NULL,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CHECK(id=1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO platform_support_settings(id) VALUES(1);
