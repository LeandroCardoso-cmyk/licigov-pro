CREATE TABLE `workflow_congestion_metrics` (
  `id` varchar(128) NOT NULL,
  `organization_id` int NOT NULL,
  `stage` varchar(64) NOT NULL,
  `department` varchar(128) NOT NULL,
  `pending_count` int NOT NULL DEFAULT 0,
  `avg_age_hours` double NOT NULL DEFAULT 0,
  `congestion_level` varchar(16) NOT NULL DEFAULT 'low',
  `measured_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_wcm_org` (`organization_id`),
  INDEX `idx_wcm_stage` (`stage`),
  INDEX `idx_wcm_dept` (`department`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
