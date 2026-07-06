CREATE TABLE IF NOT EXISTS `organization_features` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `feature_key` VARCHAR(100) NOT NULL DEFAULT '',
  `enabled` TINYINT NOT NULL DEFAULT 0,
  `source` VARCHAR(50) NOT NULL DEFAULT 'license',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_of_org` (`organization_id`),
  INDEX `idx_of_org_key` (`organization_id`, `feature_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
