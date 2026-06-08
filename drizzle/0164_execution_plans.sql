CREATE TABLE `execution_plans` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `session_id` VARCHAR(255) NOT NULL,
  `plan_name` VARCHAR(255) NOT NULL,
  `goal_description` TEXT NULL,
  `estimated_duration_ms` INT NOT NULL DEFAULT 0,
  `replay_key` VARCHAR(64) NOT NULL,
  `plan_version` VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  `status` ENUM('draft','ready','executing','completed','failed') NOT NULL DEFAULT 'draft',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_ep_org` (`organization_id`),
  INDEX `idx_ep_sess` (`organization_id`, `session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
