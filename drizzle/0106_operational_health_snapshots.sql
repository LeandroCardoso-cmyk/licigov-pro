CREATE TABLE `operational_health_snapshots` (
  `id` varchar(128) NOT NULL,
  `organization_id` int NOT NULL,
  `overall_status` varchar(16) NOT NULL DEFAULT 'healthy',
  `avg_score` int NOT NULL DEFAULT 100,
  `workflow_health` int NOT NULL DEFAULT 100,
  `review_health` int NOT NULL DEFAULT 100,
  `approval_health` int NOT NULL DEFAULT 100,
  `onboarding_health` int NOT NULL DEFAULT 100,
  `support_health` int NOT NULL DEFAULT 100,
  `active_incidents` int NOT NULL DEFAULT 0,
  `active_risks` int NOT NULL DEFAULT 0,
  `snapshot_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_ohs_org` (`organization_id`),
  INDEX `idx_ohs_status` (`overall_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
