CREATE TABLE `action_safety_logs` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `action_type` VARCHAR(255) NOT NULL,
  `execution_id` VARCHAR(20) NULL,
  `safety_level` ENUM('safe','low_risk','medium_risk','high_risk','critical','blocked') NOT NULL DEFAULT 'safe',
  `passed` TINYINT(1) NOT NULL DEFAULT 1,
  `confidence_score` DECIMAL(5,4) NOT NULL DEFAULT 0,
  `recommendation` ENUM('proceed','pause','block','escalate') NOT NULL DEFAULT 'proceed',
  `checked_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_asl_org` (`organization_id`),
  INDEX `idx_asl_safety` (`organization_id`, `safety_level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
