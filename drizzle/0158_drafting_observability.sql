CREATE TABLE IF NOT EXISTS `drafting_observability` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `session_id` VARCHAR(255) NOT NULL,
  `correlation_id` VARCHAR(20) NOT NULL,
  `draft_id` VARCHAR(20) NOT NULL,
  `document_type` VARCHAR(100) NOT NULL,
  `total_ms` INT NOT NULL DEFAULT 0,
  `completeness_score` DECIMAL(5,4) NOT NULL DEFAULT 0,
  `risk_score` DECIMAL(5,4) NOT NULL DEFAULT 0,
  `compliance_score` DECIMAL(5,4) NOT NULL DEFAULT 0,
  `variable_count` INT NOT NULL DEFAULT 0,
  `missing_variables` INT NOT NULL DEFAULT 0,
  `recorded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_do_org` (`organization_id`),
  INDEX `idx_do_session` (`organization_id`, `session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
