CREATE TABLE IF NOT EXISTS `direct_procurement_workspaces` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `process_number` VARCHAR(60) NOT NULL DEFAULT '', `object` TEXT NULL,
  `procurement_type` VARCHAR(30) NOT NULL DEFAULT 'dispensa', `procedure_type` VARCHAR(20) NOT NULL DEFAULT 'indefinido',
  `legal_basis` VARCHAR(255) NOT NULL DEFAULT '', `start_option` VARCHAR(30) NOT NULL DEFAULT 'criar_dfd',
  `current_stage` VARCHAR(30) NOT NULL DEFAULT 'NEW', `status` VARCHAR(30) NOT NULL DEFAULT 'rascunho',
  `responsible_user` INT NOT NULL DEFAULT 0, `participants` TEXT NULL, `active_copilots` TEXT NULL, `flags` TEXT NULL,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_dpw_org` (`organization_id`),
  INDEX `idx_dpw_org_stage` (`organization_id`, `current_stage`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
