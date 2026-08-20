CREATE TABLE `workspace_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`module` varchar(64) NOT NULL,
	`title` varchar(180) NOT NULL,
	`detail` text,
	`status` enum('open','done','archived') NOT NULL DEFAULT 'open',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workspace_records_id` PRIMARY KEY(`id`)
);
