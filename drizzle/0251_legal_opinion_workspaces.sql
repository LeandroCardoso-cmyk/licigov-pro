CREATE TABLE IF NOT EXISTS `legal_opinion_workspaces` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `request_id` VARCHAR(20) NOT NULL, `source_domain` VARCHAR(50) NOT NULL DEFAULT '',
  `reference_process_id` VARCHAR(64) NOT NULL DEFAULT '', `request_type` VARCHAR(50) NOT NULL DEFAULT '',
  `current_stage` VARCHAR(30) NOT NULL DEFAULT 'INBOX', `status` VARCHAR(30) NOT NULL DEFAULT 'na_caixa',
  `assigned_lawyer` INT NULL, `responsible_sector` VARCHAR(120) NOT NULL DEFAULT '',
  `priority` VARCHAR(20) NOT NULL DEFAULT 'media', `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_low_org` (`organization_id`),
  INDEX `idx_low_request` (`request_id`), INDEX `idx_low_org_stage` (`organization_id`, `current_stage`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
