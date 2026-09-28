# R2.3 — Uso de dados legados em produção (verificação read-only)

> **Status do checkpoint R2.3: IN_PROGRESS — BLOCKED (ambiente).**
> O banco de produção **não pôde ser consultado** do ambiente de execução (§2). Nenhuma contagem real foi obtida.
> Nenhuma classificação final foi atribuída. Este documento congela o **plano de consulta** read-only e agregado (§4),
> o **mapa código ↔ tabela** (§3) e a **árvore de decisão** que transforma as contagens em classificação por
> tabela (§5).
> Baseline inalterado (92/26/54/12). `SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md` não foi editado.

| Campo | Valor |
|---|---|
| Data | 2026-09-28 (turno noturno autônomo, owner ausente) |
| Base | `main` @ `5cd9d50` |
| Checkpoint | R2.3: "verificação read-only **autorizada** de uso de dados legados (`legal_opinions`, `direct_contracts`, `contracts`, `processes`)" |
| Consome | PR-03 (LEG-012, SEM-016/017), PR-14 (LEG-015, SEM-012), CUTOVER de LEG-015/016, LEG-027 |
| Mutações em produção | **Zero** (nenhum SQL executado) |

## 1. Por que R2.3 não é PASS

| Critério | Situação |
|---|---|
| Consulta autorizada | ✅ Autorizada pelo turno noturno, restrita a SELECT/SHOW/DESCRIBE/EXPLAIN |
| Consulta executada | ❌ Banco inacessível do sandbox (§2) |
| Contagens registradas | ❌ |
| Classificação por tabela | ❌ Só existe proposta condicional (§5) |

## 2. Bloqueio de ambiente

- O serviço MySQL de produção (Railway) expõe um TCP proxy público. Do sandbox, a conexão TCP a esse endpoint não se completa: houve timeout em duas tentativas, uma delas nesta data. A política de egress do ambiente não libera esse tráfego.
- A interface Railway disponível não tem operação de SQL somente leitura.
- Alternativas **não usadas**, por serem proibidas no turno:
  - criar TCP proxy, função ou serviço;
  - ler as variáveis/secrets de conexão;
  - pedir consulta via endpoint tRPC com sessão forjada;
  - executar mutações.
- **Nada foi contornado.** O bloqueio é real e exige ação humana (§6).

## 3. Mapa código ↔ tabela (estado em `main`, read-only)

As tabelas legadas e as canônicas são **disjuntas**. Os repositórios canônicos são namespaced justamente para não colidir com os legados:
- `server/db/legalOpinionWorkspace.ts:7`;
- `server/db/directProcurement.ts:8`;
- `server/db/contractWorkspace.ts:7`.

Não existe mapeamento de id legado (int autoincrement) para workspace canônico (varchar).

| Tabela legada | Repositório | Superfícies que escrevem/leem (R2.1) | Contraparte canônica | Estados (enum) | Dependentes relevantes |
|---|---|---|---|---|---|
| `legal_opinions` (`schema.ts:1424`) | `server/db/legalOpinions.ts` | LEG-012 (`/parecer/novo`, `/parecer/analytics`, `/parecer/:id` + redirects `/parecer-juridico/*`); API `legalOpinions` | `legal_opinion_workspaces` / `_drafts` / `_versions` / `_history` (`schema.ts:5710-5790`) | `status`: draft · in_review · approved · archived; `conclusion`: favorable · unfavorable · with_reservations; `sourceType`: process · direct_contract · contract · other | SEM-016/017 (aprovado editável; IA sobrescreve assinado) |
| `direct_contracts` (`schema.ts:1041`) | `server/db/directContracts.ts` | LEG-015 (`/contratacao-direta/novo`, `/analytics`, `/:id` + redirects `/direct-contracts/*`); LEG-027 (`/admin`) | `direct_procurement_workspaces` / `_procedures` (`schema.ts:5808+`) | draft · pending_approval · approved · published · in_execution · completed · cancelled | SEM-012 (analytics em centavos), SEM-072 |
| `contracts` (`schema.ts:1223`) | `server/db/contracts.ts` (+ `contractReports`, `contractNotifications`) | LEG-016 (`/contratos/novo`, `/alertas`, `/:id` + redirects `/contracts/*`); LEG-027 | `contract_workspaces` / `contract_addenda` / `contract_ws_documents` (`schema.ts:5933+`) | draft · active · suspended · terminated · expired · completed | `contract_amendments`, `contract_apostilles`, `contract_documents`, `contract_audit_logs`, `contract_renewals` (legados, FK int) |
| `processes` (`schema.ts:34`) | `server/db/processes.ts` | LEG-002…006, LEG-018/019/021/022/023, `/admin`, `/auditoria`; **lido por rotas ativas** até o fim dos cutovers | `procurement_processes` (`schema.ts:5155`) | em_dfd … concluido (8) | `documents`, `activity_logs`, `process_items`, `edital_parameters`, `tasks` (**preservadas**, §10 do R2.1) |

A criação de processo legado já está desativada (`LEGACY_PROCESS_PIPELINE_DISABLED`). Os demais DISABLE preparados nesta noite (PR-02, LEG-005, LEG-009) não apagam nem alteram nenhuma linha dessas tabelas.

## 4. Plano de consulta congelado (somente agregados, sem PII, sem conteúdo)

Regras do plano:
- sessão `START TRANSACTION READ ONLY`;
- somente `COUNT` / `MIN` / `MAX` / `GROUP BY` sobre colunas de estado e data;
- **nunca** `SELECT *`;
- **nunca** título, descrição, conteúdo, nome, e-mail ou CNPJ;
- a saída é registrada aqui no formato da tabela §4.1.

```sql
START TRANSACTION READ ONLY;

-- Q1 legal_opinions: volume, estados, conclusões, atividade recente
SELECT organizationId, status, COUNT(*) n, MIN(createdAt) first_at, MAX(updatedAt) last_at
  FROM legal_opinions GROUP BY organizationId, status;
SELECT status, (conclusion IS NOT NULL) has_conclusion, COUNT(*) n FROM legal_opinions GROUP BY 1,2;
SELECT COUNT(*) n_orphan_org FROM legal_opinions WHERE organizationId IS NULL;
SELECT COUNT(*) n_touched_30d FROM legal_opinions WHERE updatedAt >= NOW() - INTERVAL 30 DAY;

-- Q2 direct_contracts
SELECT organizationId, type, status, COUNT(*) n, MIN(createdAt) first_at, MAX(updatedAt) last_at
  FROM direct_contracts GROUP BY organizationId, type, status;
SELECT COUNT(*) n_touched_30d FROM direct_contracts WHERE updatedAt >= NOW() - INTERVAL 30 DAY;

-- Q3 contracts (+ instrumentos legados dependentes)
SELECT organizationId, status, originType, COUNT(*) n, MIN(createdAt) first_at, MAX(updatedAt) last_at
  FROM contracts GROUP BY organizationId, status, originType;
SELECT COUNT(*) n_active_like FROM contracts WHERE status IN ('active','suspended');
SELECT (SELECT COUNT(*) FROM contract_amendments) amendments,
       (SELECT COUNT(*) FROM contract_apostilles) apostilles,
       (SELECT COUNT(*) FROM contract_documents)  documents;

-- Q4 processes (legado) vs procurement_processes (canônico)
SELECT organizationId, status, COUNT(*) n, MIN(createdAt) first_at, MAX(updatedAt) last_at
  FROM processes GROUP BY organizationId, status;
SELECT COUNT(*) n_touched_30d FROM processes WHERE updatedAt >= NOW() - INTERVAL 30 DAY;
SELECT COUNT(*) n_canonical FROM procurement_processes;
SELECT (SELECT COUNT(*) FROM documents) legacy_docs,   -- documents.processId é NOT NULL (FK ao processo legado)
       (SELECT COUNT(*) FROM process_items) legacy_items;

COMMIT;
```

Antes de executar, conferir cada nome de coluna com `DESCRIBE <tabela>`, também somente leitura. O schema em `main` tem `createdAt`/`updatedAt` nas quatro tabelas; se o banco de produção divergir (drift), registrar a divergência como achado.

### 4.1 Resultado (a preencher — nenhum dado real obtido nesta noite)

| Tabela | Linhas totais | Por tenant | Estados não-terminais | Tocadas ≤ 30 d | Dependentes | Observação |
|---|---|---|---|---|---|---|
| `legal_opinions` | — | — | — | — | — | NÃO CONSULTADO |
| `direct_contracts` | — | — | — | — | — | NÃO CONSULTADO |
| `contracts` | — | — | — | — | — | NÃO CONSULTADO |
| `processes` | — | — | — | — | — | NÃO CONSULTADO |

## 5. Árvore de decisão (proposta técnica; a classificação final é humana)

Classificações do R2.1 (§10): **MIGRATE**, **RETIRE**, **HISTORICAL_READ** e, para contratos, **LEGAL_REVIEW**.

| Resultado observado | Proposta | Efeito sobre o PR dependente |
|---|---|---|
| 0 linhas (em todos os tenants) | **RETIRE**: desligar as mutações e as páginas por deep link; manter a tabela (sem DROP) | PR-03/PR-14 viram DISABLE simples, sem visão histórica |
| > 0 linhas, todas terminais e nenhuma tocada em 30 d | **HISTORICAL_READ**: leitura somente-leitura acessível pela navegação canônica; mutações desligadas | PR-03: bloquear mutações legadas; deep link abre a leitura histórica ou redireciona com aviso; nenhum dado migrado |
| > 0 linhas não-terminais (rascunho, em revisão, em execução, ativo) | **MIGRATE**, ou HISTORICAL_READ com decisão humana explícita de abandono | Exige um mapeamento legado → canônico **projetado e revisado**, provavelmente com migration aditiva (PR-03 "Provável" no plano); nenhum desligamento antes disso |
| `contracts` com `active`/`suspended` ou instrumentos dependentes | **LEGAL_REVIEW** obrigatório | Contrato vigente não pode perder o canal de aditivo e apostila. O CUTOVER de LEG-016 fica bloqueado até a revisão jurídica |
| `processes` com uso recente | **Preservar** (já decidido em R2.1) | Continua lida por rotas ativas; só a escrita legada é desligada (já feito ou preparado) |

Em nenhum caso: `DELETE`, `DROP`, anonimização ou "limpeza" de dados institucionais. Essas ações não fazem parte do R2.

## 6. Ação humana necessária para destravar R2.3

Uma das opções abaixo:
1. Um humano executa o §4 num cliente com acesso ao MySQL de produção: console Railway ou cliente local do owner, com credencial read-only se disponível. Depois cola aqui só os agregados.
2. O humano autoriza explicitamente um canal de leitura para o agente e indica qual é. Continua proibido criar proxy ou ler secrets sem essa autorização.

Depois disso, preencher §4.1, aplicar §5 com decisão humana por tabela e marcar R2.3 = PASS.

## 7. Consequência para o turno

- **PR-03** (cutover do parecer legado) depende dos dados reais de `legal_opinions`. A instrução do turno exige resultados REAIS de R2.3 antes da implementação. Status: **BLOCKED_FOR_HUMAN_REVIEW**, sem implementação especulativa.
- **PR-14** e o CUTOVER de LEG-015/016: bloqueados pelo mesmo motivo, fora da fila desta noite.

## 8. O que este documento NÃO fez

- Nenhuma conexão ao banco de produção se completou.
- Nenhum SQL executado.
- Nenhum secret lido.
- Nenhum proxy, túnel ou função criado.
- Nenhuma mutação tRPC.
- Nenhuma classificação final atribuída.
