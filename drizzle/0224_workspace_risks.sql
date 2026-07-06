CREATE TABLE IF NOT EXISTS `workspace_risks` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `workspace_id` VARCHAR(20) NOT NULL,
  `category` VARCHAR(30) NOT NULL DEFAULT 'operacional',
  `description` TEXT NULL,
  `severity` VARCHAR(20) NOT NULL DEFAULT 'medio',
  `likelihood` DECIMAL(5,4) NOT NULL DEFAULT 0.5,
  `status` VARCHAR(30) NOT NULL DEFAULT 'identificado',
  `mitigation` TEXT NULL,
  `correlated_risk_ids` TEXT NULL,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_wr_org` (`organization_id`),
  INDEX `idx_wr_workspace` (`workspace_id`),
  INDEX `idx_wr_severity` (`severity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
