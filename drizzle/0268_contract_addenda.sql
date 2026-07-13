CREATE TABLE IF NOT EXISTS `contract_addenda` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL, `contract_id` VARCHAR(20) NOT NULL,
  `addendum_type` VARCHAR(20) NOT NULL DEFAULT 'prazo', `sequence` INT NOT NULL DEFAULT 1, `justification` TEXT NULL,
  `new_value` DECIMAL(15,2) NOT NULL DEFAULT 0, `new_term` VARCHAR(255) NOT NULL DEFAULT '',
  `status` VARCHAR(30) NOT NULL DEFAULT 'solicitado', `document_reference` VARCHAR(500) NOT NULL DEFAULT '',
  `legal_opinion_request_id` VARCHAR(20) NOT NULL DEFAULT '', `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_cad_org` (`organization_id`), INDEX `idx_cad_contract` (`contract_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
