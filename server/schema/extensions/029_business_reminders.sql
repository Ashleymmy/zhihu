CREATE TABLE IF NOT EXISTS opc_reminder_reads (
 user_id BIGINT NOT NULL,event_key VARCHAR(128) NOT NULL,read_at DATETIME(3) NULL,
 PRIMARY KEY(user_id,event_key),
 FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
