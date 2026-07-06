# Observabilidade — workspaceObservabilityService

O `workspaceObservabilityService` transforma o Workspace Cognitivo em um
ambiente **mensurável**. Ele coleta e **persiste métricas** operacionais na
tabela `workspace_metrics` (MySQL/Railway via Drizzle), permitindo entender a
produtividade do Departamento de Licitações e identificar gargalos.

> O que não é medido não é gerenciável. A observabilidade dá visibilidade ao
> "dia de trabalho do servidor".

## Métricas persistidas

| Métrica | O que mede |
|---|---|
| **Produtividade** | Volume de trabalho concluído por período/participante |
| **Tempo por tarefa** | Duração de cada `workspaceTask` até `done` |
| **Tempo por copiloto** | Latência e contribuição de cada copiloto |
| **Tempo por etapa** | Duração de cada estágio (planejamento → aprovação) |
| **Gargalos** | Pontos de acúmulo/atraso no fluxo |
| **Filas** | Trabalho aguardando início ou revisão |
| **Revisões** | Quantidade e duração das revisões colaborativas |
| **Aprovações** | Tempo até aprovação humana e taxa de reprovação |

## Origem dos dados

As métricas são **derivadas da timeline institucional** (`workspaceTimeline`).
Como a timeline é append-only e determinística, os cálculos são reproduzíveis:
o mesmo conjunto de eventos gera sempre as mesmas métricas.

```
workspaceTimeline (eventos) ──▶ workspaceObservabilityService
                                        │
                                        ▼
                              workspace_metrics (persistido)
                                        │
                                        ▼
                                getMetrics (workspaceRouter)
```

## Persistência

As métricas são gravadas em `workspace_metrics` com:

- `id` — SHA-256 determinístico (replay safe);
- `workspaceId` e `organizationId` (multi-tenant);
- `metric` — nome da métrica;
- `value` — valor agregado;
- `window` — janela temporal de agregação;
- `computedAt` — timestamp do cálculo.

A persistência evita recomputar sob demanda e serve de base histórica para
comparação entre períodos.

## Consumo: `getMetrics`

O endpoint `getMetrics` (`workspaceRouter`) expõe as métricas ao frontend
React 19, que as renderiza em **dashboards** operacionais. Diferente do
paradigma anterior, o dashboard aqui é uma **visão derivada do ambiente
operacional** — não o produto em si.

## Dashboards

Os dashboards de observabilidade apoiam a gestão do departamento:

- **Produtividade** — trabalho concluído por servidor e por período.
- **Tempo por etapa** — onde o fluxo DFD → ETP → TR → Edital consome mais tempo.
- **Copilotos** — desempenho e contribuição de cada copiloto.
- **Gargalos e filas** — onde o trabalho acumula.
- **Revisões e aprovações** — eficiência da supervisão humana.

## Detecção de gargalos

Ao cruzar tempo por etapa, filas e revisões, o serviço identifica **gargalos**
(etapas ou tarefas com acúmulo recorrente), oferecendo insumo para redistribuir
trabalho ou ajustar a configuração do Workspace.

## Garantias

- **Determinismo**: métricas reproduzíveis a partir da timeline (SHA-256).
- **Rastreabilidade**: cada métrica associada ao `workspaceId`/`correlationId`
  de origem.
- **Multi-tenant**: métricas isoladas por `organizationId`.
- **Degradação graciosa**: sem DB (`getDb()`), o serviço não persiste e retorna
  erro explícito, sem produzir métricas inconsistentes.
- **Persistência**: histórico mantido em `workspace_metrics` para comparação.

## Papel institucional

A observabilidade fecha o ciclo operacional do Workspace: **planejar, executar,
revisar, aprovar e medir**. Ela dá ao gestor do Departamento de Licitações uma
visão fiel, auditável e comparável do trabalho realizado — sem sair do ambiente
operacional cognitivo.
