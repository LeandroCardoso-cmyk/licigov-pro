# Arquitetura — Cognitive Procurement Workspace (Sprint 5.0)

## Visão geral

A Fase 5 inaugura o **Sistema Operacional Cognitivo** do LiciGov Pro. O
**Cognitive Procurement Workspace** é o ambiente operacional principal do
Departamento de Licitações: ele coordena processos, documentos, copilotos,
workflows, decisões, revisões, colaboração e auditoria em um único espaço.

O Workspace **não é um dashboard** (não é uma tela de leitura de indicadores) e
**não é um chat** (não é um assistente de perguntas e respostas). Ele é o
ambiente que representa **"o dia de trabalho do servidor"** — o lugar onde o
trabalho acontece, é coordenado e é registrado.

> Toda ação é contextual, auditável, rastreável, explicável e supervisionada.
> **A decisão é sempre humana.**

## Mudança de paradigma

| Antes (Fases 1–4) | Agora (Fase 5) |
|---|---|
| Responder perguntas | Coordenar trabalho |
| Copiloto isolado por documento | Multi-Copilot Orchestrator |
| Interações pontuais | Ambiente operacional contínuo |
| Saída de IA como resposta | Saída de IA como recomendação supervisionada |
| Histórico disperso | Timeline institucional determinística |

O foco deixa de ser a geração de texto e passa a ser a **coordenação do trabalho
do departamento**, com o servidor no centro da decisão.

## As 4 camadas

```
┌───────────────────────────────────────────────────────────┐
│  Frontend (React 19 + tRPC client)                        │
│  Ambiente operacional: tarefas, timeline, decisões         │
├───────────────────────────────────────────────────────────┤
│  Routers (tRPC)                                            │
│  workspaceRouter · workspaceGovernanceRouter               │
├───────────────────────────────────────────────────────────┤
│  Services                                                  │
│  Orchestrator · Context · Task · Timeline · Decision ·     │
│  Risk · Collaboration · Observability                      │
├───────────────────────────────────────────────────────────┤
│  Domain (Drizzle ORM + MySQL Railway)                     │
│  cognitiveWorkspace · workspaceTask · workspaceTimeline ·  │
│  workspaceContext · workspaceDecision · workspaceRisk      │
└───────────────────────────────────────────────────────────┘
```

### 1. Domain
Seis agregados persistidos em MySQL (Railway) via Drizzle ORM, com IDs
**SHA-256 determinísticos** e isolamento **multi-tenant** por `organizationId`.

### 2. Services
Oito serviços coordenam a lógica operacional. Todos seguem **degradação
graciosa sem DB** (padrão `getDb()`), propagam `correlationId` e garantem
**replay safety**.

### 3. Routers
`workspaceRouter` expõe a operação; `workspaceGovernanceRouter` expõe a
governança. Ambos usam `protectedProcedure`/`adminProcedure` do tRPC 11.

### 4. Frontend
React 19 consome os routers via tRPC client, renderizando o ambiente
operacional (tarefas, timeline, decisões, riscos e colaboração).

## Os 6 agregados de domínio

| Agregado | Responsabilidade |
|---|---|
| **cognitiveWorkspace** | Raiz do ambiente operacional; estado e estágio |
| **workspaceTask** | Unidades de trabalho e seu ciclo de vida |
| **workspaceTimeline** | Linha do tempo institucional auditável |
| **workspaceContext** | Contexto consolidado (RAG + KG + memória) |
| **workspaceDecision** | Decisões humanas registradas e aprovadas |
| **workspaceRisk** | Riscos identificados e monitorados |

## Diagrama do ambiente operacional

```
                 ┌──────────────────────────────┐
   Servidor ───▶ │  Cognitive Procurement       │
                 │  Workspace                   │
                 │                              │
   Solicitação ─▶│  Orchestrator ──▶ Copilotos  │──▶ Recomendação
                 │        │                     │      (supervisionada)
                 │        ▼                     │
                 │  Context ◀── RAG · KG · Mem  │
                 │        │                     │
                 │  Task · Decision · Risk      │──▶ Timeline (auditável)
                 └──────────────────────────────┘
```

## Integração com copilotos, RAG e KG

O Workspace **reutiliza toda a infraestrutura das fases anteriores**, sem
duplicá-la:

- **Institutional RAG** — `retrieveAll` para recuperação contextual.
- **Procurement Knowledge Graph** — `searchKnowledgeNodes` e `loadSubgraph`
  para navegar o grafo de conhecimento da contratação.
- **Semantic Memory** — memória semântica de processos anteriores.
- **Copilotos** — `runCopilotReasoning` executado pelo Orchestrator.
- **Workflow Engine** — coordenação de fluxos de trabalho.
- **Approval Layer** — camada de aprovação humana obrigatória.

Toda geração de IA passa pelo pipeline oficial em `server/_core/llm.ts`
(Gemini 2.5 Flash) — nunca por chamadas diretas nos routers.

## Princípios arquiteturais

- **Determinismo**: IDs SHA-256 e timeline reproduzível (replay).
- **Multi-tenant**: todo agregado carrega `organizationId`.
- **Rastreabilidade**: `correlationId` propagado ponta a ponta.
- **Resiliência**: degradação graciosa quando o DB está indisponível.
- **Observabilidade**: métricas persistidas em `workspace_metrics`.
- **Supervisão humana**: nenhuma decisão é automatizada sem aprovação.
