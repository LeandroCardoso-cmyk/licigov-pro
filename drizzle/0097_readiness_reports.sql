CREATE TABLE `readiness_reports` (
  `id` varchar(128) NOT NULL,
  `organization_id` int NOT NULL,
  `pilot_phase` varchar(32) NOT NULL,
  `overall_score` int NOT NULL DEFAULT 0,
  `overall_status` varchar(32) NOT NULL DEFAULT 'not_ready',
  `checks` json NOT NULL,
  `blockers` json NOT NULL,
  `recommendations` json NOT NULL,
  `generated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_readiness_org` (`organization_id`),
  INDEX `idx_readiness_phase` (`pilot_phase`)
);

CREATE TABLE `phase_transition_approvals` (
  `id` varchar(128) NOT NULL,
  `organization_id` int NOT NULL,
  `from_phase` varchar(32) NOT NULL,
  `to_phase` varchar(32) NOT NULL,
  `approved_by` int NOT NULL,
  `readiness_score` int NOT NULL DEFAULT 0,
  `notes` text NOT NULL,
  `approved_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_phase_approvals_org` (`organization_id`)
);
