CREATE TABLE `assistant_capabilities` (
  `id` VARCHAR(20) NOT NULL,
  `profile_id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `capability_type` VARCHAR(100) NOT NULL,
  `description` TEXT NULL,
  `confidence_threshold` DECIMAL(5,4) NOT NULL DEFAULT 0.7000,
  `max_input_length` INT NOT NULL DEFAULT 10000,
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_ac_org` (`organization_id`),
  INDEX `idx_ac_profile` (`profile_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
