CREATE TABLE `retrieval_sessions` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `query_text` TEXT NULL,
  `normalized_query` TEXT NULL,
  `retrieval_strategy` ENUM('vector_similarity','bm25_hybrid','weighted_retrieval','contextual_expansion') NOT NULL DEFAULT 'vector_similarity',
  `reranking_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `embedding_version` VARCHAR(20) NOT NULL DEFAULT 'v1',
  `retrieved_chunks` JSON NULL,
  `retrieval_trace` JSON NULL,
  `explainability_data` JSON NULL,
  `latency_ms` INT NOT NULL DEFAULT 0,
  `correlation_id` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_rses_org` (`organization_id`),
  INDEX `idx_rses_corr` (`correlation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
