CREATE TABLE `pilot_readiness_scores` (
  `id` varchar(128) NOT NULL,
  `organization_id` int NOT NULL,
  `total_score` int NOT NULL DEFAULT 0,
  `tier` varchar(16) NOT NULL DEFAULT 'not_ready',
  `dimensions` json NOT NULL,
  `replay_key` varchar(64) NOT NULL,
  `recommendations` json NOT NULL,
  `computed_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_prs_org` (`organization_id`),
  INDEX `idx_prs_tier` (`tier`),
  UNIQUE INDEX `idx_prs_replay` (`replay_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
