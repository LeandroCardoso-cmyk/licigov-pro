# Ontology Integration Layer (RC-4.4.1)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
> A RC-4.4.1 constrói **exclusivamente a camada semântica** que conecta a **Ontologia
> Operacional** (RC-4.3) à **Ontologia Jurídica** (RC-4.4), mantendo **ambas independentes**.
> **Não** insere conhecimento jurídico, Lei 14.133, acórdãos ou jurisprudência. **Não** altera
> Business Domains/IA/UX. Declarativa, determinística, explicável, **baixo acoplamento**.

## Objetivo

Responder — sem leis, sem artigos, sem conteúdo jurídico:

> Qual **objeto operacional** está relacionado a quais **conceitos jurídicos**?

## Componentes (`server/domain/integration/`)

| Componente | Arquivo | Conteúdo |
|---|---|---|
| **Semantic Link Types** (14) | `semanticLinkTypes.ts` | representa, depende, materializa, exige, fundamenta, relaciona-se, origina, controla, fiscaliza, executa, valida, substitui, complementa, encapsula. Cada tipo declara **direção, cardinalidade, navegabilidade e peso**. |
| **Ontology Links** | `ontologyLinks.ts` | Ligações declaradas entre operacional (papel/objeto/estado/evento) e jurídico (conceito/estrutura/classificação). Cada link é **explicável** (origem, destino, tipo, **motivo**, categoria) — nunca implícito. |
| **Integration Layer** | `integrationLayer.ts` | Mapa semântico, cross references, consultas, projeção KG, validação, modelo unificado. |

## Baixo acoplamento

A camada de integração **importa** das duas ontologias, mas **elas não importam a integração**
(verificado por teste). As ontologias permanecem **totalmente independentes** — a integração é
opcional e desacoplável.

## Ligações (Part 2) — grupos

Papéis → Conceitos · Objetos → Conceitos · Estados → Hipóteses/Condições · Eventos →
Procedimentos · Dependências → Obrigações · Relacionamentos → Competências (+ Objetos →
Estrutura/Classificação).

## Mapa semântico (Part 3)

Caminhos declarativos cruzando os dois mundos, por exemplo:

```
TR → Requisito → Critério → Competência → Fundamentação
Contrato → Obrigação → Execução → Aditivo → Rescisão
DFD → Hipótese → Processo → Competência
```

## Cross references (Part 4)

- `operatingCrossRef(objectId)` → conceitos, estruturas, classificações do objeto.
- `legalCrossRef(conceptId)` → objetos, papéis, eventos, estados do conceito.

## Consultas semânticas (Part 5) — sem IA/Provider/RAG

`conceptsForObject`, `objectsForConcept`, `rolesForConcept`, `eventsForConcept`,
`statesForConcept`, `linksFor(ref)`, `linksByType(type)`. Exemplos:
"Quais conceitos pertencem ao TR?", "Quais objetos usam Competência?",
"Quais eventos executam Procedimento?", "Quais papéis atuam sob Competência?".

## Knowledge Graph (Part 6 — preparação)

`toIntegrationNodes()` / `toIntegrationEdges()` — nós (union dos elementos referenciados) e
arestas (ligações com **peso** e **categoria**), determinísticos. Prepara a estrutura definitiva
do grafo sem inserir conhecimento.

## Explainability (Part 8)

Toda ligação registra **origem, destino, tipo, motivo e categoria**. Nenhuma ligação implícita.

## Consulta pelo AIExecutionEngine (Part 7)

A API de consulta é pura e read-only — o Engine e os domínios podem **navegar entre os dois
mundos** (Semantic Links, Cross References, Ontology Map) **sem alterar o pipeline cognitivo**.

## Garantias por teste (`rc441-ontology-integration.test.ts`, ORG 12500)

14 tipos de ligação, links explicáveis com endpoints válidos, mapa semântico, cross references,
consultas, projeção KG determinística, `validateIntegrationLayer` sem erros (sem órfãs/quebradas/
duplicadas/circulares; cardinalidade válida), ids únicos, fingerprint estável, **baixo acoplamento
verificado**. **Zero regressões. Ontologias e Kernel inalterados.**

> A futura Lei 14.133 será apenas **uma instância** desta arquitetura.

---

## Organização em Corpus (RC-4.5.1)

O conhecimento conectado por esta camada é organizado pelo **Institutional Corpus Framework**
(Corpus → Coleções → unidades), com hierarquia configurável, registro declarativo e projeção KG.
É a organização permanente onde qualquer conhecimento institucional futuro viverá, **sem**
conteúdo jurídico. Ver [INSTITUTIONAL_CORPUS_FRAMEWORK.md](./INSTITUTIONAL_CORPUS_FRAMEWORK.md).
