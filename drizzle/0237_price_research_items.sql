CREATE TABLE IF NOT EXISTS `price_research_items` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `research_id` VARCHAR(20) NOT NULL, `process_id` VARCHAR(20) NOT NULL,
  `description` TEXT NULL, `quantity` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `unit` VARCHAR(30) NOT NULL DEFAULT 'un', `supplier` VARCHAR(255) NOT NULL DEFAULT '',
  `brand` VARCHAR(255) NOT NULL DEFAULT '', `model` VARCHAR(255) NOT NULL DEFAULT '',
  `value` DECIMAL(14,2) NOT NULL DEFAULT 0, `observations` TEXT NULL,
  `source` VARCHAR(50) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_pri_org` (`organization_id`),
  INDEX `idx_pri_research` (`research_id`), INDEX `idx_pri_process` (`process_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
