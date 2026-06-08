CREATE TABLE IF NOT EXISTS `jurisprudence_references` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `case_number` VARCHAR(255) NOT NULL,
  `court` VARCHAR(255) NOT NULL,
  `court_level` ENUM('supreme','superior','regional','federal','state','administrative') NOT NULL DEFAULT 'superior',
  `judgment_date` DATE NULL,
  `summary` TEXT NULL,
  `precedent_strength` ENUM('binding','persuasive','informative','overruled') NOT NULL DEFAULT 'informative',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_jr_org` (`organization_id`),
  INDEX `idx_jr_court` (`organization_id`, `court_level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
