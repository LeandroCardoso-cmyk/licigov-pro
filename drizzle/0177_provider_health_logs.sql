CREATE TABLE `provider_health_logs` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `provider_id` VARCHAR(20) NOT NULL,
  `health_status` ENUM('healthy','degraded','unavailable','unknown') NOT NULL,
  `latency_ms` INT NOT NULL DEFAULT 0,
  `error_message` TEXT NULL,
  `checked_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_phl_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
