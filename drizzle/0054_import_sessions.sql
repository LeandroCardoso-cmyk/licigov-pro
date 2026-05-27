-- Sprint 2.8 — Import Sessions table.
-- Lifecycle: uploaded → queued → parsing → extracted → normalized → awaiting_review → approved/rejected
-- Idempotent: IF NOT EXISTS pattern.

CREATE TABLE IF NOT EXISTS `import_sessions` (
  `id`                  INT          NOT NULL AUTO_INCREMENT,
  `organizationId`      INT          NOT NULL,
  `uploadedBy`          INT          NOT NULL,
  `sourceFileId`        VARCHAR(255) NOT NULL,
  `sourceFileName`      VARCHAR(255) NOT NULL,
  `sourceMimeType`      VARCHAR(100) NOT NULL,
  `sourceSize`          INT          NOT NULL DEFAULT 0,
  `importType`          VARCHAR(50)  NOT NULL DEFAULT 'generic',
  `parserType`          VARCHAR(20)  NOT NULL DEFAULT 'auto',
  `parserVersion`       VARCHAR(20)  NOT NULL DEFAULT '1.0.0',
  `status`              ENUM(
    'uploaded','queued','parsing','extracted',
    'normalized','awaiting_review','approved','rejected',
    'failed','archived'
  ) NOT NULL DEFAULT 'uploaded',
  `progress`            INT          NOT NULL DEFAULT 0,
  `stage`               VARCHAR(100),
  `confidenceScore`     DECIMAL(5,4),
  `extractionSummary`   JSON,
  `warnings`            JSON,
  `errors`              JSON,
  `correlationId`       VARCHAR(36),
  `retryCount`          INT          NOT NULL DEFAULT 0,
  `startedAt`           TIMESTAMP    NULL,
  `finishedAt`          TIMESTAMP    NULL,
  `failedAt`            TIMESTAMP    NULL,
  `createdAt`           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_import_sessions_org`    (`organizationId`),
  INDEX `idx_import_sessions_status` (`organizationId`, `status`),
  INDEX `idx_import_sessions_file`   (`organizationId`, `sourceFileId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
