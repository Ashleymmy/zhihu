-- Durable business history, independent of removable audit logs.
CREATE TABLE IF NOT EXISTS project_membership_history (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 user_id BIGINT NOT NULL,
 project_id BIGINT NOT NULL,
 member_role VARCHAR(16) NOT NULL,
 effective_from DATETIME(3) NOT NULL,
 effective_to DATETIME(3) NULL,
 source_kind VARCHAR(48) NOT NULL,
 source_ref VARCHAR(128) NOT NULL,
 actor_id BIGINT NULL,
 closed_by BIGINT NULL,
 close_source_kind VARCHAR(48) NULL,
 prior_history_unknown BOOLEAN NOT NULL DEFAULT FALSE,
 version INT NOT NULL DEFAULT 1,
 open_user BIGINT GENERATED ALWAYS AS (CASE WHEN effective_to IS NULL THEN user_id END) STORED,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_project_history_open(project_id,open_user),
 UNIQUE KEY uk_project_history_source(project_id,user_id,source_kind,source_ref),
 KEY ix_project_history_time(user_id,project_id,effective_from),
 CONSTRAINT fk_project_history_user FOREIGN KEY(user_id) REFERENCES users(id),
 CONSTRAINT fk_project_history_project FOREIGN KEY(project_id) REFERENCES projects(id),
 CONSTRAINT ck_project_history_range CHECK(effective_to IS NULL OR effective_to>=effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Only the last recorded participation is known. Never infer an earlier join
-- from user registration, invitation, current role or current team.
INSERT INTO project_membership_history(user_id,project_id,member_role,effective_from,effective_to,source_kind,source_ref,prior_history_unknown)
 SELECT pm.user_id,pm.project_id,pm.member_role,pm.joined_at,
   CASE WHEN pm.left_at>=pm.joined_at THEN pm.left_at WHEN pm.left_at IS NULL THEN NULL ELSE pm.joined_at END,
   'migration',CAST(pm.id AS CHAR),TRUE
 FROM project_members pm
 WHERE NOT EXISTS(SELECT 1 FROM project_membership_history h WHERE h.user_id=pm.user_id AND h.project_id=pm.project_id);

CREATE TABLE IF NOT EXISTS member_history_versions (
 user_id BIGINT NOT NULL,
 project_id BIGINT NOT NULL,
 version INT NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,project_id),
 CONSTRAINT fk_history_version_user FOREIGN KEY(user_id) REFERENCES users(id),
 CONSTRAINT fk_history_version_project FOREIGN KEY(project_id) REFERENCES projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS member_history_evidence (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 user_id BIGINT NOT NULL,
 project_id BIGINT NOT NULL,
 effective_from DATETIME(3) NOT NULL,
 effective_to DATETIME(3) NOT NULL,
 time_precision ENUM('date','timestamp') NOT NULL,
 participation BOOLEAN NULL,
 historical_role VARCHAR(16) NULL,
 has_team BOOLEAN NOT NULL DEFAULT FALSE,
 leader_id BIGINT NULL,
 source_kind VARCHAR(48) NOT NULL,
 source_ref VARCHAR(255) NULL,
 source_summary VARCHAR(2000) NOT NULL,
 source_snapshot JSON NOT NULL,
 status ENUM('verified','pending') NOT NULL,
 actor_id BIGINT NOT NULL,
 request_key VARCHAR(128) NOT NULL,
 input_hash CHAR(64) NOT NULL,
 version INT NOT NULL,
 supersedes_id BIGINT NULL,
 context_json JSON NULL,
 result_json JSON NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_history_evidence_request(user_id,project_id,actor_id,request_key),
 UNIQUE KEY uk_history_evidence_version(user_id,project_id,version),
 UNIQUE KEY uk_history_evidence_supersedes(supersedes_id),
 KEY ix_history_evidence_time(user_id,project_id,effective_from,effective_to),
 CONSTRAINT fk_history_evidence_user FOREIGN KEY(user_id) REFERENCES users(id),
 CONSTRAINT fk_history_evidence_project FOREIGN KEY(project_id) REFERENCES projects(id),
 CONSTRAINT fk_history_evidence_supersedes FOREIGN KEY(supersedes_id) REFERENCES member_history_evidence(id),
 CONSTRAINT ck_history_evidence_range CHECK(effective_to>effective_from),
 CONSTRAINT ck_history_evidence_team CHECK(leader_id IS NULL OR leader_id<>user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
