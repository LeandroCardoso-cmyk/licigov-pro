CREATE TABLE `workload_metrics` (
  `id` varchar(128) NOT NULL,
  `organization_id` int NOT NULL,
  `period_start` datetime(3) NOT NULL,
  `period_end` datetime(3) NOT NULL,
  `reviewer_workloads` json NOT NULL,
  `alerts` json NOT NULL,
  `queue_health` json NOT NULL,
  `avg_approval_latency_ms` int NOT NULL DEFAULT 0,
  `total_pending` int NOT NULL DEFAULT 0,
  `throughput_per_hour` double NOT NULL DEFAULT 0,
  `productivity_score` int NOT NULL DEFAULT 100,
  `computed_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_wm_org` (`organization_id`),
  INDEX `idx_wm_period` (`period_start`, `period_end`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
