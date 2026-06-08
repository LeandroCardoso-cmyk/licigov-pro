CREATE TABLE `approval_decisions` (
  `id` VARCHAR(20) NOT NULL,
  `workflow_id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `approver` VARCHAR(255) NOT NULL,
  `decision` ENUM('approve','reject','delegate','escalate') NOT NULL,
  `justification` TEXT NULL,
  `decided_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_ad_org` (`organization_id`),
  INDEX `idx_ad_wf` (`workflow_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
