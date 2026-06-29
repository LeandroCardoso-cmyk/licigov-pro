CREATE TABLE `semantic_corpora` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `corpus_type` ENUM('legal_base','jurisprudence','institutional','templates','custom') NOT NULL DEFAULT 'custom',
  `corpus_name` VARCHAR(255) NOT NULL,
  `corpus_description` TEXT NULL,
  `indexing_strategy` ENUM('full_reindex','incremental','rolling','append_only') NOT NULL DEFAULT 'incremental',
  `embedding_provider` VARCHAR(255) NOT NULL DEFAULT 'mock',
  `active_embedding_version` VARCHAR(20) NOT NULL DEFAULT 'v1',
  `total_chunks` INT NOT NULL DEFAULT 0,
  `total_embeddings` INT NOT NULL DEFAULT 0,
  `indexing_status` ENUM('pending','indexing','indexed','failed','stale','rebuilding') NOT NULL DEFAULT 'pending',
  `last_indexed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_scorpus_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
