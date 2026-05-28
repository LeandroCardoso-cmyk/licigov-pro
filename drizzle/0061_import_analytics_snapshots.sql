-- Sprint 2.9 — Import Analytics Snapshots
-- Snapshots periódicos dos 10 KPIs do import engine por organização.

CREATE TABLE IF NOT EXISTS import_analytics_snapshots (
  id               VARCHAR(26)  NOT NULL,
  organization_id  INT          NOT NULL,

  period_start     DATETIME(3)  NOT NULL,
  period_end       DATETIME(3)  NOT NULL,
  session_count    INT          NOT NULL DEFAULT 0,
  item_count       INT          NOT NULL DEFAULT 0,

  -- 10 KPIs serializados como JSON (ImportKpi[])
  kpis             JSON         NOT NULL DEFAULT (JSON_ARRAY()),

  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  INDEX idx_ias_org         (organization_id),
  INDEX idx_ias_period      (organization_id, period_start DESC),
  INDEX idx_ias_created     (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
