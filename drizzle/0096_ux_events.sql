CREATE TABLE `ux_events` (
  `id` varchar(128) NOT NULL,
  `organization_id` int NOT NULL,
  `user_id` int NOT NULL,
  `session_id` varchar(128) NOT NULL,
  `event_type` varchar(64) NOT NULL,
  `feature` varchar(128) NOT NULL,
  `metadata` json NOT NULL,
  `duration_ms` int NULL,
  `occurred_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_ux_events_org` (`organization_id`),
  INDEX `idx_ux_events_user` (`user_id`),
  INDEX `idx_ux_events_session` (`session_id`),
  INDEX `idx_ux_events_feature` (`feature`)
);

CREATE TABLE `ux_sessions` (
  `session_id` varchar(128) NOT NULL,
  `organization_id` int NOT NULL,
  `user_id` int NOT NULL,
  `started_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ended_at` datetime(3) NULL,
  `events_count` int NOT NULL DEFAULT 0,
  `features_used` json NOT NULL,
  `total_duration_ms` int NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`session_id`),
  INDEX `idx_ux_sessions_org` (`organization_id`),
  INDEX `idx_ux_sessions_user` (`user_id`)
);
