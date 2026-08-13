UPDATE compositions SET media_type = '1' WHERE media_type = 'KOC抖音';

UPDATE compositions SET media_type = '2' WHERE media_type = 'KOC小红书';

ALTER TABLE compositions MODIFY media_type TINYINT NOT NULL;
