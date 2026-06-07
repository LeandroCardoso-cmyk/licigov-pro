CREATE TABLE IF NOT EXISTS `context_assemblies` (
  `id`                  VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`     INT          NOT NULL,
  `session_id`          VARCHAR(100) NOT NULL,
  `total_tokens_used`   INT          NOT NULL DEFAULT 0,
  `fragment_count`      INT          NOT NULL DEFAULT 0,
  `compression_applied` TINYINT(1)   NOT NULL DEFAULT 0,
  `status`              VARCHAR(50)  NOT NULL DEFAULT 'open',
  `assembly_reason_key` VARCHAR(64)  NULL,
  `lineage`             JSON         NULL,
  `replay_key`          VARCHAR(64)  NOT NULL,
  `assembled_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_ca_org`     (`organization_id`),
  INDEX `idx_ca_session` (`organization_id`, `session_id`),
  INDEX `idx_ca_replay`  (`replay_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
