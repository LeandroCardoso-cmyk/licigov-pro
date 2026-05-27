-- Sprint 2: Extend document_templates for multi-tenant, structured content and versioning
ALTER TABLE `document_templates` ADD COLUMN `organizationId`    int  AFTER `userId`;
ALTER TABLE `document_templates` ADD COLUMN `structuredContent` json AFTER `content`;
ALTER TABLE `document_templates` ADD COLUMN `variables`         json AFTER `structuredContent`;
ALTER TABLE `document_templates` ADD COLUMN `version`           int  NOT NULL DEFAULT 1 AFTER `isDefault`;
-- Extend type enum: add all document types
ALTER TABLE `document_templates` MODIFY COLUMN `type` enum('etp','tr','dfd','edital','contrato','ata','parecer','aditivo','minuta') NOT NULL;
-- Index for multi-tenant template lookup
CREATE INDEX `idx_templates_org_type` ON `document_templates` (`organizationId`, `type`);
