-- 回滚 014: 移除知乎审核状态 JSON 字段

ALTER TABLE plans DROP COLUMN zhihu_status_json;
ALTER TABLE compositions DROP COLUMN zhihu_status_json;
