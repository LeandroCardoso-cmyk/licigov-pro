# Re-auditoria técnica de fechamento — autoridade semântica (R11.7)

> Resultado: **TECHNICAL_REAUDIT_COMPLETE — NÃO É PASS.** O checkpoint R11.7 exige "sem P0 aberto". Na `main` oficial
> 21 dos 26 P0 continuam abertos. Nesta branch (não mergeada) 24 dos 26 P0 têm correção implementada e testada
> localmente, e os outros **2 P0 (SEM-010, SEM-011) estão abertos por dependerem de parecer jurídico**.
> Branch `work/autonomous-semantic-remediation-r3-r11` · base `main` `aac4241` · 2026-10-02 · **re-auditoria repetida no 2º passe em 2026-10-05 (head `22d0ed8`) — ver §5.**
> Baseline: `docs/audits/SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md` (sha256 `08edc734…810b3`, **inalterado**).

## 1. Metodologia (mesma do baseline)

Para cada P0: (1) a evidência original do baseline foi procurada de novo no código da branch (padrão de código); (2) o
comportamento foi reproduzido por teste — de preferência em MySQL 8 real e com dados sintéticos; (3) a guarda
permanente R11 que impede a regressão foi identificada. Não houve consulta à produção.

## 2. P0 — evidência original × estado atual

| SEM | Evidência original (baseline) | Estado no código da branch | Teste que prova | Guarda permanente | Veredito |
|---|---|---|---|---|---|
| SEM-001 | lookups globais em `collaborationRouter` | corrigido na `main` (PR-01/01A) | `collaboration-tenant-isolation-mysql-smoke` | R11.3 | FIXED_IN_MAIN |
| SEM-002/003 | `createProcess` reseta etapa/workspace | corrigido na `main` (PR-05) | `create-not-reset-processes-mysql-smoke` | R11.2 | FIXED_IN_MAIN |
| SEM-004 | `decision ?? "ratificado"`, clicante = autoridade, upsert | 0 ocorrências do default; ledger append-only 0312 com autoridade declarada | `institutional-decision-ledger-mysql-smoke` | R11.1, R11.2, R11.4, R11.6 | CLOSED_LOCAL (competência: J-1) |
| SEM-005 | 2ª colagem sobrescreve cotações | importação governada com identidade explícita + guarda acoplada à flag | `direct-price-import-governed`, `pr04-legacy-price-research-guard` | — | CLOSED_LOCAL (flag: R2.2) |
| SEM-006 | `createDraft` reseta parecer assinado | `decideLegalOpinionDraftCreate` (CONFLICT) | `create-not-reset-legal-contract-mysql-smoke` | R11.2 | CLOSED_LOCAL |
| SEM-007 | upsert por (origem, número) | `insertNewContractWorkspace` + UNIQUE `uq_ctw_org_normalized_number` (0310) | idem + `contract-number-unique-0310-mysql-smoke` | R11.2 | CLOSED_LOCAL |
| SEM-008 | `assertCanonicalQuantitiesComplete` → `if (!canonical) return;` | removido; `CANONICAL_ITEMS_REQUIRED` | `tr-canonical-quantity`, `canonical-quantity-documents` (MySQL) | — | CLOSED_LOCAL (R6.2) |
| SEM-009 | parâmetros do Edital não hidratados | parâmetros persistidos (0311) e hidratados | `pr09-regeneration-human-state-mysql-smoke` | R11.4 | CLOSED_LOCAL |
| SEM-010 | catálogo legado + `includes("75, I")` | **inalterado** (1 ocorrência); auditoria marca `NOT_VALIDATED_LEGAL_POLICY_PENDING` | `unit/r8-legal-review-policy` | `legalReviewPolicy` | **OPEN — BLOCKED_LEGAL_REVIEW** |
| SEM-011 | `originalValue * 0.5` | **inalterado** (1 ocorrência) | — | `legalReviewPolicy` | **OPEN — BLOCKED_LEGAL_REVIEW** |
| SEM-012 | `contract.value.toLocaleString` (centavos como reais), KPI "Valor Total Contratado" | 0 ocorrências nas superfícies do achado; formatador único; KPI "valor estimado" sem rascunho/cancelada | `pr14-money-formatter-mysql-smoke` | guarda estática PR-14 | CLOSED_LOCAL (ver NEW-036) |
| SEM-013 | emissão sem `institutionalIdentitySnapshot` | snapshot + nº do processo/objeto no metadata da versão emitida | `pr15-emission-identity-snapshot-mysql-smoke` | R11.6 | CLOSED_LOCAL (backfill: R7.2) |
| SEM-014 | regerar sobrescreve edição humana | regeneração exige confirmação sobre estado humano | `pr09-regeneration-human-state-mysql-smoke` | R11.4 | CLOSED_LOCAL |
| SEM-015/018 | `updateStage`/`approveDocument` legados | desligados na `main` (PR-02) | `r2-pr02-legacy-endpoints-disabled-mysql-smoke` | — | FIXED_IN_MAIN |
| SEM-016/017 | parecer legado editável/aprovável/reescrito por IA | 6 mutações desligadas (LEG-012); leitura preservada | `legal-opinions-tenant-isolation-mysql-smoke` | — | CLOSED_LOCAL |
| SEM-019 | editor abre vazio com "Favorável"; salvar apaga | hidratação + patch sem brancos + CAS de versão | `pr10-pr11-human-authority-mysql-smoke` H1–H3 | R5.1, R11.4 | CLOSED_LOCAL |
| SEM-020 | `s3://anexo` fictício | 0 ocorrências; upload real com SHA-256 (0314) | `pr16-required-document-evidence-mysql-smoke` | R11.1 | CLOSED_LOCAL |
| SEM-021/022 | justificativa por IA vira oficial; vazio sobrescreve | sugestão ≠ registro; aceite humano obrigatório; autor humano | `pr10-pr11-human-authority-mysql-smoke` J1–J5 | R11.1, R11.4 | CLOSED_LOCAL |
| SEM-023 | "Salvar contrato" altera vigente sem aditivo/CAS | só por instrumento, CAS `expectedUpdatedAt` | `pr12-contract-governed-change-mysql-smoke` | — | CLOSED_LOCAL |
| SEM-024 | termo = sugestões do copiloto | termo a partir do instrumento; IA só como sugestão rotulada | `pr17-instrument-terms-mysql-smoke` | R11.1 | CLOSED_LOCAL |
| SEM-025/026 | status contornando a máquina de estados; viewer aprova CATMAT | `planInstrumentStatusChange`; `decidirCATMAT` operator+; `approveItem` desligado | `pr08-rbac-state-machine(-mysql-smoke)` | — | CLOSED_LOCAL |

**Contagem:** FIXED_IN_MAIN 5 · CLOSED_LOCAL 19 · OPEN (jurídico) 2 = 26.

## 3. Achados novos durante a re-auditoria

- **NEW-035** (P1, candidato) — `client/src/components/institutional-request/ResponsePanel.tsx:48` pré-seleciona
  `responseStatus = "favoravel"` na resposta institucional (mesma classe de SEM-019/SEM-004: decisão por default).
- **NEW-036** (P0, candidato; `legado-API`) — a minuta de contrato legado (`contractsRouter` → `contractDocuments.ts:131`
  `generateContractMinuta`) recebe `contract.value` em **centavos** e o formata como reais (`Intl.NumberFormat` e
  `toLocaleString` sem /100): mesma classe de SEM-012, fora das superfícies listadas no baseline. **Corrigido localmente no `adea553`** (formatador único, unidades explícitas; teste `new036-legacy-contract-money`).
  O destino do módulo legado (corrigir × retirar) segue dependendo de R2.3.

## 4. Por que não é PASS

1. R11.7 exige zero P0 aberto: SEM-010 e SEM-011 dependem de parecer (BLOCKED_LEGAL_REVIEW).
2. Os 19 CLOSED_LOCAL não estão na `main` nem foram validados em produção (BLOCKED_PR_REQUIRED / MERGE / PRODUCTION_VALIDATION).
3. NEW-036 (candidato a P0) está corrigido localmente, mas sem triagem/validação humana nem produção.

## 5. Re-auditoria do 2º passe (2026-10-05, head `22d0ed8`)

Método: (1) o padrão de evidência original foi procurado de novo no código por `grep` (não por memória); (2) o gate final
rodou os testes que provam cada correção em MySQL 8 limpo (`pnpm test` 7019 passaram; cadeia MySQL da CI inclusive
`test:smoke:security` 396/396); (3) as guardas permanentes R11 (`r11-semantic-authority-guards`, 18; `r11-semantic-authority-behavior-guards`,
17) rodaram verdes. Sem consulta à produção. **Resultado: nenhum P0 regrediu; a contagem não mudou.**

| SEM | Padrão procurado no código | Resultado em `22d0ed8` | Veredito |
|---|---|---|---|
| 001 | lookups globais em `collaborationRouter` | escopados por processo/órgão | FIXED_IN_MAIN |
| 002/003 | `createProcess` com reset | insert simples; Create ≠ Reset | FIXED_IN_MAIN |
| 004 | `?? "ratificado"` | 0 ocorrências; ledger append-only | CLOSED_LOCAL (competência: J-1) |
| 005 | colagem sobrescreve | `assertLegacyPriceResearchPasteAllowed` + importação governada | CLOSED_LOCAL |
| 006 | `createDraft` reseta parecer | `claimNewLegalOpinionDraft` (CONFLICT) | CLOSED_LOCAL |
| 007 | upsert por (origem, número) | insert simples + índice 0310 | CLOSED_LOCAL |
| 008 | `if (!canonical) return;` | `CANONICAL_ITEMS_REQUIRED` | CLOSED_LOCAL |
| 009 | parâmetros do Edital | persistidos e hidratados (0311) | CLOSED_LOCAL |
| **010** | `includes("75, I")` | **1 ocorrência, inalterada** (`directContractsRouter`) | **OPEN — BLOCKED_LEGAL_REVIEW** |
| **011** | `originalValue * 0.5` | **1 ocorrência, inalterada** (`contractValidation.ts:32`) | **OPEN — BLOCKED_LEGAL_REVIEW** |
| 012 | `toLocaleString` sobre valor de contrato | 0 nas superfícies; formatador único | CLOSED_LOCAL |
| 013 | emissão sem snapshot | snapshot institucional (PR-15); 2º passe: artefato por formato (SEM-043) | CLOSED_LOCAL |
| 014 | regerar sobrescreve edição humana | `HUMAN_EDIT_WOULD_BE_OVERWRITTEN` | CLOSED_LOCAL |
| 015/018 | `updateStage`/`approveDocument` legados | desligados (LEG-010) | FIXED_IN_MAIN |
| 016/017 | parecer legado mutável | 6 mutações desligadas (LEG-012) | CLOSED_LOCAL |
| 019 | editor abre vazio com "Favorável" | `useHydratedForm` | CLOSED_LOCAL |
| 020 | `s3://anexo` | 0 ocorrências | CLOSED_LOCAL |
| 021/022 | justificativa por IA vira oficial | `confirmAccept`; 2º passe: DFD também (`acceptDFDJustification`, SEM-058) | CLOSED_LOCAL |
| 023 | "Salvar contrato" sem CAS | `expectedUpdatedAt` | CLOSED_LOCAL |
| 024 | termo = sugestões do copiloto | termo a partir do instrumento | CLOSED_LOCAL |
| 025/026 | status fora da máquina; viewer aprova CATMAT | `planInstrumentStatusChange`; `decidirCATMAT` = `orgRoleProcedure("operator")` | CLOSED_LOCAL |
| NEW-036 | centavos formatados como reais na minuta legada | `formatCentsBRL` (`contractDocuments.ts`) | CLOSED_LOCAL (candidato a P0; destino do legado: R2.3) |

**Contagem (inalterada):** FIXED_IN_MAIN 5 · CLOSED_LOCAL 19 · OPEN (jurídico) 2 = 26. **Continua NÃO sendo PASS** pelos mesmos três motivos de §4
(SEM-010/011 pendentes de parecer; correções não mergeadas nem validadas em produção; NEW-036 sem triagem humana).
