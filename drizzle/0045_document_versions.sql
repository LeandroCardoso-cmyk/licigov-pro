-- Sprint 2: Immutable document version snapshots
CREATE TABLE `document_versions` (
  `id`               int          AUTO_INCREMENT NOT NULL,
  `organizationId`   int          NOT NULL,
  `documentId`       int          NOT NULL,
  `versionNumber`    int          NOT NULL,
  `contentSnapshot`  text,
  `structuredSnapshot` json,
  `diffMetadata`     json,
  `changeReason`     varchar(500),
  `sourceContext`    enum('manual','autosave_publish','ai','import','restore','workflow') NOT NULL DEFAULT 'manual',
  `actorSnapshot`    json         NOT NULL,
  `workflowSnapshot` json,
  `correlationId`    varchar(36),
  `requestId`        varchar(36),
  `createdBy`        int          NOT NULL,
  `createdAt`        timestamp    NOT NULL DEFAULT (now()),
  CONSTRAINT `document_versions_id` PRIMARY KEY(`id`),
  CONSTRAINT `uniq_doc_version`     UNIQUE (`documentId`, `versionNumber`)
);
--> statement-breakpoint
CREATE INDEX `idx_doc_versions_doc` ON `document_versions` (`documentId`);
--> statement-breakpoint
CREATE INDEX `idx_doc_versions_org` ON `document_versions` (`organizationId`);
