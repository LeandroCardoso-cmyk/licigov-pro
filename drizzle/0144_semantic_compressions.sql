CREATE TABLE IF NOT EXISTS `semantic_compressions` (
  `id`                    VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`       INT          NOT NULL,
  `session_id`            VARCHAR(100) NOT NULL,
  `original_tokens`       INT          NOT NULL DEFAULT 0,
  `compressed_tokens`     INT          NOT NULL DEFAULT 0,
  `compression_ratio`     DECIMAL(4,3) NOT NULL DEFAULT 1,
  `deduplicated_count`    INT          NOT NULL DEFAULT 0,
  `overlap_removed_count` INT          NOT NULL DEFAULT 0,
  `replay_key`            VARCHAR(64)  NOT NULL,
  `created_at`            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_sc2_org`     (`organization_id`),
  INDEX `idx_sc2_session` (`organization_id`, `session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
