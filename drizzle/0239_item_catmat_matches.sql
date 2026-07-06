CREATE TABLE IF NOT EXISTS `item_catmat_matches` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `item_id` VARCHAR(20) NOT NULL, `catmat_code` VARCHAR(50) NOT NULL DEFAULT '',
  `catmat_description` TEXT NULL, `score` DECIMAL(5,4) NOT NULL DEFAULT 0,
  `match_rank` INT NOT NULL DEFAULT 0, `decision` VARCHAR(20) NOT NULL DEFAULT 'sugerido',
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_icm_org` (`organization_id`), INDEX `idx_icm_item` (`item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
