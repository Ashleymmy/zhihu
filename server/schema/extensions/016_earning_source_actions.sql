-- Current handling instructions belong to the mutable source, never confirmed lines.
SET @earning_action_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='opc_earning_sources' AND column_name='next_action');
SET @earning_action_ddl = IF(@earning_action_exists>0,'SELECT 1','ALTER TABLE opc_earning_sources ADD COLUMN next_action VARCHAR(255) NULL');
PREPARE earning_action_statement FROM @earning_action_ddl;
EXECUTE earning_action_statement;
DEALLOCATE PREPARE earning_action_statement;
