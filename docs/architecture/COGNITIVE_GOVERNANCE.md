# Governança Cognitiva e Documental (PR C)

> Consolida a governança das operações de IA, aprovações institucionais, idempotência e
> rastreabilidade ponta a ponta. **Aditivo e não-destrutivo**: reutiliza o gateway cognitivo
> canônico, o serviço único de idempotência e os papéis RBAC já existentes — sem mecanismos paralelos.

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
- **`assessMatchSafety`** dá o sinal explícito **"sem correspondência segura"** (`no_candidates` /
  `below_threshold`) — **nunca fabrica código**; expõe o melhor candidato para revisão humana sem
  marcá-lo como confirmado.
- O limiar (`DEFAULT_MIN_SAFE_SCORE`) é **provisório e sobreponível**; o valor institucional definitivo
  é decisão de negócio (ver §6).

## 6. Limitações e responsabilidades humanas / itens deferidos

A decisão final é sempre **humana**. Itens do escopo original **deferidos** por acionarem condições de
parada (código é a verdade operacional):

- **Migração dos ~7 sites legados de IA para o gateway** (`services/gemini.ts`, `services/ai/suggestions.ts`,
  4× `invokeLLM`): vários estão em `LEGACY_ACTIVE_MAINTENANCE_ONLY` (pipeline documental **ativo em
  produção**, política "sem migração, sem remoção"). Migrar = **mudança de produção**.
- **Reescrever o caminho de aprovação ligado à UI** (`documentsRouter`, legacy-ativo, hoje owner-only):
  **mudança de produção**. A regra reviewer≠autor foi aplicada no state machine canônico.
- **Limiar institucional de confiança do CATMAT + validação anti-fabricação contra a API real**
  (`dadosabertos.compras.gov.br`): **decisão institucional não definida**. A infraestrutura ("sem
  correspondência segura" + `source`) está pronta para recebê-la.
