-- Sprint 2: Extend comments for threading, resolution and section anchoring
ALTER TABLE `comments` ADD COLUMN `parentId`      int                                              AFTER `id`;
ALTER TABLE `comments` ADD COLUMN `anchorSection` varchar(100)                                     AFTER `parentId`;
ALTER TABLE `comments` ADD COLUMN `status`        enum('open','resolved','dismissed') NOT NULL DEFAULT 'open' AFTER `anchorSection`;
ALTER TABLE `comments` ADD COLUMN `resolvedBy`    int                                              AFTER `status`;
ALTER TABLE `comments` ADD COLUMN `resolvedAt`    timestamp                                        AFTER `resolvedBy`;
ALTER TABLE `comments` ADD COLUMN `resolvedNote`  text                                             AFTER `resolvedAt`;
-- Index for threading (parent → replies)
CREATE INDEX `idx_comments_parent`  ON `comments` (`parentId`);
-- Index for status filtering
CREATE INDEX `idx_comments_status`  ON `comments` (`documentId`, `status`);
