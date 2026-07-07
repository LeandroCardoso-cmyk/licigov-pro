CREATE TABLE IF NOT EXISTS `request_timelines` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `request_id` VARCHAR(20) NOT NULL, `event_order` INT NOT NULL DEFAULT 0,
  `event_type` VARCHAR(40) NOT NULL DEFAULT 'created', `actor` VARCHAR(100) NOT NULL DEFAULT 'system',
  `summary` TEXT NULL, `ref_id` VARCHAR(40) NOT NULL DEFAULT '', `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_rtl_org` (`organization_id`),
  INDEX `idx_rtl_request` (`request_id`), INDEX `idx_rtl_org_request` (`organization_id`, `request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
