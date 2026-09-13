CREATE TABLE zh_agency_spaces (
 id BIGINT PRIMARY KEY, name VARCHAR(128) NOT NULL,
 priority_seconds INT NOT NULL DEFAULT 86400,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO zh_agency_spaces(id,name) VALUES(1,'OPC 运营主体');

CREATE TABLE zh_channel_mappings (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 account_id BIGINT NOT NULL, project_id BIGINT NOT NULL,
 channel_id BIGINT NOT NULL, canonical_id BIGINT NULL,
 channel_name VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
 effective_from DATE NOT NULL, effective_to DATE NULL,
 created_by BIGINT NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX ix_zh_channel_name(account_id,channel_name,effective_from),
 FOREIGN KEY(account_id) REFERENCES integration_accounts(id),
 FOREIGN KEY(project_id) REFERENCES projects(id),
 FOREIGN KEY(channel_id) REFERENCES channels(id),
 FOREIGN KEY(canonical_id) REFERENCES zh_channel_mappings(id),
 CHECK(effective_to IS NULL OR effective_to>effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE zh_keywords (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, agency_space_id BIGINT NOT NULL DEFAULT 1,
 account_id BIGINT NOT NULL, project_id BIGINT NOT NULL, task_id BIGINT NOT NULL,
 channel_mapping_id BIGINT NOT NULL, plan_id BIGINT NOT NULL,
 keyword VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
 upstream_status VARCHAR(32) NOT NULL DEFAULT 'pending',
 lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'pending',
 upstream_confirmed_at DATETIME(3) NULL, priority_until DATETIME(3) NULL,
 current_binding_id BIGINT NULL, used_ever_at DATETIME(3) NULL,
 legacy_mode VARCHAR(32) NOT NULL DEFAULT 'new',
 created_by BIGINT NOT NULL, version INT NOT NULL DEFAULT 1,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_zh_keyword(agency_space_id,keyword),
 UNIQUE KEY uk_zh_keyword_plan(plan_id),
 INDEX ix_zh_keyword_scope(project_id,account_id,lifecycle_status,priority_until,id),
 FOREIGN KEY(account_id) REFERENCES integration_accounts(id),
 FOREIGN KEY(project_id) REFERENCES projects(id),
 FOREIGN KEY(task_id) REFERENCES tasks(id),
 FOREIGN KEY(plan_id) REFERENCES plans(id),
 FOREIGN KEY(channel_mapping_id) REFERENCES zh_channel_mappings(id),
 FOREIGN KEY(agency_space_id) REFERENCES zh_agency_spaces(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE zh_keyword_bindings (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, keyword_id BIGINT NOT NULL,
 path_type VARCHAR(32) NOT NULL, leader_id BIGINT NULL, executor_id BIGINT NULL,
 relation_snapshot JSON NOT NULL,
 claimed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 assigned_at DATETIME(3) NULL, activated_on DATE NULL, used_at DATETIME(3) NULL,
 stop_new_use_at DATETIME(3) NULL, released_at DATETIME(3) NULL,
 release_status VARCHAR(32) NOT NULL DEFAULT 'none', release_reason VARCHAR(500) NULL,
 verification_status VARCHAR(32) NOT NULL DEFAULT 'pending',
 version INT NOT NULL DEFAULT 1,
 occupied_keyword_id BIGINT GENERATED ALWAYS AS (CASE WHEN released_at IS NULL THEN keyword_id ELSE NULL END) STORED,
 UNIQUE KEY uk_zh_occupied(occupied_keyword_id),
 FOREIGN KEY(keyword_id) REFERENCES zh_keywords(id),
 FOREIGN KEY(leader_id) REFERENCES users(id),
 FOREIGN KEY(executor_id) REFERENCES users(id),
 CHECK((path_type='reserved' AND leader_id IS NOT NULL AND executor_id IS NULL) OR
 (path_type='team_creator' AND leader_id IS NOT NULL AND executor_id IS NOT NULL AND leader_id<>executor_id) OR
 (path_type='direct_creator' AND leader_id IS NULL AND executor_id IS NOT NULL) OR
 (path_type='leader_self' AND leader_id=executor_id))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE zh_keywords ADD CONSTRAINT fk_zh_current_binding FOREIGN KEY(current_binding_id) REFERENCES zh_keyword_bindings(id);

CREATE TABLE zh_idempotency_requests (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, account_id BIGINT NOT NULL, actor_id BIGINT NOT NULL,
 operation VARCHAR(64) NOT NULL, request_key VARCHAR(128) NOT NULL,
 request_hash CHAR(64) NOT NULL, response_json JSON NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_zh_request(account_id,actor_id,operation,request_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
