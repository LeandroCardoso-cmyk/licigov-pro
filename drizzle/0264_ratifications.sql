CREATE TABLE IF NOT EXISTS `ratifications` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL, `workspace_id` VARCHAR(20) NOT NULL,
  `responsible` INT NOT NULL DEFAULT 0, `decision` VARCHAR(30) NOT NULL DEFAULT 'ratificado', `justification` TEXT NULL,
  `evidence` TEXT NULL, `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `ratified_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_rat_org` (`organization_id`), INDEX `idx_rat_workspace` (`workspace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
