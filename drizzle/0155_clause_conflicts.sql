CREATE TABLE IF NOT EXISTS `clause_conflicts` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `session_id` VARCHAR(255) NOT NULL,
  `clause_id_a` VARCHAR(100) NOT NULL,
  `clause_id_b` VARCHAR(100) NOT NULL,
  `compatibility_score` DECIMAL(5,4) NOT NULL DEFAULT 1,
  `conflict_type` ENUM('direct','indirect','conditional','none') NOT NULL DEFAULT 'none',
  `explanation` TEXT NULL,
  `resolution` TEXT NULL,
  `checked_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_ccf_org` (`organization_id`),
  INDEX `idx_ccf_session` (`organization_id`, `session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
