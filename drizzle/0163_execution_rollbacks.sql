CREATE TABLE `execution_rollbacks` (
  `id` VARCHAR(20) NOT NULL,
  `execution_id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `reason` TEXT NULL,
  `initiated_by` VARCHAR(255) NOT NULL,
  `checkpoint_id` VARCHAR(20) NULL,
  `status` ENUM('pending','executing','completed','failed') NOT NULL DEFAULT 'pending',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_erb_org` (`organization_id`),
  INDEX `idx_erb_exec` (`execution_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
