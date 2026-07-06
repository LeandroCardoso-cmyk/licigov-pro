CREATE TABLE IF NOT EXISTS `domain_navigation` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `business_domain_code` VARCHAR(50) NOT NULL DEFAULT '',
  `visible` TINYINT NOT NULL DEFAULT 1, `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_dnav_org` (`organization_id`),
  INDEX `idx_dnav_org_visible` (`organization_id`, `visible`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
