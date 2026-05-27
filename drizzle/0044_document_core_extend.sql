-- Sprint 2: Extend documents table for structured content, workflow, locking and metadata
ALTER TABLE `documents` ADD COLUMN `title`            varchar(500)                                                              AFTER `processId`;
ALTER TABLE `documents` ADD COLUMN `structuredContent` json                                                                     AFTER `content`;
ALTER TABLE `documents` ADD COLUMN `currentVersionId`  int                                                                      AFTER `version`;
ALTER TABLE `documents` ADD COLUMN `updatedBy`         int                                                                      AFTER `createdBy`;
ALTER TABLE `documents` ADD COLUMN `approvedBy`        int                                                                      AFTER `updatedBy`;
ALTER TABLE `documents` ADD COLUMN `isLocked`          int        NOT NULL DEFAULT 0                                            AFTER `documentStatus`;
ALTER TABLE `documents` ADD COLUMN `lockedBy`          int                                                                      AFTER `isLocked`;
ALTER TABLE `documents` ADD COLUMN `lockReason`        varchar(255)                                                             AFTER `lockedBy`;
ALTER TABLE `documents` ADD COLUMN `lockExpiresAt`     timestamp                                                                AFTER `lockReason`;
ALTER TABLE `documents` ADD COLUMN `metadata`          json                                                                     AFTER `lockExpiresAt`;
ALTER TABLE `documents` ADD COLUMN `archivedAt`        timestamp                                                                AFTER `metadata`;
-- Extend type enum: add aditivo + minuta
ALTER TABLE `documents` MODIFY COLUMN `type` enum('etp','tr','dfd','edital','contrato','ata','parecer','aditivo','minuta') NOT NULL;
-- Extend documentStatus: add archived
ALTER TABLE `documents` MODIFY COLUMN `documentStatus` enum('draft','in_review','approved','rejected','archived') NOT NULL DEFAULT 'draft';
-- Index for active documents per org+process (common query)
CREATE INDEX `idx_docs_org_process` ON `documents` (`organizationId`, `processId`);
-- Index for status filtering
CREATE INDEX `idx_docs_status`      ON `documents` (`documentStatus`);
