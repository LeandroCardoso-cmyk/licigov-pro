CREATE TABLE IF NOT EXISTS `contract_justifications` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL, `workspace_id` VARCHAR(20) NOT NULL,
  `need` TEXT NULL, `public_interest` TEXT NULL, `motivation` TEXT NULL, `legal_foundation` TEXT NULL,
  `benefits` TEXT NULL, `alternatives` TEXT NULL, `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_cjs_org` (`organization_id`), INDEX `idx_cjs_workspace` (`workspace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
