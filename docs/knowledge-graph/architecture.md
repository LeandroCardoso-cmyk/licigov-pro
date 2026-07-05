# Arquitetura do Knowledge Graph

## Visao Geral

O Knowledge Graph (KG) de licitacoes do LiciGov Pro e uma camada de inteligencia
semantica que modela as relacoes entre entidades do dominio de contratacoes publicas.
Diferente de uma busca textual tradicional, o KG permite navegacao por relacoes
tipadas entre conceitos, documentos, normas e processos.

O objetivo principal e fornecer ao sistema a capacidade de:
- Identificar dependencias entre documentos (DFD fundamenta ETP, ETP fundamenta TR)
- Recomendar clausulas e fundamentacoes legais com base no contexto processual
- Detectar inconsistencias entre documentos de um mesmo processo
- Sugerir precedentes e modelos com base em similaridade estrutural

## Como Complementa o RAG Existente

O sistema ja possui RAG (Retrieval-Augmented Generation) sobre a Lei 14.133/2021.
O KG complementa o RAG de forma sinergica:

| Aspecto | RAG | Knowledge Graph |
|---------|-----|-----------------|
| Tipo de busca | Textual/vetorial | Relacional/semantica |
| Retorno | Trechos de texto relevantes | Entidades e suas relacoes |
| Forca | Encontrar passages especificas | Navegar conexoes entre conceitos |
| Fraqueza | Nao entende relacoes | Nao substitui busca textual livre |
| Uso principal | Fundamentacao legal | Recomendacao e validacao |

**Fluxo combinado:** O RAG busca trechos legais relevantes; o KG identifica quais
conceitos se relacionam ao contexto atual e recomenda caminhos de fundamentacao.

## Pipeline de Integracao

```
[Documento]
     |
     v
[1. Ingestao] -----> Parsing do documento (PDF, DOCX, texto)
     |
     v
[2. Extracao de Entidades] -----> NER + regras para identificar:
     |                            modalidades, artigos, orgaos, objetos
     v
[3. Resolucao de Entidades] ----> Deduplicacao e normalizacao
     |                            (ver entity-resolution.md)
     v
[4. Construcao do Grafo] -------> Criacao de nos e arestas
     |                            com pesos e confianca
     v
[5. Enriquecimento] ------------> Inferencia de relacoes implicitas
     |                            via regras e ontologia
     v
[Grafo Atualizado]
```

## Componentes Principais

### 1. Grafo (Nodes + Edges)
Armazena entidades como nos e relacoes como arestas direcionadas e tipadas.
Cada no tem tipo, metadata e embedding vetorial. Cada aresta tem tipo, peso
e nivel de confianca.

### 2. Ontologia
Define a taxonomia de conceitos do dominio de licitacoes. Estabelece hierarquias,
propriedades obrigatorias e restricoes de relacao. Ver `ontology.md`.

### 3. Motor de Resolucao
Responsavel por identificar quando duas mencoes se referem a mesma entidade.
Utiliza estrategias fuzzy, alias e semantica. Ver `entity-resolution.md`.

### 4. Motor de Recomendacao
Consulta o grafo para sugerir:
- Fundamentacoes legais aplicaveis ao contexto
- Clausulas frequentemente usadas em processos similares
- Alertas de inconsistencia entre documentos do processo

## Integracao com Fluxo Documental

O KG se integra ao fluxo principal DFD -> ETP -> TR -> Edital:

- **DFD:** gera entidades (objeto, justificativa, setor_demandante), relacao `fundamenta` ETP
- **ETP:** gera entidades (solucao, riscos, estimativa_valor), relacao `fundamenta` TR
- **TR:** gera entidades (especificacoes, criterios, obrigacoes), relacao `fundamenta` Edital
- **Edital:** gera entidades (modalidade, regime, cronograma), relacao `compoe` clausulas

## Tecnologias

O grafo e modelado usando tabelas relacionais no MySQL via Drizzle ORM:

- **`kg_nodes`** - Nos do grafo (entidades, conceitos, documentos)
- **`kg_edges`** - Arestas tipadas e ponderadas
- **`kg_concepts`** - Ontologia de conceitos do dominio

Essa abordagem foi escolhida por:
1. Reutilizar a infraestrutura MySQL ja existente (Railway)
2. Manter consistencia transacional com o restante do sistema
3. Evitar complexidade operacional de um banco de grafos dedicado
4. Queries de grafo sao resolvidas com CTEs recursivas quando necessario

## Diagrama da Arquitetura

```
+----------------------------------------------------------+
|                    LiciGov Pro                            |
+----------------------------------------------------------+
|                                                          |
|  [Geracao IA]  <---+--- [RAG Lei 14.133]                |
|       |            |         |                           |
|       v            |         v                           |
|  [llm.ts]         |    [Busca Vetorial]                 |
|       |            |                                     |
|       v            v                                     |
|  +------------------+    +---------------------------+   |
|  | Motor de         |    | Knowledge Graph           |   |
|  | Recomendacao     |<-->| (kg_nodes, kg_edges,      |   |
|  +------------------+    |  kg_concepts)             |   |
|                          +---------------------------+   |
|                                |                         |
|                                v                         |
|                     +---------------------+              |
|                     | Motor de Resolucao  |              |
|                     | de Entidades        |              |
|                     +---------------------+              |
|                                |                         |
|                                v                         |
|                     +---------------------+              |
|                     | Pipeline de         |              |
|                     | Ingestao            |              |
|                     +---------------------+              |
|                                                          |
+----------------------------------------------------------+
|              MySQL (Railway) via Drizzle ORM              |
+----------------------------------------------------------+
```

## Proximos Passos

1. Implementar schema Drizzle para `kg_nodes`, `kg_edges`, `kg_concepts`
2. Criar pipeline de extracao de entidades usando Gemini 2.5 Flash
3. Implementar motor de resolucao com estrategias configuraveis
4. Integrar recomendacoes no fluxo de geracao de documentos
