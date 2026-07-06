# Timeline Institucional — workspaceTimeline

A **timeline institucional** é o registro auditável e determinístico de tudo o
que acontece no Workspace Cognitivo. Ela é composta pelo agregado
`workspaceTimeline` e coordenada pelo `workspaceTimelineService`.

> A timeline é a memória oficial do "dia de trabalho do servidor" —
> imutável, reproduzível e auditável.

## O que é registrado

O registro é **automático**: cada serviço do Workspace emite eventos ao alterar
estado. São capturados, no mínimo:

| Evento | Origem |
|---|---|
| **Decisões** | `workspaceDecisionService` (createDecision, approveDecision) |
| **Revisões** | `workspaceCollaborationService` (revisão colaborativa) |
| **Aprovações** | Approval Layer (aprovação humana) |
| **Recomendações** | `workspaceOrchestratorService` (saída consolidada) |
| **Mudanças** | Transições de estado/estágio do Workspace e das tarefas |

Complementam o registro: comentários, marcações, delegações, abertura e
resolução de riscos, atribuição de copilotos e participantes.

## Estrutura de um evento

Cada evento da timeline carrega:

- `id` — **SHA-256 determinístico** derivado do conteúdo do evento;
- `workspaceId` e `organizationId` (multi-tenant);
- `correlationId` — propagado desde a solicitação de origem;
- `type` — tipo do evento (decisão, revisão, aprovação, recomendação, mudança);
- `actor` — servidor ou copiloto que originou o evento;
- `payload` — dados do evento (o que mudou);
- `timestamp` — momento da ocorrência.

Eventos são **imutáveis**: nunca são editados ou removidos, apenas acrescentados
(append-only).

## Determinismo e replay

A timeline é **determinística**: dada a mesma sequência de eventos, o estado do
Workspace é sempre reproduzível. Isso habilita o **replay**
(`replayWorkspace` no `workspaceGovernanceRouter`):

```
eventos (append-only) ──▶ replay ──▶ estado reconstruído
```

Como cada `id` é um SHA-256 do conteúdo, duplicidades são detectáveis e o replay
é **idempotente** (replay safety). O mesmo processo de reconstrução vale para
auditoria e para validação de integridade (`validateWorkspace`).

## Registro automático

O serviço não exige chamadas manuais dispersas: os demais serviços
(`Task`, `Decision`, `Risk`, `Collaboration`, `Orchestrator`) delegam o registro
ao `workspaceTimelineService` no momento de cada transição. Isso garante que
**nenhuma ação relevante escape** da linha do tempo.

```ts
await workspaceTimelineService.record({
  workspaceId,
  organizationId,
  correlationId,
  type: "decision.approved",
  actor,
  payload,
});
```

## Consulta

A timeline é consultada via `getTimeline` (`workspaceRouter`), que retorna os
eventos ordenados cronologicamente, com filtros por tipo, período e ator. O
frontend React 19 renderiza a linha do tempo como o histórico oficial do
Workspace.

## Exportação

A governança permite exportar a timeline (`exportTimeline`) e o Workspace
completo (`exportWorkspace`) para fins de auditoria externa, preservando os
IDs determinísticos e o encadeamento dos eventos.

## Garantias

- **Auditabilidade total**: append-only, imutável, com autor e timestamp.
- **Determinismo**: IDs SHA-256 e reconstrução reproduzível (replay).
- **Rastreabilidade**: `correlationId` liga cada evento à sua solicitação.
- **Multi-tenant**: eventos isolados por `organizationId`.
- **Degradação graciosa**: sem DB (`getDb()`), o registro é bloqueado com erro
  explícito, evitando lacunas silenciosas na trilha de auditoria.

## Papel institucional

A timeline é o que torna o Workspace **auditável por natureza**: não é um log
técnico acessório, mas o **registro oficial** das decisões e ações do
Departamento de Licitações, alinhado à exigência de rastreabilidade da
Lei 14.133/2021.
