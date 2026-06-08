CREATE TABLE `execution_tasks` (
  `id` VARCHAR(20) NOT NULL,
  `plan_id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `task_name` VARCHAR(255) NOT NULL,
  `task_type` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `priority` ENUM('critical','high','medium','low') NOT NULL DEFAULT 'medium',
  `status` ENUM('pending','ready','running','completed','failed','skipped','blocked') NOT NULL DEFAULT 'pending',
  `parallelizable` TINYINT(1) NOT NULL DEFAULT 0,
  `estimated_ms` INT NOT NULL DEFAULT 1000,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_et_org` (`organization_id`),
  INDEX `idx_et_plan` (`plan_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
