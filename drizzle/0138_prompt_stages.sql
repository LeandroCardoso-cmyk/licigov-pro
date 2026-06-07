CREATE TABLE IF NOT EXISTS `prompt_stages` (
  `id`                VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`   INT          NOT NULL,
  `chain_id`          VARCHAR(20)  NOT NULL,
  `name`              VARCHAR(255) NOT NULL,
  `stage_type`        VARCHAR(50)  NOT NULL,
  `template_id`       VARCHAR(20)  NOT NULL,
  `input_variables`   JSON         NULL,
  `output_schema`     JSON         NULL,
  `max_tokens`        INT          NOT NULL DEFAULT 1024,
  `timeout_ms`        INT          NOT NULL DEFAULT 30000,
  `retry_count`       INT          NOT NULL DEFAULT 3,
  `fallback_strategy` VARCHAR(50)  NOT NULL DEFAULT 'retry',
  `depends_on`        JSON         NULL,
  `guardrails`        JSON         NULL,
  `created_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_ps_org`   (`organization_id`),
  INDEX `idx_ps_chain` (`organization_id`, `chain_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
