CREATE TABLE `environments` (
  `id` varchar(128) NOT NULL,
  `organization_id` int NOT NULL,
  `name` varchar(256) NOT NULL,
  `type` varchar(32) NOT NULL DEFAULT 'development',
  `status` varchar(32) NOT NULL DEFAULT 'active',
  `config` json NOT NULL,
  `version` varchar(32) NOT NULL DEFAULT '1.0.0',
  `promoted_from` varchar(128) NULL,
  `created_by` int NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_environments_org` (`organization_id`),
  INDEX `idx_environments_type` (`type`),
  INDEX `idx_environments_status` (`status`)
);
--> statement-breakpoint
CREATE TABLE `environment_promotions` (
  `id` varchar(128) NOT NULL,
  `organization_id` int NOT NULL,
  `from_env_id` varchar(128) NOT NULL,
  `to_env_id` varchar(128) NOT NULL,
  `promoted_by` int NOT NULL,
  `changes` json NOT NULL,
  `promoted_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_env_promotions_org` (`organization_id`)
);