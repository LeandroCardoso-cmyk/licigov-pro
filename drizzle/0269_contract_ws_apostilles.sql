CREATE TABLE IF NOT EXISTS `contract_ws_apostilles` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL, `contract_id` VARCHAR(20) NOT NULL,
  `kind` VARCHAR(20) NOT NULL DEFAULT 'reajuste', `sequence` INT NOT NULL DEFAULT 1, `description` TEXT NULL,
  `new_value` DECIMAL(15,2) NOT NULL DEFAULT 0, `new_manager` VARCHAR(255) NOT NULL DEFAULT '', `new_inspector` VARCHAR(255) NOT NULL DEFAULT '',
  `document_reference` VARCHAR(500) NOT NULL DEFAULT '', `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_cap_org` (`organization_id`), INDEX `idx_cap_contract` (`contract_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
