CREATE TABLE `agent_executions` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `session_id` VARCHAR(255) NOT NULL,
  `agent_type` VARCHAR(255) NOT NULL,
  `status` ENUM('pending','running','paused','awaiting_approval','completed','failed','rolled_back','cancelled') NOT NULL DEFAULT 'pending',
  `current_stage` VARCHAR(255) NULL,
  `replay_key` VARCHAR(64) NOT NULL,
  `correlation_id` VARCHAR(20) NOT NULL,
  `request_id` VARCHAR(20) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` DATETIME(3) NULL,
  `rollback_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_ae_org` (`organization_id`),
  INDEX `idx_ae_sess` (`organization_id`, `session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
