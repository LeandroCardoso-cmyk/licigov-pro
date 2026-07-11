CREATE TABLE IF NOT EXISTS `lawyer_assignments` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `workspace_id` VARCHAR(20) NOT NULL, `request_id` VARCHAR(20) NOT NULL,
  `lawyer_id` INT NULL, `sector` VARCHAR(120) NOT NULL DEFAULT '', `priority` VARCHAR(20) NOT NULL DEFAULT 'media',
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_las_org` (`organization_id`),
  INDEX `idx_las_workspace` (`workspace_id`), INDEX `idx_las_lawyer` (`lawyer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
