CREATE TABLE `pilot_execution_snapshots` (
  `id` varchar(128) NOT NULL,
  `organization_id` int NOT NULL,
  `municipio` varchar(256) NOT NULL,
  `activation_state` varchar(64) NOT NULL DEFAULT 'inactive',
  `maturity_level` varchar(32) NOT NULL DEFAULT 'initial',
  `adoption_score` json NOT NULL,
  `health_indicators` json NOT NULL,
  `risk_indicators` json NOT NULL,
  `rollout_stages` json NOT NULL,
  `execution_history` json NOT NULL,
  `started_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_activity_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_pes_org` (`organization_id`),
  INDEX `idx_pes_state` (`activation_state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
