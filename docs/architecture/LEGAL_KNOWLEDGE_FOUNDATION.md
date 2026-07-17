# Legal Knowledge Foundation (RC-4.5)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
>
> ⚠️ **Esta RC NÃO contém a Lei 14.133.** Não contém jurisprudência, acórdãos nem doutrina.
> Ela cria apenas a **fundação estrutural permanente** que permitirá inserir **qualquer**
> conhecimento jurídico institucional futuro — sem alterar a arquitetura. Multi-tenant,
> determinística, replay-safe, explicável, auditável.

## O que é

A camada de armazenamento estrutural do conhecimento jurídico, em
`server/domain/legalKnowledge/`. Constrói **sobre** a Ontologia Jurídica (RC-4.4, que define os
*tipos* e a *estrutura* do Direito) o **container** para unidades concretas de conhecimento,
suas referências, versões, conflitos, projeção e consultas.

## Componentes

| Componente | Arquivo | Papel |
|---|---|---|
| **LegalKnowledgeUnit** | `legalKnowledgeUnit.ts` | Unidade jurídica (id, tenantId, type, title, description, hierarchy, jurisdiction, validity, sourceReference, effectiveDate, revokedDate, version, lineageId, metadata, replayHash). **Sem conteúdo — só estrutura.** |
| **KnowledgeReference** | `knowledgeReference.ts` | Relação entre unidades (supports/depends_on/derived_from/revokes/amends/interprets/implements/requires) com **força, direção e explicação**. |
| **KnowledgeVersion / VersionChain / KnowledgeEvolution** | `knowledgeVersion.ts` | Versionamento **append-only** — nunca sobrescreve; `evolveUnit` gera a próxima versão na mesma linhagem. |
| **Conflict Model** | `knowledgeConflict.ts` | ConflictType / Severity / ResolutionStrategy / Explanation. **Representa e detecta** conflitos — não os resolve. |
| **LegalKnowledgeProjection** | `knowledgeProjection.ts` | Projeta qualquer base em nós/arestas com atributos, **peso, importância e tipo semântico** (determinística). |
| **Knowledge Queries** | `knowledgeQueries.ts` | API declarativa (getKnowledge, findKnowledge, findRelatedKnowledge, findDependencies, findHierarchy, findParents, findChildren, findConflicts, findReferences, findByType) — **sem banco**. |
| **Validation** | `knowledgeValidation.ts` | `validateLegalKnowledge()`: ids únicos, hierarquia válida, referências existentes, **sem ciclos**, versionamento consistente, relacionamentos/dependências válidos. |
| **Explainability** | `knowledgeExplainability.ts` | `explainKnowledgeUnit()`: origem, hierarquia, dependências, referências, versões, relacionamentos, conflitos — **nunca só dados**. |
| **Observabilidade** | `server/services/knowledge/knowledgeObservabilityService.ts` | Eventos (knowledgeLoaded, knowledgeValidated, projectionGenerated, conflictsDetected, versionResolved, queryExecuted) recuperáveis por **correlationId**, multi-tenant. |

## Garantias

- **Multi-tenant:** toda unidade carrega `tenantId`; linhagem/id incluem o tenant (isolamento).
- **Replay Safety:** ids/lineage/replayHash via sha256 sobre insumos estruturais (sem `Date.now`
  em ids; `createdAt` fora do hash). Mesma base → mesma validação/projeção/conflitos.
- **Versionamento append-only:** nunca sobrescreve; histórico preservado por linhagem.
- **Explainability & Auditabilidade:** toda unidade se explica; toda operação é observável.
- **Determinismo:** projeção e consultas com ordenação estável.

## Relação com a Ontologia Jurídica (RC-4.4)

- **RC-4.4** define a **estrutura do Direito** (tipos normativos, hierarquia, conceitos).
- **RC-4.5** define o **container** para instâncias de conhecimento sobre essa estrutura.
- `LegalKnowledgeUnit.type` reutiliza `NormTypeId` (RC-4.4). Baixo acoplamento.

## Garantias por teste (`rc45-legal-knowledge-foundation.test.ts`, ORG 12600)

Unidades (campos + determinismo + multi-tenant), referências (8 tipos + explicação),
versionamento append-only, projeção determinística, todas as consultas, conflitos (duplicação/
referencial/revogação/temporal), validação (base válida + detecção de ciclo/ref quebrada/id
duplicado), explainability, observabilidade por correlationId, replay safety. **Zero regressões.**

> A futura Lei 14.133 será apenas **um conjunto de LegalKnowledgeUnits** inserido nesta fundação.

## Organização em Corpus (RC-4.5.1)

As unidades desta fundação **não vivem soltas no sistema**: a RC-4.5.1 cria o **Institutional
Corpus Framework**, que organiza cada `LegalKnowledgeUnit` em **Coleções** de um **Corpus**
(Federal, Estadual, Municipal, Institucional, …). O vínculo (`attachLegalKnowledge`) preserva
versionamento, replay safety, explainability e auditabilidade. Baixo acoplamento: esta fundação
**não importa** o framework de corpus. Ver [INSTITUTIONAL_CORPUS_FRAMEWORK.md](./INSTITUTIONAL_CORPUS_FRAMEWORK.md).

O primeiro pacote instalável que consumirá estas unidades é o **Federal Procurement Corpus**
(RC-4.6) — cuja coleção `Lei 14.133` será, no futuro, **preenchida** por `LegalKnowledgeUnit`.
Ver [FEDERAL_PROCUREMENT_CORPUS_PACKAGE.md](./FEDERAL_PROCUREMENT_CORPUS_PACKAGE.md).

A **Fundação Normativa da Lei nº 14.133** (RC-4.6.1) cria a árvore estrutural (nós sem texto) cujos
`NormativeNode` apontarão para `LegalKnowledgeUnit` via `knowledgeUnitId` (hoje `null`) — o ponto de
ingestão incremental do conteúdo jurídico. Ver
[FEDERAL_PROCUREMENT_CORPUS_FOUNDATION.md](./FEDERAL_PROCUREMENT_CORPUS_FOUNDATION.md).

A ligação entre `NormativeNode` e `LegalKnowledgeUnit` é realizada pelo **Knowledge Binding
Framework** (RC-4.6.2): bindings versionados (append-only), tipados, explicáveis e auditáveis — sem
alterar nenhuma das fundações. Ver [KNOWLEDGE_BINDING_FRAMEWORK.md](./KNOWLEDGE_BINDING_FRAMEWORK.md).
