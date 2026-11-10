-- 2026-11-10：晋升由同一位有权限的人员办理；保留旧记录、唯一待办与其他约束。
SET @promotion_reviewer_constraint = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'member_promotions'
    AND CONSTRAINT_NAME = 'chk_promotion_reviewer' AND CONSTRAINT_TYPE = 'CHECK'
);
SET @promotion_reviewer_sql = IF(@promotion_reviewer_constraint > 0,
  'ALTER TABLE member_promotions DROP CHECK chk_promotion_reviewer', 'SELECT 1');
PREPARE promotion_reviewer_stmt FROM @promotion_reviewer_sql;
EXECUTE promotion_reviewer_stmt;
DEALLOCATE PREPARE promotion_reviewer_stmt;
