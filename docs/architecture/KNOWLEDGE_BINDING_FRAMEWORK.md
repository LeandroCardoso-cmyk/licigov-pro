# Knowledge Binding Framework (RC-4.6.2)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
>
> ⚠️ **Esta RC NÃO insere conteúdo jurídico.** Não contém texto da Lei 14.133, artigos, incisos,
> jurisprudência, decretos, pareceres, acórdãos, interpretação jurídica, RAG, IA, Business Domains,
> banco, migrations nem React. Cria apenas a **infraestrutura que liga** `NormativeNode` (RC-4.6.1)
> a `LegalKnowledgeUnit` (RC-4.5). Multi-tenant, determinística, replay-safe, versionada, auditável.

## O que é

A Normative Foundation (RC-4.6.1) criou a árvore estrutural da Lei 14.133 (nós com
`knowledgeUnitId = null`); a Legal Knowledge Foundation (RC-4.5) criou o container de unidades de
conhecimento. Faltava a **camada de ligação**. O **Knowledge Binding Framework**
(`server/domain/legal/binding/`) cria exatamente isso: a infraestrutura que associa uma
KnowledgeUnit a qualquer artigo — **sem alterar a arquitetura**.

```
NormativeNode ← KnowledgeBinding → LegalKnowledgeUnit
                (tipo, versão, autoridade, escopo, status)
```

## Componentes

| Parte | Componente | Arquivo | Papel |
|---|---|---|---|
| 1/2 | **KnowledgeBinding** + **Metadata** | `knowledgeBinding.ts` | Vínculo (bindingId, tenantId, normativeNodeId, knowledgeUnitId, bindingType, authority, scope, version, status, createdAt, updatedAt, lineageId, metadata, replayHash). |
| 3 | **Binding Types** | `knowledgeBinding.ts` | PRIMARY, SECONDARY, SUPPLEMENTAL, INTERPRETATIVE, REFERENCE, REGULATORY. |
| 4 | **Versionamento** | `bindingVersion.ts` | Append-only, imutável: `evolveBinding`/`supersedeBinding`/`revokeBinding` + cadeias de versão. |
| 1 | **Binding Registry** | `knowledgeBindingRegistry.ts` | Registro append-only, multi-tenant. |
| 5 | **Binding Resolver** | `knowledgeBindingResolver.ts` | Bindings ativos (última versão active), versões, por nó, por unidade, múltiplos. |
| 6 | **Graph Projection** | `bindingProjection.ts` | Projeta Binding, Knowledge Unit, Normative Node, Binding Type e Lineage (alinha `nn:`/`lku:`). |
| 7 | **Declarative Queries** | `bindingQueries.ts` | Por artigo, por tipo, unidades de um artigo, artigo de uma unidade, versões, lineage. |
| 8 | **Explainability** | `bindingExplainability.ts` | Por que existe, quem criou, qual artigo/unidade, versão, autoridade, escopo. |
| — | **Validation** | `bindingValidation.ts` | ids únicos, tipos válidos, invariantes de linhagem, versionamento consistente. |
| 9 | **Observabilidade** | `server/services/legal/bindingObservabilityService.ts` | Eventos (bindingCreated/Updated/Versioned/Resolved/Queried) por **correlationId**. |

## Binding Types (Part 3)

`PRIMARY` (representa diretamente o nó), `SECONDARY` (complementa), `SUPPLEMENTAL` (material de
apoio), `INTERPRETATIVE` (interpreta), `REFERENCE` (referencia), `REGULATORY` (regulamenta). Serão
usados para conectar artigos, decretos, pareceres e jurisprudência.

## Versionamento (Part 4)

Todo binding é **append-only, imutável, versionado, replay-safe e auditável**. A linhagem é estável
por `(tenant, normativeNodeId, knowledgeUnitId, bindingType)`; `evolveBinding` gera a próxima versão
(nunca sobrescreve). `resolveActiveBindings` retorna a **última versão** de cada linhagem cujo status
seja `active`.

## Compatibilidade futura (Part 10)

O modelo é genérico: `normativeNodeId` + `knowledgeUnitId` + `authority` + `scope` permitem
vincular conhecimento a Lei 14.133, LC 123, Constituição, Decretos, IN SEGES, TCU, AGU, TCE, normas
municipais e documentos institucionais — **sem qualquer alteração estrutural**.

## Garantias

- **Multi-tenant:** todo binding carrega `tenantId`; linhagem/id incluem o tenant.
- **Replay Safety:** id/lineage/replayHash via sha256 (sem createdAt/updatedAt no hash).
- **Append-only:** nunca sobrescreve; histórico preservado por linhagem.
- **Explainability & Auditabilidade:** todo binding se explica; toda operação é observável.
- **Baixo acoplamento:** camada declarativa; não altera Kernel/IA/Normative Foundation/Knowledge
  Foundation/Business Domains. **Nenhum conteúdo jurídico.**

## Garantias por teste (`rc462-knowledge-binding-framework.test.ts`, ORG 13200)

Binding (campos + determinismo + multi-tenant), 6 tipos, versionamento append-only
(evolve/supersede/revoke + cadeias), registry (append-only + isolamento), resolver (ativos + versões
+ por nó/unidade + múltiplos), queries (artigo/tipo/unidades/artigos/versões/lineage), projeção KG
determinística, explainability, validação (base válida + id duplicado), observabilidade por
correlationId, replay safety. **Zero regressões.**

## Visão de longo prazo

Após esta RC, o sistema recebe milhares de `LegalKnowledgeUnits` **sem alteração estrutural**. Cada
artigo da Lei nº 14.133 pode possuir uma ou mais KnowledgeUnits vinculadas de forma **versionada,
explicável, auditável e replay-safe** — bastando popular a árvore normativa (RC-4.6.1) e o container
de conhecimento (RC-4.5) e registrar os bindings.

## Padrão do conhecimento vinculado (RC-4.7)

A representação de cada unidade de conhecimento segue o **Institutional Knowledge Framework**
(RC-4.7): `KnowledgeDocument` genérico com blocos cognitivos, qualidade, renderer (6 visões),
lifecycle e versionamento. Os bindings desta RC apontam para o conteúdo estruturado por esse
framework. Ver [INSTITUTIONAL_KNOWLEDGE_FRAMEWORK.md](./INSTITUTIONAL_KNOWLEDGE_FRAMEWORK.md).
