CREATE TABLE IF NOT EXISTS `process_stages` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `process_id` VARCHAR(20) NOT NULL, `stage` VARCHAR(30) NOT NULL DEFAULT 'NEW_PROCESS',
  `state` VARCHAR(30) NOT NULL DEFAULT '', `entered_at` VARCHAR(30) NOT NULL DEFAULT '',
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_ps_org` (`organization_id`), INDEX `idx_ps_process` (`process_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
