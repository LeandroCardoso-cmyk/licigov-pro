# Ciclo de Vida — Cognitive Procurement Workspace

Este documento descreve o ciclo de vida do **Workspace Cognitivo** e das
**tarefas** (`workspaceTask`) que ele coordena. Todos os estados e transições
são persistidos em MySQL (Railway) via Drizzle ORM e registrados na
`workspaceTimeline` de forma determinística (replay safe).

## Estados do Workspace

O agregado `cognitiveWorkspace` percorre seis estados:

```
draft → active → in_review → awaiting_approval → completed → archived
```

| Estado | Significado |
|---|---|
| **draft** | Workspace criado, ainda em configuração inicial |
| **active** | Trabalho em andamento; tarefas e copilotos operando |
| **in_review** | Entregas em revisão colaborativa |
| **awaiting_approval** | Aguardando aprovação humana (Approval Layer) |
| **completed** | Trabalho concluído e aprovado |
| **archived** | Workspace arquivado, imutável para consulta/auditoria |

## Estágios operacionais

Independentemente do estado, o Workspace avança por **estágios** que refletem o
fluxo documental do LiciGov Pro (DFD → ETP → TR → Edital):

```
planejamento → elaboração → revisão → aprovação
```

- **planejamento** — consolidação do contexto (RAG + KG + memória semântica).
- **elaboração** — execução dos copilotos via Orchestrator.
- **revisão** — revisão colaborativa humana das entregas.
- **aprovação** — decisão e aprovação humana registradas.

Estado e estágio são ortogonais: um Workspace `active` pode estar no estágio de
`elaboração`, e um `in_review` no estágio de `revisão`.

## Transições válidas do Workspace

```
draft ──────────────▶ active
active ─────────────▶ in_review
in_review ──────────▶ awaiting_approval
in_review ──────────▶ active           (retorno para ajustes)
awaiting_approval ──▶ completed         (aprovação humana)
awaiting_approval ──▶ in_review         (reprovação / revisão adicional)
completed ──────────▶ archived
```

Transições inválidas são rejeitadas pelos serviços de domínio. Cada transição
gera um evento na `workspaceTimeline` com `correlationId`, autor e timestamp,
garantindo rastreabilidade total.

## Ciclo de vida da tarefa (`workspaceTask`)

Cada unidade de trabalho percorre cinco estados:

```
pending → in_progress → blocked → in_review → done
```

| Estado | Significado |
|---|---|
| **pending** | Tarefa criada, aguardando início |
| **in_progress** | Em execução (por servidor e/ou copilotos) |
| **blocked** | Impedida por dependência, risco ou pendência |
| **in_review** | Entregue, em revisão humana |
| **done** | Concluída e validada |

### Transições válidas da tarefa

```
pending ─────▶ in_progress
in_progress ─▶ blocked
in_progress ─▶ in_review
blocked ─────▶ in_progress
in_review ───▶ in_progress   (ajustes solicitados)
in_review ───▶ done          (concluída via concludeTask)
```

## Regras de consistência

- **Determinismo**: IDs SHA-256; a mesma sequência de eventos reproduz o mesmo
  estado (replay).
- **Multi-tenant**: transições só ocorrem dentro do mesmo `organizationId`.
- **Supervisão humana**: a transição para `completed` exige aprovação humana
  registrada em `workspaceDecision`.
- **Auditabilidade**: toda transição de estado/estágio é imutável na timeline.
- **Degradação graciosa**: sem DB (`getDb()` indisponível), as transições são
  bloqueadas com erro explícito, sem corromper estado.

## Relação com decisões e riscos

- Uma transição para `awaiting_approval` cria/consulta uma `workspaceDecision`
  pendente.
- Riscos abertos (`workspaceRisk`) podem forçar tarefas ao estado `blocked` e
  impedir o avanço do estágio para `aprovação` até resolução ou aceite formal.

## Fluxo típico

1. `createWorkspace` → estado **draft**.
2. Configuração e participantes → estado **active**, estágio **planejamento**.
3. Orchestrator executa copilotos → estágio **elaboração**.
4. Entregas revisadas → estado **in_review**, estágio **revisão**.
5. `createDecision` + `approveDecision` → **awaiting_approval** → **completed**.
6. `archiveWorkspace` → **archived** (imutável).
