-- Sprint 2.8 — Import Staging Items table.
-- Staging-only: raw extracted items waiting for validation + normalization + human review.
-- NEVER persists directly to domain tables (ItemTR, CATMAT, etc.) — Sprint 3 handles normalization.

CREATE TABLE IF NOT EXISTS `import_staging_items` (
  `id`                  INT          NOT NULL AUTO_INCREMENT,
  `importSessionId`     INT          NOT NULL,
  `organizationId`      INT          NOT NULL,
  `rawDescription`      TEXT,
  `rawQuantity`         VARCHAR(100),
  `rawUnit`             VARCHAR(50),
  `rawUnitPrice`        VARCHAR(100),
  `rawTotalPrice`       VARCHAR(100),
  `rawMetadata`         JSON,
  `sourceLocation`      JSON,
  `parserMetadata`      JSON,
  `confidenceMetadata`  JSON,
  `extractionWarnings`  JSON,
  `extractionErrors`    JSON,
  `reviewStatus`        ENUM('pending','approved','rejected','skipped') NOT NULL DEFAULT 'pending',
  `reviewedBy`          INT,
  `reviewedAt`          TIMESTAMP    NULL,
  `reviewNote`          TEXT,
  `expiresAt`           TIMESTAMP    NULL,
  `createdAt`           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_staging_session`    (`importSessionId`),
  INDEX `idx_staging_org`        (`organizationId`),
  INDEX `idx_staging_review`     (`importSessionId`, `reviewStatus`),
  INDEX `idx_staging_expires`    (`expiresAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
