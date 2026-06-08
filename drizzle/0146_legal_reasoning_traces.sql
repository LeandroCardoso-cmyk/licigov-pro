CREATE TABLE IF NOT EXISTS `legal_reasoning_traces` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `session_id` VARCHAR(255) NOT NULL,
  `overall_compliance_score` DECIMAL(5,4) NOT NULL DEFAULT 0,
  `overall_risk_score` DECIMAL(5,4) NOT NULL DEFAULT 0,
  `replay_key` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_lrt_org` (`organization_id`),
  INDEX `idx_lrt_session` (`organization_id`, `session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
