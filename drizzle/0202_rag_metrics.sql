CREATE TABLE `rag_metrics` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `operation` VARCHAR(100) NOT NULL DEFAULT '',
  `retrieval_ms` INT NOT NULL DEFAULT 0,
  `grounding_ms` INT NOT NULL DEFAULT 0,
  `inference_ms` INT NOT NULL DEFAULT 0,
  `total_ms` INT NOT NULL DEFAULT 0,
  `chunk_count` INT NOT NULL DEFAULT 0,
  `evidence_count` INT NOT NULL DEFAULT 0,
  `token_count` INT NOT NULL DEFAULT 0,
  `confidence_score` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
  `hallucination_risk` VARCHAR(50) NOT NULL DEFAULT 'none',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_rm_org` (`organization_id`),
  INDEX `idx_rm_corr` (`correlation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
