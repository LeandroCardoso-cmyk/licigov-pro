# Sprint 1.5 — Decisões Arquiteturais

## ADR-S15-001: ActivityLog como append-only immutable store

**Decisão:** Registros de `activity_logs` nunca são atualizados ou deletados. São append-only por contrato.

**Motivação:** Conformidade com LGPD Art. 37 (registros de tratamento de dados pessoais) e Lei 14.133/2021 (rastreabilidade de atos administrativos).

## ADR-S15-002: Snapshot de contexto vs referência

**Decisão:** Campos como `actorEmail`, `actorRole`, `orgName` são gravados como snapshot, não como foreign keys.

**Motivação:** Foreign key seria mutável (usuário pode mudar email). Snapshot preserva o estado exato no momento do ato.
