# C.3A-OPS — Controle Institucional de Feature Flags (entrega)

> Menor superfície institucional para **consultar** e **alterar** overrides tenant-aware em
> `tenant_feature_flags`, de forma **auditável, replay-safe, multi-tenant, RBAC (admin de plataforma)
> e fail-closed**. Habilita a futura homologação controlada de `FF_DIRECT_CONTRACT_SHADOW` em STAGING.
> **Nenhuma flag é ativada nesta PR.** Nenhuma migration, nenhum RBAC novo, nenhuma allowlist/freeze
> alterada, nenhuma mudança de Railway/produção.

## Superfície (tRPC `featureFlagAdmin`)
- **`getTenantFlag`** (`adminProcedure`, query): `{ organizationId, flagName }` →
  `{ override, global, effectiveValue, origin }`, onde `origin ∈ { tenant | global | default }`.
- **`setTenantFlag`** (`adminProcedure`, mutation): `{ organizationId, flagName, enabled, expiresAt?,
  reason, idempotencyKey }` → estado final `{ before, after, effectiveValue, origin, replayed }`.

Ambos restritos a **admin de plataforma** (`adminProcedure` — `ctx.user.role === 'admin'`), **não** a
operator/manager/owner de organização. Nenhum RBAC novo foi inventado.

## Autorização e guarda de ambiente
- **RBAC:** reuso de `adminProcedure` (`server/_core/trpc.ts`).
- **Guarda de ambiente (obrigatória):** LEITURA liberada em qualquer ambiente autorizado; **ESCRITA
  BLOQUEADA em produção** no backend via `IS_PRODUCTION` (fonte canônica `server/config/env.ts` —
  `APP_ENV` tem precedência sobre `NODE_ENV`). Em produção, `setTenantFlag` retorna `FORBIDDEN` estável
  **antes de qualquer efeito** — sem write, sem bypass. Nunca confia em env do cliente.

## Camada de serviço (regra de negócio)
`server/services/featureFlagAdminService.ts` concentra toda a lógica (o router é fino):
guarda de ambiente → allowlist → validações (`reason` não-vazia, `idempotencyKey`, `expiresAt` futura) →
existência do tenant → idempotência → transação atômica (UPSERT + auditoria) → invalidação de cache →
estado final. `percentage` permanece **sempre 100** (sem rollout gradual nesta superfície).

## Autoridade dos nomes de flag (allowlist explícito)
A avaliação (`featureFlagService.isFeatureEnabled`) resolve um override de tenant **sem exigir** linha no
registro global `feature_flags` (que hoje semeia apenas kill-switches de Ops — `FF_*_DISABLE`,
`FF_OUTBOX_DISPATCHER_PAUSE`, etc.; a flag da C.3A **não** está lá). Para **não** permitir nomes
arbitrários, esta camada define um **allowlist canônico e explícito** — `GOVERNABLE_TENANT_FLAGS` —
contendo hoje apenas **`FF_DIRECT_CONTRACT_SHADOW`** (o propósito declarado). Escrever/consultar uma flag
fora do allowlist é recusado com `BAD_REQUEST`. Ampliar o conjunto é decisão arquitetural explícita.
A semântica da flag da C.3A é compatível com o mecanismo de override (não é kill-switch), portanto **não**
há divergência incompatível com o registro global — apenas a formalização de que flags tenant-aware são
declaradas em código, não semeadas no registro global.

## Idempotência (replay-safe)
Reuso do mecanismo ÚNICO `runWithIdempotency` (operação `feature-flag.set`). `payloadHash` cobre
`organizationId + flagName + enabled + expiresAt + reason`.
- Mesma chave + mesmo payload → **replay** (não reexecuta, não altera de novo, **não duplica auditoria**).
- Mesma chave + payload diferente → **`CONFLICT`** (nunca sobrescreve o efeito sob a mesma chave).

## Persistência + Auditoria ATÔMICA
- **Estado:** UPSERT em `tenant_feature_flags` (PK `organizationId + flagName`). Sem migration
  (tabela pré-existente). `percentage = 100`, `createdBy = ator`.
- **Auditoria:** trilha append-only em `activity_logs`, gravada **no MESMO `tx`** do UPSERT via
  `tx.insert(activityLogs)` — **nunca** via `logActivity` fail-silent. Se a auditoria falhar, a transação
  inteira sofre rollback e a flag **não muda** → impossível "flag alterada mas auditoria perdida".
  Campos: ator (`userId`/nome/email/papel), `organizationId`, `flagName`, estado **antes/depois**
  (enabled + expiry antes/novo), `reason`, `correlationId`, `idempotencyKey`, `timestamp` (`createdAt`).
  `action ∈ { feature_flag_enabled | feature_flag_disabled }`, `entityType = 'feature_flag'`.

> **Atomicidade — verificação da condição de PARADA:** `getDb()` (`drizzle-orm/mysql2`) expõe
> `.transaction(tx)`; `tenant_feature_flags` e `activity_logs` são graváveis pelo mesmo executor `tx`.
> Logo a atomicidade (flag + auditoria) é garantida **sem** migration e **sem** novo ledger. **Não houve
> necessidade de PARAR.**

## Cache
Após a operação, `invalidateFlagCache(flagName, organizationId)` — a leitura imediata (`isFeatureEnabled`
/ `getTenantFlag`) reflete o novo estado (via DB). É apenas evicção em memória (não é efeito persistente),
segura mesmo em replay; o replay **não** cria nova auditoria nem novo efeito de domínio.

## Multi-tenant
`organizationId` explícito em leitura, escrita, idempotência e auditoria. Alterar A **não** altera B
(A ≠ B, provado no smoke MySQL). Tenant desconhecido → `NOT_FOUND` antes de qualquer write.

## Expiry
`expiresAt` opcional (data futura; `null` = sem expiração). Enquanto não expira, o override é efetivo;
expirado, a resolução cai para global/default (mesma semântica de `featureFlagService`). **Sem
scheduler/job** — a expiração é avaliada na leitura.

## Testes
- **Unit** `server/__tests__/feature-flag-admin.test.ts` (sem DB): allowlist, `reason`/`idempotencyKey`
  obrigatórios, `expiresAt` passada recusada, leitura fail-closed sem DB, **guarda de produção** (ESCRITA
  bloqueada — `FORBIDDEN` antes de qualquer efeito).
- **Smoke MySQL real** `server/__tests__/integration/feature-flag-admin-mysql-smoke.test.ts` + step no
  `ci.yml`: leitura (default/override/expiry), escrita (enable/disable/expiry, auditoria persistida com
  todos os campos), replay (sem 2ª alteração, sem 2ª auditoria; chave+payload diferente → `CONFLICT`),
  invalidação de cache, isolamento multi-tenant (A ≠ B), tenant inexistente → `NOT_FOUND`.

## Fora de escopo / limitações
Sem ativação de flag; sem rollout `%`; sem escrita em produção; sem UI nova (backend + procedimento
operacional autenticado bastam); sem migration; sem alteração de allowlist de fronteira/freeze; sem
alteração de Railway/secrets; sem mudança na C.3A shadow.

## Procedimento operacional (homologação futura em STAGING)
Autenticado como **admin de plataforma**, em ambiente **staging** (nunca produção):
1. `featureFlagAdmin.setTenantFlag` `{ organizationId: <tenant staging>, flagName:
   "FF_DIRECT_CONTRACT_SHADOW", enabled: true, reason: "<justificativa>", idempotencyKey: "<uuid>" }`.
2. Conferir com `featureFlagAdmin.getTenantFlag` → `origin: "tenant"`, `effectiveValue: true`.
3. Coletar as comparações do shadow em `cognitive_observability` (ver
   [`C3A_DIRECT_CONTRACT_SHADOW_DELIVERY.md`](./C3A_DIRECT_CONTRACT_SHADOW_DELIVERY.md)).
4. Ao encerrar a janela: `setTenantFlag` `{ enabled: false, ... }` (nova `idempotencyKey`).
