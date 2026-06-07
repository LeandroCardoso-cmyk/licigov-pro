CREATE TABLE IF NOT EXISTS `context_observability` (
  `id`               VARCHAR(20)   NOT NULL PRIMARY KEY,
  `organization_id`  INT           NOT NULL,
  `session_id`       VARCHAR(100)  NOT NULL,
  `metric_name`      VARCHAR(100)  NOT NULL,
  `value`            DECIMAL(10,4) NOT NULL DEFAULT 0,
  `unit`             VARCHAR(20)   NOT NULL,
  `tags`             JSON          NULL,
  `recorded_at`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_co_org`     (`organization_id`),
  INDEX `idx_co_session` (`organization_id`, `session_id`),
  INDEX `idx_co_metric`  (`organization_id`, `metric_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
