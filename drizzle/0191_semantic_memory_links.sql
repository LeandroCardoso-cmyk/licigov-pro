CREATE TABLE `semantic_memory_links` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `source_chunk_id` VARCHAR(20) NOT NULL,
  `target_chunk_id` VARCHAR(20) NOT NULL,
  `link_type` ENUM('correlation','reuse','precedent','contradiction','evolution') NOT NULL DEFAULT 'correlation',
  `strength` DECIMAL(5,4) NOT NULL DEFAULT 0.5,
  `context` TEXT NULL,
  `correlation_id` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_sml_org` (`organization_id`),
  INDEX `idx_sml_source` (`source_chunk_id`),
  INDEX `idx_sml_target` (`target_chunk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
