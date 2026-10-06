# G0 SHADOW — Institutional Document Templates × árvore sintética (main + Wave A + Wave B)

**G0_SHADOW_BASE** = `integration/semantic-fast-wave-b` @ `5827b7f4fa6b351d3232eae485a4e190cef5f62c`
(main `ee70c81` + Wave A `dda9fea` + Wave B). Árvore sintética: **não** mergeada, **não** é a main. Somente leitura.
**STATUS = PASS** — nenhuma contradição com as 37 invariantes PRE-G0 (itens de "o que muda" abaixo são deltas de ADR, não contradições).

## 1. Premissas de schema (verificadas no schema real, MySQL 8, 338 tabelas, 0 FKs)
| Fato | Evidência |
|---|---|
| Nenhuma FK em todo o schema | dump `information_schema` da árvore B: 0 `FOREIGN KEY` |
| Tenant: `organization_id INT` (generated_documents, institutional_decisions, document_templates legado) vs `tenant_id INT` (official_documents, official_document_artifacts, official_document_timeline) | ambos referenciam `organizations.id INT AUTO_INCREMENT` |
| Collation: tabelas modernas `utf8mb4_unicode_ci` (ids varchar(20/24)); legado Drizzle antigo `utf8mb4_0900_ai_ci` | `official_documents.id varchar(20) unicode_ci`; `document_templates.name 0900_ai_ci` |
| `official_documents`: versões append-only por `lineage_id`, `status gerado|revisado|emitido`, `replay_hash`, `metadata text`, `template varchar(120)` **texto livre** | `drizzle/schema.ts`, `server/domain/officialDocument.ts` |
| `official_document_artifacts` (0315): ledger append-only por formato, `source_content_hash`, `source_replay_hash`, `identity_fingerprint`, UNIQUE(tenant,doc,format,hash) | migration 0315 |
| `institutional_decisions` (0312): append-only, UNIQUE(org,subject,revision), idempotência (org,key), `authority_validation` | migration 0312 |
| `generated_documents.sources` (text) carrega marcadores `srcd:` (digests de fonte) — ponto de pin de fontes já existente | `server/domain/sourceDigests.ts` |
| `generated_documents.content` longtext + `status` + `author_user_id`/`last_substantive_*` (marcador de edição humana, SEM-044) | schema |

## 2. Mapa de reuso (sem segundo Document Engine)
| Componente | Decisão | Nota |
|---|---|---|
| Geração/autoria (`structuredAuthoringService`, `authoringSchema`, `AUTHORING_CONTRACT_VERSION`) | **EXTEND** | seções canônicas viram o "contrato de slots"; o composer puro entra ANTES do slot narrativo de IA |
| `AIExecutionEngine` (`server/services/aiExecutionEngine.ts`) + `_core/llm.ts` | **REUSE** | único caminho de IA, só em slots narrativos explícitos; nunca seleciona template/condicional |
| `officialDocumentLifecycleService` / `officialDocument.ts` (versões, lineage, replay_hash, status) | **REUSE** | emissão e imutabilidade continuam sendo a autoridade; template não emite |
| `official_document_artifacts` (ledger DOCX/PDF) | **REUSE** | export nunca recompõe; apenas renderiza conteúdo persistido + manifest |
| `institutional_decisions` | **REUSE** | aprovação/publicação de revisão de template = decisão institucional (subject_type novo, sem coluna nova) |
| Source digests (`sourceDigests.ts`, `srcd:`) + `upstreamAuthority` | **REUSE/EXTEND** | pin exato das fontes no manifest; `SOURCE_CHANGED` nunca auto-muta |
| Edição humana governada (C.4B.3B, SEM-044) | **REUSE** | autoridade da edição humana sobre o conteúdo composto |
| Identity snapshots (`institutionalIdentityService`) | **REUSE** | congelam a identidade institucional no manifest/emissão |
| Pipeline de export (`officialExportEngine`, `documentExportService`, `officialDocumentExportAdapter`) | **ADAPT** | consumir AST persistido → render; sem recomposição |
| `documentVersionService` / `document_versions` (int ids, legado `documents`) | **DO_NOT_USE** como base de revisões de template (ids int, domínio legado); usar tabela própria append-only |
| `documentTimelineService` / observabilidade / auditoria | **REUSE** | eventos de ciclo de vida do template |
| `documentTemplateService` / `templatesRouter` / `document_templates` (legado) | **DO_NOT_USE** | ver §5 |
| Segundo Document Engine / renderer paralelo | **DO_NOT_USE** | proibido |

## 3. Mapa de colisões
- **Nomes**: `document_templates`/`documentTemplates` e `templates.*` (tRPC) já existem → o novo domínio usa prefixo `institutional_template_*` e router `institutionalTemplates` (sem reuso do nome). Sem outra colisão encontrada (`template_*` só em `official_documents.template` coluna livre).
- **`official_documents.template`** (varchar 120, livre): permanece legado; o vínculo exato vai para o **manifest** (revision id + hash), não para essa coluna.
- **Migrations**: cadeia termina em 0315 → Templates começa em **0316+**, estritamente após a cadeia fast-track. Nenhum número reservado conflita.
- **Smoke list/CI**: novas tabelas exigem smokes registrados em `test:smoke:security` e CI (meta-guard R11-B1 falha para órfãos).
- **Pontos de ancoragem do manifest**: `generated_documents` (draft) e `official_documents.metadata/replay_hash` (emitido) — o manifest é tabela própria insert-only referenciada por id/hash; não reescreve `content`.

## 4. Verificação das invariantes (37) contra a árvore
Sem contradição. Pontos de atenção (deltas, não violações):
1. Não existe FK no schema: "organization_id obrigatório" será garantido por NOT NULL + chave composta (ver §6).
2. `official_documents` usa `tenant_id`; novas tabelas devem usar `organization_id` (invariante V1) e o adaptador converte — registrar no ADR.
3. Replay: `replay_hash` atual cobre conteúdo + inputs do documento; o manifest deve entrar no cálculo **versionado** (`replay_hash` v2) — semântica de hash versionada já é invariante.
4. `official_document_artifacts.identity_fingerprint` já separa identidade institucional; o manifest deve guardar o mesmo fingerprint.
5. Nenhuma chamada remota dentro de transação: o composer é puro; IA roda antes da transação (padrão já presente em `generateStructuredAuthoring`).

## 5. Legado `/templates` (revalidado)
User-scoped (`userId`), mutável (`updateTemplate`), **delete físico** (`deleteTemplate`), `organizationId` nullable e **sem uso** (“null = global”), enum de tipos próprio, **não conectado** a DFD/ETP/TR/Edital (único chamador: UI `Templates.tsx`; `documentTemplateService` só é importado por 1 teste). Estratégia somente de **contenção/cutover** (nada implementado): (i) congelar escrita nova atrás de flag; (ii) rotular na UI como "Modelos pessoais (legado)"; (iii) nunca promover automaticamente — importação explícita → AST candidato → DRAFT; (iv) leitura mantida até migração assistida; (v) remoção só após decisão humana.

## 6. HD-26 — `CROSS_TENANT_RELATIONSHIP_MUST_BE_IMPOSSIBLE`
Reavaliado com o schema real (0 FKs; ids varchar(20/24) `unicode_ci`; tenant INT; tenant_id vs organization_id).
**Mecanismo estrutural recomendado** (apenas nas tabelas novas): `UNIQUE (organization_id, id)` em cada tabela-pai e **FK composta** `(organization_id, parent_id) → parent(organization_id, id)` para revision→identity, binding→revision/identity, manifest→revision, manifest_refs→manifest; colunas de id com `COLLATE utf8mb4_unicode_ci` explícito (FKs MySQL exigem collation idêntica); primeira introdução de FK no produto ⇒ ADR + teste de migração (replay/upgrade) + verificação de `db:generate`/migrator.
**Fallback de validação** (para referências a tabelas existentes sem índice `(tenant_id,id)`: `official_documents`, `generated_documents`, `institutional_decisions`): validação na MESMA transação com `SELECT … WHERE id=? AND tenant/org=? FOR SHARE`, `organization_id` denormalizado no manifest, repositório que nunca aceita id sem org, **auditoria SQL** de "órfãos cruzados" no `schema-audit`/smoke, e smoke de isolamento multi-tenant obrigatório. Alternativa estrutural futura: `UNIQUE(tenant_id,id)` em `official_documents` (aditivo, não destrutivo) — decisão humana/ADR.

## 7. Requisitos de migration para Templates (não implementados)
Tabelas candidatas (0316+): identity, revision (append-only; published imutável), binding, variable catalog (versionado), composition manifest + refs (insert-only), eventos de ciclo de vida. Todas com `organization_id NOT NULL`, chaves compostas, hashes semânticos versionados, sem DELETE de revisão usada, sem PLATFORM_GLOBAL, sem colunas de PNCP/publicação (OUT_OF_SCOPE: LICIGOV_PUBLICATION_ORCHESTRATION, PNCP_PUBLICATION, BLL_CERTAME_CREATION, DIARIO_PUBLICATION, PORTAL_PUBLICATION — cláusulas de publicidade do Edital permanecem conteúdo documental).

## 8. Modelo-Mestre 1.0.1-draft
FROZEN_FOR_LEGAL_REVIEW — **não importado**, conteúdo jurídico **inalterado**. Usado só como caso de teste dos contratos: placeholders, condicionais, referência ao TR, Anexo I, edição humana e revalidação canônica são todos expressáveis pelo contrato T1 (ver T1_DESIGN_PACKAGE).

## 9. Deltas de ADR
(1) `replay_hash` v2 incluindo manifest; (2) primeira FK composta do produto (HD-26); (3) `institutional_decisions.subject_type` += TEMPLATE_REVISION; (4) naming `institutional_template_*`; (5) adaptador `organization_id`↔`tenant_id`; (6) flag de contenção do `/templates` legado; (7) política de collation `utf8mb4_unicode_ci` para ids novos.

## 10. Decisões humanas remanescentes
HD-26 (mecanismo estrutural vs fallback e `UNIQUE(tenant_id,id)` em `official_documents`), HD-15 (UNIQUE de número de contrato — pendente), destino do `/templates` legado, revisão jurídica do Modelo-Mestre, política de revisão/autoridade de aprovação (`authority_validation` hoje `NOT_VALIDATED_POLICY_PENDING`), LEG-007 (adiado).

## 11. G0 oficial
Deve ser **mecânico** após o merge das waves: re-executar este mapa contra a main real (diff esperado = nenhum), com a base apontando ao novo `main`. Condição: Wave A e Wave B mergeadas na ordem A→B sem rebase semântico.
