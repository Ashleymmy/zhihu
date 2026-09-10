-- 回滚 017：移除归因关联字段和 P0 归因核心表。

ALTER TABLE earnings
  DROP INDEX idx_earnings_attribution,
  DROP COLUMN attribution_method,
  DROP COLUMN attribution_result_id;

DROP TABLE IF EXISTS attribution_results;
DROP TABLE IF EXISTS attribution_tasks;
DROP TABLE IF EXISTS creator_works;
DROP TABLE IF EXISTS keyword_bindings;
