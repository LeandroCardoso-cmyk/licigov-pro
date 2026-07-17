# Federal Procurement Corpus · Normative Foundation (RC-4.6.1)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
>
> ⚠️ **Esta RC NÃO insere o texto da Lei nº 14.133.** Não contém Knowledge Units, Reasoning, RAG,
> IA, React, banco, migrations, Business Domains nem Copilot. Cria apenas a **estrutura normativa
> permanente** que permitirá a ingestão incremental da Lei 14.133 e de qualquer Corpus Jurídico
> Federal futuro. Multi-tenant, determinística, replay-safe, explicável, auditável.

## O que é

Com toda a infraestrutura cognitiva pronta (Legal Knowledge Foundation, Institutional Corpus
Framework, Federal Procurement Corpus Package, Experience e Bootstrap Frameworks), esta RC inicia
oficialmente o **Corpus Federal da Lei nº 14.133/2021** — criando sua **Fundação Normativa**:
a árvore estrutural (apenas nós, sem texto) e todo o modelo reutilizável para qualquer norma.

Vive em `server/domain/legal/normative/`.

```
NormativeHierarchy (Lei → … → Item) → NormativeNode (árvore) → References → Projection → Queries
```

## Componentes

| Parte | Componente | Arquivo | Papel |
|---|---|---|---|
| 2 | **Normative Hierarchy** | `normativeHierarchy.ts` | 11 níveis oficiais: Lei, Livro, Título, Capítulo, Seção, Subseção, Artigo, Parágrafo, Inciso, Alínea, Item. Monotônica; níveis intermediários opcionais (`canContain`). |
| 1 | **Normative Model** | `normativeNode.ts` | `NormativeNode` (id, tenantId, normId, type, identifier, displayName, parent, children, order, authority, scope, knowledgeUnitId, version, lineageId, metadata, replayHash) + `NormativeMetadata`. **Reutilizável para qualquer ato normativo.** |
| 5 | **Cross References** | `normativeReference.ts` | `NormativeReference` + `NormativeRelationship`: referência interna, remissão, dependência, correlação, regulamentadora — com explicação. |
| 3 | **Federal Procurement Tree** | `normativeTree.ts` | Árvore estrutural REPRESENTATIVA da Lei nº 14.133 (`buildFederalProcurementTree`) — só nós estruturais, `knowledgeUnitId = null`. Agregado `NormativeTree`. |
| 4 | **Knowledge Binding** | (`NormativeNode.knowledgeUnitId`) | Ligação `NormativeNode → LegalKnowledgeUnit` preparada; **null nesta RC** (usada nas próximas). |
| 6 | **Graph Projection** | `normativeProjection.ts` | Projeta Hierarchy, Normative Nodes, Relationships, References e Lineage para o Knowledge Graph. |
| 7 | **Declarative Queries** | `normativeQueries.ts` | `findNode`, `findByIdentifier`, `findByType`, `parentOf`, `childrenOf`, `ancestorsOf`, `descendantsOf`, `referencesOf`, `referencesByType`. |
| 8 | **Explainability** | `normativeExplainability.ts` | `explainNode()`: origem, posição, ancestrais, descendentes, referências, dependências, lineage. |
| — | **Validation** | `normativeValidation.ts` | ids únicos, hierarquia monotônica, reciprocidade pai/filho, sem ciclos, referências resolvidas. |
| 9 | **Observabilidade** | `server/services/legal/normativeObservabilityService.ts` | Eventos (hierarchyCreated, nodeRegistered, referenceRegistered, graphProjected, queryExecuted) por **correlationId**. |

## Hierarquia oficial (Part 2)

`Lei(0) → Livro(1) → Título(2) → Capítulo(3) → Seção(4) → Subseção(5) → Artigo(6) → Parágrafo(7)
→ Inciso(8) → Alínea(9) → Item(10)`. A profundidade é monotônica: um nó só pode ter como pai um
nível **estritamente superior** — permitindo saltar níveis opcionais (ex.: Artigo diretamente sob
Capítulo, como ocorre na Lei 14.133, que não usa Livro).

## Knowledge Binding (Part 4)

Cada `NormativeNode` carrega `knowledgeUnitId` — a ligação futura com `LegalKnowledgeUnit`
(RC-4.5). **Nesta RC é sempre `null`** (validado por teste): a estrutura existe, o conteúdo será
preenchido incrementalmente nas próximas RCs, preservando replay safety, versionamento e lineage.

A infraestrutura que realiza essa ligação é o **Knowledge Binding Framework** (RC-4.6.2): um
`KnowledgeBinding` versionado (append-only) conecta cada `NormativeNode` a uma ou mais
`LegalKnowledgeUnit`, com tipo, autoridade, escopo e explainability — **sem alterar a árvore
normativa**. Ver [KNOWLEDGE_BINDING_FRAMEWORK.md](./KNOWLEDGE_BINDING_FRAMEWORK.md).

## Compatibilidade futura (Part 10)

O modelo é genérico: `normId` + `authority` + `scope` permitem instanciar, **sem alterar a
arquitetura**, Decretos Federais, IN SEGES, Acórdãos TCU, Pareceres AGU, Leis Complementares,
Constituição, Normas Municipais e documentos institucionais. Referências podem apontar para nós de
**outra norma** (cross-corpus).

## Garantias

- **Multi-tenant:** todo nó carrega `tenantId`; linhagem/id incluem tenant+norma (isolamento).
- **Replay Safety:** id/lineage/replayHash via sha256 sobre insumos estruturais (sem tempo).
- **Determinismo:** árvore, projeção e consultas com ordenação estável.
- **Explainability & Auditabilidade:** todo nó se explica; toda operação é observável.
- **Baixo acoplamento:** camada declarativa; não altera Kernel/IA/Corpus Framework/Business Domains.

## Garantias por teste (`rc461-normative-foundation.test.ts`, ORG 13100)

Hierarquia (11 níveis monotônicos + contenção + caminho), NormativeNode (campos + determinismo +
multi-tenant + knowledgeUnitId null), Cross References (5 tipos + direção + explicação), árvore da
Lei 14.133 (nós estruturais sem conteúdo, cobrindo todos os níveis + determinismo), validação (base
válida + hierarquia invertida), projeção KG determinística, todas as consultas, explainability,
observabilidade por correlationId, replay safety. **Zero regressões.**

## Visão de longo prazo

Após esta RC, a Lei nº 14.133 possui uma **estrutura normativa completa**, pronta para receber
conhecimento jurídico incrementalmente. As próximas RCs preencherão os nós com `LegalKnowledgeUnit`
(populando `knowledgeUnitId`), mantendo replay safety, versionamento, explainability e
rastreabilidade — e os demais Corpora (Decretos, IN SEGES, AGU, TCU, TCEs, legislação municipal)
seguirão exatamente este mesmo modelo.
