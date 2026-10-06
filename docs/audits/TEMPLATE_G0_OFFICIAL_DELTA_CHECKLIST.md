# TEMPLATE G0 — OFFICIAL DELTA CHECKLIST

> **Não executado.** Este documento lista o que o G0 oficial deve **comparar** quando a Wave A e a Wave B estiverem na `main`. O G0 oficial é **delta-only**: não refaz a auditoria; só confirma que a `main` real é igual à base shadow nos pontos que o T1 assume.
>
> **Referências:**
> - base shadow: `integration/semantic-fast-wave-b` @ `5827b7f4fa6b351d3232eae485a4e190cef5f62c` (G0_SHADOW = PASS);
> - T1 shadow: `work/templates-t1-pure-domain-shadow` (HEAD da branch; versão anterior à correção R-5: `a52eac03ebea77cd1b255c5b83605cac69d37d38`), estado `T1_PURE_DOMAIN_SHADOW_CANDIDATE = IMPLEMENTED_PENDING_G0_RECONCILIATION`;
> - handoff: `audit/fast-track-template-handoff` (6 sha256 conferidos);
> - este arquivo é a cópia versionada na branch shadow, para revisão sem depender do ambiente de execução.

## 0. Pré-condição

- [ ] A Wave A e a Wave B foram mergeadas na `main` na ordem A → B, **sem rebase semântico**.
- [ ] A cadeia de migrations na `main` é 0310 → 0315, nessa ordem. O migrator do drizzle aplica por `created_at`, então uma migration fora de ordem é pulada em silêncio.
- [ ] HD-01 decidida, com o PR-13 integrado. Sem isso, os commits de authoring e fontes não existem na forma assumida.

## 1. Método

Para cada linha, compare o **blob SHA** do arquivo na `main` com o da base shadow:
- **igual:** PASS mecânico;
- **diferente:** revisar **somente** o diff contra a coluna "Contrato assumido pelo T1".

Use, por exemplo, `git diff 5827b7f <main> -- <arquivo>`.

## 2. Itens a comparar

| # | Área | Arquivo(s) | Blob na base shadow | Contrato assumido pelo T1 | Saída |
|---|---|---|---|---|---|
| S1 | Schema | `drizzle/schema.ts` | `91f941482338` | nenhuma tabela `institutional_template_*` ainda; tenant `organization_id INT` nas tabelas modernas; `official_documents.template` = texto livre (legado) | PASS / DELTA |
| S2 | Cadeia de migrations | `drizzle/meta/_journal.json` | `af5c041742bf` | última = `0315_official_document_artifacts`; Templates começa em **0316+** | PASS / DELTA |
| S3 | FKs | `drizzle/*.sql` | 0 arquivos com `FOREIGN KEY` | nenhuma FK ainda; HD-26 continua **aberta** (mecanismo de INV-TPL-36 decidido no G0/T0) | PASS / DELTA |
| E1 | Document Engine | `server/services/documentEngineService.ts` | `a2b57438fd1a` | ponto único de geração oficial; não há segundo engine; o composer entrará antes do slot de IA | PASS / DELTA |
| L1 | Lifecycle | `server/services/officialDocumentLifecycleService.ts` | `28a7d09b9b7a` | versões append-only por `lineage_id`; `gerado`/`revisado`/`emitido`; `replay_hash` v1 (o v2 com `manifestHash` é delta de ADR) | PASS / DELTA |
| L2 | Domínio oficial | `server/domain/officialDocument.ts`, `server/db/officialDocuments.ts` | `02522bd1b12e`, `8f34b5e54753` | `tenant_id` (≠ `organization_id`): adaptador necessário; sem índice `(tenant_id, id)` | PASS / DELTA |
| A1 | Artefatos 0315 | `drizzle/0315_official_document_artifacts.sql`, `server/db/officialDocumentArtifacts.ts` | `2c037728a576`, `e1d3442a0d94` | ledger append-only por formato; `identity_fingerprint` (= `CompositionManifest.identityFingerprint`); **nenhum** descritor de render (o render mode fica fora do manifest, INV-TPL-31) | PASS / DELTA |
| D1 | Decisões institucionais 0312 | `drizzle/0312_institutional_decision_ledger.sql`, `server/domain/institutionalDecision.ts`, `server/services/institutionalDecisionService.ts` | `c730a0ca37d0`, `b654574b689e`, `abcb7350e36f` | `subject_type varchar(48)` + `UNIQUE(org, subject_type, subject_id, revision)`: aprovação e publicação de revisão = decisões distintas (`approvalDecisionId` ≠ `publishDecisionId`); `subject_type += TEMPLATE_REVISION` sem coluna nova | PASS / DELTA |
| F1 | Autoridade de fontes | `server/services/authoring/upstreamAuthority.ts`, `server/domain/sourceDigests.ts` | `14528ded7558`, `bba47022f826` | marcador `srcd:` (`SOURCE_DIGEST_PREFIX`) = pin de fonte do manifest; `SOURCE_CHANGED` nunca auto-muta | PASS / DELTA |
| F2 | Emissão | `server/services/documentPromotionService.ts`, `server/domain/emissionPreconditions.ts` | `9995e267ffc9`, `880befcd48bf` | ponto de inserção da revalidação canônica (INV-TPL-35) e do M2 derivado | PASS / DELTA |
| F3 | Authoring | `server/services/authoring/structuredAuthoringService.ts`, `server/domain/authoring/authoringSchema.ts` | `296cf09214ec`, `b4a0b82e1a77` | seções canônicas = contrato de slots; IA só no slot narrativo; autoridade numérica no servidor | PASS / DELTA |
| Q1 | Idempotência | `server/services/idempotencyService.ts` | `dd28e93636b1` | chave ligada à operação; re-reserva atômica | PASS / DELTA |
| K1 | Lineage | `server/domain/officialDocument.ts` (lineage por instrumento) | ver L2 | `OfficialDocumentReference` = `documentId + lineageId + version + contentHash` | PASS / DELTA |
| T1 | Tenant contracts | L2 + S1 | — | novas tabelas com `organization_id NOT NULL`; relações com `official_documents` via validação fail-closed na mesma tx enquanto não houver `UNIQUE(tenant_id, id)` | PASS / DELTA |
| H1 | Hash | `server/domain/canonicalJson.ts` | `b996f8e9389b` | `canonicalJson`: chaves ordenadas, `undefined` omitido, números finitos. O `tpl-hash/1` do T1 acrescenta NFC e `-0`→`0` **no próprio módulo**, sem alterar a função compartilhada. `computeReplayHash` legado inalterado. | PASS / DELTA |
| G1 | Legado `/templates` | `server/services/documentTemplateService.ts`, `server/routers/templatesRouter.ts` | `a163a5fb9b3f`, `6a9ab3ef47cf` | inalterado; user-scoped; NULL nunca significa global; sem reuso pelo novo domínio; só contenção | PASS / DELTA |

## 3. Conferência do T1 depois do merge

- [ ] Rebasear (ou recriar) `work/templates-t1-pure-domain-shadow` sobre a nova `main` **sem conflito**. O T1 só adiciona arquivos novos e o `graphify-out`; regenerar o grafo uma única vez.
- [ ] `pnpm check`, lint dos arquivos alterados e `institutional-templates-t1-domain.test.ts` (63 testes) verdes na `main` real.
- [ ] Decisões do owner sobre R-1…R-6 (em `docs/architecture/INSTITUTIONAL_TEMPLATES_T1_DOMAIN.md`) preservadas:
  - **R-1 a R-4: APPROVED.** Binding sem pin falha fechada (`BINDING_REVISION_NOT_PINNED`); `composedOutputHash` × `documentContentHash` × `humanEditRefs` × `canonicalRevalidation`; manifest completo; referência oficial sem render mode.
  - **R-5: REJECTED_AS_IMPLEMENTED, corrigido.** O lifecycle é `DRAFT → APPROVED → PUBLISHED → DEPRECATED`, com `DEPRECATED ≠ INVALID` e sem `RETIRED`.
  - **R-6: APPROVED_AS_TECHNICAL_SAFETY_GUARD.** `MAX_AST_DEPTH = 32` é limite técnico de `tpl-ast/1`, não regra jurídica nem institucional.
- [ ] **IN_REVIEW:** só se o G0 revelar evidência autoritativa inequívoca de que uma invariante congelada o exige. Nesse caso, registrar a divergência e **parar para decisão do owner**; não antecipar.

## 4. Saída do G0 oficial

- Todas as linhas PASS ⇒ `OFFICIAL_G0 = PASS` e liberação da T2 (persistência, 0316+), sujeita à HD-26.
- Qualquer DELTA em contrato assumido ⇒ ajustar só o ponto afetado. Se o delta contradisser invariante congelada ⇒ **STOP para o owner**.
