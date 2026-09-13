ALTER TABLE zh_metric_revisions
 DROP INDEX uk_zh_revision_source,
 ADD candidate_generation INT NOT NULL DEFAULT 0,
 ADD supersedes_candidate_id BIGINT NULL,
 ADD UNIQUE KEY uk_zh_revision_generation(fact_id,source_row_id,candidate_generation),
 ADD CONSTRAINT fk_zh_candidate_parent FOREIGN KEY(supersedes_candidate_id) REFERENCES zh_metric_revisions(id);
