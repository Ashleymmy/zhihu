CREATE TABLE `activity_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` varchar(64) NOT NULL,
	`status` enum('success','pending','failed') NOT NULL DEFAULT 'pending',
	`message` varchar(255) NOT NULL,
	`context` varchar(160),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `activity_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `callback_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`callbackUrl` varchar(1000) NOT NULL,
	`eventTypes` text NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `callback_configs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`keyword` varchar(160) NOT NULL,
	`channel` varchar(100) NOT NULL,
	`dailyBudget` int NOT NULL,
	`status` enum('draft','active','paused','ended') NOT NULL DEFAULT 'draft',
	`impressions` int NOT NULL DEFAULT 0,
	`clicks` int NOT NULL DEFAULT 0,
	`conversions` int NOT NULL DEFAULT 0,
	`spend` int NOT NULL DEFAULT 0,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `daily_metrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`metricDate` varchar(10) NOT NULL,
	`impressions` int NOT NULL DEFAULT 0,
	`clicks` int NOT NULL DEFAULT 0,
	`conversions` int NOT NULL DEFAULT 0,
	`spend` int NOT NULL DEFAULT 0,
	CONSTRAINT `daily_metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `earning_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`amount` int NOT NULL,
	`source` varchar(160) NOT NULL,
	`settledAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `earning_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `keyword_bindings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`keyword` varchar(160) NOT NULL,
	`targetUrl` varchar(1000) NOT NULL,
	`campaignId` int,
	`eventType` varchar(64) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `keyword_bindings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `withdrawals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`amount` int NOT NULL,
	`status` enum('processing','paid','rejected') NOT NULL DEFAULT 'processing',
	`requestedBy` int,
	`requestedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `withdrawals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('boss','leader','member') NOT NULL DEFAULT 'member';