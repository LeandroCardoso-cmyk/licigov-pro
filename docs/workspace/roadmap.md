# Roadmap — Cognitive Procurement Workspace

A **Sprint 5.0** entrega o **ambiente operacional** do LiciGov Pro: o
Cognitive Procurement Workspace, que inaugura o Sistema Operacional Cognitivo do
Departamento de Licitações. Este documento resume o que foi entregue e o que
vem a seguir.

## O que a Sprint 5.0 entrega

- **Ambiente operacional principal** — coordena processos, documentos,
  copilotos, workflows, decisões, revisões, colaboração e auditoria.
- **Multi-Copilot Orchestrator** — solicitação → classificação → seleção →
  execução paralela → resolução de conflitos → consolidação → validação →
  recomendação supervisionada.
- **6 agregados de domínio** — `cognitiveWorkspace`, `workspaceTask`,
  `workspaceTimeline`, `workspaceContext`, `workspaceDecision`, `workspaceRisk`.
- **8 serviços** — Orchestrator, Context, Task, Timeline, Decision, Risk,
  Collaboration, Observability.
- **2 routers** — `workspaceRouter` (operação) e `workspaceGovernanceRouter`
  (governança).
- **Timeline institucional** — auditável, determinística e reproduzível (replay).
- **Observabilidade** — métricas persistidas em `workspace_metrics`.
- **Reuso das fases anteriores** — Institutional RAG (`retrieveAll`),
  Procurement Knowledge Graph (`searchKnowledgeNodes`/`loadSubgraph`),
  Semantic Memory, Copilotos (`runCopilotReasoning`), Workflow Engine e
  Approval Layer.

Fundações mantidas: IDs SHA-256 determinísticos, multi-tenant por
`organizationId`, replay safety, `correlationId` propagado, degradação graciosa
sem DB (`getDb()`) e geração de IA sempre via `server/_core/llm.ts`.

## Estado atual das entregas

| Entrega | Status |
|---|---|
| Domínio (6 agregados) | Implementado |
| Serviços (8) | Implementado |
| Routers (operação + governança) | Implementado |
| Multi-Copilot Orchestrator | Implementado |
| Timeline institucional + replay | Implementado |
| Observabilidade (`workspace_metrics`) | Implementado |
| Automações de fluxo | Roadmap |
| Templates por tipo de contratação | Roadmap |
| Integração com ERPs municipais | Roadmap |
| Workspaces multi-órgão | Roadmap |

## Próximas evoluções

### 1. Automações de fluxo
Regras que disparam tarefas, revisões e recomendações automaticamente a partir
de eventos da timeline — sempre com **decisão humana** preservada. Objetivo:
reduzir trabalho repetitivo sem remover a supervisão. As automações se apoiam na
natureza determinística e append-only da timeline, garantindo que cada gatilho
seja auditável e reproduzível via replay.

### 2. Templates de workspace por tipo de contratação
Modelos pré-configurados de Workspace por modalidade e tipo de contratação
(pregão, dispensa, inexigibilidade, credenciamento), já com estágios, copilotos
e políticas de aprovação adequados ao fluxo DFD → ETP → TR → Edital. Os templates
padronizam a operação entre processos semelhantes, reduzindo esforço de
configuração inicial e reforçando a consistência jurídica das entregas.

### 3. Integração com ERPs municipais
Integração como **camada cognitiva sobre o ERP**, sem substituí-lo. O Workspace
consome e devolve dados ao ERP (empenho, contrato, dotação) mantendo-se fiel ao
escopo do LiciGov Pro: **sistema satélite especializado**, nunca um ERP,
contábil, tributário ou de RH. A troca de dados é rastreável, mapeada por
`correlationId` e registrada na timeline, preservando a trilha de auditoria.

### 4. Workspaces colaborativos multi-órgão
Workspaces compartilhados entre órgãos (ex.: compras conjuntas, atas de registro
de preços com múltiplos participantes), preservando isolamento multi-tenant,
governança por participante e trilha de auditoria unificada. Cada órgão mantém
seu `organizationId`, e a colaboração ocorre sob políticas de aprovação
explícitas, sem quebrar o isolamento dos dados.

## Princípios que se mantêm

Todas as evoluções respeitam os invariantes do Workspace Cognitivo:

- **Decisão sempre humana** — automações recomendam, não decidem.
- **Auditabilidade total** — tudo registrado na timeline imutável.
- **Determinismo** — IDs SHA-256 e replay reproduzível.
- **Multi-tenant** — isolamento por `organizationId`.
- **Explicabilidade** — toda ação é contextual, rastreável e explicável.
- **Escopo** — camada inteligente operacional do departamento de licitações;
  nunca ERP, contabilidade, tributação ou RH.

## Visão de longo prazo

Consolidar o Workspace como o **sistema operacional cognitivo** do Departamento
de Licitações: o ambiente único onde o servidor planeja, elabora, revisa, decide
e presta contas — com inteligência aplicada, padronização e segurança jurídica
alinhadas à Lei 14.133/2021.
