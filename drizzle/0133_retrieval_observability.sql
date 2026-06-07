CREATE TABLE IF NOT EXISTS `retrieval_observability` (
  `id`               VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`  INT          NOT NULL,
  `correlation_id`   VARCHAR(20)  NOT NULL,
  `operation`        VARCHAR(100) NOT NULL,
  `duration_ms`      INT          NOT NULL DEFAULT 0,
  `result_count`     INT          NOT NULL DEFAULT 0,
  `avg_score`        DECIMAL(6,5) NULL,
  `p95_latency_ms`   INT          NULL,
  `stage_breakdown`  JSON         NULL,
  `tags`             JSON         NULL,
  `alert_fired`      TINYINT(1)   NOT NULL DEFAULT 0,
  `alert_type`       VARCHAR(50)  NULL,
  `recorded_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_ro_org`         (`organization_id`),
  INDEX `idx_ro_correlation` (`organization_id`, `correlation_id`),
  INDEX `idx_ro_operation`   (`organization_id`, `operation`),
  INDEX `idx_ro_alert`       (`organization_id`, `alert_fired`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
