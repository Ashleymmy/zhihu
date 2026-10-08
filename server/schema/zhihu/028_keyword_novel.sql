-- Reader-facing reference information; landing_url remains the upstream promotion target.
ALTER TABLE plans ADD COLUMN novel_title VARCHAR(128) NULL, ADD COLUMN novel_url VARCHAR(1024) NULL;
