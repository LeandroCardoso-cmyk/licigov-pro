# Mapa de commits — lote autônomo (base `main` `aac4241`)

> Branch `work/autonomous-semantic-remediation-r3-r11`. Commits por pacote de trabalho, cherry-pickáveis na ordem
> abaixo (a cadeia de migrations 0310 → 0314 é linear no journal: a ordem relativa dos commits com migration é
> obrigatória). Estado de todos: **IMPLEMENTED_PENDING_REVIEW** (sem PR, sem merge, sem deploy).

| # | Commit | Pacote | Achados | Migration | Testes principais |
|---:|---|---|---|---|---|
| 1 | `e4f978d` | Fase A — reconciliação do ledger + decisões humanas importadas | — | — | — |
| 2 | `aeed4f1` | LEG-009 pipeline legado de documentos desligado | SEM-036, SEM-078, SEM-079 (mitigação) | — | `r2-leg009-legacy-documents-disabled(-mysql-smoke)` |
| 3 | `e4b5fe2` | LEG-028 APIs experimentais em memória fail-closed fora de dev | SEM-073, SEM-077 (mitigação) | — | gate experimental |
| 4 | `18a3d60` | LEG-032 formulário público de contato legado desligado | — | — | contact router |
| 5 | `2c5a9ad` | NEW-002 / LEG-033 hard delete de conta bloqueado | NEW-002 | — | `new-002-account-hard-delete-mysql-smoke` |
| 6 | `55e3151` | NEW-005 RBAC institucional da Contratação Direta | NEW-005 | — | `direct-procurement-rbac-*` |
| 7 | `cfa747d` | NEW-006 RBAC do workspace de contratos | NEW-006 | — | `new006-*` |
| 8 | `b75a6a3` | NEW-007 autoridade do parecer por atribuição | NEW-007 | — | `new007-*` |
| 9 | `d722256` | PR-04A importação governada de pesquisa (identidade explícita) | SEM-005 | — | `direct-price-import-governed-mysql-smoke` |
| 10 | `ae8a286` | PR-04 guarda do colar legado (acoplada à flag) | SEM-005 | — | `pr04-legacy-price-research-guard-mysql-smoke` |
| 11 | `296f831` | PR-03 parecer legado → histórico só leitura | SEM-016, SEM-017 | — | `legal-opinions-tenant-isolation-mysql-smoke` (14) |
| 12 | `b0d9588` | número de contrato único por órgão | SEM-007 (FCC-06) | **0310** | `contract-number-unique-0310-mysql-smoke` |
| 13 | `62b0d3c` | PR-06 criação de parecer/contrato sem reset | SEM-006, SEM-007 | — | `create-not-reset-legal-contract-mysql-smoke` |
| 14 | `9559153` | R3.5 contrato de replay tardio | R3.5 | — | `create-not-reset-processes-mysql-smoke` (16) |
| 15 | `87e8635` | PR-08 paridade RBAC CATMAT + máquina de estados de instrumentos | SEM-025, SEM-026 | — | `pr08-rbac-state-machine(-mysql-smoke)` |
| 16 | `2d22545` | PR-12 contrato vigente muda termos só por instrumento (CAS) | SEM-023 | — | `pr12-contract-governed-change-mysql-smoke` |
| 17 | `8b88522` | PR-09 regeneração preserva edição humana; parâmetros do Edital hidratados | SEM-014, SEM-009 | **0311** | `pr09-regeneration-human-state(-mysql-smoke)` |
| 18 | `da5e7aa` | PR-07 ledger de decisão institucional (ratificação) | SEM-004 | **0312** | `institutional-decision-ledger-mysql-smoke` (D1–D10) |
| 19 | `68c8426` | Pilot Reset B2/B3 lifecycle governado | Pilot Reset | **0313** | `pilot-reset-lifecycle-mysql-smoke` (L1–L12), `process-lifecycle-0313-migration-mysql-smoke` |
| 20 | `3ff78a1` | PR-10 + R5.1 edição não destrutiva do parecer, guard de hidratação | SEM-019 | — | `formHydration.test`, `pr10-pr11-*` (H1–H3) |
| 21 | `67ccbbf` | PR-11 justificativa da IA é sugestão; aceite humano registra | SEM-021, SEM-022 | — | `pr10-pr11-human-authority-mysql-smoke` (J1–J5) |
| 22 | `db184f1` | PR-13 quantidade cotada nunca vira necessidade | SEM-008 | — | `tr-canonical-quantity`, `canonical-quantity-documents`, pilotos |
| 23 | `7f35be3` | PR-14 formatador monetário único, KPI de valor estimado | SEM-012 | — | `pr14-money-formatter-mysql-smoke` |
| 24 | `98918a9` | PR-15 snapshot institucional na emissão + R7.5 | SEM-013 | — | `pr15-emission-identity-snapshot-mysql-smoke` |
| 25 | `65c4fe7` | PR-16 evidência documental real | SEM-020 | **0314** | `pr16-required-document-evidence-mysql-smoke` (D1–D7) |
| 26 | `d6f8c84` | PR-17 termos a partir do instrumento | SEM-024 | — | `pr17-instrument-terms-mysql-smoke` (T1–T4) |
| 27 | `9b25de7` | R8 pacote jurídico + scaffolding fail-closed (PR-19/20) | SEM-010, SEM-011, SEM-084 | — | `unit/r8-legal-review-policy` |
| 28 | `c56b0ae` | R9/R10 planos + correção SEM-050 | SEM-050 | — | `unit/r9-sem050-governance-fail-closed` |
| 29 | `a75ac0e` | R11.1–R11.6 guardas permanentes | — | — | `unit/r11-semantic-authority-guards` (18) |
| 30 | `00a3c2a` | correções pegas pela suíte completa (fronteira do Kernel no storage da PR-16, estilo disabled, teste legado do Edital) | SEM-020, SEM-008 | — | `rc35*/rc352`, `darkmode-disabled`, `p0-edital-context` |
| 31 | (docs finais) | relatórios de fechamento, bloqueios, decisões, ledger | — | — | — |

## Dependências entre commits

- **Migrations**: 12 (0310) → 17 (0311) → 18 (0312) → 19 (0313) → 25 (0314). Cada uma tem `meta/NNNN_snapshot.json`; a
  0310 absorve o drift pré-existente das 0308/0309 (sem snapshot).
- 6/7/8 (RBAC) antes de 13, 15, 16, 21, 25 (usam `orgRoleProcedure`/matrizes).
- 13 depende de 12; 16 depende de 13 (fixups no smoke de PR-06); 18 depende de 6 (matriz RBAC) e 15.
- 20 antes de 21 (o guard R5.1 e o smoke H/J estão no commit 21).
- 22 depende de 17 (contexto do Edital); 29 depende de 21, 25, 26; 30 corrige 22 e 25 (cherry-pick junto).
