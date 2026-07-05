# Copilotos Cognitivos Institucionais — Arquitetura

## Visão geral

Com a Sprint 4.9, o LiciGov Pro deixa de ser apenas **infraestrutura documental** e
passa a operar como um **Sistema Operacional Cognitivo** do departamento de licitações.

Os Copilotos Cognitivos Institucionais são agentes especializados que **orientam,
estruturam, sugerem, explicam, fundamentam e identificam riscos** — mas **nunca tomam
decisões jurídicas**. Toda decisão permanece humana, revisável e auditável.

> Princípio central: o copiloto é um copiloto. Ele fundamenta a decisão; o servidor público a toma.

## Os 8 copilotos e seus domínios

| Copiloto | Domínio |
|---|---|
| `agente_contratacao` | Condução geral da contratação, coordenação do fluxo DFD → ETP → TR → Edital |
| `pregoeiro` | Sessão pública, condução do pregão, atos do certame |
| `planejamento` | Planejamento da contratação, DFD, ETP, calendário |
| `tr_intelligence` | Elaboração e revisão técnica de Termo de Referência |
| `juridico` | Apoio à análise jurídica, fundamentação, identificação de riscos legais |
| `pesquisa_precos` | Pesquisa de preços, cesta de referência, CATMAT/CATSER |
| `contratos` | Contratos, aditivos, reaproveitamento processual |
| `controle_interno` | Conformidade, checklists de controle, aderência à Lei 14.133/2021 |

## Restrição arquitetural inviolável

Nenhum copiloto acessa o provider de IA diretamente. **Toda inferência passa pelo
pipeline oficial** (`server/_core/llm.ts` → `invokeLLM` / `generateText`).

Cada copiloto usa obrigatoriamente as camadas institucionais:

- **Institutional RAG** — `retrieveAll` / `retrieveFromKnowledgeGraph`
- **Procurement Knowledge Graph** — relações entre entidades da contratação
- **Semantic Memory** — memória semântica institucional
- **Workflow Engine** — estado e transições do processo
- **Provider Layer** — abstração única sobre Gemini 2.5 Flash
- **Approval Layer** — supervisão humana obrigatória

## Camadas do sistema

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend — Institutional Copilot Center (React 19)          │
├─────────────────────────────────────────────────────────────┤
│  Routers — copilotRouter · copilotGovernanceRouter (tRPC)    │
├─────────────────────────────────────────────────────────────┤
│  Services                                                    │
│   orchestrator · context · reasoning · recommendation        │
│   policy · observability · evaluation · memory               │
├─────────────────────────────────────────────────────────────┤
│  Domain (Drizzle / MySQL — Railway)                          │
│   institutionalCopilot · copilotSession · copilotCapability  │
│   copilotRecommendation · copilotDecisionTrace · copilotPolicy│
├─────────────────────────────────────────────────────────────┤
│  Institutional Layers (obrigatórias)                         │
│   RAG · Knowledge Graph · Semantic Memory · Workflow Engine  │
│   Provider Layer (server/_core/llm.ts) · Approval Layer      │
└─────────────────────────────────────────────────────────────┘
```

### Domain (Drizzle ORM / MySQL)

- `institutionalCopilot` — registro de cada copiloto, domínio e capacidades
- `copilotSession` — sessão de interação, escopo multi-tenant (`organizationId`)
- `copilotCapability` — capacidade declarada de um copiloto
- `copilotRecommendation` — recomendação fundamentada, estado de aprovação
- `copilotDecisionTrace` — cadeia completa de reasoning para explainability e replay
- `copilotPolicy` — limites operacionais e ações proibidas por copiloto

### Services

- **orchestrator** — seleção do copiloto por intent e coordenação multi-copiloto
- **context** — montagem de contexto fundamentado (RAG + Knowledge Graph)
- **reasoning** — reasoning especializado roteado pelo pipeline oficial
- **recommendation** — estruturação da recomendação e evidências
- **policy** — avaliação de limites e ações permitidas
- **observability** — logs, métricas e rastreabilidade
- **evaluation** — qualidade, confiança e feedback
- **memory** — memória semântica institucional

## Pipeline do copiloto

```
Consulta
   → Intent Classification
   → Copilot Selection
   → Knowledge Graph
   → Institutional RAG
   → Context Assembly
   → Reasoning
   → Recommendation
   → Validation
   → Explainability
   → Response
```

Cada etapa é determinística e rastreável: IDs gerados por **SHA-256**, escopo
**multi-tenant** por `organizationId`, `correlationId` propagado ponta a ponta e
**replay safety** garantido pelo `copilotDecisionTrace`.

## Garantias transversais

- **IDs determinísticos (SHA-256)** — mesmas entradas produzem os mesmos identificadores
- **Multi-tenant** — todo acesso é isolado por `organizationId`
- **Replay safety** — decisões reproduzíveis a partir do trace
- **correlationId** — correlação de logs e traces entre camadas
- **Degradação graciosa sem DB** — padrão `getDb()`; a ausência de banco degrada
  funcionalidades sem quebrar o fluxo (modo grounding-only determinístico no reasoning)

## Referências internas

- `server/_core/llm.ts` — pipeline oficial de inferência (única porta para o provider)
- `server/services/` — RAG institucional e Knowledge Graph
- `docs/copilots/orchestrator.md`, `reasoning.md`, `governance.md`, `policies.md`,
  `explainability.md`, `evaluation.md`, `roadmap.md`
