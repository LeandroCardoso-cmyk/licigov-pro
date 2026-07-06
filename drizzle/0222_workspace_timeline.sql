CREATE TABLE IF NOT EXISTS `workspace_timeline` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `workspace_id` VARCHAR(20) NOT NULL,
  `event_order` INT NOT NULL DEFAULT 0,
  `event_type` VARCHAR(40) NOT NULL DEFAULT 'change',
  `actor` VARCHAR(100) NOT NULL DEFAULT 'system',
  `summary` TEXT NULL,
  `ref_id` VARCHAR(40) NOT NULL DEFAULT '',
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_wtl_org` (`organization_id`),
  INDEX `idx_wtl_workspace` (`workspace_id`),
  INDEX `idx_wtl_org_workspace` (`organization_id`, `workspace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
