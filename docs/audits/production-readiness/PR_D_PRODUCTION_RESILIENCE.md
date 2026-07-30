# PR D — Produção e Resiliência (entrega)

> Bloco D do [plano de remediação](./PRODUCTION_REMEDIATION_PLAN.md). Torna o deploy seguro,
> observável, testável e reversível. **Sem merge, sem alteração manual em produção** — aguarda
> homologação. Branch: `claude/rebuild-licigov-pro-bFyTO`.

## Mapa achado → ação

| Achado | Estado anterior | Ação nesta PR |
|---|---|---|
| **DEPLOY-019 / DEPLOY-049 / G7** | "build" era `echo`; sem typecheck/lint/build/isolamento no gate | Gate de CI real: `pnpm check`, lint de não-regressão, `pnpm test`, smokes de isolamento (`test:smoke:security`), `pnpm build`; `deploy` depende de todos via `needs` ([CI_CD_GATES](../../architecture/CI_CD_GATES.md)) |
| **OBS-043** | Sem endpoint HTTP de health | `GET /health`,`/healthz`,`/readyz` (readiness 200/503) + `/livez` (liveness) — `server/_core/health.ts` |
| **AI-014** | IA sem timeout/retry/abort | `withTimeout`+`withRetry` (`server/_core/resilience.ts`) e `resilientAiCall` (`server/_core/ai/aiResilience.ts`) em volta do `provider.generate` no motor cognitivo; flags `AI_TIMEOUT_MS`/`AI_MAX_ATTEMPTS` |
| **AI-015** | (já resolvido) fail-closed do mock | **Intacto** — o wrapper de resiliência NÃO toca em `selectProvider`; erro determinístico/`NoRealAIProviderError` nunca é re-tentado |
| **DATA-012** | Versionamento sem transação (colisão de versão / ponteiro divergente) | `documentVersionService.createVersion`/`restoreToVersion` agora transacionais (`db.transaction` + `SELECT … FOR UPDATE` como mutex por documento) |
| **SEC-036** | Helmet `contentSecurityPolicy:false` incondicional em produção | CSP configurável via `HELMET_CSP_ENABLED` (opt-in, validável em staging) |
| **DOC-056** | Docs diziam `AWS_REGION`; código lê `AWS_S3_REGION` | Documentação corrigida para `AWS_S3_REGION` (código já estava correto) |
| **DEPLOY-050 / DEPLOY-051 / G11** | Backup só manual, sem checksum; restore nunca testado | Backup **agendado** + checksum + retenção; **teste de restauração isolado** (fixture) com evidência ([runbook](../../ops/DB_RESTORE_RUNBOOK.md)) |
| **OBS-044** | Observabilidade incompleta | Eventos estruturados (via `serviceLogger`/`structuredLog`) para readiness degradado, retry/timeout/falha de IA e rollback de transação crítica |
| **PERF-052 / binding de porta** | `findAvailablePort` varria portas mesmo em produção | Varredura de porta só em **dev**; produção/staging usa a porta injetada (respeita o Railway) |

## Escopo honesto — o que ficou como follow-up (não mascarado)

- **Transações P1/P3/P4** (documentos oficiais `officialDocumentLifecycle`, aditivos
  `contractService`, criação de processo + evento): exigiriam threading de `tx` pela camada `db/`
  (risco de regressão ampla) ou `UNIQUE(lineageId,version)` (migration). Fora do escopo desta PR;
  o padrão transacional entregue em `documentVersionService` é a referência para replicá-los.
- **Dependências vulneráveis (SEC):** `pnpm audit --prod` acusa críticas/altas pré-existentes;
  correção = upgrades (fora do escopo). Gate de audit roda **advisory** e transparente.
- **Drill de restore com backup REAL (G11):** implementado o workflow + validação por fixture +
  runbook; o drill com `BACKUP_DATABASE_URL` é **ação operacional** (jamais sobre produção).
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

## Testes adicionados

- `resilience.test.ts` — timeout (abort), retry transitório, limite de tentativas, determinístico sem retry.
- `health-endpoint.test.ts` — 200/503, liveness, sem exposição de secrets (HTTP real via `app.listen(0)`).
- `ai-resilience.test.ts` — classificação transitório×determinístico, retry, fail-closed sem retry, timeout+abort.
- `document-version-transaction.test.ts` — atomicidade, rollback, `correlationId`, versão+ponteiro na mesma transação.

Concorrência real de numeração (FOR UPDATE) e isolamento por tenant são exercidos pelos smokes
MySQL no CI.
