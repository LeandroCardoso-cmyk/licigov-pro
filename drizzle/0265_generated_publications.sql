CREATE TABLE IF NOT EXISTS `generated_publications` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL, `workspace_id` VARCHAR(20) NOT NULL,
  `kind` VARCHAR(30) NOT NULL DEFAULT 'aviso', `title` VARCHAR(500) NOT NULL DEFAULT '', `content` TEXT NULL,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_pub_org` (`organization_id`), INDEX `idx_pub_workspace` (`workspace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
