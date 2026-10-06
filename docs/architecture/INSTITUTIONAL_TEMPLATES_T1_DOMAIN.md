# Institutional Document Templates — T1: domínio puro

> **Estado:** T1 de domínio puro **reconciliado sobre a `main` real** (`c88c853`) e integrado na `main` (`dffa7ff`, PR #280). G0 oficial: **PASS** (ver `docs/audits/TEMPLATE_G0_OFFICIAL_DELTA_CHECKLIST.md`, seção 5). HD-26 **decidida** (`OPTION_A`; `INSTITUTIONAL_TEMPLATES_HD26_DECISION.md`). A persistência (T2), a composição, o workflow/API e a UX foram integrados em pacote único: ver `INSTITUTIONAL_TEMPLATES_INTEGRATION.md` (flag `FF_INSTITUTIONAL_TEMPLATES_V1` OFF). Este documento descreve só o domínio puro T1.
> **Autoridade:** `T1_DESIGN_PACKAGE.md` (branch `audit/fast-track-template-handoff`, sha256 `ecdedd29…563a8a`) e as 37 invariantes PRE-G0 congeladas (INV-TPL-01..37).

## O que existe

`server/domain/institutionalTemplates/` contém só contratos e regras **puras**: sem I/O, relógio, IA, DB, router ou UI.

| Arquivo | Contrato |
|---|---|
| `types.ts` | `OrgId`, `Sha256`, `HashVersion` (`tpl-hash/1`), tipos documentais, `TemplateResult`/`TemplateIssue` |
| `tenant.ts` | `organizationId` obrigatório; relação entre organizações = `CROSS_TENANT_REFERENCE` (INV-TPL-06/07/36) |
| `semanticHash.ts` | JSON canônico (reusa `canonicalJson`) + NFC + `-0`→`0`; `semanticHash` da revisão |
| `variableCatalog.ts` | catálogo versionado em código; a fonte pertence ao catálogo, nunca ao template |
| `conditionalDsl.ts` | DSL fechada (`eq/ne/in/present/absent/and/or/not`, profundidade ≤ 4); avaliação pura com trilha |
| `ast.ts` | AST canônico (`tpl-ast/1`), whitelist fechada de nós **e** propriedades; `aiSlot` é o único ponto de IA |
| `revision.ts` | identidade, revisão, ciclo canônico `DRAFT → APPROVED → PUBLISHED → DEPRECATED`, imutabilidade, remoção bloqueada se usada |
| `binding.ts` | resolução determinística (escopo exato, `asOf` explícito, ambíguo ⇒ fail-closed) |
| `manifest.ts` | Composition Manifest M1 (geração) e M2 (emissão derivada), pin exato, revalidação canônica, hash |
| `composerContract.ts` | só a assinatura do composer puro (implementação: T7) |

Testes: `server/__tests__/unit/institutional-templates-t1-domain.test.ts` (sem DB).

## Reconciliações T1 × invariantes congeladas (decididas pelo owner)

O T1 é rascunho e as invariantes estão congeladas. Onde o T1 não representava uma invariante, o domínio aplica a invariante e mantém o shape do T1 sempre que possível. A coluna "Decisão" registra a decisão do owner.

| # | T1 | Invariante | Resolução no domínio | Decisão |
|---|---|---|---|---|
| R-1 | `pinnedRevisionId` ausente = "última PUBLISHED" | INV-TPL-03 (nunca "latest") | campo continua opcional no shape; a resolução sem pin falha fechada (`BINDING_REVISION_NOT_PINNED`) | APPROVED |
| R-2 | `composedContentHash` único | INV-TPL-10/35, edição humana governada | `composedOutputHash` (M1) + `documentContentHash` (M2); divergência só com `humanEditRefs` cujo último hash é o emitido | APPROVED |
| R-3 | manifest sem decisões condicionais, identidade do template ou revalidação | INV-TPL-10/35 | `conditionalDecisions`, `templateIdentityId`, `canonicalRevalidation` (`checkedAt` fora dos hashes) | APPROVED |
| R-4 | `officialDocRefs` sem papel/ordem/título | contrato de referência ao anexo (INV-TPL-31) | `role`/`order`/`title` acrescentados; propriedade extra (ex.: `renderMode`) é recusada | APPROVED |
| R-5 | ciclo sem `IN_REVIEW`; `RETIRED` | lifecycle canônico congelado `DRAFT → APPROVED → PUBLISHED → DEPRECATED` | `RETIRED` **substituído** por `DEPRECATED` (tipos, transições, validação, testes); estado fora do lifecycle é recusado; `DEPRECATED ≠ INVALID`; **sem** `IN_REVIEW` nesta fase | REJECTED_AS_IMPLEMENTED → corrigido |
| R-6 | limite só para a profundidade da condição | INV-TPL-28 (abuso recursivo) | `MAX_AST_DEPTH = 32` = **IMPLEMENTATION_SAFETY_LIMIT**, **NOT_LEGAL_RULE**, **NOT_INSTITUTIONAL_DECISION**; pertence ao contrato técnico versionado de `tpl-ast/1` | APPROVED_AS_TECHNICAL_SAFETY_GUARD |

## IN_REVIEW

Não existe nesta fase. Se o G0 oficial revelar evidência autoritativa inequívoca de que uma invariante congelada exige `IN_REVIEW`, a divergência é registrada no G0 e o trabalho para até decisão do owner. A mudança não é antecipada nesta branch.

## G0 oficial

O checklist delta-only fica em `docs/audits/TEMPLATE_G0_OFFICIAL_DELTA_CHECKLIST.md`.

## HD-26 (decidida)

`HD26_STATUS = DECIDED` · `HD26_DECISION = OPTION_A`: FK composta de tenant entre as tabelas **novas** e validação fail-closed na mesma transação para as tabelas **existentes**, sem DDL nelas, sem `CASCADE` e com extensão do tooling de schema. O contrato de domínio deste T1 (`tenant.ts`) é a base da validação de serviço. Ver `docs/architecture/INSTITUTIONAL_TEMPLATES_HD26_DECISION.md`.

## Fora de escopo do domínio puro

- persistência, migrations, FKs, routers, UI, Document Engine, Lifecycle e import DOCX/Markdown (integrados fora deste módulo — ver `INSTITUTIONAL_TEMPLATES_INTEGRATION.md`); catálogo de produção completo (T4/T5);
- publicação externa (PNCP, BLL, Diário, Portal): **fora do bounded context**;
- `/templates` legado: inalterado, sem reuso; NULL nunca significa global.
