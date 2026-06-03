CREATE TABLE IF NOT EXISTS security_incidents (
  id VARCHAR(64) NOT NULL,
  organization_id INT NOT NULL,
  event_type ENUM('brute_force','suspicious_access','permission_anomaly','session_anomaly','audit_anomaly','rate_limit_exceeded') NOT NULL,
  severity ENUM('info','warning','critical') NOT NULL DEFAULT 'info',
  actor_id INT NULL,
  description TEXT NOT NULL,
  metadata JSON NULL,
  correlation_id VARCHAR(64) NULL,
  detected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_si_org_type (organization_id, event_type),
  INDEX idx_si_org_severity (organization_id, severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
