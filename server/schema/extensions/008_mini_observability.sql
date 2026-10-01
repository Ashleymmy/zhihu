CREATE TABLE IF NOT EXISTS mini_request_events (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 occurred_at DATETIME(3) NOT NULL,
 route_key VARCHAR(100) NOT NULL,
 method VARCHAR(8) NOT NULL,
 http_status SMALLINT NOT NULL,
 result_code INT NOT NULL,
 duration_ms INT NOT NULL,
 user_id BIGINT NULL,
 cloud_env VARCHAR(80) NULL,
 bridge_version VARCHAR(32) NULL,
 client_version VARCHAR(32) NULL,
 client_env VARCHAR(16) NULL,
 INDEX ix_mini_events_time(occurred_at),
 INDEX ix_mini_events_user(user_id,occurred_at),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
