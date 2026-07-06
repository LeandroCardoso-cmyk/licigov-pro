CREATE TABLE IF NOT EXISTS `module_feature_flags` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `business_domain_code` VARCHAR(50) NULL,
  `feature_key` VARCHAR(100) NOT NULL DEFAULT '',
  `enabled` TINYINT NOT NULL DEFAULT 0,
  `rollout_strategy` VARCHAR(20) NOT NULL DEFAULT 'off',
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_mff_org` (`organization_id`),
  INDEX `idx_mff_key` (`feature_key`),
  INDEX `idx_mff_org_key` (`organization_id`, `feature_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
