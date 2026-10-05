# Relatório de execução — lote autônomo R0 → R11 + Pilot Reset B2/B3 + LEG-009

> Branch `work/autonomous-semantic-remediation-r3-r11` · base `main` `aac42411f86dd482684c5017867322d64ff5d730` ·
> head de código do 1º lote `00a3c2a` (2026-10-02) · **2º passe: head `22d0ed8` (2026-10-05, 63 commits à frente da `main`)** — ver §12 e `AUTONOMOUS_REMEDIATION_SECOND_PASS_REPORT.md`.
> **Sem PR · sem merge · sem deploy · produção intocada.** Todo estado "local" é IMPLEMENTED_PENDING_REVIEW, nunca
> "merged" nem "validado em produção". Baseline `SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md` sha256
> `08edc734…810b3` conferido no início e no fim (inalterado); denominador 87 checkpoints; 92 achados = 26/54/12.

## 1. Resumo executivo

1. **31 commits** por pacote de trabalho, cherry-pickáveis (`AUTONOMOUS_REMEDIATION_COMMIT_MAP.md`).
2. **5 migrations novas** (0310–0314), aditivas, com guard fail-closed onde há risco de dado e replay-safe; testadas só em MySQL 8 local.
3. **24/26 P0 com correção**: 5 já na `main`, **19 implementados localmente**; **2 P0 abertos** por parecer jurídico (SEM-010, SEM-011).
4. **Legado** desligado/só leitura: LEG-009, LEG-012 (PR-03), LEG-028, LEG-032, LEG-033.
5. **Segurança/RBAC**: NEW-005, NEW-006, NEW-007 portados e testados em MySQL.
6. **Autoridade humana**: ledger de decisão (PR-07), sugestão de IA ≠ registro (PR-11), edição humana preservada (PR-09/PR-10), termos do instrumento (PR-17).
7. **Fontes semânticas**: quantidade cotada nunca vira necessidade (PR-13); formatador monetário único (PR-14); evidência real (PR-16).
8. **Documento emitido reproduzível**: snapshot institucional (PR-15) + guarda de imutabilidade (R7.5/R11.6).
9. **Pilot Reset B2/B3** implementado (gerações imutáveis, preview read-only, digest, CAS, idempotência) — **nenhum reset real**.
10. **R8**: pacote jurídico com perguntas objetivas e scaffolding fail-closed (nenhuma regra jurídica alterada).
11. **R9/R10**: planos 54/54 P1 e 12/12 P2 extraídos programaticamente; 1 P1 corrigido (SEM-050).
12. **R11.1–R11.6**: guardas permanentes (18 testes). R11.7: **TECHNICAL_REAUDIT_COMPLETE, não PASS**.
13. **Gate final único** em MySQL 8 limpo: ver §2 (números exatos).
14. **10 achados novos** (NEW-028…NEW-037), incluindo um **candidato a P0** (NEW-036).

## 2. Gate final do 1º lote (único, banco limpo, head de código `00a3c2a`) — o gate do 2º passe está em §12

| Etapa | Resultado | Números |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | — |
| `pnpm check` (tsc) | PASS | 0 erros |
| ESLint nos arquivos alterados vs. `aac4241` (`--max-warnings 0`) | PASS | 184 arquivos, 0 problemas |
| `pnpm test` (suíte sem DB) | PASS | **319 arquivos passaram / 80 pulados (399); 6595 testes passaram / 688 pulados (7283); 0 falhas** |
| MySQL 8 limpo: `pnpm db:migrate:release` (0000 → 0314) | PASS | — |
| Migration safety (`reconciliation-mysql-smoke`) | PASS | 4/4 |
| Cadeia MySQL do CI (45 comandos: release + 43 smokes + `test:smoke:security`) | **PASS 45/45** | **649 testes passaram, 0 falhas**; `test:smoke:security` 347/347 |
| Smokes MySQL fora do CI (7) | 6 PASS · 1 FAIL pré-existente | `a3-failure-provenance` 2, `catmat-governance` 10, `cognitive-provenance-a1` 10, `contrato-avulso` 13, `document-generation` 3, `p0-edital-generation` 4; **`invitations` 8/10 — as mesmas 2 falhas reproduzem na `main` `aac4241`** (fixture `res: {}` sem `cookie`; bind `undefined`) ⇒ NEW-037, não introduzida pelo lote |
| `pnpm build` | PASS | — |
| `pnpm audit:gate` | PASS | sem regressão sobre o baseline |
| Graphify | PASS | hook `pre-commit` ativo em todos os commits (sem `--no-verify`), grafo atualizado e incluído em cada commit; `.graphify_root` restaurado |
| Baseline | PASS | sha256 `08edc7344c9038889978e1b2f9204f4fd523e3fef36e6b29b47ff324ae0810b3` (inalterado) |

**EXPECTED_SKIP:** os 688 testes pulados na suíte sem DB são os `*-mysql-smoke` (rodam na cadeia MySQL). **UNEXECUTED_REQUIRED_TEST:** só a verificação em produção (não autorizada). Os 5 testes que falharam na primeira passada da suíte completa (estilo disabled, fronteira do Kernel, rótulo legado do Edital) foram corrigidos no commit `00a3c2a` antes deste gate.

## 3. Migrations

| Migration | Tabela(s) | Natureza | Guard fail-closed | Replay | Testes | Produção |
|---|---|---|---|---|---|---|
| 0310_contract_number_unique_per_org | `contract_workspaces` (`normalized_number` gerada utf8mb4_bin + UNIQUE) | aditiva | SIGNAL `0310_FC_DUP_CONTRACT_NUMBER_PER_ORG` antes do DDL; preflight `scripts/preflight-0310-contract-number.sql` | sim | `contract-number-unique-0310-mysql-smoke` | não executada |
| 0311_edital_institutional_parameters | `generated_documents` (critério de julgamento, regime) | aditiva | procedures `licigov_0311_*` guardadas | sim | `pr09-regeneration-human-state-mysql-smoke` | não executada |
| 0312_institutional_decision_ledger | `institutional_decisions` (UNIQUE sujeito+revisão, órgão+chave) | aditiva (CREATE TABLE IF NOT EXISTS) | — | sim | `institutional-decision-ledger-mysql-smoke` | não executada |
| 0313_procurement_process_lifecycle | `procurement_processes` (+ colunas de geração/estado, UNIQUE geradas) + `procurement_process_lifecycle_events` | aditiva | SIGNAL `0313_FC_DUP_ACTIVE_PROCESS_NUMBER` | sim (guard LEAVE quando já migrado) | `process-lifecycle-0313-migration-mysql-smoke` M1–M3 | não executada |
| 0314_required_document_evidence | `required_documents` (hash, tamanho, MIME, anexado/validado por/em) | aditiva | — (só DEFAULTs neutros) | sim (reaplicação manual testada) | `pr16-required-document-evidence-mysql-smoke` D7 | não executada |

Cada migration tem `drizzle/meta/NNNN_snapshot.json`; `pnpm db:generate` responde "No schema changes" no head. A 0310
absorveu o drift pré-existente das 0308/0309 (sem snapshot). **Ordem de merge obrigatória: 0310 → 0311 → 0312 → 0313 → 0314.**

## 4. Produção

- **Nenhuma** escrita, DDL, migration, deploy, redeploy, restart, mudança de flag, tenant ou usuário artificial.
- **Nenhuma** leitura de produção neste lote (o único mecanismo seria read-only legítimo; não foi necessário/autorizado:
  R2.2, R2.3 e R6.1 ficaram BLOCKED_PRODUCTION_ACCESS com as consultas preparadas).
- O processo real **2026/253** foi apenas objeto de discovery read-only em fases anteriores; **nenhum Pilot Reset real**.
- Nenhum secret impresso; nenhum artefato do piloto (SQL de inventário, TSV, capturas, scratchpad) commitado.

## 5. Bloqueios e perguntas objetivas

Registro completo: `AUTONOMOUS_REMEDIATION_BLOCKERS.md`. Perguntas: `HUMAN_DECISION_PACKET.md` (HD-01…HD-14) e
`LEGAL_REVIEW_DECISION_PACKET.md` (J-1…J-5). As mais urgentes:

1. **HD-12** — aprovar o fatiamento em PRs (§8) e a ordem das migrations.
2. **HD-01** (R6.2) — tratamento dos processos legados sem Itens da contratação antes de mergear a PR-13.
3. **J-1** — quem é a autoridade competente para ratificar (a PR-07 registra, mas não valida a competência).
4. **HD-02/HD-04/HD-05** — autorizar leituras read-only (R6.1, R2.3, estado da flag R2.2).
5. **HD-03** (R7.2) — tratamento das versões emitidas antes do snapshot.

## 6. Achados novos (fora do baseline; não alteram 92/26/54/12)

| ID | Sev. proposta | Achado | Estado |
|---|---|---|---|
| NEW-028 | P2 | O vocabulário de status do workspace de contratação direta não tem "não ratificado": superar "ratificado" por "não ratificado" no ledger mantém o status `ratificado` (o ledger e o gate de publicação estão corretos) | aberto — HD-09 |
| NEW-029 | P1 | Publicação/ratificação da contratação direta não exigem o checklist de documentos obrigatórios validado (o `pending` é só informativo) | aberto — triagem R9 |
| NEW-030 | P2 (infra de teste) | O banco compartilhado de smokes perde colunas de `import_sessions` depois de certos smokes de migration (precisou recriar o banco duas vezes) | aberto — o CI usa banco novo por job |
| NEW-031 | P3 (infra de teste) | `new007-legal-opinion-assignment-rbac-mysql-smoke` compara contador global de `audit_logs`; flaky em execução paralela com outros arquivos | **corrigido** (`446171e`: contadores escopados aos usuários do próprio smoke) |
| NEW-032 | P2 | Relatório de processo legado imprimia `doc.status` inexistente | **corrigido** na PR-14 (`documentStatus`) |
| NEW-033 | P3 (infra de teste) | Testes "degrada sem DB" de `sprint5w/5y/5z` falham quando `DATABASE_URL` está definido | **corrigido** (`446171e`: contrato determinístico sem DB) |
| NEW-034 | P3 | `getDirectContractsOverview()` sem filtro de órgão continua exportado (sem caller) | **corrigido** (`23554f3`: 5 agregações sem filtro de órgão removidas) |
| NEW-035 | P1 | `ResponsePanel` da solicitação institucional pré-seleciona `responseStatus = "favoravel"` | aberto — triagem R9 (classe SEM-019) |
| NEW-037 | P3 (infra de teste) | `invitations-mysql-smoke` (fora do CI) falha 2/10 também na `main` — fixture `res: {}` sem `cookie` e bind `undefined` | aberto — pré-existente |
| NEW-036 | **P0 (candidato)** | Minuta de contrato legado (`contractsRouter` → `contractDocuments.generateContractMinuta`) formata `contract.value` em centavos como reais | **corrigido localmente** (`adea553`: formatador único, unidades explícitas; o destino do legado continua dependendo de R2.3) |
| NEW-038 | P1 (2º passe) | O contrato avulso gravava o valor digitado em **centavos** em `contract_workspaces.value` (DECIMAL em REAIS) — erro de unidade ×100 | **corrigido localmente** (`abc2a69`: `parseReaisInputToDecimal`) |

FCC-06 (correção factual candidata): o plano dizia "PR-06 Migration: Não"; a PR-06 exigiu a 0310 (unicidade por órgão
em `contract_workspaces`, SEM-007). O SEM-085 (legado `contracts.number`) continua em R9.

## 7. Pilot Reset B2/B3

- **Discovery (fases anteriores):** processo 2026/253 do tenant piloto — Identity Gate confirmado; inventário agregado:
  **RESET_ELIGIBLE** (sem estado formal) e **NOT DISCARD_ELIGIBLE** (há trabalho de piloto).
- **Implementado (local):** `docs/architecture/PILOT_RESET_GOVERNED_LIFECYCLE.md` — preview read-only (operator+),
  execução (manager+) com digest do preview, CAS de revisão, idempotência, ledger append-only; ações CORRECT_NUMBER,
  DISCARD_DRAFT (sem DELETE), RESET_DRAFT (geração antiga imutável + nova geração limpa), CANCEL, ARCHIVE; 7 domínios
  formais bloqueiam reset; nenhuma IA/S3/HTTP no caminho transacional.
- **Testes:** `pilot-reset-lifecycle-mysql-smoke` L1–L12, `process-lifecycle-0313-migration-mysql-smoke` M1–M3,
  `unit/process-lifecycle-domain` — dados sintéticos (órgãos 960811/960812).
- **Execução real:** **não feita** — exige merge + deploy da 0313, preview read-only pelo owner, decisão HD-06.

## 8. Plano de fatiamento em PRs (proposta — nenhuma aberta)

| PR | Commits | Conteúdo | Depende de |
|---|---|---|---|
| A | `e4f978d` | reconciliação documental do ledger | — |
| B | `aeed4f1` `e4b5fe2` `18a3d60` `2c5a9ad` | LEG-009, LEG-028, LEG-032, NEW-002 | — |
| C | `55e3151` `cfa747d` `b75a6a3` | RBAC NEW-005/006/007 | — |
| D | `d722256` `ae8a286` | PR-04A + PR-04 | C |
| E | `296f831` | PR-03 | — |
| F | `b0d9588` `62b0d3c` `9559153` | 0310 + PR-06 + R3.5 | C |
| G | `87e8635` `2d22545` | PR-08 + PR-12 | C, F |
| H | `8b88522` | PR-09 + 0311 | F |
| I | `da5e7aa` | PR-07 + 0312 | C, G, H |
| J | `68c8426` | Pilot Reset + 0313 | I |
| K | `3ff78a1` `67ccbbf` | PR-10 + R5.1 + PR-11 | C |
| L | `db184f1` + parte de `00a3c2a` | PR-13 | H, **HD-01** |
| M | `7f35be3` | PR-14 | — |
| N | `98918a9` | PR-15 + R7.5 | — |
| O | `65c4fe7` + parte de `00a3c2a` | PR-16 + 0314 | J (ordem da migration), C |
| P | `d6f8c84` | PR-17 | G |
| Q | `9b25de7` | R8 pacote + scaffolding | P |
| R | `c56b0ae` | R9/R10 planos + SEM-050 | — |
| S | `a75ac0e` | R11 guardas | K, O, P, I |
| T | (docs finais) | relatórios, bloqueios, decisões, ledger | todas |

## 9. Duas visões de progresso

| Visão | Critério | Resultado |
|---|---|---|
| **OFFICIAL MAIN** | checkpoints PASS na `main` | **24/87 = 27,6%** (inalterado por este lote) |
| **LOCAL IMPLEMENTATION COVERAGE** | PASS oficial + PASS_LOCAL + IMPLEMENTED_PENDING_REVIEW nesta branch | **56/87 = 64,4%** (2º passe: +1, R9.7; os demais R9.x/R10.2 são PARTIAL_LOCAL e **não** entram na contagem) |

A segunda visão **não** é progresso oficial: nada foi revisado, mergeado ou validado em produção.


## 10. Matrizes

## A. Matriz dos 87 checkpoints (oficial × local)

Oficial (main): **24/87 = 27.6%** PASS. Cobertura local de implementação (PASS + PASS_LOCAL + IMPLEMENTED_PENDING_REVIEW): **55/87 = 63.2%**.

| Checkpoint | Oficial (main) | Local (esta branch) | Evidência |
|---|---|---|---|
| R0.1 | PASS | PASS | #259 |
| R0.2 | PASS | PASS | #259 |
| R0.3 | PASS | PASS | #259 |
| R0.4 | PASS | PASS | #259 |
| R0.5 | PASS | PASS | #259 |
| R0.6 | PASS | PASS | #259 |
| R0.7 | PASS | PASS | #259 |
| R0.8 | PASS | PASS | #259 |
| R0.9 | PASS | PASS | #259 |
| R0.10 | PASS | PASS | #259 |
| R1.1 | PASS | PASS | PR-01/#260/#261 |
| R1.2 | PASS | PASS | PR-01/#260/#261 |
| R1.3 | PASS | PASS | PR-01/#260/#261 |
| R1.4 | PASS | PASS | PR-01/#260/#261 |
| R1.5 | PASS | PASS | PR-01/#260/#261 |
| R1.6 | PASS | PASS | PR-01/#260/#261 |
| R1.7 | PASS | PASS | PR-01/#260/#261 |
| R1.8 | PASS | PASS | PR-01/#260/#261 |
| R1.9 | PASS | PASS | PR-01/#260/#261 |
| R1.10 | IN_PROGRESS | BLOCKED_PRODUCTION_VALIDATION | deploy b85dd763; verificação comportamental pendente |
| R2.1 | PASS | PASS | #262 |
| R2.2 | IN_PROGRESS | BLOCKED_PRODUCTION_ACCESS | decisão Opção B registrada; estado da flag não lido |
| R2.3 | BLOCKED | BLOCKED_PRODUCTION_ACCESS | plano read-only congelado |
| R2.4 | PASS | PASS | #272 3b0b30d |
| R2.5 | TODO | IMPLEMENTED_PENDING_REVIEW | PR-03 296f831 |
| R2.6 | TODO | IMPLEMENTED_PENDING_REVIEW | PR-04 ae8a286 + PR-04A d722256 |
| R2.7 | TODO | BLOCKED_PRODUCTION_VALIDATION | depende de merge+deploy |
| R3.1 | PASS | PASS | #276 |
| R3.2 | PASS | PASS | #276 |
| R3.3 | PASS | PASS | #276 aac4241 |
| R3.4 | TODO | IMPLEMENTED_PENDING_REVIEW | PR-06 62b0d3c + 0310 b0d9588 |
| R3.5 | TODO | PASS_LOCAL | 9559153 (16/16 MySQL) |
| R3.6 | TODO | BLOCKED_PRODUCTION_VALIDATION | — |
| R4.1 | TODO | IMPLEMENTED_PENDING_REVIEW | INSTITUTIONAL_DECISION_CONTRACT.md |
| R4.2 | TODO | BLOCKED_LEGAL_REVIEW | pacote J-1 preparado |
| R4.3 | TODO | IMPLEMENTED_PENDING_REVIEW | 0312 (testada localmente; revisão humana pendente) |
| R4.4 | TODO | IMPLEMENTED_PENDING_REVIEW | PR-07 da5e7aa |
| R4.5 | TODO | IMPLEMENTED_PENDING_REVIEW | PR-08 87e8635 |
| R4.6 | TODO | PASS_LOCAL | sprint5z/V1/RBAC reescritos (da5e7aa) |
| R4.7 | TODO | BLOCKED_PRODUCTION_VALIDATION | — |
| R5.1 | TODO | PASS_LOCAL | formHydration + guard R5.1 (3ff78a1, 67ccbbf) |
| R5.2 | TODO | IMPLEMENTED_PENDING_REVIEW | PR-09 8b88522 |
| R5.3 | TODO | IMPLEMENTED_PENDING_REVIEW | PR-10 3ff78a1 |
| R5.4 | TODO | IMPLEMENTED_PENDING_REVIEW | PR-11 67ccbbf |
| R5.5 | TODO | IMPLEMENTED_PENDING_REVIEW | PR-12 2d22545 |
| R5.6 | TODO | PASS_LOCAL | pr09-regeneration-human-state-mysql-smoke |
| R5.7 | TODO | BLOCKED_PRODUCTION_VALIDATION | — |
| R6.1 | TODO | BLOCKED_PRODUCTION_ACCESS | SQL read-only preparado e validado localmente |
| R6.2 | TODO | BLOCKED_HUMAN_DECISION | HD-01 |
| R6.3 | TODO | IMPLEMENTED_PENDING_REVIEW | PR-13 db184f1 |
| R6.4 | TODO | PASS_LOCAL | testes legados reescritos (db184f1) |
| R6.5 | TODO | IMPLEMENTED_PENDING_REVIEW | PR-14 7f35be3 |
| R6.6 | TODO | BLOCKED_PRODUCTION_VALIDATION | — |
| R7.1 | TODO | IMPLEMENTED_PENDING_REVIEW | PR-15 98918a9 |
| R7.2 | TODO | BLOCKED_HUMAN_DECISION | HD-03 |
| R7.3 | TODO | IMPLEMENTED_PENDING_REVIEW | PR-16 65c4fe7 |
| R7.4 | TODO | IMPLEMENTED_PENDING_REVIEW | PR-17 d6f8c84 |
| R7.5 | TODO | PASS_LOCAL | pr15 E3 + new016 + R11.6 |
| R7.6 | TODO | BLOCKED_PRODUCTION_VALIDATION | — |
| R8.1 | TODO | IMPLEMENTED_PENDING_REVIEW | LEGAL_REVIEW_DECISION_PACKET.md (9b25de7) |
| R8.2 | TODO | BLOCKED_LEGAL_REVIEW | J-2 |
| R8.3 | TODO | BLOCKED_LEGAL_REVIEW | J-3 |
| R8.4 | TODO | BLOCKED_LEGAL_REVIEW | scaffolding only |
| R8.5 | TODO | BLOCKED_LEGAL_REVIEW | scaffolding only |
| R8.6 | TODO | BLOCKED_PRODUCTION_VALIDATION | — |
| R9.1 | TODO | BLOCKED_HUMAN_DECISION | HD-10: o plano foi executado sob a instrução do owner do 2º passe; aprovação formal pendente |
| R9.2 | TODO | PARTIAL_LOCAL | grupo A: 7/10 implementados (SEM-028…031, 034, 035, 036); bloqueados: SEM-027 (HD-13), SEM-032 (R2.3), SEM-033 (J-2) |
| R9.3 | TODO | PARTIAL_LOCAL | grupo B: 5/5 com correção (SEM-040 só lineage futura; backfill: BLOCKED_HUMAN_DECISION) |
| R9.4 | TODO | PARTIAL_LOCAL | grupo C: 4/5 (SEM-047…050); SEM-051 BLOCKED_HUMAN_DECISION (HD-14) |
| R9.5 | TODO | PARTIAL_LOCAL | grupo D: 8/9 (SEM-052…058, 060); SEM-059 BLOCKED_LEGAL_REVIEW |
| R9.6 | TODO | PARTIAL_LOCAL | grupo E: 5/8 (SEM-062 parcial, 064, 067…069); SEM-063 jurídico; SEM-065/066 dependem de R2.3 |
| R9.7 | TODO | IMPLEMENTED_PENDING_REVIEW | grupo F: 5/5 (SEM-070…074) |
| R9.8 | TODO | PARTIAL_LOCAL | grupo G: 7/7 com correção (SEM-077, 079, 083 parciais por decisão/dev-only) |
| R9.9 | TODO | PARTIAL_LOCAL | grupo H: 2/5 (SEM-080, 081) + SEM-084 parcial; SEM-082 jurídico; SEM-085 depende de R2.3 |
| R9.10 | TODO | PARTIAL_LOCAL | estados locais do plano regenerados com base no código real (2026-10-05) |
| R10.1 | TODO | IMPLEMENTED_PENDING_REVIEW | R10_P2_REMEDIATION_PLAN.md |
| R10.2 | TODO | PARTIAL_LOCAL | 10/12 P2 (SEM-087 e 090 parciais); SEM-091 BLOCKED_LEGAL_REVIEW; HD-11 pendente |
| R10.3 | TODO | IMPLEMENTED_PENDING_REVIEW | 5 contratos em docs/architecture + 1 em docs/design (PR merge pendente) |
| R10.4 | TODO | TODO | — |
| R11.1 | TODO | PASS_LOCAL | R11.1 a75ac0e |
| R11.2 | TODO | PASS_LOCAL | R11.2 a75ac0e |
| R11.3 | TODO | PASS_LOCAL | R11.3 a75ac0e |
| R11.4 | TODO | PASS_LOCAL | R11.4 a75ac0e |
| R11.5 | TODO | PASS_LOCAL | R11.5 a75ac0e |
| R11.6 | TODO | PASS_LOCAL | R11.6 a75ac0e |
| R11.7 | TODO | TECHNICAL_REAUDIT_COMPLETE (não PASS) | SEMANTIC_AUTHORITY_CLOSURE_REAUDIT.md |
| R11.8 | TODO | BLOCKED_PR_REQUIRED | CLOSURE_REPORT (rascunho) |

Distribuição local: BLOCKED_HUMAN_DECISION 3 · BLOCKED_LEGAL_REVIEW 5 · BLOCKED_PRODUCTION_ACCESS 3 · BLOCKED_PRODUCTION_VALIDATION 8 · BLOCKED_PR_REQUIRED 1 · IMPLEMENTED_PENDING_REVIEW 19 · PASS 24 · PASS_LOCAL 12 · TECHNICAL_REAUDIT_COMPLETE (não PASS) 1 · TODO 11 (total 87).

## B. Matriz dos 92 achados (SEM-001…SEM-092, cada um uma vez)

| SEM | Sev. | Achado (baseline) | Fatia | Oficial (main) | Estado local |
|---|---|---|---|---|---|
| SEM-001 | P0 | Colaboração: lookups globais, membro de outro tenant, enumeração de e-mail e vazamento de PII | PR-01/PR-01A | FIXED_IN_MAIN | FIXED_IN_MAIN (R1.10 produção pendente) |
| SEM-002 | P0 | `createProcess` (licitação) reseta processo existente com o mesmo número | PR-05 | FIXED_IN_MAIN | FIXED_IN_MAIN (R3.6 produção pendente) |
| SEM-003 | P0 | Contratação Direta: `createProcess` com número existente reseta o workspace | PR-05 | FIXED_IN_MAIN | FIXED_IN_MAIN (R3.6 produção pendente) |
| SEM-004 | P0 | Ratificação: default "ratificado", clicante como autoridade, upsert mantém 1º responsável/data | PR-07 | OPEN | IMPLEMENTED_PENDING_REVIEW `da5e7aa` (competência: BLOCKED_LEGAL_REVIEW J-1) |
| SEM-005 | P0 | Pesquisa colada: segunda colagem sobrescreve cotações da primeira | PR-04/PR-04A | OPEN | IMPLEMENTED_PENDING_REVIEW `d722256` `ae8a286` (estado da flag: BLOCKED_PRODUCTION_ACCESS) |
| SEM-006 | P0 | Parecer canônico: `createDraft` reseta parecer assinado/editado | PR-06 | OPEN | IMPLEMENTED_PENDING_REVIEW `62b0d3c` |
| SEM-007 | P0 | Contrato: colisão de upsert sobrescreve contrato vigente | PR-06 + 0310 | OPEN | IMPLEMENTED_PENDING_REVIEW `b0d9588` `62b0d3c` (FCC-06) |
| SEM-008 | P0 | Modo legado: quantidade da cotação vira quantidade da contratação em TR/Edital/ETP | PR-13 | OPEN | IMPLEMENTED_PENDING_REVIEW `db184f1` (merge depende de R6.2) |
| SEM-009 | P0 | Edital: parâmetros não hidratados do rascunho — "Gerar edital" regenera com padrões | PR-09 | OPEN | IMPLEMENTED_PENDING_REVIEW `8b88522` |
| SEM-010 | P0 | Catálogo legal legado mistura hipóteses da Lei 8.666 em numeração da Lei 14.133 + mapeamento por substring | PR-18→PR-19 | OPEN | BLOCKED_LEGAL_REVIEW (J-2; scaffolding `9b25de7`) |
| SEM-011 | P0 | Limite de aditivo 50% para todo contrato (art. 125) | PR-18→PR-20 | OPEN | BLOCKED_LEGAL_REVIEW (J-3; scaffolding `9b25de7`) |
| SEM-012 | P0 | Valores em centavos exibidos como reais (100×) em saídas institucionais | PR-14 | OPEN | IMPLEMENTED_PENDING_REVIEW `7f35be3` (cutover: R2.3) |
| SEM-013 | P0 | Versões emitidas de DFD/ETP/TR/Edital reexportam com a identidade institucional ATUAL | PR-15 | OPEN | IMPLEMENTED_PENDING_REVIEW `98918a9` (backfill: R7.2) |
| SEM-014 | P0 | Regenerar ETP/TR/Edital sobrescreve rascunho editado por humano, sem confirmação | PR-09 | OPEN | IMPLEMENTED_PENDING_REVIEW `8b88522` |
| SEM-015 | P0 | `procurementProcess.updateStage` leva o processo a ISSUED/"emitido" sem Edital oficial | PR-02 | FIXED_IN_MAIN | FIXED_IN_MAIN (#272 `3b0b30d`) |
| SEM-016 | P0 | Parecer legado: aprovador vindo do cliente, autor aprova, aprovado continua editável e o export acompanha, ass | PR-03 | OPEN | IMPLEMENTED_PENDING_REVIEW `296f831` |
| SEM-017 | P0 | Parecer legado: IA sobrescreve parecer assinado, inclusive a conclusão favorável/desfavorável | PR-03 | OPEN | IMPLEMENTED_PENDING_REVIEW `296f831` |
| SEM-018 | P0 | `documents.approveDocument` legado aprova de qualquer status, sem SoD/papel/`approvedBy` | PR-02 | FIXED_IN_MAIN | FIXED_IN_MAIN (#272 `3b0b30d`) |
| SEM-019 | P0 | Editor do parecer canônico abre vazio e com "Favorável"; "Salvar nova versão" apaga campos | PR-10 | OPEN | IMPLEMENTED_PENDING_REVIEW `3ff78a1` |
| SEM-020 | P0 | Contratação Direta: "Anexar"/"Validar" documento obrigatório com referência falsa | PR-16 | OPEN | IMPLEMENTED_PENDING_REVIEW `65c4fe7` |
| SEM-021 | P0 | Justificativa por "copilotos" vira documento oficial sem aceite humano (e regerar sobrescreve) | PR-11 | OPEN | IMPLEMENTED_PENDING_REVIEW `67ccbbf` |
| SEM-022 | P0 | Justificativa de preço: formulário vazio sobrescreve a salva e emite documento oficial | PR-11 | OPEN | IMPLEMENTED_PENDING_REVIEW `67ccbbf` |
| SEM-023 | P0 | "Salvar contrato" altera valor/contratado/objeto de contrato vigente sem aditivo e sem controle de concorrênci | PR-12 | OPEN | IMPLEMENTED_PENDING_REVIEW `2d22545` |
| SEM-024 | P0 | Termo Aditivo/Apostilamento gerado ignora os dados do próprio instrumento | PR-17 | OPEN | IMPLEMENTED_PENDING_REVIEW `d6f8c84` |
| SEM-025 | P0 | Aditivo/apostilamento "ressuscita" contrato rescindido e marca "aditado" antes do parecer | PR-08 | OPEN | IMPLEMENTED_PENDING_REVIEW `87e8635` |
| SEM-026 | P0 | Itens Inteligentes: viewer aprova item e confirma CATMAT | PR-08 | OPEN | IMPLEMENTED_PENDING_REVIEW `87e8635` |
| SEM-027 | P1 | Média aritmética de cotações apresentada como "valor de referência", sem método/decisão humana (média/mediana/ | R9 grupo A | OPEN | BLOCKED_HUMAN_DECISION (HD-13: método institucional do valor de referência) |
| SEM-028 | P1 | Preço canônico ignora `sourceState` do Item Inteligente (`source_changed`/`review_required`) | R9 grupo A | OPEN | IMPLEMENTED_PENDING_REVIEW `c7e6921` |
| SEM-029 | P1 | Objeto digitado no navegador sobrepõe `process.object` em ETP/TR/Edital (política diz só `process`) | R9 grupo A | OPEN | IMPLEMENTED_PENDING_REVIEW `c7e6921` |
| SEM-030 | P1 | Aprovação da **sessão de importação** (extração correta) autoriza candidatura do item à contratação independen | R9 grupo A | OPEN | IMPLEMENTED_PENDING_REVIEW `c7e6921` |
| SEM-031 | P1 | Vínculo de preço aceito para qualquer item ativo sem compatibilidade de unidade; troca de unidade após vínculo | R9 grupo A | OPEN | IMPLEMENTED_PENDING_REVIEW `c7e6921` |
| SEM-032 | P1 | Valor **estimado** usado como valor do contrato na minuta; cotação selecionada (`isSelected`) nunca lida; "PAR | R9 grupo A | OPEN | OPEN — depende de R2.3 e de migration (`contractedValue`); PR-14 já rotula "valor estimado" nas saídas legadas |
| SEM-033 | P1 | Valor/status alteráveis após validação (inclusive autoaprovação) em `directContracts.update` sem revalidar lim | R9 grupo A | OPEN | BLOCKED_LEGAL_REVIEW (limites — J-2) |
| SEM-034 | P1 | CATMAT legado aprova código de IA sobre o item (e pode aplicar sugestão de outro item), trocando a descrição h | R9 grupo A | OPEN | IMPLEMENTED_PENDING_REVIEW `bc74f6f` (escritores não-escopados não exportados + guard estático; callers legados desligados por LEG-005) |
| SEM-035 | P1 | Endpoints legados de CATMAT (`acceptCATMAT` confia no código do cliente; `manualCATMAT` fora do ledger) | R9 grupo A | OPEN | IMPLEMENTED_PENDING_REVIEW `a05debe` |
| SEM-036 | P1 | Legado `documents.generateNext`/`generateDocument` gera ETP/TR/Edital com `estimatedValue \\|\\| 0`, sem tabela  | R9 grupo A | OPEN | IMPLEMENTED_PENDING_REVIEW `bc74f6f` (+ LEG-009): nenhum caller montado; assistente de IA não alimenta `estimatedValue || 0` |
| SEM-037 | P2 | `writePlannedQuantity` grava no ledger via `appendContextFacts` direto, contornando a checagem de política de  | R10 | OPEN | IMPLEMENTED_PENDING_REVIEW `d6904da` |
| SEM-038 | P2 | Política permite `intelligent_item` como fonte de descrição/unidade, mas não há escritor — autoridade morta/am | R10 | OPEN | IMPLEMENTED_PENDING_REVIEW `d6904da` |
| SEM-039 | P1 | Documentos a jusante leem **rascunhos** a montante; lineage do Edital grava `"tr_aprovado"` fixo | R9 grupo B | OPEN | IMPLEMENTED_PENDING_REVIEW `d5d9309` |
| SEM-040 | P1 | Aditivos/apostilamentos compartilham uma lineage por contrato (Aditivo nº2 = "v2" do nº1); sem `addendumId` no | R9 grupo B | OPEN | PARTIAL_LOCAL `27e9992` (lineage própria por instrumento NOVO; backfill das versões existentes: BLOCKED_HUMAN_DECISION) |
| SEM-041 | P1 | "Fixação" do documento analisado pelo parecer é fictícia (versão default 1; snapshot = hash sem conteúdo) | R9 grupo B | OPEN | IMPLEMENTED_PENDING_REVIEW `c875b5c` |
| SEM-042 | P1 | Justificativa de preço sem linhagem (valor do cliente, "Baseado na Pesquisa… confiança 0,85" fixo); `character | R9 grupo B | OPEN | IMPLEMENTED_PENDING_REVIEW `5d97fec` (justificativa de preço com lineage do servidor; `characterizeNeed`/`importDFD` recusam com código estável por falta de tabela de persistência) |
| SEM-043 | P1 | Export oficial não registra `replayHash`/`contentHash`/SHA do artefato; DOCX e PDF da mesma versão sobrescreve | R9 grupo B | OPEN | IMPLEMENTED_PENDING_REVIEW `ac51bfd` (migration 0315: ledger append-only de artefatos por formato) |
| SEM-044 | P2 | Edição humana não deixa marcador; ETP reescrito por humano aparece como "gerado" | R10 | OPEN | IMPLEMENTED_PENDING_REVIEW `d6904da` |
| SEM-045 | P2 | Descrição/unidade do item canônico sempre projetadas como `user/confirmed` (proveniência achatada) | R10 | OPEN | IMPLEMENTED_PENDING_REVIEW `d6904da` |
| SEM-046 | P2 | Activity report lê campos inexistentes (`userName`, `description`) → tudo "Sistema"; `download.*` grava logs s | R10 | OPEN | IMPLEMENTED_PENDING_REVIEW `bc74f6f` |
| SEM-047 | P1 | Digest global único de ETP/TR/Edital: falso positivo (`pendingItemCount`, status/origin do DFD, parâmetros da  | R9 grupo C | OPEN | IMPLEMENTED_PENDING_REVIEW `d5d9309` |
| SEM-048 | P1 | Correção de extração aceita após aprovação/promoção sem re-revisão (contorna operador revisa/gestor promove);  | R9 grupo C | OPEN | IMPLEMENTED_PENDING_REVIEW `1c921a3` |
| SEM-049 | P1 | `item_source_links.sourceQuantity` congelado no vínculo; "Usar N" pode adotar valor antigo do DFD | R9 grupo C | OPEN | IMPLEMENTED_PENDING_REVIEW `380fd08` |
| SEM-050 | P1 | Governança de Itens falha **aberta** (`.catch(() => null)`) → mudança em item consumido por documento aprovado | R9 grupo C | OPEN | IMPLEMENTED_PENDING_REVIEW `c56b0ae` (escritas) + `d6904da` (leitura: estado `unknown`/locked, nunca "sem restrição") |
| SEM-051 | P1 | Estado "aprovado" de `generated_documents` nunca é escrito: `assertDFDMutable` e `itemsConsumedByApproved` são | R9 grupo C | OPEN | BLOCKED_HUMAN_DECISION (HD-14: o DFD passa a ter emissão oficial?) |
| SEM-052 | P1 | "Aplicar cotações atualizadas (N)" troca cotações/média e revoga a aprovação em 1 clique; antigo × novo só em  | R9 grupo D | OPEN | IMPLEMENTED_PENDING_REVIEW `8b0ed58` |
| SEM-053 | P1 | "Promover conteúdo revisado" não diz que Itens Inteligentes existentes serão mesclados/recalculados/marcados | R9 grupo D | OPEN | IMPLEMENTED_PENDING_REVIEW `1c921a3` |
| SEM-054 | P1 | "Aprovar" Item Inteligente habilitado com "Fonte alterada"/"Identidade a revisar"; sem mostrar outliers/impact | R9 grupo D | OPEN | IMPLEMENTED_PENDING_REVIEW `8b0ed58` + `988e555` (UI de resolução humana da identidade) |
| SEM-055 | P1 | "Usar N" substitui quantidade humana sem confirmação; rótulo "Quantidade no documento" para quantidade **cotad | R9 grupo D | OPEN | IMPLEMENTED_PENDING_REVIEW `380fd08` |
| SEM-056 | P1 | Campo "Quantidade prevista" não ressincroniza após write (`useState` fixo) → "Salvar" reverte o valor | R9 grupo D | OPEN | IMPLEMENTED_PENDING_REVIEW `380fd08` |
| SEM-057 | P1 | "Emitir documento oficial" sem pré-condições semânticas (source_changed, `[REVISAR]`, ordem TR→Edital) e com e | R9 grupo D | OPEN | IMPLEMENTED_PENDING_REVIEW `9375eca` |
| SEM-058 | P1 | Justificativa do DFD por IA substitui texto importado/pré-preenchido sem aviso (confirmação só em `user_modifi | R9 grupo D | OPEN | IMPLEMENTED_PENDING_REVIEW `4037745` (sugestão ≠ decisão; aceite explícito com CAS e lineage) |
| SEM-059 | P1 | "Sugerir artigo" (IA) troca dispensa↔inexigibilidade e limpa o artigo escolhido sem aceite | R9 grupo D | OPEN | BLOCKED_LEGAL_REVIEW (catálogo — J-2) |
| SEM-060 | P1 | Rótulos que não correspondem ao efeito: "Gerar publicações" também avança etapa; "Importar DFD" legado só regi | R9 grupo D | OPEN | IMPLEMENTED_PENDING_REVIEW `4037745` |
| SEM-061 | P2 | "Substituir rascunho" (import) confirma sem mostrar o conteúdo atual; CATMAT "Confirmar" sem decisão vigente;  | R10 | OPEN | IMPLEMENTED_PENDING_REVIEW `4037745` (confirmação de limiar só na UI; política de limiar não decidida) |
| SEM-062 | P1 | Contratos não herdam nada de adjudicação/ratificação (valor 0, contratado ""), sem itens (planejado × contrata | R9 grupo E | OPEN | PARTIAL_LOCAL `27e9992` (gestor/fiscal aplicados pelo instrumento; herança de valor/contratado só da contratação direta com evidência canônica; licitação sem registro canônico; itens do contrato: nota de design, NOT DECIDED) |
| SEM-063 | P1 | Parecer devolvido não governa o domínio solicitante (ratificação/publicação não leem; aditivo `aguardando_pare | R9 grupo E | OPEN | BLOCKED_LEGAL_REVIEW (efeito do parecer desfavorável) |
| SEM-064 | P1 | Status da Contratação Direta derivado do ponteiro de etapa (ratificado/publicado sem ato registrado); `configu | R9 grupo E | OPEN | IMPLEMENTED_PENDING_REVIEW `5d97fec` (status derivado dos atos registrados; `configureFlags` com evento; `publish` sem extrato fabricado; vocabulário inalterado — HD-09) |
| SEM-065 | P1 | Geração de minuta de rescisão já marca contrato `terminated` (legado) | R9 grupo E | OPEN | OPEN — legado `contractsRouter` (LEG-016): corrigir × retirar depende de R2.3 |
| SEM-066 | P1 | Termos legados usam dados atuais (apostila "de X para X"); contratos ativos editáveis; audit só com nomes de c | R9 grupo E | OPEN | OPEN — legado (LEG-016): depende de R2.3 |
| SEM-067 | P1 | Lote arquivado mantém código reservado e gera membership pendente | R9 grupo E | OPEN | IMPLEMENTED_PENDING_REVIEW `380fd08` |
| SEM-068 | P1 | Linhas idênticas do DFD colapsam (`sourceItemKey` sem nº da linha) → `DUPLICATE_DECISION` bloqueia confirmação | R9 grupo E | OPEN | IMPLEMENTED_PENDING_REVIEW `380fd08` |
| SEM-069 | P1 | Re-adicionar item retirado não faz nada e reporta sucesso | R9 grupo E | OPEN | IMPLEMENTED_PENDING_REVIEW `380fd08` (recusa explícita; sem reativação — política não decidida) |
| SEM-070 | P1 | Centro de Operações: "Contratos vencendo" conta eventos (6 por contrato, sem janela); "Tarefas pendentes" semp | R9 grupo F | OPEN | IMPLEMENTED_PENDING_REVIEW `970211a` |
| SEM-071 | P1 | Gestão: três definições de "Atrasada" (KPI calculado × status manual × Excel); cores de prazo divergentes da r | R9 grupo F | OPEN | IMPLEMENTED_PENDING_REVIEW `970211a` |
| SEM-072 | P1 | Pacotes (publicação legado, contratação direta) empacotam todas as versões/status com nomes colidentes e Markd | R9 grupo F | OPEN | IMPLEMENTED_PENDING_REVIEW `b603d7a` (sem versão `final`: último rascunho em `rascunhos_NAO_OFICIAIS/`, controlado por `includeLatestDraftWhenNoOfficial` — escolha técnica, não política) |
| SEM-073 | P1 | Routers de export aceitam `organizationId` do cliente (`protectedProcedure`): `exports.generate/getHistory/get | R9 grupo F | OPEN | IMPLEMENTED_PENDING_REVIEW `bc74f6f` (organização do contexto; `organizationId` divergente recusado) + LEG-028 à frente |
| SEM-074 | P1 | Analytics/Auditoria leem tabelas legadas sem escrita (`processes`, `documents`) | R9 grupo F | OPEN | IMPLEMENTED_PENDING_REVIEW `b603d7a` |
| SEM-075 | P1 | `idempotencyService`: linha "failed" não é re-reservada (retries concorrentes rodam — IA duplicada); payload h | R9 grupo G | OPEN | IMPLEMENTED_PENDING_REVIEW `c0e5b7c` |
| SEM-076 | P1 | Timeline de eventos com id `sha256(org:process:count:eventType)` + upsert do `summary`: eventos concorrentes d | R9 grupo G | OPEN | IMPLEMENTED_PENDING_REVIEW `bdfabef` (timeline do processo; demais timelines: NEW-004 residual) |
| SEM-077 | P1 | Workflow de aprovação em memória (aprovador do input, sem tenant na escrita, mesmo aprovador contado N vezes); | R9 grupo G | OPEN | PARTIAL_LOCAL `bc74f6f` (superfície em memória só dev, atrás de LEG-028: tenant do contexto, aprovador = usuário autenticado, aprovador contado uma vez, agente simulado nunca `completed`; persistência não implementada) |
| SEM-078 | P1 | Conteúdo legado de `documents` muda in-place mantendo "approved" (`updateDocumento`, `publishDraft`, `restoreT | R9 grupo G | OPEN | IMPLEMENTED_PENDING_REVIEW `bc74f6f` (+ LEG-009) |
| SEM-079 | P1 | `documents.restoreVersion` insere linha **sem `organizationId`** e pode copiar conteúdo entre processos do mes | R9 grupo G | OPEN | PARTIAL_LOCAL `bc74f6f` (+ LEG-009; backfill + NOT NULL: BLOCKED_HUMAN_DECISION) |
| SEM-080 | P1 | IA nos textos de ETP/TR: seção obrigatória "estimativa do valor" escrita pela IA; números na prosa nunca verif | R9 grupo H | OPEN | IMPLEMENTED_PENDING_REVIEW `d088a33` |
| SEM-081 | P1 | "Valor estimado global" parcial apresentado como global (itens sem preço omitidos) | R9 grupo H | OPEN | IMPLEMENTED_PENDING_REVIEW `df1a717` (total parcial rotulado PARCIAL) |
| SEM-082 | P1 | Justificativa de "presencial" é boilerplate aceito pela validação e nunca renderizado no Edital | R9 grupo H | OPEN | BLOCKED_LEGAL_REVIEW (conteúdo mínimo) |
| SEM-083 | P1 | SoD do parecer canônico: quem "recebe" vira advogado responsável; assinante não precisa ser o designado; chave | R9 grupo G | OPEN | PARTIAL_LOCAL `27e9992` (chave HMAC própria via config + verificação com fallback documentado; assinante = designado confirmado; rotação de chave e SoD "designado ≠ quem recebe": BLOCKED_HUMAN_DECISION) |
| SEM-084 | P1 | Aditivos canônicos sem limite de valor/prazo e com sequência `count+1` → criação concorrente sobrescreve | R9 grupo H | OPEN | PARTIAL_LOCAL `27e9992` (sequência atômica sob lock; limites do art. 125: BLOCKED_LEGAL_REVIEW J-4) |
| SEM-085 | P1 | `contracts.number` único **global** (entre tenants) | R9 grupo H | OPEN | OPEN — depende de R2.3 (FCC-06: a 0310 cobre `contract_workspaces`, não `contracts`) |
| SEM-086 | P1 | Rotas autorizadas por `ownerId` (`downloadRouter`, `platformsRouter`) sem checar membership vigente no tenant  | R9 grupo G | OPEN | IMPLEMENTED_PENDING_REVIEW `bc74f6f` (hipótese CONFIRMADA e corrigida: tenant + processo do autor) |
| SEM-087 | P2 | SoD da emissão exclui só autor e **último** editor; `issueProcess` não exige ETP/TR emitidos. | R10 | OPEN | PARTIAL_LOCAL `d6904da` (parte B: `issueProcess` exige ETP/TR/Edital emitidos; parte A, escopo da SoD: BLOCKED_HUMAN_DECISION) |
| SEM-088 | P2 | `tenantIsolationAuditService` avalia registros fornecidos pelo chamador (não varre o banco) — falsa sensação d | R10 | OPEN | IMPLEMENTED_PENDING_REVIEW `bc74f6f` |
| SEM-089 | P2 | `dfdj:${key}`.slice(0,64) pode colidir chaves longas. | R10 | OPEN | IMPLEMENTED_PENDING_REVIEW `d6904da` |
| SEM-090 | P2 | Quantidade nula gravada como 0 na promoção (0 entra na chave lógica). | R10 | OPEN | PARTIAL_LOCAL `d6904da` (quantidade nula ≠ 0 no domínio e nos documentos; o token "0" da chave lógica persistida exige migração versionada de chave) |
| SEM-091 | P2 | Credenciamento inexistente como regime; prompt de parecer legado lê `legalArticle` inexistente. | R10 | OPEN | BLOCKED_LEGAL_REVIEW (J-5) |
| SEM-092 | P2 | Componente `WorkspaceDecisionPanel` com decisões fictícias ("Ana Souza", "Carlos Lima") como default — sem con | R10 | OPEN | IMPLEMENTED_PENDING_REVIEW `bc74f6f` |

Resumo local: ADDRESSED_LOCAL 1 · BLOCKED_LEGAL_REVIEW 2 · FIXED_IN_MAIN 5 · IMPLEMENTED_PENDING_REVIEW 20 · MITIGATED_LOCAL 5 · PARTIAL_LOCAL 6 · PLAN_PREPARED 53 (total 92).
Por severidade: P0/BLOCKED_LEGAL_REVIEW 2 · P0/FIXED_IN_MAIN 5 · P0/IMPLEMENTED_PENDING_REVIEW 19 · P1/ADDRESSED_LOCAL 1 · P1/IMPLEMENTED_PENDING_REVIEW 1 · P1/MITIGATED_LOCAL 5 · P1/PARTIAL_LOCAL 6 · P1/PLAN_PREPARED 41 · P2/PLAN_PREPARED 12.


## 11. Encerramento

AUTONOMOUS_BATCH =
TECHNICAL_WORK_EXHAUSTED /
NO_PR_OPENED /
NO_MERGE /
NO_DEPLOY /
PRODUCTION_UNTOUCHED /
READY_FOR_GLOBAL_HUMAN_VALIDATION


## 12. SEGUNDO PASSE (2026-10-05) — resumo

> Detalhe completo: [`AUTONOMOUS_REMEDIATION_SECOND_PASS_REPORT.md`](AUTONOMOUS_REMEDIATION_SECOND_PASS_REPORT.md).
> Branch ainda **LOCAL_CANDIDATE** (não é MERGED, DEPLOYED nem VALIDATED_PRODUCTION). Sem PR · sem merge · sem deploy · produção intocada.

- **13 commits** sobre `5081ec7` (de `23554f3` a `22d0ed8`); 1 migration nova (**0315** `official_document_artifacts`, aditiva, append-only).
- Matriz B atualizada: dos 66 achados P1+P2 do plano, **47 IMPLEMENTED_PENDING_REVIEW**, **8 PARTIAL_LOCAL**, 2 BLOCKED_HUMAN_DECISION (SEM-027, 051),
  5 BLOCKED_LEGAL_REVIEW (SEM-033, 059, 063, 082, 091), 4 dependentes de R2.3 (SEM-032, 065, 066, 085). Os 26 P0 não mudaram de contagem:
  24 com correção, **SEM-010 e SEM-011 abertos (jurídico)**; NEW-036 corrigido localmente.
- **Gate final do 2º passe** (MySQL 8.0.46 limpo): migrations 0000→0315 (ledger 316 = journal 316), `db:audit`, sem drift, typecheck, lint dos 413 arquivos
  alterados (0 problemas), `pnpm test` **360 arquivos / 7019 testes passaram** (101 / 798 pulados = `*-mysql-smoke` sem DB), cadeia MySQL da CI
  (48 passos; 44 comandos com testes somaram **757 testes passados** + 2 do C.4B.3B reexecutados após a correção; `test:smoke:security` **39 arquivos / 396 testes**; passo novo R9/R10 **16 arquivos / 59 testes**), build, `audit:gate`, baseline `08edc734…810b3` inalterado.
  **1 reprovação encontrada pelo gate** (smoke C.4B.3B, asserção desatualizada pelo marcador de edição humana do SEM-044) → corrigida em `22d0ed8` e reexecutada
  (11/11). Detalhes e a ressalva honesta sobre o "gate único" no relatório do 2º passe.
- **R11:** novo `r11-semantic-authority-behavior-guards.test.ts` (17 testes, labels R11-B1…B7: smokes órfãos, identidade da timeline, autoridade numérica da IA,
  objeto canônico, preço de fonte desatualizada, semântica da auditoria de tenant, formatação monetária). R11.7 segue **TECHNICAL_REAUDIT_COMPLETE, não PASS**.
- NEW-037 (`invitations` 8/10) **PRE_EXISTING_MAIN_FAILURE**: apenas documentado, não corrigido.
