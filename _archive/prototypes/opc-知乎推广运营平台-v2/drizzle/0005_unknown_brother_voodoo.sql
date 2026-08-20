CREATE TABLE `zhihu_batch_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestHash` varchar(64) NOT NULL,
	`zhihuTaskId` varchar(32) NOT NULL,
	`zhihuChannelId` varchar(32) NOT NULL,
	`itemCount` int NOT NULL,
	`externalBatchTaskId` varchar(32),
	`externalSubmissionState` enum('none','submitting','created','uncertain','failed') NOT NULL DEFAULT 'none',
	`resultSummary` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `zhihu_batch_tasks_id` PRIMARY KEY(`id`),
	CONSTRAINT `zhihu_batch_tasks_requestHash_unique` UNIQUE(`requestHash`),
	CONSTRAINT `zhihu_batch_tasks_externalBatchTaskId_unique` UNIQUE(`externalBatchTaskId`)
);
