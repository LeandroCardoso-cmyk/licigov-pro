CREATE TABLE `execution_observability` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `correlation_id` VARCHAR(20) NOT NULL,
  `execution_id` VARCHAR(20) NOT NULL,
  `agent_type` VARCHAR(255) NOT NULL,
  `total_stages` INT NOT NULL DEFAULT 0,
  `completed_stages` INT NOT NULL DEFAULT 0,
  `failed_stages` INT NOT NULL DEFAULT 0,
  `approval_required` TINYINT(1) NOT NULL DEFAULT 0,
  `safety_blocked` TINYINT(1) NOT NULL DEFAULT 0,
  `total_ms` INT NOT NULL DEFAULT 0,
  `recorded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_eo_org` (`organization_id`),
  INDEX `idx_eo_corr` (`correlation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
