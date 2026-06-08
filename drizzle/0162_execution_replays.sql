CREATE TABLE `execution_replays` (
  `id` VARCHAR(20) NOT NULL,
  `original_execution_id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `reason` TEXT NULL,
  `replay_key` VARCHAR(64) NOT NULL,
  `status` ENUM('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_er_org` (`organization_id`),
  INDEX `idx_er_orig` (`original_execution_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
