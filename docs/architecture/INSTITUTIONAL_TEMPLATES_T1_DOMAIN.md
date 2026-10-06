# Institutional Document Templates — T1: domínio puro

> **Estado:** SHADOW. A branch `work/templates-t1-pure-domain-shadow` parte de `integration/semantic-fast-wave-b` @ `5827b7f` (G0_SHADOW_BASE), que **não** é a `main`. O G0 oficial **não** foi executado.
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
| `revision.ts` | identidade, revisão, ciclo `DRAFT → APPROVED → PUBLISHED → RETIRED`, imutabilidade, remoção bloqueada se usada |
| `binding.ts` | resolução determinística (escopo exato, `asOf` explícito, ambíguo ⇒ fail-closed) |
| `manifest.ts` | Composition Manifest M1 (geração) e M2 (emissão derivada), pin exato, revalidação canônica, hash |
| `composerContract.ts` | só a assinatura do composer puro (implementação: T7) |

Testes: `server/__tests__/unit/institutional-templates-t1-domain.test.ts` (sem DB).

## Reconciliações T1 × invariantes congeladas

O T1 é rascunho e as invariantes estão congeladas. Onde o T1 não representava uma invariante, o domínio aplica a invariante e mantém o shape do T1 sempre que possível.

| # | T1 | Invariante | Resolução no domínio |
|---|---|---|---|
| R-1 | `pinnedRevisionId` ausente = "última PUBLISHED" | INV-TPL-03 (nunca "latest") | campo continua opcional no shape; a resolução sem pin falha fechada (`BINDING_REVISION_NOT_PINNED`) |
| R-2 | `composedContentHash` único | INV-TPL-10/35, edição humana governada | `composedOutputHash` (M1) + `documentContentHash` (M2); divergência só com `humanEditRefs` cujo último hash é o emitido |
| R-3 | manifest sem decisões condicionais, identidade do template ou revalidação | INV-TPL-10/35 | `conditionalDecisions`, `templateIdentityId`, `canonicalRevalidation` (`checkedAt` fora dos hashes) |
| R-4 | `officialDocRefs` sem papel/ordem/título | contrato de referência ao anexo (INV-TPL-31) | `role`/`order`/`title` acrescentados; propriedade extra (ex.: `renderMode`) é recusada |
| R-5 | ciclo sem `IN_REVIEW`; `RETIRED` | ADR §8 (IN_REVIEW, DEPRECATED) | segue o T1; a validação completa (variável desconhecida bloqueia) ocorre na criação do DRAFT e na aprovação; `RETIRED` carrega a semântica DEPRECATED ≠ INVALID |
| R-6 | limite só para a profundidade da condição | INV-TPL-28 (abuso recursivo) | guarda estrutural `MAX_AST_DEPTH = 32` (não é regra de DSL; confirmar no T0) |

## Fora de escopo nesta fase

- persistência, migrations, FKs, routers, UI, Document Engine, Lifecycle, composer, import DOCX/Markdown e catálogo de produção;
- publicação externa (PNCP, BLL, Diário, Portal): **fora do bounded context**;
- `/templates` legado: inalterado, sem reuso; NULL nunca significa global.
