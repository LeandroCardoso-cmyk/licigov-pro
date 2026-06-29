CREATE TABLE `confidence_scores` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `query_id` VARCHAR(20) NOT NULL,
  `retrieval_score` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
  `evidence_score` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
  `legal_score` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
  `grounding_score` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
  `response_score` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
  `consolidated_score` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
  `weights` JSON NULL,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_cs_org` (`organization_id`),
  INDEX `idx_cs_query` (`query_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
