# R2.2 — Decisão por tenant sobre `FF_CANONICAL_INGESTION` (SEM-005)

> **Status do checkpoint R2.2 (atualizado 2026-09-28, pós-turno): PASS_CANDIDATE — DECISION_RECORDED —
> RUNTIME_STATE_READONLY_PENDING.**
> **HUMAN DECISION RECORDED — OPTION B** (§10). A decisão foi tomada pelo owner após revisar o NIGHT SHIFT REPORT.
> A flag **não foi ativada**: a ativação é uma ação futura, feita por humano pelo mecanismo governado.
> O estado de runtime ainda **não foi confirmado no banco** (§6).
> No ledger oficial, R2.2 **não** conta como PASS até a revisão e o merge desta documentação e o cumprimento dos
> gates formais.
>
> *Texto original do turno noturno (mantido como histórico):* "IN_PROGRESS — HUMAN_DECISION_REQUIRED. Este documento
> não registra decisão humana e não altera flag. Prepara o pacote de decisão (§7) e a verificação read-only que falta (§6)."
> Baseline de achados inalterado (92/26/54/12). Documento base congelado:
> `SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md` (sha256 `08edc734…0810b3`), não editado.

| Campo | Valor |
|---|---|
| Data | 2026-09-28 (turno noturno autônomo, owner ausente) |
| Base | `main` @ `5cd9d50` |
| Checkpoint | R2.2 — "decisão humana registrada sobre `FF_CANONICAL_INGESTION` por tenant (SEM-005)" |
| Achado | SEM-005 (2ª colagem sobrescreve cotações da 1ª) — CUTOVER → PR-04 |
| Superfície | LEG-013 (`procurementProcess.importPriceResearch` + `LegacyPriceResearchPanel`) — FCC-03 aceita |
| Produção consultada | Somente logs do Railway (leitura). **Banco de produção NÃO consultado** (inacessível do sandbox, §6). |

## 1. Por que R2.2 não é PASS

PASS exige, ao mesmo tempo:
1. decisão humana prévia, documentada e inequívoca sobre a flag por tenant; e
2. estado atual confirmado read-only em produção.

| Critério | Situação | Evidência |
|---|---|---|
| Decisão humana registrada | ✅ **Registrada em 2026-09-28: Opção B** (§10) | Na noite anterior só havia registros de **não-ativação** e de que "ativação é decisão do owner" (§3). A pergunta de §13 do inventário R2.1 está respondida em §10. |
| Estado confirmado read-only | ⚠️ Parcial | Logs sem evento de ativação e sem tráfego de ingestão (§4). As tabelas `feature_flags` e `tenant_feature_flags` não foram lidas (§6). |

## 2. Como a flag é resolvida (código em `main`)

| Aspecto | Comportamento | Referência |
|---|---|---|
| Definição | `CANONICAL_INGESTION_FLAG = "FF_CANONICAL_INGESTION"`, "Default: desabilitada" | `server/services/ingestionUploadService.ts:28-29` |
| Resolução | 1) kill-switch global (não se aplica: o nome não contém `_DISABLE`); 2) override por tenant (`tenant_feature_flags`) com `percentage`/`expiresAt`; 3) valor global (`feature_flags.name`); 4) default `false` | `server/services/featureFlagService.ts:30-85` |
| Sem DB | `false` (fail-closed) | `featureFlagService.ts` (`if (!db) return false`) |
| Override expirado | Cai para o valor **global**; hoje não existe linha global (seed `0037` não a cria) | `featureFlagService.ts:71-78`; `drizzle/0037_feature_flags.sql:22-29` |
| `percentage` < 100 | Liga/desliga **aleatoriamente** a cada resolução (`Math.random`), com cache de 60 s por instância | `featureFlagService.ts:73`, `CACHE_TTL_MS = 60_000` |
| Escrita em produção | Só `featureFlagAdmin.setTenantFlag` (`adminProcedure`); única flag em `PRODUCTION_GOVERNABLE_TENANT_FLAGS`; `reason` ≥ 15 caracteres; evento `feature_flag_set` / `feature_flag_set_denied_production` | `featureFlagAdminService.ts:45-62,263,410`; `featureFlagAdminRouter.ts:16-43` |
| Escrita global | Nenhum caminho de código grava `feature_flags` para esta flag | grep em `server/`, `scripts/`, `drizzle/` |

### 2.1 Matriz de superfícies governadas pela flag

| Superfície | Governada pela flag? | Com flag OFF | Com flag ON |
|---|---|---|---|
| `ingestion.*`, servidor (upload, sessões, promoção) | ✅ `assertCanonicalIngestionEnabled` | FORBIDDEN "não habilitada" | permitido (RBAC normal) |
| `ingestion.capabilities`, servidor → UI | ✅ `ingestionRouter.ts:329` | `enabled:false` | `enabled:true` |
| `recoverStuckImportSessions` (fila) | ✅ por tenant (`importQueueService.ts:508`) | no-op para o tenant | recupera sessões |
| UI `PesquisaPrecosWorkspace` | ✅ via capabilities | painel **legado** | launcher canônico |
| UI com **falha** da consulta de capabilities | ❌ | painel legado | painel **legado** (fallback) |
| `procurementProcess.importPriceResearch` (LEG-013) | ❌ **FCC-03** | colagem legada (sobrescreve: SEM-005) | colagem legada **continua aceita** pela API |
| `directProcurement.importPriceResearch` (LEG-014) | ❌ (canônico; FIX na PR-04A) | — | — |

Com a flag ON, a API legada continua aberta e a UI volta para o painel legado se a consulta de capabilities falhar. Por isso a PR-04 exige o guard de servidor (FCC-03), ligar a flag sozinho não fecha SEM-005.

## 3. Evidência documental (decisões anteriores)

| Fonte | Conteúdo | Leitura |
|---|---|---|
| Commit `963036c` (PR #249, 2026-09-24) | "The flag is NOT enabled for any tenant by this change." | Não ativou |
| `docs/architecture/P0_PILOT_FOUNDATION.md:55` | "`FF_CANONICAL_INGESTION` — **não ligado em produção**" | Estado declarado OFF |
| `docs/architecture/P0_PILOT_FOUNDATION.md:274` | "continua desligado em produção; ativação é decisão do owner (fora deste PR)" | Decisão **delegada** ao owner, **não tomada** |
| `docs/imports/README.md:349` | "tenant-aware, fail-closed, **desabilitada em produção**" | Estado declarado OFF |
| `docs/handoffs/C3A_OPS_FEATURE_FLAG_CONTROL_DELIVERY.md:6` | "Nenhuma flag é ativada nesta PR." | Não ativou |
| `docs/ops/INGESTION_RUNBOOK.md:14-22` | Procedimento governado (`getTenantFlag` → `setTenantFlag`); nunca SQL manual | Como ativar, não se ativar |
| `docs/ops/ONBOARDING_MOREIRA_SALES.md` | Nenhuma menção à flag | — |
| `R2_LEGACY_REACHABILITY_INVENTORY.md` §13 | Pergunta registrada, **sem resposta** | Pendente |

Os documentos só registram "não ativado" e "cabe ao owner decidir". Não há decisão humana a registrar.

## 4. Evidência read-only de runtime (Railway, somente leitura)

| Consulta | Janela | Resultado |
|---|---|---|
| Logs de deploy do serviço app, filtro `feature_flag_set` | desde 2026-09-20T00:00Z (deploys recentes do serviço) | **0 entradas** |
| Logs HTTP `/api/trpc/ingestion*` (consulta anterior deste turno) | desde 2026-09-22 | **vazio** |

Limites dessas consultas:
- Ausência de log não prova ausência de linha no banco. A retenção é limitada e uma ativação anterior a 2026-09-20 não apareceria.
- Uma escrita fora do `featureFlagAdmin`, como SQL manual (proibido pelo runbook), não emitiria o evento.
- Ainda assim, os dois sinais concordam com os documentos: nenhuma ativação registrada e nenhum uso da ingestão canônica.

**Estado mais provável:** OFF para o único tenant institucional. **Não confirmado** no banco.

## 5. Tenants afetados

- Produção tem **um único tenant institucional** (decisão humana registrada em R2.1; R1.10 segue IN_PROGRESS por esse motivo).
- Os IDs sintéticos 700001 e 950000+ são fixtures de teste e não existem em produção (`ONBOARDING_MOREIRA_SALES.md`).
- A decisão abaixo vale, portanto, para esse tenant. Um tenant futuro nasce OFF (fail-closed) e precisa de decisão própria.

## 6. Verificação read-only que falta (para o humano executar ou autorizar)

Do sandbox, o banco de produção não responde: o TCP proxy `autorack.proxy.rlwy.net:50643` não conecta, com timeout. Nenhum secret foi lido, nenhum túnel foi criado e nenhuma infraestrutura foi alterada. Qualquer uma das opções abaixo basta.

**Opção de aplicação (preferida, sem SQL):** um admin de plataforma chama `featureFlagAdmin.getTenantFlag { organizationId: <tenant>, flagName: "FF_CANONICAL_INGESTION" }`. É uma query, sem efeito colateral.

**Opção SQL (somente leitura, sem PII):**

```sql
START TRANSACTION READ ONLY;
SELECT name, enabled FROM feature_flags WHERE name = 'FF_CANONICAL_INGESTION';
SELECT organizationId, enabled, percentage, expiresAt, createdAt
  FROM tenant_feature_flags WHERE flagName = 'FF_CANONICAL_INGESTION';
SELECT COUNT(*) AS sessions FROM import_sessions;   -- uso da ingestão canônica (`drizzle/schema.ts:1917`)
COMMIT;
```

Resultado esperado para confirmar o estado declarado:
- nenhuma linha em `feature_flags`;
- nenhuma linha em `tenant_feature_flags`, ou uma linha com `enabled = 0`.

Qualquer outro resultado é um achado e deve ser registrado.

## 7. R2.2 DECISION PACKET

**Pergunta ao humano:**
> Para o tenant institucional de produção, `FF_CANONICAL_INGESTION` deve ser ativada a 100%? Se sim, antes da PR-04 ou junto dela?

| | **Opção A — ativar ANTES da PR-04** | **Opção B — ativar JUNTO da PR-04 (guard acoplado à flag)** | **Opção C — manter OFF** |
|---|---|---|---|
| Sequência | Validar a ingestão em staging → owner liga a flag (100%) via `setTenantFlag` → observar → PR-04 fecha o endpoint legado **incondicionalmente** e remove o painel legado | PR-04 entra com guard **acoplado à flag** (neutro para tenant OFF) → owner liga a flag → o guard fecha o legado para o tenant → PR de acompanhamento torna o fechamento incondicional quando nenhum tenant restar OFF | Ingestão canônica fica desligada. SEM-005 deixa de ser CUTOVER e passa a exigir **FIX** do caminho legado (sem sobrescrita, id por importação), com reclassificação humana do tratamento |
| Risco em produção | Ativação sem rede: se a ingestão falhar, a colagem legada ainda existe (mitiga) | Menor: o deploy não muda comportamento para tenant OFF; a virada é uma ação governada, auditada e reversível | SEM-005 segue ativo até existir FIX |
| Reversão | `setTenantFlag enabled:false` até a PR-04; depois disso, a reversão exige revert de código | `setTenantFlag enabled:false` reabre o legado para o tenant (sem deploy) | — |
| Muda o escopo da PR-04? | Não (é o escopo original) | Divide a PR-04 em guard acoplado + fechamento final | Sim: CUTOVER → FIX (decisão de tratamento) |
| Preparação existente | — | Branch `cutover/r2-pr04-canonical-price-ingestion` (preparo, PARTIAL) | — |

**Recomendação técnica (não é decisão):** Opção B.
- Reusa o preparo desta noite.
- O deploy não muda o comportamento em produção.
- A ativação passa pela trilha governada da PR #249 (`reason`, auditoria, evento `feature_flag_set`) e pode ser revertida por tenant.

**Para qualquer opção, o humano deve fixar:**
1. o `organizationId` do tenant;
2. `percentage = 100` (nunca < 100, que é aleatório por instância, §2);
3. `expiresAt` nulo, ou uma data consciente (ao expirar, o tenant volta para OFF);
4. quem executa `setTenantFlag` e o texto de `reason`;
5. o pré-requisito de staging: fluxo de upload/colagem → sessão → promoção validado, com S3 e OCR operacionais em staging;
6. o critério de rollback.

## 8. Critérios para R2.2 = PASS

1. Decisão humana registrada (§7), com os seis parâmetros acima.
2. Estado atual confirmado read-only (§6) e registrado aqui.
3. Se a decisão for ativar: a ativação é feita **por humano** via `featureFlagAdmin.setTenantFlag`, e o evento `feature_flag_set` é confirmado nos logs.

A PR-04 (R2.6) só fica pronta para PR depois de R2.2 = PASS.

**Situação em 2026-09-28:**
- critério 1: ✅ (§10);
- critério 2: ⏳ pendente (leitura read-only do banco);
- critério 3: ⏳ ação futura, que depende de staging validado e da PR-04.

R2.2 = **PASS_CANDIDATE**.

## 9. O que este documento NÃO fez

- Nenhuma flag alterada.
- Nenhuma variável Railway alterada.
- Nenhum SQL executado em produção.
- Nenhum secret lido.
- Nenhum túnel ou TCP proxy criado.
- Nenhuma mutação tRPC em produção.
- Nenhuma decisão humana inventada.
- A decisão de §10 foi tomada pelo owner; este documento apenas a registra.

## 10. Decisão humana registrada — 2026-09-28 (HUMAN DECISION RECORDED — OPTION B)

Registro literal da autorização do owner:
> "Aprovo o pacote de decisões proposto para R2.2, PR-06, PR-08, PR-09 e PR-12, e autorizo priorizar a triagem/correção
> de NEW-005, NEW-006 e NEW-007 antes da abertura das PRs relacionadas."

### 10.1 Estratégia

**Opção B:** rollout governado por tenant. O tenant institucional piloto terá `FF_CANONICAL_INGESTION` ativada de forma governada, **em execução futura**. Nada é ativado agora.

### 10.2 Parâmetros aprovados para a ativação futura

| Parâmetro | Valor | Motivo |
|---|---|---|
| `organizationId` | tenant institucional piloto (único tenant institucional de produção) | Decisão por tenant. Um tenant futuro nasce OFF e precisa de decisão própria. |
| `percentage` | **100**, nunca menor que 100 | O código resolve percentual parcial com `Math.random` por resolução e por instância (§2), o que viola o determinismo institucional (ver NEW-015) |
| `expiresAt` | **NULL** (sem expiração automática) | Uma expiração silenciosa devolveria o tenant ao valor global, isto é, OFF, e reabriria o fluxo legado |
| Executor | owner ou admin autorizado | — |
| Mecanismo | **exclusivamente** `featureFlagAdmin.setTenantFlag` | Nunca SQL manual, variável Railway ou edição direta de banco |
| Registro obrigatório | `reason`, ator, tenant, timestamp, evento de auditoria/correlação (`feature_flag_set`) | Trilha da PR #249 |

### 10.3 Sequência institucional aprovada

1. Confirmar o estado atual da flag, somente leitura (§6).
2. Validar a ingestão canônica em staging: fluxo upload/colagem → sessão → revisão → aprovação → promoção, com S3 e OCR operacionais.
3. PR-04 com o guard server-side preparado. Branch `cutover/r2-pr04-canonical-price-ingestion`: flag ON ⇒ legado bloqueado; erro de avaliação ⇒ fail-closed; falha de capabilities ⇒ sem fallback silencioso ao legado.
4. Ativação governada do tenant a 100%.
5. Observação.
6. Fechamento definitivo do legado quando for seguro (PR de acompanhamento: fechamento incondicional e remoção do painel legado).

### 10.4 Rollback futuro (decisão operacional supervisionada)

- Enquanto o cutover for reversível, o rollback é `featureFlagAdmin.setTenantFlag { enabled: false }`, pelo mesmo mecanismo governado. **Não executado agora.**
- Gatilhos candidatos:
  - falha de capabilities;
  - erro sistêmico de upload;
  - falha na criação de sessão;
  - OCR ou storage indisponível;
  - promoção incapaz de concluir;
  - regressão de isolamento de tenant;
  - aumento anômalo de 5xx;
  - impossibilidade de completar o fluxo real upload → revisão → aprovação → promoção.
- Erro isolado de um usuário **não** dispara rollback automático. O rollback é sempre decisão humana supervisionada.

### 10.5 Status resultante

| Item | Estado |
|---|---|
| R2.2 | **PASS_CANDIDATE · DECISION_RECORDED · RUNTIME_STATE_READONLY_PENDING** (não é PASS oficial) |
| Flag em produção | **inalterada**. Estado provável OFF; não confirmado no banco. |
| PR-04 | **DECISION_RECORDED / IMPLEMENTATION_PREPARED**. Não está pronta para PR enquanto o estado da flag não for confirmado read-only e o staging não for validado. |
| Ledger oficial | sem novo checkpoint até a revisão e o merge documental |
