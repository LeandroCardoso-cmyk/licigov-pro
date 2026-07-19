CREATE TABLE IF NOT EXISTS `continuous_operation_metrics` (
  `id`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `organization_id`  INT          NOT NULL,
  `period_days`      SMALLINT     NOT NULL DEFAULT 30,
  `workflow_decay`   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `adoption_decay`   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `fatigue`          TINYINT(1)   NOT NULL DEFAULT 0,
  `support_overload` TINYINT(1)   NOT NULL DEFAULT 0,
  `degraded_metrics` JSON         NULL,
  `severity`         ENUM('none','mild','moderate','severe') NOT NULL DEFAULT 'none',
  `recorded_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_com_org`  (`organization_id`),
  INDEX `idx_com_time` (`organization_id`, `recorded_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `degradation_records` (
  `id`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `organization_id`  INT          NOT NULL,
  `metric_name`      VARCHAR(100) NOT NULL,
  `drop_percent`     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `degraded`         TINYINT(1)   NOT NULL DEFAULT 0,
  `detected_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_dr_org`  (`organization_id`),
  INDEX `idx_dr_time` (`organization_id`, `detected_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;