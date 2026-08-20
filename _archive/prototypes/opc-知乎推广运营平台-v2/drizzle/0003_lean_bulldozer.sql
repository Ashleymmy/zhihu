ALTER TABLE `campaigns` ADD `zhihuTaskId` varchar(32);--> statement-breakpoint
ALTER TABLE `campaigns` ADD `zhihuChannelId` varchar(32);--> statement-breakpoint
ALTER TABLE `campaigns` ADD `contentUrl` varchar(1000);--> statement-breakpoint
ALTER TABLE `campaigns` ADD `externalPlanId` varchar(32);--> statement-breakpoint
ALTER TABLE `campaigns` ADD `externalSubmissionState` enum('none','submitting','created','failed') DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `externalSubmittedAt` timestamp;--> statement-breakpoint
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_externalPlanId_unique` UNIQUE(`externalPlanId`);