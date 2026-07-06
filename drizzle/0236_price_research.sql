CREATE TABLE IF NOT EXISTS `price_research` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `process_id` VARCHAR(20) NOT NULL, `source` VARCHAR(20) NOT NULL DEFAULT 'manual',
  `item_count` INT NOT NULL DEFAULT 0, `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_pr_org` (`organization_id`), INDEX `idx_pr_process` (`process_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
