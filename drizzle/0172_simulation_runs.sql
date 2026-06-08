CREATE TABLE `simulation_runs` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `session_id` VARCHAR(255) NOT NULL,
  `simulation_type` ENUM('dry_run','full_preview','rollback_preview','impact_estimation') NOT NULL DEFAULT 'dry_run',
  `overall_risk` ENUM('safe','low_risk','medium_risk','high_risk','critical','blocked') NOT NULL DEFAULT 'safe',
  `task_count` INT NOT NULL DEFAULT 0,
  `impact_summary` TEXT NULL,
  `rollback_summary` TEXT NULL,
  `replay_key` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_sr_org` (`organization_id`),
  INDEX `idx_sr_sess` (`organization_id`, `session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
