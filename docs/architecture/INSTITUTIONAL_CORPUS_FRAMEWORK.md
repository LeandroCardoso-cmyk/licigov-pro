# Institutional Corpus Framework (RC-4.5.1)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
>
> ⚠️ **Esta RC NÃO adiciona conhecimento jurídico.** Não contém Lei 14.133, decretos, IN SEGES,
> TCU, TCE, doutrina nem jurisprudência. Não conecta RAG, LLM, Providers, Business Domains ou UX.
> Ela cria apenas a **organização institucional permanente** onde todo conhecimento futuro viverá.
> Multi-tenant, determinística, replay-safe, explicável, auditável.

## O que é

A RC-4.5 (Legal Knowledge Foundation) criou o *container* para **unidades** de conhecimento
jurídico (`LegalKnowledgeUnit`). Faltava, porém, o conceito de **coleção de conhecimento**: sem
ele, milhares de unidades ficariam isoladas, sem organização institucional.

O **Institutional Corpus Framework** (`server/domain/corpus/`) cria exatamente essa camada: a
organização permanente onde qualquer conhecimento institucional será agrupado — Corpus Federal,
Estadual, Municipal, Institucional, Organizacional e centenas de outros no futuro.

```
Corpus Registry → InstitutionalCorpus → KnowledgeCollection → (LegalKnowledgeUnit | documentos | conceitos | …)
```

Nenhum conhecimento pertence **diretamente ao sistema** — sempre dentro de uma **Coleção** de um
**Corpus**.

## Componentes

| Componente | Arquivo | Papel |
|---|---|---|
| **InstitutionalCorpus** | `institutionalCorpus.ts` | Unidade organizacional (id, tenantId, name, description, type, scope, jurisdiction, owner, parentId, version, status, language, lineageId, metadata, createdAt, updatedAt, replayHash). **Sem conteúdo jurídico.** |
| **Corpus Types** | `corpusTypes.ts` | Catálogo oficial e **expansível** (Federal, Estadual, Municipal, Institucional, Organizacional, Tribunal, Controladoria, Manual, Normativo, Conhecimento Interno). |
| **KnowledgeCollection** | `knowledgeCollection.ts` | Coleção que pertence a **exatamente um** Corpus; agrupa membros (LegalKnowledgeUnit, documentos, conceitos, normas, referências, fontes) **por referência**. Append-only. |
| **Corpus Hierarchy** | `corpusHierarchy.ts` | Taxonomia de escopo **configurável** (Nação → União → Estado → Município → Instituição → Departamento) **sem assumir país** + árvore de corpora por `parentId`, **acíclica**. |
| **Corpus Registry** | `corpusRegistry.ts` | Registro oficial **declarativo** — cataloga corpora e permite consulta/append-only. |
| **Legal Knowledge Integration** | `corpusIntegration.ts` | `attachLegalKnowledge()` — vincula uma `LegalKnowledgeUnit` a um Corpus (via Coleção) **preservando versionamento, replay, explainability e auditabilidade**. Baixo acoplamento (a RC-4.5 não importa esta camada). |
| **CorpusFramework** | `corpusFramework.ts` | Agregado (corpora + coleções + vínculos) + `structuralSampleFramework()` (placeholders — **sem** conteúdo real). |
| **Corpus Projection** | `corpusProjection.ts` | Projeta Corpus/Collection Nodes + arestas Ownership/Hierarchy/Grouping para o Knowledge Graph (determinística; `legal_unit` alinha com `lku:` da RC-4.5). |
| **Queries** | `corpusQueries.ts` | `findCorpus`, `findCollections`, `findKnowledgeByCorpus`, `findKnowledgeByCollection`, `findCorpusHierarchy`, `findCorpusDependencies`, `findCorpusChildren`, `findCorpusParents`, `findCorpusMetadata` — **sem banco**. |
| **Versionamento & Lifecycle** | `corpusVersion.ts` | `evolveCorpus`/`activateCorpus`/`deprecateCorpus`/`archiveCorpus` — **append-only**, nunca sobrescreve; cadeias de versão por linhagem. |
| **Explainability** | `corpusExplainability.ts` | `explainCorpus()`: origem, responsável, escopo, abrangência, hierarquia, dependências, coleções, versões — **nunca só dados**. |
| **Validation** | `corpusValidation.ts` | `validateCorpusFramework()`: corpora/coleções válidos, hierarquia sem ciclos, vínculos consistentes, isolamento multi-tenant, versionamento consistente. |
| **Observabilidade** | `server/services/knowledge/corpusObservabilityService.ts` | Eventos (corpusCreated, corpusLoaded, corpusActivated, corpusDeprecated, collectionAdded, collectionRemoved, knowledgeAttached, projectionGenerated) recuperáveis por **correlationId**, multi-tenant. |

## Garantias

- **Multi-tenant:** todo corpus/coleção/vínculo carrega `tenantId`; linhagem/id incluem o tenant.
  A integração rejeita vínculos cross-tenant.
- **Replay Safety:** ids/lineage/replayHash via sha256 sobre insumos estruturais (sem `Date.now`
  em ids; `createdAt`/`updatedAt` fora do hash). Mesmo framework → mesma validação/projeção.
- **Versionamento append-only:** corpus nunca é sobrescrito; histórico preservado por linhagem;
  ciclo de vida (draft → active → deprecated → archived) sempre gera nova versão.
- **Explainability & Auditabilidade:** todo corpus se explica; toda operação é observável.
- **Baixo Acoplamento:** a Legal Knowledge Foundation (RC-4.5) **não importa** esta camada.
- **Determinismo:** projeção, consultas e registro com ordenação estável.

## Hierarquia configurável (Part 4)

A taxonomia de escopo padrão (`DEFAULT_SCOPE_TAXONOMY`) é apenas um conjunto de **rótulos
estruturais** — `nacao`, `uniao`, `estado`, `municipio`, `instituicao`, `departamento` — e pode
ser substituída por qualquer taxonomia configurável. **Nenhum país é assumido.** A hierarquia
entre corpora é construída por `parentId` e validada como árvore acíclica.

## Relação com a Legal Knowledge Foundation (RC-4.5)

- **RC-4.5** define a **unidade** de conhecimento (`LegalKnowledgeUnit`).
- **RC-4.5.1** define **onde** essas unidades vivem: Corpus → Coleção.
- `attachLegalKnowledge()` conecta os dois mundos preservando todas as garantias; o vínculo
  registra `unitLineageId`, `unitVersion` e `unitReplayHash` da unidade no momento da associação.

## Garantias por teste (`rc451-institutional-corpus-framework.test.ts`, ORG 12700)

Corpus (campos + determinismo + multi-tenant), 10 tipos oficiais, coleções (append-only +
idempotência), hierarquia configurável (sem ciclos + detecção de ciclo), registro declarativo,
integração (preserva versionamento/replay + rejeita cross-tenant), projeção determinística
(nós/arestas + alinhamento `lku:`), todas as consultas, versionamento & lifecycle
(activate/deprecate append-only), explainability, validação (base válida + pai inexistente +
ciclo + coleção órfã), observabilidade por correlationId, replay safety. **Zero regressões.**

## Visão de longo prazo

Após esta RC, torna-se possível representar — **sem alterar a arquitetura** — Corpus Federal
(Lei 14.133 → Decretos → IN SEGES → TCU → AGU), Corpus Estadual (TCE → Resoluções →
Orientações), Corpus Municipal (Decretos → Portarias → Normas locais) e Corpus Institucional
(Manuais → Fluxos → Pareceres → Boas práticas → FAQ). Cada Corpus é **totalmente independente**;
toda expansão futura ocorre apenas **adicionando novos Corpora**, nunca modificando a arquitetura.

> A futura Lei 14.133 será apenas um conjunto de `LegalKnowledgeUnit` (RC-4.5), organizado em
> **Coleções** de um **Corpus Federal** (RC-4.5.1).

## Primeiro pacote instalável (RC-4.6)

Sobre este framework, a RC-4.6 cria o **primeiro pacote oficial** do sistema — o **Federal
Procurement Corpus** (`server/domain/corpus/package/`): um `CorpusPackage` instalável com
`CorpusManifest`, 5 coleções federais **vazias** (Lei 14.133, Decretos, IN SEGES, AGU, TCU),
integridade/checksums, lifecycle, registro, validação e projeção KG — **sem conteúdo jurídico**.
Ver [FEDERAL_PROCUREMENT_CORPUS_PACKAGE.md](./FEDERAL_PROCUREMENT_CORPUS_PACKAGE.md).

A **Fundação Normativa** (RC-4.6.1) cria a estrutura permanente da Lei nº 14.133 (hierarquia oficial
+ árvore de nós estruturais, sem texto), reutilizável por qualquer norma federal. Ver
[FEDERAL_PROCUREMENT_CORPUS_FOUNDATION.md](./FEDERAL_PROCUREMENT_CORPUS_FOUNDATION.md).
