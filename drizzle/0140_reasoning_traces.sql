CREATE TABLE IF NOT EXISTS `reasoning_traces` (
  `id`                   VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`      INT          NOT NULL,
  `session_id`           VARCHAR(100) NOT NULL,
  `stages`               JSON         NULL,
  `final_conclusion`     TEXT         NULL,
  `overall_confidence`   DECIMAL(4,3) NOT NULL DEFAULT 0,
  `contradictions_found` INT          NOT NULL DEFAULT 0,
  `ambiguities_found`    INT          NOT NULL DEFAULT 0,
  `citation_count`       INT          NOT NULL DEFAULT 0,
  `replay_key`           VARCHAR(64)  NOT NULL,
  `created_at`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_rt_org`     (`organization_id`),
  INDEX `idx_rt_session` (`organization_id`, `session_id`),
  INDEX `idx_rt_replay`  (`replay_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
