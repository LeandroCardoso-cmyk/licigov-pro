CREATE TABLE IF NOT EXISTS `copilot_metrics` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `copilot_type` VARCHAR(50) NOT NULL DEFAULT 'agente_contratacao',
  `metric_name` VARCHAR(100) NOT NULL DEFAULT '',
  `metric_value` DECIMAL(10,4) NOT NULL DEFAULT 0,
  `metric_unit` VARCHAR(50) NOT NULL DEFAULT 'count',
  `tags` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_cmet_org` (`organization_id`),
  INDEX `idx_cmet_type` (`copilot_type`),
  INDEX `idx_cmet_name` (`metric_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
