CREATE TABLE IF NOT EXISTS `clause_recommendations` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `session_id` VARCHAR(255) NOT NULL,
  `clause_id` VARCHAR(100) NOT NULL,
  `recommendation_type` ENUM('add','remove','modify','reorder') NOT NULL DEFAULT 'modify',
  `content` TEXT NULL,
  `rationale` TEXT NULL,
  `priority` INT NOT NULL DEFAULT 1,
  `legal_basis` VARCHAR(500) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_cr_org` (`organization_id`),
  INDEX `idx_cr_session` (`organization_id`, `session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
