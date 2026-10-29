-- Preserve all historical terms and replace the one-request-per-day index.
-- Safe to repeat after a completed DDL but interrupted migration receipt.
SET @withdrawal_day_index_sql = IF(
 EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE()
 AND table_name='opc_withdrawal_terms' AND index_name='uk_opc_withdrawal_day'),
 'ALTER TABLE opc_withdrawal_terms DROP INDEX uk_opc_withdrawal_day, ADD INDEX ix_opc_withdrawal_day(user_id,applied_day)',
 'SELECT 1');
PREPARE withdrawal_day_index_stmt FROM @withdrawal_day_index_sql;
EXECUTE withdrawal_day_index_stmt;
DEALLOCATE PREPARE withdrawal_day_index_stmt;
