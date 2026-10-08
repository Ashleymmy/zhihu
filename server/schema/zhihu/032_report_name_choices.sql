CREATE TABLE IF NOT EXISTS zh_import_row_matches (
  source_row_id BIGINT PRIMARY KEY,
  channel_mapping_id BIGINT NULL,
  keyword_id BIGINT NULL,
  confirmed_by BIGINT NOT NULL,
  confirmed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY(source_row_id) REFERENCES zh_import_rows(id),
  FOREIGN KEY(channel_mapping_id) REFERENCES zh_channel_mappings(id),
  FOREIGN KEY(keyword_id) REFERENCES zh_keywords(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
