CREATE TABLE IF NOT EXISTS `licensed_modules` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `business_domain_code` VARCHAR(50) NOT NULL DEFAULT '',
  `plan` VARCHAR(30) NOT NULL DEFAULT 'trial',
  `active` TINYINT NOT NULL DEFAULT 1,
  `activation_date` VARCHAR(30) NOT NULL DEFAULT '',
  `expiration_date` VARCHAR(30) NULL, `licensed_features` TEXT NULL,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_lm_org` (`organization_id`),
  INDEX `idx_lm_domain` (`business_domain_code`),
  INDEX `idx_lm_org_domain` (`organization_id`, `business_domain_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
