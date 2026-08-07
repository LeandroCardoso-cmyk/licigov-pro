# Fundação de Governança Cognitiva e Documental (PR C.1)

> Estabelece a **fundação** da governança de IA, aprovações, idempotência e rastreabilidade.
> **Aditivo e não-destrutivo**: reutiliza o gateway cognitivo canônico, o serviço único de
> idempotência e os papéis RBAC já existentes — sem mecanismos paralelos. Wiring operacional,
> UI e migração de legados ficam para o bloco **C.2** (§6).

## 1. Gateway cognitivo canônico

Toda cognição oficial passa pelo **Cognitive Kernel** (`executeCognitiveTask`, em
`server/services/aiExecutionEngine.ts`). O provider/modelo é decidido **exclusivamente** pela política
da tarefa via Provider Adapter (`server/_core/ai/`). `invokeLLM`/`llm.ts` permanece **fronteira legada
allowlistada** (`server/kernel/architecture/legacyBoundaries.ts` → `INVOKE_LLM_LEGACY_ALLOWLIST`),
enforçada pelos boundary-tests (`rc352-boundary-enforcement`, `rc41-cognitive-activation`).

### Ledger de governança (tenant-aware, auditável)

Cada execução cognitiva grava um registro de governança na observabilidade persistida
(`cognitive_observability`, recuperável por `correlationId`) — **sem migration** (reutiliza o campo
`payload`). O registro (`CognitiveGovernanceRecord`, em `cognitive/cognitiveObservabilityService.ts`)
contém:

| Campo | Origem |
|---|---|
| `actorUserId` | contexto da requisição (usuário/ator) |
| `operation` | id da Cognitive Task |
| `module` | business domain de origem (`unspecified` se ausente) |
| `provider` / `model` | política resolvida |
| `promptTemplateId` / `promptContractVersion` | builder tipado + contrato da resposta |
| `inputHash` / `outputHash` | SHA-256 do insumo/saída governados (integridade) |
| `inputPreview` / `outputPreview` | pré-visualização **bounded** (≤280 chars) |
| `processId` / `documentRefs` | vínculo com processo/documento |
| `reviewState` | `pending_human_review` \| `invalid` \| `failed` |
| `error` | erro estruturado `{ code, message }` em falha/contrato inválido |

**Nunca** persiste chain-of-thought privada: apenas metadados institucionais, hashes e pré-visualização
governada. Falhas de provider e de contrato (Structured Output inválido) são persistidas via
`recordCognitiveFailure` (status + erro estruturado) antes de propagar o erro — sem alterar o fluxo.

## 2. CorrelationId ponta a ponta

`X-Correlation-Id` é propagado Frontend → tRPC/HTTP (`correlationMiddleware` + `TrpcContext.correlationId`)
→ service → gateway de IA → persistência/observabilidade. Quando o cliente não envia, o backend gera.
O mesmo `correlationId` reconstrói toda a execução (observabilidade + lineage).

## 3. Idempotência e replay-safety

Serviço **único** `server/services/idempotencyService.ts` (tenant-aware por `organizationId+userId+key`,
UNIQUE `idempotency_org_user_key`). Reforçado nesta PR:

- **Concorrência-safe:** o caminho "new" agora captura a violação do UNIQUE (corrida de INSERT), relê a
  linha vencedora e devolve o estado real — em vez de propagar um erro cru.
- **`runWithIdempotency(params, fn)`** (wrapper canônico, não um segundo mecanismo): replay seguro
  (mesma chave+payload → resultado anterior), conflito explícito (mesma chave+payload diferente →
  `CONFLICT`), operação em andamento → `CONFLICT`, falha nunca cacheada como sucesso, sem conclusão
  parcial tratada como sucesso.

Operações que já exigem chave: **upload/importação** (ingestão) e **promoção** (ledger `import_promotions`).
As demais operações do escopo (geração/regeneração/exportação/aprovação/confirmação CATMAT) reutilizam
`runWithIdempotency` ao serem ligadas — ver §6 (itens que tocam produção congelada).

## 4. Aprovações institucionais (segregação de deveres)

State machine canônico `documentWorkflowService.applyTransition`. Regra pura e testável
`assertInstitutionalDecisionRules`:

- **reviewer ≠ autor:** quem gerou/submeteu o conteúdo (inclusive uma saída de IA) não pode aprová-lo.
- **Nenhuma IA/sistema aprova:** a aprovação exige um revisor humano identificado.
- **Justificativa obrigatória** em rejeição e devolução ao rascunho.
- Histórico **imutável/versionado** (novo `version` + timeline append-only + activity log) — a aprovação
  não altera retroativamente o conteúdo; nova alteração gera nova versão e nova revisão.
- Papel mínimo via RBAC existente (`orgRoleProcedure`/`WORKFLOW_ROLE_REQUIREMENTS`) — sem RBAC paralelo.

## 5. CATMAT/CATSER supervisionado

Domínio puro `server/domain/catmatMatching.ts`:

- Sugestões carregam **proveniência** (`source`) e **confiança** (`score`); a IA/heurística **apenas
  sugere** (`decision: "sugerido"`).
- **`assessMatchSafety` é FAIL-CLOSED** — dá o sinal explícito **"sem correspondência segura"**
  (`no_candidates` / `below_threshold` / `threshold_not_configured`) e **nunca declara `safe:true`
  sem um limiar institucional explicitamente fornecido**. **Não há default arbitrário.** Expõe o melhor
  candidato para revisão humana sem marcá-lo como confirmado; **nunca fabrica código**.
- O valor institucional do limiar é **decisão de negócio pendente** (bloco C.2 — ver §6).

## 6. Estado desta fundação (C.1) e próximo bloco (C.2)

A decisão final é sempre **humana**. O que **C.1 entrega** e o que **fica pendente**:

**Entregue (C.1):**
- Ledger de governança cognitiva gravado pelo gateway canônico.
- Serviço de idempotência **reforçado** (concorrência-safe + `runWithIdempotency`) — porém **ainda não
  ligado a todas as operações** (hoje só ingestão/promoção o usam).
- Regras canônicas de **segregação de deveres** implementadas no state machine — porém o **fluxo legado
  usado pela UI** (`documentsRouter`) **permanece inalterado**.
- Contrato **seguro e fail-closed** do CATMAT (`source` + "sem correspondência segura") — porém
  **confirmação operacional/UI e o limiar institucional ficam pendentes**.
- **Nenhuma chamada legada de IA foi migrada.**

**Próximo bloco — C.2 (não implementado agora):**
- Wiring de idempotência em **geração, regeneração, exportação, upload, aprovação e CATMAT**.
- Aprovação **version-aware** no fluxo efetivamente usado pela UI.
- **UI** de revisão / aprovação / solicitação de ajustes.
- **Confirmação humana e auditoria** CATMAT/CATSER (quem/quando/processo/item, rejeição/substituição).
- **Plano supervisionado de migração** das chamadas legadas de IA ao gateway (várias em
  `LEGACY_ACTIVE_MAINTENANCE_ONLY` = produção ativa) e definição do **limiar institucional** do CATMAT
  (+ validação anti-fabricação contra `dadosabertos.compras.gov.br`).
