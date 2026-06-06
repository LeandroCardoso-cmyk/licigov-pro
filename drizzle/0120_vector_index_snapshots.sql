CREATE TABLE IF NOT EXISTS `vector_index_snapshots` (
  `id`               VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`  INT          NOT NULL,
  `index_name`       VARCHAR(100) NOT NULL,
  `dimensions`       SMALLINT     NOT NULL DEFAULT 1536,
  `entry_count`      INT UNSIGNED NOT NULL DEFAULT 0,
  `metadata`         JSON         NULL,
  `updated_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_vis_org`   (`organization_id`),
  INDEX `idx_vis_name`  (`organization_id`, `index_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
