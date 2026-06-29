# Institutional Memory — Memória Institucional

## Visão Geral

A Memória Institucional é o subsistema responsável por preservar, organizar e disponibilizar o conhecimento acumulado de cada organização para uso no RAG institucional.

## Fontes de Conhecimento

### Documentos Licitatórios
- **Termos de Referência**: especificações técnicas, itens, justificativas
- **DFDs**: formalizações de demanda com necessidades identificadas
- **ETPs**: estudos técnicos com análise de soluções
- **Editais**: parâmetros de julgamento, modalidades

### Legislação
- **Lei 14.133/2021**: base legal completa indexada por artigo
- **Decretos**: regulamentações específicas
- **Instruções Normativas**: normas operacionais

### Jurisprudência
- **Acórdãos TCU/TCE**: decisões relevantes indexadas
- **Súmulas**: entendimentos consolidados

### Templates
- **Templates municipais**: modelos padronizados da organização
- **Modelos anteriores**: documentos aprovados como referência

### Catálogos (Planejado)
- **CATMAT**: catálogo de materiais do governo federal
- **CATSER**: catálogo de serviços do governo federal

## Arquitetura de Retrieval Multi-Fonte

```
Consulta
  │
  ├── retrieveFromTRs()       → TRs similares
  ├── retrieveFromLegal()     → Referências legais
  ├── retrieveFromDocuments() → Chunks de documentos
  ├── retrieveFromCATMAT()    → Itens CATMAT (stub)
  ├── retrieveFromHistory()   → Histórico municipal
  └── retrieveFromTemplates() → Templates
  │
  ▼
weightedMerge() → Resultados consolidados e ranqueados
```

Todas as buscas executam em paralelo via `Promise.all` para mínima latência.

## Extensibilidade

A arquitetura permite adicionar novas fontes de conhecimento implementando a interface de retrieval. Cada fonte retorna chunks normalizados com `id`, `content`, `similarity` e `source`.

## Isolamento Multi-Tenant

Cada organização possui sua própria memória institucional. O `organizationId` é obrigatório em todas as operações de retrieval, garantindo isolamento completo dos dados.

## Preservação de Conhecimento

O sistema mantém lineage completo:
- Correlation IDs rastreiam cada operação
- Replay snapshots permitem reprodução
- Grounding logs registram toda a cadeia de inferência
