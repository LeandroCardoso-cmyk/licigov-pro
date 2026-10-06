# Pilot Reset B2/B3 — lifecycle governado do Processo Licitatório

> Estado: **IMPLEMENTED_LOCAL / TESTED_LOCAL / NOT_EXECUTED_IN_PRODUCTION** (branch
> `work/autonomous-semantic-remediation-r3-r11`).
> **O processo real 2026/253 do tenant piloto foi apenas objeto de DISCOVERY read-only** (fases A2/A2.1/A2.2:
> Identity Gate confirmado, inventário agregado). **Nenhum reset real foi executado**, nenhum dado de produção foi
> lido ou alterado por esta implementação, e todos os testes usam órgãos e números **sintéticos**.
> Código: `server/domain/processLifecycle.ts` (regra pura), `server/db/processLifecycle.ts`,
> `server/services/processLifecycleService.ts`, `server/routers/processLifecycleRouter.ts` (montado como
> `processLifecycle`), migration `drizzle/0313_procurement_process_lifecycle.sql`.

## 1. Por que

O discovery do piloto concluiu **RESET_ELIGIBLE** (nenhum estado formal/oficial: sem emissão, promoção oficial,
contrato, assinatura ou publicação) mas **NOT DISCARD_ELIGIBLE** (há estado de piloto: DFD e edições, pesquisa de
preços, importação, staging, checksum, itens, CATMAT, contexto e timeline). Desde a PR-05, criar de novo o mesmo número
recebe CONFLICT — e reaproveitar o mesmo `processId` como "processo novo" herdaria todo esse estado. A solução é uma
**nova geração** com identidade própria, preservando a anterior.

## 2. Modelo

| Conceito | Representação |
|---|---|
| Identidade interna estável | `procurement_processes.id` (opaco). Gerações novas: `sha256("plp-gen:org:lineage:n")[0:20]` — nunca derivado do número |
| Número administrativo | `process_number` (atributo; corrigível por operação governada) |
| Linhagem | `lineage_id` = `pln_` + `sha256("pln:org:processoRaiz")[0:20]`, materializada no 1º lifecycle; `NULL` = geração única (todas as linhas anteriores à 0313) |
| Geração | `generation_no` (1, 2, …) e `supersedes_process_id` |
| Estado | `lifecycle_state`: `active` · `superseded` · `discarded` · `cancelled` · `archived` |
| Revisão (CAS) | `lifecycle_revision` |
| Ledger append-only | `procurement_process_lifecycle_events` (antes/depois, motivo, ator, digest, revisões, chave, hash do pedido, resultado, correlationId) |

**Invariantes no banco** (colunas geradas STORED, colação binária): no máximo **uma geração ativa por linhagem**
(`uq_pp_active_lineage`) e **um processo ativo por número** no órgão (`uq_pp_active_number`). Só a geração `active` é
resolvida por `getProcess`/`listProcesses`/`updateProcessStage`/ingestão: gerações históricas ficam fora das listas e
**nenhuma mutação as alcança** (resposta NOT_FOUND neutra). O histórico é lido por `processLifecycle.history`.

## 3. Operações

| Ação | Quando | Efeito | Nunca |
|---|---|---|---|
| **Preview** (`processLifecycle.preview`) | sempre (operator+) | read-only: ação, elegibilidade, bloqueios, contagens por domínio, geração, estado, revisão, **digest**, efeito institucional | escreve ou trava |
| `CORRECT_NUMBER` | ativo, sem estado formal | troca o número da geração (antes/depois no ledger); id preservado | número de outro processo ativo (CONFLICT `PROCESS_NUMBER_TAKEN`) |
| `DISCARD_DRAFT` | ativo, sem estado formal **e** sem trabalho | `discarded` (linha mantida) | DELETE; liberar o número para "criar de novo" |
| `RESET_DRAFT` | ativo, sem estado formal | antiga → `superseded` (imutável, com todos os filhos); nova geração `active`, limpa, mesmo número, mesmo objeto/opção de início/responsável | apagar ou reapontar filhos |
| `CANCEL` | ativo, não emitido nem publicado | `cancelled` | cancelar emitido (exige ato próprio) |
| `ARCHIVE` | ativo (qualquer estado) | `archived` | reiniciar estado formalizado |

Estado formalizado **nunca** é tratado como reset: `OFFICIAL_STATE_BLOCKS_RESET` + o código do domínio.

## 4. Elegibilidade

| Domínio formal/oficial (bloqueia correção, descarte e reset) | Código |
|---|---|
| processo emitido (`status = emitido` ou etapa `ISSUED`) | `PROCESS_ISSUED` |
| promoção oficial (`official_document_promotions`) | `OFFICIAL_PROMOTION_EXISTS` |
| documento oficial `emitido` com origem no processo | `OFFICIAL_DOCUMENT_ISSUED` |
| contrato derivado (`contract_workspaces.origin_process`) | `DERIVED_CONTRACT_EXISTS` |
| resposta institucional assinada | `SIGNED_INSTITUTIONAL_RESPONSE` |
| parecer assinado (workspace com `reference_process_id`) | `SIGNED_LEGAL_OPINION` |
| publicação (`publication_records`) | `PUBLICATION_EXISTS` |

Domínios de trabalho (bloqueiam só o descarte — `WORK_STATE_BLOCKS_DISCARD`): rascunhos e edições de documentos,
pesquisa de preços, sessões e promoções de importação, itens e lotes, decisões CATMAT, fatos de contexto além dos de
criação, eventos de timeline além do de criação.

Todas as contagens vêm de **uma** consulta agregada tenant-scoped, com subconsultas indexadas por (organização,
processo), colação explícita do lado do processo e sem LIKE ou varredura de JSON.

## 5. Digest, CAS e idempotência

- **Digest** = SHA-256 de `[versão, ação, órgão, processo, número, status, etapa, linhagem, geração, estado, revisão,
  contagens formais, contagens de trabalho]`. É por ação.
- **Execução** (`processLifecycle.execute`, manager+) exige `expectedRevision`, `expectedEligibilityDigest`,
  `idempotencyKey` e `reason` (mín. 10 caracteres). Numa transação: replay por chave → `SELECT … FOR UPDATE` da geração →
  snapshot recomputado **sob lock** → revisão ≠ esperada ⇒ `LIFECYCLE_STALE_REVISION`; digest ≠ do preview ⇒
  `STALE_PREVIEW` → elegibilidade recomputada ⇒ `PRECONDITION_FAILED` com códigos → escrita.
- **Idempotência:** mesma chave + mesmo pedido ⇒ o mesmo resultado (`replayed: true`), zero escrita; mesma chave + pedido
  diferente ⇒ `LIFECYCLE_IDEMPOTENCY_CONFLICT`. Retries nunca geram múltiplas gerações, eventos ou superações.
- **Concorrência:** o lock da linha serializa; a perdedora vê a revisão nova ⇒ CONFLICT. As UNIQUE geradas são a última
  barreira (colisão ⇒ CONFLICT).

## 6. RBAC e IA

Preview: operator+. Execução: **manager+** (piso técnico; não é autoridade jurídica). Leitura do histórico: tenant.
`organizationId` sempre do contexto. **IA: nenhum caminho** — o serviço não importa IA, storage/S3, HTTP, e-mail nem
provider (guarda estática L12). Dentro da transação só há persistência local determinística; efeitos externos futuros
iriam para outbox pós-commit.

## 7. Migration 0313

Aditiva e replay-safe: guard fail-closed **antes** de qualquer DDL (`0313_FC_DUP_ACTIVE_PROCESS_NUMBER` se houver número
duplicado no órgão — impossível pela PK atual; o guard não reavalia quando a coluna já existe), colunas com DEFAULT (o
"backfill" é só o default: `active`, revisão 0, geração 1, linhagem NULL), colunas geradas, UNIQUE, índice e o ledger.
Testada em banco limpo, upgrade com dados (colunas antigas idênticas), rerun do runner, reaplicação manual e
precondição (`process-lifecycle-0313-migration-mysql-smoke`). **Não executada em produção.**

Rollback lógico: o build anterior ignora as colunas (não as escreve; as linhas seguem `active`). Remover as colunas
exigiria DROP manual, só seguro se nenhum lifecycle tiver sido executado.

## 8. Falhas e observabilidade

| Situação | Resposta | Escrita |
|---|---|---|
| processo de outro órgão / inexistente | NOT_FOUND neutro (idêntico) | nenhuma |
| campos ausentes | BAD_REQUEST `LIFECYCLE_FIELDS_REQUIRED` | nenhuma |
| estado mudou após o preview | CONFLICT `STALE_PREVIEW` | nenhuma |
| revisão desatualizada / corrida | CONFLICT `LIFECYCLE_STALE_REVISION` | nenhuma |
| inelegível | PRECONDITION_FAILED com códigos | nenhuma |
| banco indisponível | INTERNAL_SERVER_ERROR (fail-closed) | nenhuma |

Logs: `process_lifecycle_executed` / `_replayed` / `_refused` / `_conflict` / `_rejected`, com órgão, processo, ação,
ator, correlationId, linhagem, estados e `durationMs` — sem conteúdo documental nem motivo textual.

## 9. Testes (MySQL 8 real, dados sintéticos)

`pilot-reset-lifecycle-mysql-smoke` (L1–L12): preview zero-write e digest; RBAC; reset com geração antiga imutável,
filhos intactos e nova geração limpa; idempotência; STALE_PREVIEW e CAS; os 7 bloqueios formais; descarte sem DELETE;
correção de número auditável e protegida; concorrência; cross-tenant; cancelar × arquivar; transação sem chamada remota.
`process-lifecycle-0313-migration-mysql-smoke` (M1–M3) e `unit/process-lifecycle-domain`.

## 10. Execução futura no piloto (NÃO feita)

Exige, em ordem: merge e deploy desta capacidade com a 0313; preview read-only do processo real pelo owner/admin; decisão
humana explícita da ação (`RESET_DRAFT` é a elegível pelo discovery) e do motivo; execução por manager+ com o digest do
preview; verificação read-only do resultado. Cada passo com autorização própria.
