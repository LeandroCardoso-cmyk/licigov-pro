CREATE TABLE `department_permissions` (
  `id` varchar(128) NOT NULL,
  `organization_id` int NOT NULL,
  `user_id` int NOT NULL,
  `department` varchar(128) NOT NULL,
  `resource` varchar(64) NOT NULL,
  `actions` json NOT NULL,
  `scope` varchar(32) NOT NULL DEFAULT 'own',
  `granted_by` int NOT NULL,
  `granted_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expires_at` datetime(3) NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_dept_perms_org_user` (`organization_id`, `user_id`),
  INDEX `idx_dept_perms_dept` (`department`),
  INDEX `idx_dept_perms_active` (`active`)
);

CREATE TABLE `workflow_permissions` (
  `id` varchar(128) NOT NULL,
  `organization_id` int NOT NULL,
  `user_id` int NOT NULL,
  `workflow_stage` varchar(64) NOT NULL,
  `can_advance` tinyint(1) NOT NULL DEFAULT 0,
  `can_reject` tinyint(1) NOT NULL DEFAULT 0,
  `can_escalate` tinyint(1) NOT NULL DEFAULT 0,
  `can_delegate` tinyint(1) NOT NULL DEFAULT 0,
  `max_delegations` int NOT NULL DEFAULT 1,
  `granted_by` int NOT NULL,
  `granted_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_workflow_perms_org_user` (`organization_id`, `user_id`),
  INDEX `idx_workflow_perms_stage` (`workflow_stage`)
);
