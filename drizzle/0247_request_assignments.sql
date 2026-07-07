CREATE TABLE IF NOT EXISTS `request_assignments` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `request_id` VARCHAR(20) NOT NULL, `user_id` INT NULL,
  `sector` VARCHAR(100) NOT NULL DEFAULT '', `queue` VARCHAR(100) NOT NULL DEFAULT 'geral',
  `priority` VARCHAR(20) NOT NULL DEFAULT 'media', `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_rasg_org` (`organization_id`), INDEX `idx_rasg_request` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
