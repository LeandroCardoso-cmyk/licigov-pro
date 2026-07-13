CREATE TABLE IF NOT EXISTS `price_justifications` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL, `workspace_id` VARCHAR(20) NOT NULL,
  `source` VARCHAR(20) NOT NULL DEFAULT 'pesquisa', `justification` TEXT NULL,
  `reference_value` DECIMAL(15,2) NOT NULL DEFAULT 0, `research_id` VARCHAR(20) NOT NULL DEFAULT '',
  `document_references` TEXT NULL, `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_pjs_org` (`organization_id`), INDEX `idx_pjs_workspace` (`workspace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
