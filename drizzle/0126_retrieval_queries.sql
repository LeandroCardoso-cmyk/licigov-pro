CREATE TABLE IF NOT EXISTS `retrieval_queries` (
  `id`               VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`  INT          NOT NULL,
  `raw_query`        TEXT         NULL,
  `expanded_terms`   JSON         NULL,
  `synonym_expansion` JSON        NULL,
  `corrected_query`  VARCHAR(500) NULL,
  `filters`          JSON         NULL,
  `replay_key`       VARCHAR(64)  NOT NULL,
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_rq_org`      (`organization_id`),
  INDEX `idx_rq_replay`   (`replay_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
