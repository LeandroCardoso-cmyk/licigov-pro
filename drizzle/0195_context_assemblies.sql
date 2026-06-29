CREATE TABLE `context_assemblies` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `query_id` VARCHAR(20) NOT NULL,
  `retrieved_chunks` JSON NULL,
  `legal_references` JSON NULL,
  `municipality_history` JSON NULL,
  `similar_trs` JSON NULL,
  `semantic_evidence` JSON NULL,
  `prompt_context` TEXT NULL,
  `total_tokens` INT NOT NULL DEFAULT 0,
  `assembly_strategy` VARCHAR(50) NOT NULL DEFAULT 'selective',
  `compression_applied` TINYINT NOT NULL DEFAULT 0,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_ca_org` (`organization_id`),
  INDEX `idx_ca_query` (`query_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
