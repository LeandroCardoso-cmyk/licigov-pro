CREATE TABLE IF NOT EXISTS `intelligent_items` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `process_id` VARCHAR(20) NOT NULL, `source_research_id` VARCHAR(20) NOT NULL DEFAULT '',
  `description` TEXT NULL, `quantity` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `unit` VARCHAR(30) NOT NULL DEFAULT 'un', `average_price` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `suppliers` TEXT NULL, `suggested_catmat` VARCHAR(50) NULL, `alternative_catmat` TEXT NULL,
  `specifications` TEXT NULL, `risks` TEXT NULL, `recommendations` TEXT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pendente', `approved_by` INT NULL,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_ii_org` (`organization_id`),
  INDEX `idx_ii_process` (`process_id`), INDEX `idx_ii_status` (`status`),
  INDEX `idx_ii_org_process` (`organization_id`, `process_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
