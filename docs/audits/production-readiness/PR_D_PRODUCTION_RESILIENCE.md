# PR D — Produção e Resiliência (entrega)

> Bloco D do [plano de remediação](./PRODUCTION_REMEDIATION_PLAN.md). Torna o deploy seguro,
> observável, testável e reversível. **Sem merge, sem alteração manual em produção** — aguarda
> homologação. Branch: `claude/rebuild-licigov-pro-bFyTO`.

## Mapa achado → ação

| Achado | Estado anterior | Ação nesta PR |
|---|---|---|
| **DEPLOY-019 / DEPLOY-049 / G7** | "build" era `echo`; sem typecheck/lint/build/isolamento no gate | Gate de CI real: `pnpm check`, lint de não-regressão, `pnpm test`, smokes de isolamento (`test:smoke:security`), `pnpm build`; `deploy` depende de todos via `needs` ([CI_CD_GATES](../../architecture/CI_CD_GATES.md)) |
| **OBS-043** | Sem endpoint HTTP de health | `GET /health`,`/healthz`,`/readyz` (readiness 200/503) + `/livez` (liveness) — `server/_core/health.ts` |
| **AI-014** | IA sem timeout/retry/abort | `withTimeout`+`withRetry` (`server/_core/resilience.ts`) e `resilientAiCall` (`server/_core/ai/aiResilience.ts`) em volta do `provider.generate`; **timeout também no SDK** (`RequestOptions.timeout` em `gemini.ts` — aborta a chamada HTTP real); flags `AI_TIMEOUT_MS`/`AI_MAX_ATTEMPTS` |
| **AI-015** | (já resolvido) fail-closed do mock | **Intacto** — o wrapper de resiliência NÃO toca em `selectProvider`; erro determinístico/`NoRealAIProviderError` nunca é re-tentado |
| **DATA-012** | Versionamento e documento oficial sem transação (colisão de versão / ponteiro divergente / evento perdido) | `documentVersionService.createVersion`/`restoreToVersion` (`db.transaction` + `SELECT … FOR UPDATE`) **e** `officialDocumentLifecycle.createDocument` (transação + `GET_LOCK` por linhagem, serializa até a 1ª versão) |
| **SEC-036** | Helmet `contentSecurityPolicy:false` incondicional em produção | **CSP secure-by-default**: ligada por padrão em produção/staging; `HELMET_CSP_ENABLED=false` só como escape hatch; validação em staging = ação operacional |
| **DOC-056** | Docs diziam `AWS_REGION`; código lê `AWS_S3_REGION` | Documentação corrigida para `AWS_S3_REGION` (código já estava correto) |
| **DEPLOY-050 / DEPLOY-051 / G11** | Backup só manual, sem checksum; restore nunca testado | Backup **agendado** + checksum + retenção + **criptografia**; teste isolado por fixture **+ drill de restauração com backup REAL concluído** em banco descartável (run `30682397855`, **312 tabelas / 120 migrations / órfãs=0 / mismatch=0**, **PASS**) → **G11 = PASS** ([evidência](./DB_RESTORE_DRILL_EVIDENCE.md), [runbook](../../ops/DB_RESTORE_RUNBOOK.md)) |
| **DEPLOY-049 (deps)** | Audit mascarado (`\|\| true`) | Gate de auditoria com **baseline** (`security/audit-baseline.json`): bloqueia NOVA high/critical, dívida pré-existente auditável ([triagem](../../ops/DEPENDENCY_AUDIT_TRIAGE.md)) |
| **OBS-044** | Observabilidade incompleta | Eventos estruturados (via `serviceLogger`/`structuredLog`) para readiness degradado, retry/timeout/falha de IA e rollback de transação crítica |
| **PERF-052 / binding de porta** | `findAvailablePort` varria portas mesmo em produção | Varredura de porta só em **dev**; produção/staging usa a porta injetada; `railway.json` aponta o healthcheck para `/readyz` |

## Escopo honesto — o que ficou como follow-up (não mascarado)

- **Transações P3/P4** (aditivos `contractService.createAddendum`, criação de processo + evento em
  `procurementProcessRouter`, `importPriceResearch`): **deixadas para follow-up** porque (a) não são
  o núcleo documental que DATA-012 aponta, (b) o padrão transacional já está entregue e testado em
  `documentVersionService` (FOR UPDATE) e `officialDocumentLifecycle` (GET_LOCK) — replicá-lo é
  mecânico; (c) evitam ampliar o diff/risco desta PR. Justificativa técnica: as P1 efetivamente
  usadas no fluxo canônico (versão de documento e documento oficial) **foram** cobertas.
- **Dependências vulneráveis (SEC):** 3 críticas + 45 altas pré-existentes; correção = upgrades
  (fora do escopo). O gate **bloqueia novas** (baseline); reduzir o baseline é ação operacional.
- **Drill de restore com backup REAL (G11 `PASS`):** ✅ **concluído** em banco descartável e isolado
  (`RESTORE_TARGET_URL`, endpoint público) — run `30682397855`, evidência segura em
  [`DB_RESTORE_DRILL_EVIDENCE.md`](./DB_RESTORE_DRILL_EVIDENCE.md). Ressalva: falso negativo de cleanup
  posterior às validações, corrigido em `0fd5099`. A **política definitiva de backup institucional**
  (retenção longa/rotação/off-site) permanece como follow-up.
- **Required checks / Wait for CI:** o bloqueio efetivo do deploy exige branch protection + Railway
  (ação operacional — o `needs` sozinho não bloqueia).
- **Gate de lint completo:** hoje não-regressão; caminho documentado em CI_CD_GATES.

## Replay safety da IA

O retry ocorre **dentro** de `resilientAiCall`, **antes** de qualquer persistência (a persistência
do resultado vive uma camada acima — `answerConsultation`, idempotente por
`executionId=computeExecutionId(org, correlationId)`). Logo, re-tentativas técnicas **não** geram
resposta/versão/evento duplicado, e o mock **nunca** é servido silenciosamente como oficial.

## Divergência Graphify × código (registrada)

O Graphify lista "Numeração Automática Sequencial" como **roadmap**; no código **não há** contador
de número de processo (id determinístico `sha256` + `onDuplicateKeyUpdate` = idempotência). Não é
uma corrida de contador. As corridas reais estavam no **versionamento** (tratadas nesta PR).

## Consumidores das transações (mapeamento)

`documentVersionService.createVersion`/`restoreToVersion` são consumidos por `documentService`,
`documentWorkflowService`, `documentDraftService`, `documentEngineService` e `documentsRouter` —
todos passam a herdar a atomicidade. `officialDocumentLifecycle.createDocument` é o produtor
canônico de documentos oficiais (Document Engine). Operações canônicas que **seguem sem transação**
(follow-up justificado): `contractService.createAddendum`/apostilamento e
`procurementProcessRouter` (processo + evento / `importPriceResearch`).

## Testes adicionados

- `resilience.test.ts` — timeout (abort), retry transitório, limite de tentativas, determinístico sem retry.
- `health-endpoint.test.ts` — 200/503, liveness, sem exposição de secrets (HTTP real via `app.listen(0)`).
- `ai-resilience.test.ts` — classificação transitório×determinístico, retry, fail-closed sem retry,
  timeout+abort, **retries sequenciais** e **descarte de chamada tardia** (replay safety).
- `document-version-transaction.test.ts` — atomicidade, rollback, `correlationId`, versão+ponteiro na mesma transação (mock).
- `document-version-concurrency-mysql-smoke.test.ts` — **MySQL real (CI)**: duas criações
  concorrentes sem versão duplicada (FOR UPDATE), rollback sem registro parcial, consistência do ponteiro.

Concorrência real de numeração (FOR UPDATE / GET_LOCK) e isolamento por tenant são exercidos pelos
smokes MySQL no CI.
