CREATE TABLE IF NOT EXISTS `grounding_evidence` (
  `id`               VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`  INT          NOT NULL,
  `source_ref`       VARCHAR(255) NOT NULL,
  `content`          LONGTEXT     NOT NULL,
  `relevance_score`  DECIMAL(4,3) NOT NULL DEFAULT 0.500,
  `evidence_type`    ENUM('document','regulation','precedent','knowledge_base','user_input') NOT NULL DEFAULT 'document',
  `legal_basis`      TEXT         NULL,
  `citation_key`     VARCHAR(100) NOT NULL,
  `verified`         TINYINT(1)   NOT NULL DEFAULT 0,
  `verified_at`      DATETIME(3)  NULL,
  `metadata`         JSON         NULL,
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_ge_org`        (`organization_id`),
  INDEX `idx_ge_type`       (`organization_id`, `evidence_type`),
  INDEX `idx_ge_citation`   (`citation_key`),
  INDEX `idx_ge_verified`   (`organization_id`, `verified`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
