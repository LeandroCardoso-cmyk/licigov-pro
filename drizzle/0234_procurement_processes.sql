CREATE TABLE IF NOT EXISTS `procurement_processes` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `process_number` VARCHAR(64) NOT NULL DEFAULT '', `object` TEXT NULL,
  `modality` VARCHAR(50) NOT NULL DEFAULT '',
  `current_stage` VARCHAR(30) NOT NULL DEFAULT 'NEW_PROCESS',
  `status` VARCHAR(30) NOT NULL DEFAULT 'rascunho',
  `start_option` VARCHAR(30) NOT NULL DEFAULT 'criar_dfd',
  `responsible_user` INT NOT NULL DEFAULT 0, `participants` TEXT NULL, `active_copilots` TEXT NULL,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_pp_org` (`organization_id`),
  INDEX `idx_pp_number` (`process_number`), INDEX `idx_pp_stage` (`current_stage`),
  INDEX `idx_pp_org_status` (`organization_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
