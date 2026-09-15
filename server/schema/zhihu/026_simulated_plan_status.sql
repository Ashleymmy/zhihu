-- Keep local integration testing distinct from successful upstream synchronization.
CREATE TABLE IF NOT EXISTS zhihu_account_settings (
 project_id BIGINT PRIMARY KEY, account_id BIGINT NOT NULL,
 api_base_url VARCHAR(255), sign_method VARCHAR(32), config_json JSON
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE plans MODIFY sync_status ENUM('local','syncing','synced','failed','simulated') NOT NULL DEFAULT 'local';
