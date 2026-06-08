CREATE TABLE `approval_workflows` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `execution_id` VARCHAR(20) NULL,
  `plan_id` VARCHAR(20) NULL,
  `approval_type` VARCHAR(255) NOT NULL,
  `status` ENUM('pending','approved','rejected','escalated','delegated','expired','overridden') NOT NULL DEFAULT 'pending',
  `priority` ENUM('urgent','high','normal','low') NOT NULL DEFAULT 'normal',
  `deadline` DATETIME(3) NULL,
  `escalate_to` VARCHAR(255) NULL,
  `delegated_to` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `resolved_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_aw_org` (`organization_id`),
  INDEX `idx_aw_status` (`organization_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
