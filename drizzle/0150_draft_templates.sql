CREATE TABLE IF NOT EXISTS `draft_templates` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `document_type` VARCHAR(100) NOT NULL,
  `version` VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  `legal_framework` VARCHAR(255) NOT NULL DEFAULT 'Lei 14133/2021',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_dt_org` (`organization_id`),
  INDEX `idx_dt_type` (`organization_id`, `document_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
