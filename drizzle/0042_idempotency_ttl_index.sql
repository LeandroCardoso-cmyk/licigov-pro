-- Sprint 1.5 — Idempotency: índices para cleanup eficiente de TTL
-- Permite DELETE eficiente de chaves expiradas sem full scan

CREATE INDEX `idx_idempotency_expires`     ON `idempotency_keys` (`expiresAt`, `status`);
--> statement-breakpoint
CREATE INDEX `idx_idempotency_org_expires` ON `idempotency_keys` (`organizationId`, `expiresAt`);