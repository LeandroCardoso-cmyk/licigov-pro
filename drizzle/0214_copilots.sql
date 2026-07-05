CREATE TABLE IF NOT EXISTS `copilots` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `copilot_type` VARCHAR(50) NOT NULL DEFAULT 'agente_contratacao',
  `name` VARCHAR(255) NOT NULL DEFAULT '',
  `description` TEXT NULL,
  `domain` VARCHAR(100) NOT NULL DEFAULT '',
  `capabilities` TEXT NULL,
  `permissions` TEXT NULL,
  `forbidden_actions` TEXT NULL,
  `active` TINYINT NOT NULL DEFAULT 1,
  `version` INT NOT NULL DEFAULT 1,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_cop_org` (`organization_id`),
  INDEX `idx_cop_type` (`copilot_type`),
  INDEX `idx_cop_org_type` (`organization_id`, `copilot_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
