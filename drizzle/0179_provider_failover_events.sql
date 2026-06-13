CREATE TABLE `provider_failover_events` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `failed_provider_id` VARCHAR(20) NOT NULL,
  `new_provider_id` VARCHAR(20) NULL,
  `reason` TEXT NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_pfe_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
