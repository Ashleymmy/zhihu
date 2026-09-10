CREATE TABLE IF NOT EXISTS module_installations (
 module_id VARCHAR(64) PRIMARY KEY, version VARCHAR(32) NOT NULL, installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS integration_accounts (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 module_id VARCHAR(64) NOT NULL, account_key VARCHAR(128) NOT NULL, name VARCHAR(128) NOT NULL,
 status ENUM('active','disabled') NOT NULL DEFAULT 'active', created_by BIGINT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uk_integration_key (module_id,account_key),
 CONSTRAINT fk_integration_module FOREIGN KEY (module_id) REFERENCES module_installations(module_id),
 CONSTRAINT fk_integration_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS project_integrations (
 project_id BIGINT NOT NULL, account_id BIGINT NOT NULL,
 PRIMARY KEY(project_id,account_id),
 CONSTRAINT fk_pi_project FOREIGN KEY(project_id) REFERENCES projects(id),
 CONSTRAINT fk_pi_account FOREIGN KEY(account_id) REFERENCES integration_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
