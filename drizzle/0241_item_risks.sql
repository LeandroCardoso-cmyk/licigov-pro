CREATE TABLE IF NOT EXISTS `item_risks` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `item_id` VARCHAR(20) NOT NULL, `risk_type` VARCHAR(40) NOT NULL DEFAULT 'inconsistencia',
  `severity` VARCHAR(20) NOT NULL DEFAULT 'medio', `description` TEXT NULL, `explanation` TEXT NULL,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_irk_org` (`organization_id`), INDEX `idx_irk_item` (`item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
