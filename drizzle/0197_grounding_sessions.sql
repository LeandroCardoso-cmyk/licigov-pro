CREATE TABLE `grounding_sessions` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `query_id` VARCHAR(20) NOT NULL,
  `provider_execution_id` VARCHAR(20) NULL,
  `grounding_version` VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  `evidence_graph` JSON NULL,
  `final_prompt` TEXT NULL,
  `grounding_score` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
  `confidence_score` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
  `replay_snapshot` TEXT NULL,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_gsess_org` (`organization_id`),
  INDEX `idx_gsess_query` (`query_id`),
  INDEX `idx_gsess_corr` (`correlation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
