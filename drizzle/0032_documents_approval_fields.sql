ALTER TABLE `documents` ADD `createdBy` int;
--> statement-breakpoint
ALTER TABLE `documents` ADD `documentStatus` enum('draft','in_review','approved','rejected') NOT NULL DEFAULT 'draft';