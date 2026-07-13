CREATE TABLE IF NOT EXISTS `contract_workspaces` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `origin_type` VARCHAR(30) NOT NULL DEFAULT 'externo', `origin_process` VARCHAR(64) NOT NULL DEFAULT '',
  `contract_number` VARCHAR(80) NOT NULL DEFAULT '', `contractor` VARCHAR(255) NOT NULL DEFAULT '',
  `object` TEXT NULL, `value` DECIMAL(15,2) NOT NULL DEFAULT 0, `term` VARCHAR(255) NOT NULL DEFAULT '',
  `status` VARCHAR(30) NOT NULL DEFAULT 'minuta', `manager` VARCHAR(255) NOT NULL DEFAULT '', `inspector` VARCHAR(255) NOT NULL DEFAULT '',
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_ctw_org` (`organization_id`),
  INDEX `idx_ctw_org_origin` (`organization_id`, `origin_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
