CREATE TABLE IF NOT EXISTS `ai_token_estimations` (
  `id`               VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`  INT          NOT NULL,
  `session_id`       VARCHAR(40)  NOT NULL,
  `model`            VARCHAR(100) NOT NULL DEFAULT 'mock-default',
  `max_tokens`       INT          NOT NULL DEFAULT 4096,
  `used_tokens`      INT          NOT NULL DEFAULT 0,
  `reserved_tokens`  INT          NOT NULL DEFAULT 0,
  `cost_estimate_usd` DECIMAL(10,6) NOT NULL DEFAULT 0.000000,
  `warnings`         JSON         NULL,
  `hard_limit`       TINYINT(1)   NOT NULL DEFAULT 0,
  `updated_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_ate_org`      (`organization_id`),
  INDEX `idx_ate_session`  (`organization_id`, `session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
