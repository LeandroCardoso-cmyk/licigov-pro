CREATE TABLE `execution_checkpoints` (
  `id` VARCHAR(20) NOT NULL,
  `execution_id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `checkpoint_name` VARCHAR(255) NOT NULL,
  `snapshot_data` JSON NULL,
  `is_rollback_point` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_ec_org` (`organization_id`),
  INDEX `idx_ec_exec` (`execution_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
