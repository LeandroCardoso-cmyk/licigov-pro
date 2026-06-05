CREATE TABLE IF NOT EXISTS `operational_stability_metrics` (
  `id`               VARCHAR(64)   NOT NULL,
  `organization_id`  INT           NOT NULL,
  `metric_type`      ENUM('workflow_throughput','queue_depth','review_latency','approval_rate','error_rate','deployment_health','tenant_load') NOT NULL,
  `value`            DOUBLE        NOT NULL,
  `unit`             ENUM('ms','count','percent','ratio') NOT NULL DEFAULT 'count',
  `threshold`        DOUBLE        NOT NULL,
  `is_anomalous`     TINYINT(1)    NOT NULL DEFAULT 0,
  `recorded_at`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_osm_org`  (`organization_id`),
  INDEX `idx_osm_type` (`organization_id`, `metric_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `stability_snapshots` (
  `id`                VARCHAR(64)   NOT NULL,
  `organization_id`   INT           NOT NULL,
  `overall_score`     TINYINT UNSIGNED NOT NULL DEFAULT 100,
  `degradation_level` ENUM('none','mild','moderate','severe','critical') NOT NULL DEFAULT 'none',
  `trend`             ENUM('improving','stable','degrading') NOT NULL DEFAULT 'stable',
  `active_anomalies`  JSON          NULL,
  `snapshot_at`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_ss_org`  (`organization_id`),
  INDEX `idx_ss_time` (`organization_id`, `snapshot_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
