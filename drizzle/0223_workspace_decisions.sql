CREATE TABLE IF NOT EXISTS `workspace_decisions` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `workspace_id` VARCHAR(20) NOT NULL,
  `title` VARCHAR(500) NOT NULL DEFAULT '',
  `decision` TEXT NULL,
  `justification` TEXT NULL,
  `responsible_user` INT NOT NULL DEFAULT 0,
  `outcome` VARCHAR(30) NOT NULL DEFAULT 'adiada',
  `status` VARCHAR(30) NOT NULL DEFAULT 'registrada',
  `evidence_ids` TEXT NULL,
  `involved_copilots` TEXT NULL,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_wd_org` (`organization_id`),
  INDEX `idx_wd_workspace` (`workspace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
