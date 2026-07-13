CREATE TABLE IF NOT EXISTS `contract_occurrences` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL, `contract_id` VARCHAR(20) NOT NULL,
  `description` TEXT NULL, `occurred_on` VARCHAR(40) NOT NULL DEFAULT '', `attachments` TEXT NULL, `notes` TEXT NULL,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_cocc_org` (`organization_id`), INDEX `idx_cocc_contract` (`contract_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
