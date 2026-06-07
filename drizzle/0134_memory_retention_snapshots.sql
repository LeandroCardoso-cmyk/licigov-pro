CREATE TABLE IF NOT EXISTS `memory_retention_snapshots` (
  `id`               VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`  INT          NOT NULL,
  `policy_id`        VARCHAR(20)  NOT NULL,
  `snapshot_type`    VARCHAR(50)  NOT NULL,
  `total_memories`   INT          NOT NULL DEFAULT 0,
  `active_count`     INT          NOT NULL DEFAULT 0,
  `expiring_soon_count` INT       NOT NULL DEFAULT 0,
  `expired_count`    INT          NOT NULL DEFAULT 0,
  `archived_count`   INT          NOT NULL DEFAULT 0,
  `avg_confidence`   DECIMAL(4,3) NULL,
  `metrics`          JSON         NULL,
  `lineage`          JSON         NULL,
  `snapshot_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_mrs_org`    (`organization_id`),
  INDEX `idx_mrs_policy` (`organization_id`, `policy_id`),
  INDEX `idx_mrs_type`   (`organization_id`, `snapshot_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
