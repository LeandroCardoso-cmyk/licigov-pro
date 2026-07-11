CREATE TABLE IF NOT EXISTS `legal_opinion_history` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `workspace_id` VARCHAR(20) NOT NULL, `event_order` INT NOT NULL DEFAULT 0,
  `event_type` VARCHAR(50) NOT NULL DEFAULT '', `actor` VARCHAR(60) NOT NULL DEFAULT '',
  `summary` TEXT NULL, `ref_id` VARCHAR(64) NOT NULL DEFAULT '', `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_loh_org` (`organization_id`),
  INDEX `idx_loh_workspace` (`workspace_id`), INDEX `idx_loh_ws_order` (`workspace_id`, `event_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
