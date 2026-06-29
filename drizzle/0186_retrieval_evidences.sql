CREATE TABLE `retrieval_evidences` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `retrieval_session_id` VARCHAR(20) NOT NULL,
  `chunk_id` VARCHAR(20) NOT NULL,
  `similarity_score` DECIMAL(10,6) NOT NULL DEFAULT 0,
  `bm25_score` DECIMAL(10,6) NOT NULL DEFAULT 0,
  `rerank_score` DECIMAL(10,6) NOT NULL DEFAULT 0,
  `final_score` DECIMAL(10,6) NOT NULL DEFAULT 0,
  `ranking_reason` TEXT NULL,
  `semantic_explanation` TEXT NULL,
  `evidence_type` ENUM('semantic_match','lexical_match','hybrid_match','contextual_match','reranked') NOT NULL DEFAULT 'semantic_match',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_rev_org` (`organization_id`),
  INDEX `idx_rev_session` (`retrieval_session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
