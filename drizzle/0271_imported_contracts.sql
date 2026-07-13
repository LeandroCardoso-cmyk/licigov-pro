CREATE TABLE IF NOT EXISTS `imported_contracts` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL, `contract_id` VARCHAR(20) NOT NULL DEFAULT '',
  `source` VARCHAR(10) NOT NULL DEFAULT 'pdf', `raw_text_hash` VARCHAR(64) NOT NULL DEFAULT '', `extracted` TEXT NULL,
  `confidence` DECIMAL(5,2) NOT NULL DEFAULT 0, `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_imp_org` (`organization_id`), INDEX `idx_imp_contract` (`contract_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
