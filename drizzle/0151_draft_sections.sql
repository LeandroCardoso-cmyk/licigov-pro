CREATE TABLE IF NOT EXISTS `draft_sections` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `template_id` VARCHAR(20) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `order_index` INT NOT NULL DEFAULT 0,
  `is_optional` TINYINT(1) NOT NULL DEFAULT 0,
  `legal_basis` VARCHAR(500) NULL,
  `condition_expression` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_ds_org` (`organization_id`),
  INDEX `idx_ds_template` (`template_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
