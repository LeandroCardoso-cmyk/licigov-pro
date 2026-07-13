CREATE TABLE IF NOT EXISTS `direct_procurement_procedures` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL, `workspace_id` VARCHAR(20) NOT NULL,
  `procedure_type` VARCHAR(20) NOT NULL DEFAULT 'eletronico', `platform` VARCHAR(30) NULL, `receipt_method` VARCHAR(30) NULL,
  `instructions` TEXT NULL, `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_dpp_org` (`organization_id`), INDEX `idx_dpp_workspace` (`workspace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
