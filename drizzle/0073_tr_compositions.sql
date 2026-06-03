CREATE TABLE IF NOT EXISTS tr_compositions (
  id VARCHAR(32) NOT NULL,
  organization_id INT NOT NULL,
  process_id INT NOT NULL,
  replay_key VARCHAR(64) NOT NULL,
  correlation_id VARCHAR(64) NULL,
  composed_sections JSON NOT NULL,
  recommended_clauses JSON NOT NULL,
  item_groups JSON NOT NULL,
  composition_rationale TEXT NOT NULL,
  item_count INT NOT NULL DEFAULT 0,
  created_by INT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_trc_org (organization_id),
  INDEX idx_trc_process (organization_id, process_id),
  INDEX idx_trc_replay (organization_id, replay_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
