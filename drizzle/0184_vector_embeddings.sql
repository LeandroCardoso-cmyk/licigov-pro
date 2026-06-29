CREATE TABLE `vector_embeddings` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `chunk_id` VARCHAR(20) NOT NULL,
  `provider_id` VARCHAR(255) NOT NULL,
  `model` VARCHAR(255) NOT NULL,
  `embedding_version` VARCHAR(20) NOT NULL DEFAULT 'v1',
  `embedding_vector` JSON NULL,
  `embedding_hash` VARCHAR(64) NOT NULL,
  `token_usage` INT NOT NULL DEFAULT 0,
  `generation_latency_ms` INT NOT NULL DEFAULT 0,
  `deterministic_snapshot` VARCHAR(64) NULL,
  `correlation_id` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_ve_org` (`organization_id`),
  INDEX `idx_ve_chunk` (`chunk_id`),
  INDEX `idx_ve_version` (`embedding_version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
