CREATE TABLE IF NOT EXISTS `request_notifications` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `request_id` VARCHAR(20) NOT NULL, `recipient_user` INT NOT NULL DEFAULT 0,
  `channel` VARCHAR(20) NOT NULL DEFAULT 'sistema', `title` VARCHAR(500) NOT NULL DEFAULT '',
  `message` TEXT NULL, `status` VARCHAR(20) NOT NULL DEFAULT 'pendente', `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_rnot_org` (`organization_id`),
  INDEX `idx_rnot_request` (`request_id`), INDEX `idx_rnot_recipient` (`recipient_user`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
