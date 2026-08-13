ALTER TABLE compositions MODIFY media_type VARCHAR(32) NOT NULL;

UPDATE compositions SET media_type = 'KOC抖音' WHERE media_type = '1';

UPDATE compositions SET media_type = 'KOC小红书' WHERE media_type = '2';
