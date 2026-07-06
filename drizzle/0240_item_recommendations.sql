CREATE TABLE IF NOT EXISTS `item_recommendations` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `item_id` VARCHAR(20) NOT NULL, `rec_type` VARCHAR(30) NOT NULL DEFAULT 'catmat',
  `summary` TEXT NULL, `reasoning` TEXT NULL, `explainability` TEXT NULL,
  `provenance` VARCHAR(100) NOT NULL DEFAULT 'kernel', `confidence` DECIMAL(5,4) NOT NULL DEFAULT 0.5,
  `accepted` TINYINT NULL, `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_ir_org` (`organization_id`), INDEX `idx_ir_item` (`item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
