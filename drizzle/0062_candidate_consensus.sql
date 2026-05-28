CREATE TABLE IF NOT EXISTS candidate_consensus (
  id VARCHAR(26) NOT NULL,
  staging_item_id VARCHAR(26) NOT NULL,
  import_session_id INT NOT NULL,
  organization_id INT NOT NULL,
  winning_candidate_id VARCHAR(26) NULL,
  consensus_score DECIMAL(5,4) NOT NULL,
  consensus_reasoning TEXT NOT NULL,
  confidence_breakdown JSON NOT NULL,
  ranking_metadata JSON NOT NULL,
  evidence_summary TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_cc_staging (staging_item_id),
  INDEX idx_cc_session (import_session_id),
  INDEX idx_cc_org (organization_id),
  INDEX idx_cc_score (consensus_score DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
