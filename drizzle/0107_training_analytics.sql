CREATE TABLE `training_analytics` (
  `id` varchar(128) NOT NULL,
  `organization_id` int NOT NULL,
  `user_hash` varchar(32) NOT NULL,
  `module_id` varchar(128) NOT NULL,
  `module_name` varchar(256) NOT NULL,
  `role` varchar(64) NOT NULL,
  `started_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` datetime(3) NULL,
  `duration_ms` int NOT NULL DEFAULT 0,
  `score` int NULL,
  `attempts` int NOT NULL DEFAULT 1,
  `is_simulation` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_ta_org` (`organization_id`),
  INDEX `idx_ta_module` (`module_id`),
  INDEX `idx_ta_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
