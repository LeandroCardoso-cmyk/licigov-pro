CREATE TABLE IF NOT EXISTS `operational_events` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `event_type` VARCHAR(40) NOT NULL DEFAULT 'manual', `title` VARCHAR(500) NOT NULL DEFAULT '',
  `event_date` VARCHAR(10) NOT NULL DEFAULT '', `event_time` VARCHAR(5) NOT NULL DEFAULT '',
  `reference_type` VARCHAR(40) NOT NULL DEFAULT '', `reference_id` VARCHAR(64) NOT NULL DEFAULT '',
  `auto_generated` INT NOT NULL DEFAULT 0, `alert_offset_days` INT NOT NULL DEFAULT 0,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_opevt_org` (`organization_id`), INDEX `idx_opevt_date` (`organization_id`, `event_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
