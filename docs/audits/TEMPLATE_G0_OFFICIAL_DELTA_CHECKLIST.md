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

---

## 5. Resultado REAL — G0 OFICIAL (delta-only)

> Executado em 2026-10-06 sobre `main` = `c88c8537f751e45a96f02b404511c4e2b7c30307` (PR #278 e PR #279 mergeados; CI pós-merge da Wave B verde; migrations 0310 → 0315; **0316 ausente**; os 9 commits post-G0 **fora** da `main`).
> Seções 1–4 acima permanecem como registrado antes da execução. Esta seção só acrescenta o resultado.
> Legenda: **PASS** = compatível sem mudança; **DELTA_COMPATIBLE** = o arquivo mudou, mas preserva ou fortalece a invariante assumida; **DELTA_CONTRADICTORY** = contradiz invariante congelada (nenhum encontrado).

### 5.1 Pré-condições

| Pré-condição | Resultado |
|---|---|
| `origin/main` = `c88c853` (sem avanço posterior) | confirmado |
| Wave A (`e510e74`, #278) antes da Wave B (`c88c853`, #279) | confirmado (`e510e74` é ancestral; a primeira-pai da `main` é A → B) |
| CI pós-merge da Wave B (run 706, push em `main`) | `success` |
| `_journal.json`: 0310 → 0311 → 0312 → 0313 → 0314 → 0315 | confirmado; última = `0315_official_document_artifacts` |
| Migration 0316 | **ausente** |
| HD-01 integrado (`NO_CANONICAL_ITEMS ⇒ CANONICAL_ITEMS_REQUIRED` em TR/Edital novos) | confirmado (`procurementProcessService.ts`; `hd01-canonical-items-required.test.ts`) |
| 9 commits post-G0 fora da `main` | confirmado (nenhum é ancestral da `main`) |
| Baseline `SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md` | sha256 inalterado: `08edc734…0810b3` |

Diferença total `5827b7f` → `main` (sem `graphify-out`): 45 arquivos, 40 modificados e 5 novos. São a remediação da Wave A (F1, F4/HD-01, F2), o SEM-084 (retry de deadlock, replay do comando de instrumento) e os testes correspondentes. Dos 21 arquivos de contrato do checklist, **2** mudaram.

### 5.2 Itens do checklist

Blobs com 12 caracteres.

| # | Área | Arquivo(s) | BASE_SHADOW_BLOB | MAIN_BLOB | STATUS | DELTA_SUMMARY | INVARIANT_RESULT |
|---|---|---|---|---|---|---|---|
| S1 | Schema | `drizzle/schema.ts` | `91f941482338` | `91f941482338` | PASS | idêntico; nenhuma tabela `institutional_template_*`; `official_documents.template` = `varchar(120)` livre (legado); `organizations.id` = INT | INV-06/07 mantidas |
| S2 | Migrations | `drizzle/meta/_journal.json` | `af5c041742bf` | `af5c041742bf` | PASS | idêntico; última = 0315; Templates começa em **0316+** | INV-19 mantida |
| S3 | FKs / HD-26 | `drizzle/*.sql`, `drizzle/schema.ts` | 0 FKs | 0 FKs | PASS (HD-26 **aberta**) | nenhuma FK em migrations (0 arquivos) nem no schema (0 `foreignKey`/`.references`); `schema-audit` e `db-push-guard` não têm noção de FK | INV-36: resultado exigido; mecanismo pendente |
| E1 | Document Engine | `documentEngineService.ts` | `a2b57438fd1a` | `a2b57438fd1a` | PASS | idêntico; `generateOfficialDocument` segue único ponto de geração; `officialExportEngine` é só exportação (preexistente); sem segundo engine | INV-09/13 mantidas |
| L1 | Lifecycle | `officialDocumentLifecycleService.ts` | `28a7d09b9b7a` | `8172b1ed6322` | **DELTA_COMPATIBLE** | única mudança: a transação PRÓPRIA de `createDocument` passa por `runTransactionWithDeadlockRetry` (SEM084-A: repete a transação inteira, só para ER_LOCK_DEADLOCK/1213/40001, máx. 3 tentativas, esperas fixas de 10/25 ms). O caminho com executor externo não muda. Append-only, linhagem, `gerado/revisado/emitido` e `GET_LOCK` intactos; nenhum UPDATE/DELETE em `official_documents` | fortalece INV-20/29 (sem duplicar versão em concorrência) |
| L2 | Domínio oficial | `officialDocument.ts`, `db/officialDocuments.ts` | `02522bd1b12e`, `8f34b5e54753` | iguais | PASS | idênticos; `tenant_id`; PK(`id`) + índices `(tenant_id)`, `(tenant_id, lineage_id)`, `(tenant_id, business_domain)`; sem `UNIQUE(tenant_id, id)` | INV-11 viável |
| K1 | Lineage | `officialDocument.ts` | `02522bd1b12e` | `02522bd1b12e` | PASS | lineage por instrumento (`instrumentId`) preservada, em espaço de hash separado; `documentId + lineageId + version + contentHash` continua viável | INV-11 mantida |
| A1 | Artefatos 0315 | `0315_…sql`, `db/officialDocumentArtifacts.ts` | `2c037728a576`, `e1d3442a0d94` | iguais | PASS | ledger append-only por formato; `identity_fingerprint`; `UNIQUE(tenant_id, document_id, format, artifact_hash)`; **nenhuma coluna de descritor de render** | INV-31 mantida (render fora do manifest) |
| D1 | Ledger de decisões | `0312_…sql`, `institutionalDecision.ts`, `institutionalDecisionService.ts` | `c730a0ca37d0`, `b654574b689e`, `abcb7350e36f` | iguais | PASS | `subject_type varchar(48)` sem CHECK; `UNIQUE(organization_id, subject_type, subject_id, revision)`. `DECISION_SUBJECT_TYPES` e `DECISION_OUTCOMES` são **catálogos fechados em código** (hoje só `direct_procurement.ratification`/`ratification`): `TEMPLATE_REVISION` entra por **extensão aditiva do catálogo, sem migration e sem redesenhar a autoridade**. Aprovação e publicação = decisões distintas (tipos/assuntos distintos). `authority_validation` segue `NOT_VALIDATED_POLICY_PENDING` | INV-30 mantida; HD-02 viável |
| F1 | Autoridade de fontes | `upstreamAuthority.ts`, `sourceDigests.ts` | `14528ded7558`, `bba47022f826` | iguais | PASS | `source_changed` só **bloqueia a emissão** (`EMISSION_SOURCES_CHANGED`) e marca `[REVISAR]`; nenhum caminho de regeneração/mutação automática | INV-12 mantida |
| F2 | Emissão | `documentPromotionService.ts`, `emissionPreconditions.ts` | `9995e267ffc9`, `880befcd48bf` | `6343a29a9343`, `880befcd48bf` | **DELTA_COMPATIBLE** | única mudança: a transação da promoção é envolvida por `runTransactionWithDeadlockRetry` (fronteira DONA da transação). **Ponto de inserção confirmado:** a revalidação canônica entra junto de `resolveEmissionPreconditions` (leitura fora da transação, comparação pura) e o M2 derivado dentro da transação, ao lado de `createDocument` e `saveIdempotencyResult` | INV-35 viável; INV-13 mantida |
| F3 | Autoria | `structuredAuthoringService.ts`, `authoringSchema.ts` | `296cf09214ec`, `b4a0b82e1a77` | iguais | PASS | seções canônicas e slots governados; a IA só redige texto (`executeCognitiveTask`); números server-authoritative (`aiNumericAuthority`, SEM-080) | INV-04/05/23 mantidas |
| Q1 | Idempotência | `idempotencyService.ts` | `dd28e93636b1` | `dd28e93636b1` | PASS | idêntico: `IDEMPOTENCY_KEY_OPERATION_MISMATCH`, re-reserva atômica, `payloadHash`. O SEM-084-B usa o serviço sem alterá-lo (id do instrumento derivado de órgão + contrato + ator + chave) | INV-27 mantida |
| T1 | Tenant | L2 + S1 | — | — | PASS | `tenant_id` (official_*) × `organization_id` (generated_documents, institutional_decisions); ambos referenciam `organizations.id` INT; PKs `varchar(20/24)` `utf8mb4_unicode_ci`; nenhuma relação cross-tenant introduzida pelos deltas (o retry carrega `organizationId` só para log) | INV-36: ver HD-26 |
| H1 | Hash | `canonicalJson.ts` | `b996f8e9389b` | `b996f8e9389b` | PASS | idêntico; o T1 aplica NFC e `-0`→`0` localmente (`tpl-hash/1`), sem alterar a função compartilhada | INV-19 mantida |
| G1 | `/templates` legado | `documentTemplateService.ts`, `templatesRouter.ts` | `a163a5fb9b3f`, `6a9ab3ef47cf` | iguais | PASS | idênticos; `protectedProcedure` por `userId`; `organizationId` nullable e não lido; `document_templates` com comentário "null = template global" **não** é autoridade; o novo domínio não depende dele | INV-07/22 mantidas |

**DELTA_CONTRADICTORY_COUNT = 0.** Nenhum item contradiz invariante congelada.

### 5.3 Decisões do owner (R-1…R-6) e `IN_REVIEW`

R-1 a R-4 permanecem aprovadas. R-5: o lifecycle é `DRAFT → APPROVED → PUBLISHED → DEPRECATED`, sem `RETIRED`, e `DEPRECATED ≠ INVALID`. R-6: `MAX_AST_DEPTH = 32` é guarda técnica. **Não foi encontrada evidência na `main` de que uma invariante congelada exija `IN_REVIEW`**, então `STOP_FOR_OWNER_DECISION` não foi acionado.

### 5.4 Notas para a T2 (informativas; nada foi implementado)

- A persistência do manifest na promoção deve ficar **dentro** da transação envolvida pelo retry de deadlock: se o InnoDB desfizer a transação, ela é repetida inteira, e o INSERT do manifest deve ser derivado de forma determinística (ou idempotente) por tentativa.
- Estender `DECISION_SUBJECT_TYPES`/`DECISION_OUTCOMES` é mudança de código, não de schema.

### 5.5 HD-26 — `OPEN_PENDING_OWNER_DECISION`

**Fatos reais pós-Wave B**
- 0 FKs em todo o repositório; `schema-audit` e `db-push-guard` não reconhecem FK, então a primeira FK é uma convenção nova.
- Pais existentes sem índice `(id, tenant)`:
  - `official_documents`: PK(`id` varchar(20)) + `(tenant_id)`, `(tenant_id, lineage_id)`, `(tenant_id, business_domain)`;
  - `generated_documents`: PK(`id` varchar(20)) + `(organization_id)`;
  - `institutional_decisions` e `official_document_artifacts`: PK(`id` varchar(24)) + UNIQUE compostos próprios, nenhum no formato `(tenant, id)`.
- Todas as tabelas modernas declaram `ENGINE=InnoDB … utf8mb4_unicode_ci`; `document_templates` (legado, migration 0012) não declara collation e herda o padrão do banco.
- Coluna de tenant: `tenant_id` (official_*) × `organization_id` (demais). O valor é o mesmo `organizations.id` INT.

**Opções (mínimas)**

| Opção | O que faz | Toca tabelas existentes? | Custo / risco |
|---|---|---|---|
| **A (recomendada)** | Nas tabelas **novas**: `UNIQUE(organization_id, id)` nos pais + FK composta filho→pai, com `COLLATE utf8mb4_unicode_ci` explícito. Nas relações com tabelas **existentes** (`official_documents`, `generated_documents`, `institutional_decisions`): validação fail-closed na **mesma transação** (`SELECT … WHERE id=? AND tenant=? FOR SHARE`, tenant sempre do contexto ou do objeto recém-persistido) + teste MySQL adversarial | **Não** | primeira convenção de FK: exige verificar `db:generate`, migrator e `schema-audit` com FK na T2 |
| B | A + `UNIQUE(tenant_id, id)` em `official_documents` (e equivalentes) para FK estrutural também nas relações existentes | **Sim** (DDL aditivo na área da Wave B) | amplia o escopo da T2 e exige decisão explícita |
| C | Nenhuma FK: só validação fail-closed na mesma transação + auditoria SQL de órfãos | Não | nenhuma garantia estrutural no banco entre as próprias tabelas novas |

**Recomendação:** **A.** É a única que mantém o resultado de INV-36 (relação cross-tenant impossível) com garantia estrutural onde o schema já permite, sem alterar índice nem collation de tabelas existentes. B só deve entrar por decisão explícita do owner. Nenhuma FK, migration ou índice foi criado nesta execução.

### 5.6 Resultado

```
OFFICIAL_G0 = PASS
DELTA_CONTRADICTORY_COUNT = 0
OWNER_DECISION_REQUIRED (para liberar a T2 conceitualmente) = FALSE
HD26_STATUS = OPEN_PENDING_OWNER_DECISION   # decisão exigida antes da T2 (persistência), não antes do G0
T2_RELEASED_CONCEPTUALLY = TRUE
```
