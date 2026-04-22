ALTER TABLE `documents` ADD `sourceType` enum('ai','upload') NOT NULL DEFAULT 'ai';
--> statement-breakpoint
ALTER TABLE `documents` ADD `s3Key` varchar(500);
--> statement-breakpoint
ALTER TABLE `documents` ADD `fileUrl` varchar(1000);
