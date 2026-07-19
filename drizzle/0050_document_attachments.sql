-- Sprint 2.5: Document Attachments
-- Camada de anexos tenant-safe com integridade (SHA-256) e scan readiness.

CREATE TABLE `document_attachments` (
  `id`               int AUTO_INCREMENT PRIMARY KEY,
  `organizationId`   int NOT NULL,
  `documentId`       int NOT NULL,
  `versionId`        int,
  `filename`         varchar(255) NOT NULL,
  `originalFilename` varchar(255) NOT NULL,
  `mimeType`         varchar(100) NOT NULL,
  `fileSize`         int NOT NULL,
  `storageKey`       varchar(500) NOT NULL,
  `contentHash`      varchar(64),
  `scanStatus`       enum('pending','clean','infected','error') NOT NULL DEFAULT 'pending',
  `uploadedBy`       int NOT NULL,
  `deletedAt`        timestamp NULL,
  `createdAt`        timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_doc` ON `document_attachments` (`documentId`, `organizationId`);
--> statement-breakpoint
CREATE INDEX `idx_attachments_org` ON `document_attachments` (`organizationId`);