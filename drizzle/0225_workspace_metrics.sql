CREATE TABLE IF NOT EXISTS `workspace_metrics` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `workspace_id` VARCHAR(20) NOT NULL,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `metric_name` VARCHAR(100) NOT NULL DEFAULT '',
  `metric_value` DECIMAL(10,4) NOT NULL DEFAULT 0,
  `metric_unit` VARCHAR(50) NOT NULL DEFAULT 'count',
  `tags` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_wm_org` (`organization_id`),
  INDEX `idx_wm_workspace` (`workspace_id`),
  INDEX `idx_wm_name` (`metric_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
