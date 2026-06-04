CREATE TABLE `permission_audit_log` (
  `id` varchar(128) NOT NULL,
  `organization_id` int NOT NULL,
  `user_id` int NOT NULL,
  `action` varchar(64) NOT NULL,
  `resource` varchar(64) NOT NULL,
  `resource_id` varchar(256) NOT NULL,
  `allowed` tinyint(1) NOT NULL DEFAULT 0,
  `reason` varchar(512) NOT NULL,
  `occurred_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_perm_audit_org` (`organization_id`),
  INDEX `idx_perm_audit_user` (`user_id`),
  INDEX `idx_perm_audit_resource` (`resource`)
);
