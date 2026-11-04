CREATE TABLE IF NOT EXISTS zh_work_review_records (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  binding_id BIGINT NOT NULL,
  composition_id BIGINT NULL,
  evidence_id BIGINT NULL,
  policy VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  decided_by BIGINT NULL,
  detail_json JSON NOT NULL,
  source_audit_id BIGINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_zh_work_review_audit(source_audit_id),
  INDEX ix_zh_work_review_binding(binding_id,policy,id),
  INDEX ix_zh_work_review_composition(composition_id,binding_id,id),
  INDEX ix_zh_work_review_evidence(evidence_id,id),
  FOREIGN KEY(binding_id) REFERENCES zh_keyword_bindings(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO zh_work_review_records(binding_id,composition_id,policy,status,decided_by,detail_json,source_audit_id,created_at)
SELECT b.id,c.id,'manual-registered-work-v1','passed',a.user_id,a.detail_json,a.id,a.created_at
FROM audit_logs a
JOIN zh_keyword_bindings b ON b.id=CAST(JSON_UNQUOTE(JSON_EXTRACT(a.detail_json,'$.bindingId')) AS UNSIGNED)
JOIN zh_keywords k ON k.id=b.keyword_id
JOIN compositions c ON BINARY a.resource_id=BINARY CAST(c.id AS CHAR) AND c.plan_id=k.plan_id AND c.owner_id=b.executor_id
WHERE a.action='zhihu.work.review-existing' ORDER BY a.id;

INSERT IGNORE INTO zh_work_review_records(binding_id,evidence_id,policy,status,decided_by,detail_json,source_audit_id,created_at)
SELECT e.binding_id,e.id,'manual-evidence-review-v1',
  IF(JSON_UNQUOTE(JSON_EXTRACT(a.detail_json,'$.accept'))='true','passed','rejected'),
  a.user_id,a.detail_json,a.id,a.created_at
FROM audit_logs a JOIN zh_evidence e ON BINARY a.resource_id=BINARY CAST(e.id AS CHAR)
WHERE a.action='zhihu.evidence.review' ORDER BY a.id;

INSERT IGNORE INTO zh_work_review_records(binding_id,policy,status,decided_by,detail_json,source_audit_id,created_at)
SELECT b.id,'R7-default-review-v1',IF(a.action='zhihu.work.default-review','passed','pending'),
  a.user_id,a.detail_json,a.id,a.created_at
FROM audit_logs a JOIN zh_keyword_bindings b ON BINARY a.resource_id=BINARY CAST(b.id AS CHAR)
WHERE a.action IN ('zhihu.work.default-review','zhihu.work.review-blocked') ORDER BY a.id;

-- Preserve stored approvals whose original review events were already cleaned.
-- The baseline records provenance without inventing an upstream approval.
INSERT INTO zh_work_review_records(binding_id,composition_id,policy,status,detail_json)
SELECT b.id,c.id,'legacy-approved-v1','passed',
  JSON_OBJECT('source','stored-platform-approval','bindingId',CAST(b.id AS CHAR),
    'compositionId',CAST(c.id AS CHAR),'executorId',CAST(b.executor_id AS CHAR),
    'workUrl',c.promo_url,'projectId',CAST(k.project_id AS CHAR),'accountId',CAST(k.account_id AS CHAR))
FROM zh_keyword_bindings b JOIN zh_keywords k ON k.id=b.keyword_id
LEFT JOIN compositions c ON c.plan_id=k.plan_id AND c.owner_id=b.executor_id
WHERE b.verification_status='passed'
  AND NOT EXISTS(SELECT 1 FROM zh_work_review_records r WHERE r.binding_id=b.id)
ORDER BY b.id,c.id;
