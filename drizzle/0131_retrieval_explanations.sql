CREATE TABLE IF NOT EXISTS `retrieval_explanations` (
  `id`               VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`  INT          NOT NULL,
  `query_id`         VARCHAR(20)  NOT NULL,
  `correlation_id`   VARCHAR(20)  NOT NULL,
  `explanation_tree` JSON         NULL,
  `ranking_lineage`  JSON         NULL,
  `trace_steps`      JSON         NULL,
  `human_summary`    TEXT         NULL,
  `confidence`       DECIMAL(4,3) NOT NULL DEFAULT 0,
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_re_org`         (`organization_id`),
  INDEX `idx_re_query`       (`organization_id`, `query_id`),
  INDEX `idx_re_correlation` (`organization_id`, `correlation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
