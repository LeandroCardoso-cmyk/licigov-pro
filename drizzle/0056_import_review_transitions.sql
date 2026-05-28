-- Sprint 2.9 — Import Review Transitions
-- Histórico imutável de transições de estado de revisão por item de staging.

CREATE TABLE IF NOT EXISTS import_review_transitions (
  id               VARCHAR(26)  NOT NULL,
  staging_item_id  VARCHAR(26)  NOT NULL,
  from_state       ENUM(
    'extracted','normalized','review_pending','reviewed',
    'approved','rejected','corrected','catmat_linked','finalized'
  ) NOT NULL,
  to_state         ENUM(
    'extracted','normalized','review_pending','reviewed',
    'approved','rejected','corrected','catmat_linked','finalized'
  ) NOT NULL,
  actor_type       ENUM('system','human','ai_assist') NOT NULL DEFAULT 'system',
  actor_user_id    INT          NULL,
  actor_org_id     INT          NOT NULL,
  actor_agent_id   VARCHAR(128) NULL,
  reason           TEXT         NULL,
  metadata         JSON         NULL,
  occurred_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  INDEX idx_irt_staging_item (staging_item_id),
  INDEX idx_irt_to_state    (to_state),
  INDEX idx_irt_occurred_at (occurred_at),
  INDEX idx_irt_actor_user  (actor_user_id),
  INDEX idx_irt_org         (actor_org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
