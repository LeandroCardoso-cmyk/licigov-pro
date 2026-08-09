# C.2B — Aprovação Version-Aware e Workflow Institucional de Documentos (entrega)

> Continuação de C.2A ([`C2_GOVERNANCE_OPERATIONALIZATION_DELIVERY.md`](./C2_GOVERNANCE_OPERATIONALIZATION_DELIVERY.md)).
> C.2A operacionalizou CATMAT/CATSER; **C.2B** operacionaliza o **workflow documental** no fluxo
> realmente usado pela UI, conectando-o ao domínio canônico — **aditivo, sem big-bang, sem destruir
> linhagem, sem tocar `documentsRouter` congelado**.

## Arquitetura — fluxo antigo → reconciliação → workflow canônico

**Antes (legado, congelado):** UI `DocumentApprovalPanel` → `trpc.documents.{submitForReview,approveDocument,
rejectDocument}` (owner-only, status in-place, sem justificativa/idempotência/ledger).

**Agora (C.2B, canônico):** UI `DocumentApprovalPanel` → **`trpc.documentReview.*`** → `documentReviewService`
→ regras de domínio canônicas + `runWithIdempotency` + ledger imutável `document_review_decisions`.
O `documentsRouter` **não foi tocado** (permanece para compatibilidade); a UI apenas **trocou** as chamadas
(redução de consumidores de `trpc.documents.*` — legacy-freeze preservado por inclusão).

## Backend — operações version-aware
- **Novo router canônico** `server/routers/documentReviewRouter.ts` (`documentReview`): `submitForReview`,
  `approve`, `reject`, `requestChanges`, `getReviewDecisions` — todas `tenantProcedure`.
- **Serviço** `server/services/documentReviewService.ts`: valida escopo tenant+processo, guarda de
  **versão observada** (`expectedVersion` obsoleta → `CONFLICT`), transição canônica (`isValidTransition`),
  papel (`orgRoleMeets` + `WORKFLOW_ROLE_REQUIREMENTS`), segregação de deveres
  (`assertInstitutionalDecisionRules`), e efeito único transacional. **Aprova-se uma VERSÃO**
  (`documents` é row-per-version): editar gera nova linha em `draft` → **nunca herda aprovação**; a versão
  aprovada **permanece aprovada**. **Não usa `applyTransition`** (evita o bump de `documents.version`);
  **não inventa segundo state machine** (reusa `documentTypes`).
- **Devolução:** transição canônica estendida `in_review → draft` (solicitar ajustes), com justificativa
  obrigatória.

## Segregação de funções (backend, não só no front)
- **reviewer ≠ autor** (aprovação); **IA/sistema ≠ approver** (aprovador humano identificado);
  **papel insuficiente** bloqueado (RBAC canônico); **justificativa obrigatória** em rejeição/devolução.

## Idempotência (serviço único — sem segundo mecanismo)
- `idempotencyKey` explícito em `submitForReview`/`approve`/`reject`/`requestChanges`, via `runWithIdempotency`
  (`operation: "document.review.decision"`, `payloadHash` sobre `{documentId, version, toState, reason}`).
- Mesma chave+payload → **replay**; chave+payload diferente → **CONFLICT**; concorrência → **efeito único**
  (UNIQUE `uq_docreview_decision_idem`); replay **não** duplica ledger/auditoria; falha nunca vira sucesso.

## Persistência e auditoria
- **Migration aditiva `0293_document_review_decisions.sql`** (`CREATE TABLE IF NOT EXISTS`, sem ALTER/backfill;
  espelhada em `bootstrap.ts`). Ledger **imutável/append-only**, version-aware, tenant-aware:
  `{organizationId, processId, documentId, documentVersion, action, fromState, toState, actorUserId,
  authorUserId, justification, correlationId, idempotencyKey, createdAt}` + `UNIQUE(org, idempotencyKey)`.
- Narrativa via `logActivity` (correlation-aware), aplicada uma única vez. Sem chain-of-thought; sem
  conteúdo documental integral no ledger.

## UI institucional
- `DocumentApprovalPanel` (arquivo baseline): estado/versão exibidos, ações **Enviar para revisão /
  Aprovar / Rejeitar / Solicitar ajustes** gateadas por RBAC (`useOrgRole`) e por SoD (autor não vê
  "Aprovar" habilitado); **justificativa obrigatória** em rejeição/devolução (Dialog); **idempotencyKey**
  por ação (anti-duplo-clique, rotaciona no sucesso); **histórico imutável** via
  `documentReview.getReviewDecisions`; estado reconstruído do backend após reload; dark mode/acessível.
- `X-Correlation-Id` passa a ser enviado pelo cliente (`main.tsx`) — correlação ponta a ponta.

## Multi-tenant
- Toda leitura/escrita filtra `organizationId`; mutação cross-tenant → `NOT_FOUND` (não vaza existência);
  histórico cross-tenant → vazio. Coberto no smoke.

## Testes e gates
- Unit `document-review-rules.test.ts` (transição de devolução + SoD).
- Smoke MySQL `document-review-mysql-smoke.test.ts` (version-aware, SoD, reason, idempotência
  replay/conflito/concorrência, guarda de versão, nova versão não herda aprovação, multi-tenant) + step no CI.

## Fora de escopo (inalterado)
CATMAT/CATSER (C.2A) · limiar `minScore` (decisão institucional) · migração/cutover de IA legada ·
remoção de legado · Railway/secrets/flags.
