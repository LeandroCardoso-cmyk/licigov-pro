CREATE TABLE IF NOT EXISTS `service_health_snapshots` (
  `id`                VARCHAR(64)      NOT NULL,
  `organization_id`   INT              NOT NULL,
  `overall_sla_score` TINYINT UNSIGNED NOT NULL DEFAULT 100,
  `breaching_metrics` JSON             NULL,
  `warning_metrics`   JSON             NULL,
  `snapshot_at`       DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at`        DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_shs_org`  (`organization_id`),
  INDEX `idx_shs_time` (`organization_id`, `snapshot_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sla_metrics` (
  `id`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `snapshot_id`      VARCHAR(64)   NOT NULL,
  `organization_id`  INT           NOT NULL,
  `metric_name`      VARCHAR(100)  NOT NULL,
  `current_value`    DOUBLE        NOT NULL,
  `target_value`     DOUBLE        NOT NULL,
  `unit`             VARCHAR(50)   NOT NULL,
  `sla_status`       ENUM('meeting','warning','breaching') NOT NULL DEFAULT 'meeting',
  `trend_direction`  ENUM('up','down','stable') NOT NULL DEFAULT 'stable',
  `recorded_at`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_sm_snapshot` (`snapshot_id`),
  INDEX `idx_sm_org`      (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
