CREATE TABLE IF NOT EXISTS `domain_workspaces` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `business_domain_id` VARCHAR(20) NOT NULL,
  `business_domain_code` VARCHAR(50) NOT NULL DEFAULT '',
  `workspace_type` VARCHAR(50) NOT NULL DEFAULT 'generico',
  `current_workflow` VARCHAR(50) NOT NULL DEFAULT '',
  `active_copilots` TEXT NULL, `active_documents` TEXT NULL, `active_tasks` TEXT NULL,
  `permissions` TEXT NULL, `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_dws_org` (`organization_id`),
  INDEX `idx_dws_domain` (`business_domain_code`),
  INDEX `idx_dws_org_domain` (`organization_id`, `business_domain_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
