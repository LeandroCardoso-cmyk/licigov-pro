# Arquitetura — Business Domain Contratação Direta

## Visão geral

O Business Domain **Contratação Direta** cobre os processos de **Dispensa** e
**Inexigibilidade** de licitação previstos na Lei 14.133/2021. Sua arquitetura é
**workspace-cêntrica**: todo o ciclo de vida de um processo é conduzido a partir
de um agregado central, o `DirectProcurementWorkspace`
(`server/domain/directProcurementWorkspace.ts`).

O princípio de projeto é **reutilizar sem duplicar**. O domínio não reimplementa
pesquisa de preços, geração documental, linha do tempo, parecer jurídico ou
acesso ao Kernel — ele orquestra serviços que já existem na plataforma.

## Modelo workspace-cêntrico

Um workspace é a unidade de trabalho e de estado. Ele:

- guarda a etapa atual da máquina de 15 estados (ver `workflow.md`);
- referencia — nunca copia — artefatos produzidos por outros domínios;
- carrega as flags do Adaptive Process Engine (DFD opcional, pesquisa de preços,
  propostas, parecer jurídico);
- expõe cada transição como uma operação determinística e auditável.

```
DirectProcurementWorkspace
├── procedure            (direct_procurement_procedures)
├── proposalCollection   (proposal_collections + proposal_documents)
├── contractJustification(contract_justifications)
├── priceJustification   (price_justifications)
├── requiredDocuments    (required_documents)
├── ratification         (ratifications)
└── publication          (generated_publications)
```

## Camadas

| Camada | Local | Responsabilidade |
|---|---|---|
| **Domínio** | `server/domain/directProcurementWorkspace.ts` | Regras de negócio, máquina de estados, Adaptive Process Engine, invariantes |
| **Serviço** | `server/domain/priceResearch.ts`, Request Engine, Document Engine, Multi-Copilot Orchestrator | Capacidades reutilizadas e orquestração cross-domínio |
| **Repositório** | Drizzle sobre as 9 tabelas do domínio | Persistência multi-tenant, leitura/escrita determinística |
| **Router** | `server/routers/directProcurementRouter.ts` | Superfície tRPC (`directProcurement`), validação Zod, autorização |

A regra é estrita: o **router não contém regra de negócio** — ele valida a
entrada, chama o domínio e devolve o resultado. O **domínio não conhece tRPC**.

## Reuso do Kernel e de outros domínios

O domínio integra-se a capacidades existentes por interfaces bem definidas:

- **Kernel Access Service** (`assertKernelAccess`) — **única porta** de acesso ao
  Kernel. Nenhum acesso direto é permitido; toda leitura/escrita sensível passa
  por essa verificação.
- **Price Research Workspace** (`server/domain/priceResearch.ts`) — importado por
  referência para a etapa `PRICE_RESEARCH` e para a Justificativa do Preço.
- **Institutional Request Engine** (`requestInstitutionalReview`) — dispara
  `LEGAL_OPINION_INITIAL` ao Business Domain Parecer Jurídico (ver `legal-opinion.md`).
- **Timeline Engine** (`process_timeline`) — registra cada transição relevante.
- **Multi-Copilot Orchestrator** — copilotos `agente_contratacao`, `juridico` e
  `pesquisa_precos` fornecem recomendações.
- **Document Engine** — geração de publicações e artefatos (ver `publication.md`).

## Multi-tenant

Todo agregado e toda linha das 9 tabelas carregam `organizationId`. Nenhuma
consulta cruza fronteira de organização; a autorização é validada no router e
reforçada pelo Kernel Access Service. Isso garante isolamento total entre
tenants sobre a mesma base MySQL.

## Determinismo e replay-safety

O domínio é **determinístico** e **replay-safe**:

- IDs derivados de `sha256` sobre entradas estáveis — **sem** `Date.now()` nem
  `Math.random()`;
- a mesma sequência de comandos produz o mesmo estado final;
- transições são idempotentes onde a semântica permite, viabilizando replay de
  eventos sem efeitos colaterais divergentes.

## Explicabilidade

Toda recomendação emitida (legal basis, checklist, justificativas, publicação)
carrega **reasoning**, **explainability**, **provenance** e **confidence**, e
pode ser **rejeitada** pelo operador humano. A IA nunca decide sozinha: ela
propõe, o humano valida.
