CREATE TABLE `provider_usage_quotas` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `daily_limit` DECIMAL(10,4) NOT NULL DEFAULT 100.0,
  `monthly_limit` DECIMAL(10,4) NOT NULL DEFAULT 2000.0,
  `alert_threshold` DECIMAL(5,4) NOT NULL DEFAULT 0.8,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_puq_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
