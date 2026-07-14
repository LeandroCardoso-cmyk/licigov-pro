CREATE TABLE IF NOT EXISTS `publication_records` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `reference_type` VARCHAR(40) NOT NULL DEFAULT '', `reference_id` VARCHAR(64) NOT NULL DEFAULT '',
  `channel` VARCHAR(30) NOT NULL DEFAULT 'pncp', `status` VARCHAR(20) NOT NULL DEFAULT 'nao_iniciado', `date` VARCHAR(10) NOT NULL DEFAULT '',
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_oppub_org` (`organization_id`), INDEX `idx_oppub_ref` (`reference_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
