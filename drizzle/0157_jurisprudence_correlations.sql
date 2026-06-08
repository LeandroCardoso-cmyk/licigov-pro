CREATE TABLE IF NOT EXISTS `jurisprudence_correlations` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `session_id` VARCHAR(255) NOT NULL,
  `source_id` VARCHAR(255) NOT NULL,
  `reference_id` VARCHAR(20) NOT NULL,
  `citation_type` ENUM('direct','analogical','distinguishing','overruling') NOT NULL DEFAULT 'analogical',
  `relevance_score` DECIMAL(5,4) NOT NULL DEFAULT 0,
  `correlation_score` DECIMAL(5,4) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_jcr_org` (`organization_id`),
  INDEX `idx_jcr_session` (`organization_id`, `session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
