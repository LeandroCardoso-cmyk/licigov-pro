# Sprint 2.5 — Decisões Arquiteturais

## ADR-007: PolicyEngine centralizado vs checks inline

**Contexto:** 14 ações com regras complexas de autorização por contexto.

**Decisão:** PolicyEngine centralizado em `documentPolicy.ts`. Toda verificação de permissão documental passa por `assertPolicy()`.

**Consequências:**
- Ponto único para auditoria e debug de autorização
- Testável de forma isolada (puro, sem DB)
- Novas regras adicionadas em um único lugar

---

## ADR-008: RetentionPolicy baseada em tipo de documento

**Contexto:** LGPD e Lei 14.133/2021 exigem retenção diferenciada por tipo de ato.

**Decisão:** `DOCUMENT_TYPE_RETENTION` mapeia tipo → classe de retenção. Purge date calculada em criação do documento.

**Consequências:**
- Conformidade legal automática por tipo
- `legalHold` bloqueia purge independente da classe
- Auditoria mostra data de purge antecipadamente

---

## ADR-009: Locks com expiração automática

**Contexto:** Locks sem expiração causam deadlocks quando usuário fecha o browser.

**Decisão:** Soft lock: 15min TTL. Hard lock: 60min TTL. Expiração automática via `lockExpiresAt`.

**Consequências:**
- `cleanupExpiredLocks()` deve ser chamado periodicamente (cron job)
- Usuário precisa renovar lock antes de expirar
- Força colaboração: ninguém pode monopolizar documento por muito tempo
