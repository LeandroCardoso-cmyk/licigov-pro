# Institutional Ontology Validation (RC-4.3.1)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
> A RC-4.3.1 valida **exaustivamente** a Ontologia Operacional (RC-4.3) antes da RC-4.4
> (Institutional Legal Knowledge). **Não adiciona** conhecimento jurídico, IA ou RAG — apenas
> prova que a modelagem existente representa qualquer cenário institucional relevante **sem
> alterações estruturais**. Determinística e replay-safe.

## Validação de integridade (`ontologyValidation.ts`)

`validateOntology()` executa 7 seções, cada uma retornando `{ ok, issues[] }`:

| Seção | Verifica |
|---|---|
| **roles** | Campos, referências, **não-isolamento** (todo papel participa via documentos/eventos/relacionamentos). |
| **objects** | Finalidade, estados, dependências, relacionamentos, **não-órfão**. |
| **states** | Transições válidas, **estados inalcançáveis**, dead-end **não-final** (o único terminal legítimo é `arquivado`), duplicados. |
| **events** | Origem, destino, objetos, papéis; **eventos órfãos**. |
| **dependencies** | **Ciclos** (DFS) + dependências quebradas. |
| **relationships** | Duplicados, origem/destino inválidos, sem objeto. |
| **knowledge_graph** | Nós/arestas/cardinalidade da projeção. |

**Resultado:** ontologia **válida — zero issues** em todas as seções.

## Expressividade (`scenarios.ts`)

**20 cenários** compostos APENAS com elementos existentes — todos **representáveis**:

Pregão, Concorrência, Dispensa, Inexigibilidade, Credenciamento, Registro de Preços, Contrato,
Convênio, Aditivo, Apostilamento, Rescisão, Fiscalização, Encerramento, Contratação Emergencial,
Processo Legado, Processo iniciado no ERP, Processo iniciado no LiciGov, Processo parcialmente
importado, Planejamento da demanda, Controle de conformidade.

**Cobertura pelos cenários: 100%** — 18/18 objetos, 13/13 papéis, 10/10 eventos, 10/10 estados.

## Resiliência

Detectores genéricos (`detectCycle`, `objectRefValid`, `roleRefValid`, `stateRefValid`,
`eventRefValid`) provam que o sistema **detecta** inconsistências propositais: ciclos,
referências quebradas, cenários com objetos/papéis/estados/eventos inexistentes.

## Consistência (Part 9)

- ✓ nenhum ciclo · ✓ nenhuma dependência impossível · ✓ nenhuma referência quebrada
- ✓ nenhuma duplicação · ✓ nenhuma ambiguidade · ✓ determinismo preservado (validação
  reproduzível — mesma ontologia → mesmo resultado).

## Limitações encontradas / melhorias futuras

- **Convênio** é representado como instrumento contratual (`contrato`) — a ontologia é
  **operacional**, não taxonômica de todo tipo de instrumento. Se necessário, um subtipo pode
  ser adicionado no futuro **sem** alterar a estrutura.
- **Modalidades** (pregão/concorrência) são representadas por composição de objetos existentes
  (edital/sessão/ata) — não como objetos próprios, por design.
- Nenhuma alteração estrutural foi necessária para os 20 cenários.

## Garantias por teste (`rc431-ontology-validation.test.ts`, ORG 12300)

16 testes: integridade por seção, expressividade (20 cenários + cobertura 100%), resiliência
(detecção de inconsistências), consistência e determinismo. **Zero regressões. Kernel/Business
Domains/ontologia inalterados.**
