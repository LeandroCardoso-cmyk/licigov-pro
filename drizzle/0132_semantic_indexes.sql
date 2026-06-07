CREATE TABLE IF NOT EXISTS `semantic_indexes` (
  `id`               VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`  INT          NOT NULL,
  `index_name`       VARCHAR(100) NOT NULL,
  `entity_type`      VARCHAR(50)  NOT NULL,
  `entity_id`        VARCHAR(100) NOT NULL,
  `tokens`           JSON         NULL,
  `token_count`      INT          NOT NULL DEFAULT 0,
  `index_hash`       VARCHAR(64)  NOT NULL,
  `content_preview`  VARCHAR(500) NULL,
  `metadata`         JSON         NULL,
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_si_org`         (`organization_id`),
  INDEX `idx_si_name`        (`organization_id`, `index_name`),
  INDEX `idx_si_entity`      (`organization_id`, `entity_type`, `entity_id`),
  INDEX `idx_si_hash`        (`index_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
