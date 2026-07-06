CREATE TABLE IF NOT EXISTS `item_history` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `process_id` VARCHAR(20) NOT NULL, `item_id` VARCHAR(20) NOT NULL DEFAULT '',
  `object` TEXT NULL, `year` INT NOT NULL DEFAULT 0,
  `winning_supplier` VARCHAR(255) NOT NULL DEFAULT '', `homologated_price` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `catmat_used` VARCHAR(50) NOT NULL DEFAULT '', `outcome` VARCHAR(30) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_ih_org` (`organization_id`), INDEX `idx_ih_process` (`process_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
