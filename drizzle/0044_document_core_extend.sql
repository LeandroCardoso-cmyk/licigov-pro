-- Sprint 2: Extend documents table for structured content, workflow, locking and metadata
ALTER TABLE `documents` ADD COLUMN `title`            varchar(500)                                                              AFTER `processId`;
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `structuredContent` json                                                                     AFTER `content`;
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `currentVersionId`  int                                                                      AFTER `version`;
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `updatedBy`         int                                                                      AFTER `createdBy`;
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `approvedBy`        int                                                                      AFTER `updatedBy`;
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `isLocked`          int        NOT NULL DEFAULT 0                                            AFTER `documentStatus`;
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `lockedBy`          int                                                                      AFTER `isLocked`;
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `lockReason`        varchar(255)                                                             AFTER `lockedBy`;
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `lockExpiresAt`     timestamp                                                                AFTER `lockReason`;
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `metadata`          json                                                                     AFTER `lockExpiresAt`;
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `archivedAt`        timestamp                                                                AFTER `metadata`;
--> statement-breakpoint
-- Extend type enum: add aditivo + minuta
ALTER TABLE `documents` MODIFY COLUMN `type` enum('etp','tr','dfd','edital','contrato','ata','parecer','aditivo','minuta') NOT NULL;
--> statement-breakpoint
-- Extend documentStatus: add archived
ALTER TABLE `documents` MODIFY COLUMN `documentStatus` enum('draft','in_review','approved','rejected','archived') NOT NULL DEFAULT 'draft';
--> statement-breakpoint
-- Index for active documents per org+process (common query)
CREATE INDEX `idx_docs_org_process` ON `documents` (`organizationId`, `processId`);
--> statement-breakpoint
-- Index for status filtering
CREATE INDEX `idx_docs_status`      ON `documents` (`documentStatus`);