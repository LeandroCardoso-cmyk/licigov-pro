CREATE TABLE IF NOT EXISTS `prompt_chains` (
  `id`               VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`  INT          NOT NULL,
  `name`             VARCHAR(255) NOT NULL,
  `stages`           JSON         NULL,
  `transitions`      JSON         NULL,
  `max_total_tokens` INT          NOT NULL DEFAULT 4096,
  `replay_key`       VARCHAR(64)  NOT NULL,
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_pc_org`    (`organization_id`),
  INDEX `idx_pc_replay` (`replay_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
