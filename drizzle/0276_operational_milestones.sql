CREATE TABLE IF NOT EXISTS `operational_milestones` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `reference_type` VARCHAR(40) NOT NULL DEFAULT '', `reference_id` VARCHAR(64) NOT NULL DEFAULT '',
  `milestone_type` VARCHAR(30) NOT NULL DEFAULT 'outro', `date` VARCHAR(10) NOT NULL DEFAULT '', `time` VARCHAR(5) NOT NULL DEFAULT '',
  `result` VARCHAR(255) NOT NULL DEFAULT '', `observation` TEXT NULL, `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_opms_org` (`organization_id`), INDEX `idx_opms_ref` (`reference_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
