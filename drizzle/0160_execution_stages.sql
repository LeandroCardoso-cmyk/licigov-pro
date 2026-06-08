CREATE TABLE `execution_stages` (
  `id` VARCHAR(20) NOT NULL,
  `execution_id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `stage_name` VARCHAR(255) NOT NULL,
  `stage_order` INT NOT NULL DEFAULT 0,
  `status` ENUM('pending','running','completed','failed','skipped') NOT NULL DEFAULT 'pending',
  `input` JSON NULL,
  `output` JSON NULL,
  `duration_ms` INT NULL,
  `error_message` TEXT NULL,
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_es_org` (`organization_id`),
  INDEX `idx_es_exec` (`execution_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
