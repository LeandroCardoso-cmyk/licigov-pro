-- Sprint 2: Autosave drafts — one per user per document
CREATE TABLE `document_drafts` (
  `id`               int          AUTO_INCREMENT NOT NULL,
  `organizationId`   int          NOT NULL,
  `documentId`       int          NOT NULL,
  `userId`           int          NOT NULL,
  `contentDraft`     text,
  `structuredDraft`  json,
  `baseVersionId`    int,
  `version`          int          NOT NULL DEFAULT 1,
  `lastSavedAt`      timestamp    NOT NULL DEFAULT (now()),
  `expiresAt`        timestamp    NOT NULL,
  `correlationId`    varchar(36),
  `createdAt`        timestamp    NOT NULL DEFAULT (now()),
  `updatedAt`        timestamp    NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `document_drafts_id`    PRIMARY KEY(`id`),
  CONSTRAINT `uniq_doc_user_draft`   UNIQUE (`documentId`, `userId`)
);
--> statement-breakpoint
CREATE INDEX `idx_drafts_expires` ON `document_drafts` (`expiresAt`);
--> statement-breakpoint
CREATE INDEX `idx_drafts_org`     ON `document_drafts` (`organizationId`);
