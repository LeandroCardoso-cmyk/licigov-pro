CREATE TABLE `workflow_analytics_snapshots` (
  `id` varchar(128) NOT NULL,
  `organization_id` int NOT NULL,
  `period_start` datetime(3) NOT NULL,
  `period_end` datetime(3) NOT NULL,
  `total_processes` int NOT NULL DEFAULT 0,
  `completed_processes` int NOT NULL DEFAULT 0,
  `avg_completion_days` double NOT NULL DEFAULT 0,
  `bottleneck_stages` json NOT NULL,
  `drop_off_points` json NOT NULL,
  `user_engagement_score` int NOT NULL DEFAULT 0,
  `computed_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_wf_analytics_org` (`organization_id`),
  INDEX `idx_wf_analytics_period` (`period_start`, `period_end`)
);
