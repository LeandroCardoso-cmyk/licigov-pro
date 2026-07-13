CREATE TABLE IF NOT EXISTS `contract_templates` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL, `name` VARCHAR(255) NOT NULL DEFAULT '',
  `kind` VARCHAR(30) NOT NULL DEFAULT 'contrato', `body` TEXT NULL, `active` INT NOT NULL DEFAULT 1,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_ctpl_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
