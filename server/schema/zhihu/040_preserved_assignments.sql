-- Only explicitly reviewed account changes preserve an existing business path.
-- Executor, leader, path and financial history are never rewritten here.
ALTER TABLE zh_keyword_bindings ADD COLUMN access_preserved_at DATETIME(3) NULL;
