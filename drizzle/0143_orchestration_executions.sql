CREATE TABLE IF NOT EXISTS `orchestration_executions` (
  `id`                VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`   INT          NOT NULL,
  `session_id`        VARCHAR(100) NOT NULL,
  `chain_id`          VARCHAR(20)  NOT NULL,
  `status`            VARCHAR(50)  NOT NULL DEFAULT 'pending',
  `stage_executions`  JSON         NULL,
  `final_output`      TEXT         NULL,
  `total_tokens_used` INT          NOT NULL DEFAULT 0,
  `total_duration_ms` INT          NOT NULL DEFAULT 0,
  `correlation_id`    VARCHAR(20)  NOT NULL,
  `replay_key`        VARCHAR(64)  NOT NULL,
  `executed_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_oe_org`         (`organization_id`),
  INDEX `idx_oe_session`     (`organization_id`, `session_id`),
  INDEX `idx_oe_chain`       (`organization_id`, `chain_id`),
  INDEX `idx_oe_correlation` (`organization_id`, `correlation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
