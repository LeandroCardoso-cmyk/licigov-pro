CREATE TABLE IF NOT EXISTS `institutional_memories` (
  `id`               VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`  INT          NOT NULL,
  `memory_type`      VARCHAR(50)  NOT NULL,
  `content`          TEXT         NULL,
  `source_id`        VARCHAR(100) NULL,
  `source_type`      VARCHAR(50)  NULL,
  `confidence`       DECIMAL(4,3) NOT NULL DEFAULT 0,
  `access_count`     INT          NOT NULL DEFAULT 0,
  `tags`             JSON         NULL,
  `ttl_ms`           BIGINT       NULL,
  `lineage`          JSON         NULL,
  `replay_key`       VARCHAR(64)  NOT NULL,
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_im_org`     (`organization_id`),
  INDEX `idx_im_type`    (`organization_id`, `memory_type`),
  INDEX `idx_im_source`  (`organization_id`, `source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
