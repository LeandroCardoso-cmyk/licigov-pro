CREATE TABLE `vector_health_metrics` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `corpus_id` VARCHAR(20) NOT NULL,
  `total_chunks` INT NOT NULL DEFAULT 0,
  `total_embeddings` INT NOT NULL DEFAULT 0,
  `orphan_embeddings` INT NOT NULL DEFAULT 0,
  `stale_embeddings` INT NOT NULL DEFAULT 0,
  `avg_similarity_score` DECIMAL(10,6) NOT NULL DEFAULT 0,
  `index_health` ENUM('healthy','degraded','stale','rebuilding','failed') NOT NULL DEFAULT 'healthy',
  `recorded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_vhm_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
