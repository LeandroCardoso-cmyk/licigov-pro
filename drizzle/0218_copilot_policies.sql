CREATE TABLE IF NOT EXISTS `copilot_policies` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `copilot_type` VARCHAR(50) NOT NULL DEFAULT 'agente_contratacao',
  `name` VARCHAR(255) NOT NULL DEFAULT '',
  `allowed_actions` TEXT NULL,
  `forbidden_actions` TEXT NULL,
  `min_confidence` DECIMAL(5,4) NOT NULL DEFAULT 0.4,
  `approval_risk_threshold` VARCHAR(20) NOT NULL DEFAULT 'alto',
  `active` TINYINT NOT NULL DEFAULT 1,
  `version` INT NOT NULL DEFAULT 1,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_cpol_org` (`organization_id`),
  INDEX `idx_cpol_type` (`copilot_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
