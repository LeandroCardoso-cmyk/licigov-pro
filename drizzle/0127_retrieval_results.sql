CREATE TABLE IF NOT EXISTS `retrieval_results` (
  `id`               VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`  INT          NOT NULL,
  `query_id`         VARCHAR(20)  NOT NULL,
  `chunk_id`         VARCHAR(20)  NOT NULL,
  `lexical_score`    DECIMAL(6,5) NOT NULL DEFAULT 0,
  `semantic_score`   DECIMAL(6,5) NOT NULL DEFAULT 0,
  `contextual_score` DECIMAL(6,5) NOT NULL DEFAULT 0,
  `hybrid_score`     DECIMAL(6,5) NOT NULL DEFAULT 0,
  `rank_position`    INT          NOT NULL DEFAULT 0,
  `retrieval_strategy` VARCHAR(50) NOT NULL,
  `score_breakdown`  JSON         NULL,
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_rr_org`      (`organization_id`),
  INDEX `idx_rr_query`    (`organization_id`, `query_id`),
  INDEX `idx_rr_chunk`    (`organization_id`, `chunk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
