ALTER TABLE zh_agency_spaces ALTER COLUMN priority_seconds SET DEFAULT 1800;
UPDATE zh_agency_spaces SET priority_seconds=1800 WHERE id=1;
UPDATE zh_keywords SET priority_until=TIMESTAMPADD(MINUTE,30,created_at),version=version+1 WHERE current_binding_id IS NULL;
