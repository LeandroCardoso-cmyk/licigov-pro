-- Sprint 2: Extend comments for threading, resolution and section anchoring
ALTER TABLE `comments` ADD COLUMN `parentId`      int                                              AFTER `id`;
--> statement-breakpoint
ALTER TABLE `comments` ADD COLUMN `anchorSection` varchar(100)                                     AFTER `parentId`;
--> statement-breakpoint
ALTER TABLE `comments` ADD COLUMN `status`        enum('open','resolved','dismissed') NOT NULL DEFAULT 'open' AFTER `anchorSection`;
--> statement-breakpoint
ALTER TABLE `comments` ADD COLUMN `resolvedBy`    int                                              AFTER `status`;
--> statement-breakpoint
ALTER TABLE `comments` ADD COLUMN `resolvedAt`    timestamp                                        AFTER `resolvedBy`;
--> statement-breakpoint
ALTER TABLE `comments` ADD COLUMN `resolvedNote`  text                                             AFTER `resolvedAt`;
--> statement-breakpoint
-- Index for threading (parent → replies)
CREATE INDEX `idx_comments_parent`  ON `comments` (`parentId`);
--> statement-breakpoint
-- Index for status filtering
CREATE INDEX `idx_comments_status`  ON `comments` (`documentId`, `status`);