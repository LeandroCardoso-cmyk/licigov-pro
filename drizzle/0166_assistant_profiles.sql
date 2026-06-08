CREATE TABLE `assistant_profiles` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `role` VARCHAR(100) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `version` VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `requires_human_review` TINYINT(1) NOT NULL DEFAULT 1,
  `escalation_threshold` DECIMAL(5,4) NOT NULL DEFAULT 0.7000,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_ap_org` (`organization_id`),
  INDEX `idx_ap_role` (`organization_id`, `role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
