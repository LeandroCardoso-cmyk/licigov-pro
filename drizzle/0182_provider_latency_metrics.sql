CREATE TABLE `provider_latency_metrics` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `provider_id` VARCHAR(20) NOT NULL,
  `model` VARCHAR(255) NOT NULL,
  `latency_ms` INT NOT NULL DEFAULT 0,
  `correlation_id` VARCHAR(64) NOT NULL,
  `recorded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_plm_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
