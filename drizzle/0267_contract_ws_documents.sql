CREATE TABLE IF NOT EXISTS `contract_ws_documents` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL, `contract_id` VARCHAR(20) NOT NULL,
  `kind` VARCHAR(30) NOT NULL DEFAULT 'contrato', `title` VARCHAR(500) NOT NULL DEFAULT '', `content` TEXT NULL,
  `ref_id` VARCHAR(64) NOT NULL DEFAULT '', `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_cwd_org` (`organization_id`), INDEX `idx_cwd_contract` (`contract_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
