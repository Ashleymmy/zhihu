ALTER TABLE `campaigns` MODIFY COLUMN `status` enum('draft','active','paused','ended','archived') NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `callback_configs` ADD `campaignId` int;