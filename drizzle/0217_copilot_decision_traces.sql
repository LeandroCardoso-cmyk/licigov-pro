CREATE TABLE IF NOT EXISTS `copilot_decision_traces` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `session_id` VARCHAR(20) NOT NULL,
  `reasoning_id` VARCHAR(20) NOT NULL DEFAULT '',
  `steps` TEXT NULL,
  `replay_snapshot` VARCHAR(64) NOT NULL DEFAULT '',
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_ctr_org` (`organization_id`),
  INDEX `idx_ctr_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
