CREATE TABLE IF NOT EXISTS `draft_generations` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `session_id` VARCHAR(255) NOT NULL,
  `template_id` VARCHAR(20) NOT NULL,
  `resolved_content` MEDIUMTEXT NULL,
  `generation_score` DECIMAL(5,4) NOT NULL DEFAULT 0,
  `replay_key` VARCHAR(64) NOT NULL,
  `generated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_dg_org` (`organization_id`),
  INDEX `idx_dg_session` (`organization_id`, `session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
