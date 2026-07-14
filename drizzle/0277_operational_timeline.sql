CREATE TABLE IF NOT EXISTS `operational_timeline` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL, `event_order` INT NOT NULL DEFAULT 0,
  `actor` VARCHAR(60) NOT NULL DEFAULT '', `action` VARCHAR(60) NOT NULL DEFAULT '',
  `reference_type` VARCHAR(40) NOT NULL DEFAULT '', `reference_id` VARCHAR(64) NOT NULL DEFAULT '',
  `summary` TEXT NULL, `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_optl_org` (`organization_id`), INDEX `idx_optl_org_order` (`organization_id`, `event_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
