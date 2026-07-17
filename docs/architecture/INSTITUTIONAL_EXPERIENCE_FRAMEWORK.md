# Institutional Experience Framework (RC-X.1)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
>
> ⚠️ **Esta RC NÃO implementa UX definitiva.** Não cria dashboards, páginas finais, sidebar
> definitiva, React components, Design System, Business Domains, IA/RAG/Providers nem conteúdo
> jurídico. Ela cria apenas a **arquitetura permanente** que organizará toda a experiência do
> sistema. Declarativa, determinística, multi-tenant, replay-safe, explicável, observável.

## O que é

O LiciGov Pro tinha dois pilares (Cognitive Architecture e Business Domains), mas **nenhuma
arquitetura permanente para a experiência do usuário**. O **Institutional Experience Framework**
(`server/domain/experience/`) cria esse terceiro pilar: um **Kernel de Experiência** que organiza
navegação, home, workspaces e o ponto de entrada do copiloto **dinamicamente**, a partir de um
contexto institucional imutável.

**Nenhum módulo constrói menus, navegação ou home diretamente.** Todo módulo registra apenas
**Workspace + Capabilities + Actions + Routes**; o Framework monta a experiência.

```
InstitutionContext → ExperienceKernel → { Capabilities, Workspaces, Navigation, Home, Copilot }
```

## Componentes

| Parte | Componente | Arquivo | Papel |
|---|---|---|---|
| 1 | **ExperienceKernel** | `experienceKernel.ts` | Coordena toda a experiência (`buildExperience`): resolve capacidades/workspaces, monta navegação, compõe home, prepara copiloto. |
| 2 | **InstitutionContext** | `institutionContext.ts` | Contexto **imutável** (congelado): tenant, instituição, corpora ativos, módulos habilitados, capacidades, permissões, workspaces, resolutionChain, branding, metadata. |
| 3 | **Capability Matrix** | `capability.ts` | `Capability` + `CapabilityRegistry` + `CapabilityResolver`. Capacidade habilitada = módulo ativo **E** contratada. **Nunca menus.** |
| 4 | **Workspace Registry** | `workspace.ts` | `WorkspaceDefinition` + `WorkspaceRegistry` + `WorkspaceResolver`. Ambiente de trabalho (não módulo técnico). **Nenhum workspace sem Capability (Part 8).** |
| 5 | **Navigation Builder** | `navigationBuilder.ts` | Monta Sidebar, Top Navigation, Quick Actions, Breadcrumbs e Menus **dinamicamente** — nunca hardcoded. Cada item traz **explainability**. |
| 6 | **Home Composer** | `homeComposer.ts` | Monta Widgets, Cards, Quick Actions, Recentes, Favoritos e Workspaces com base no `InstitutionContext`. |
| 7 | **Copilot EntryPoint** | `copilotEntrypoint.ts` | `CopilotDefinition` + `CopilotContext` + `CopilotEntryPoint`. Ponto de entrada institucional — **sem IA nesta RC**. |
| 12 | **Explainability** | `experienceExplainability.ts` | Toda navegação/workspace explica: por que apareceu, qual capacidade, qual módulo, qual workspace, qual tenant. |
| — | **Validation** | `experienceValidation.ts` | Contexto válido, capacidades com módulo, workspaces sempre com Capability, capacidades existentes, ids únicos. |
| — | **Sample** | `experienceSample.ts` | Registros e contextos de exemplo por tipo de tenant (demonstra a extensibilidade da Part 10). |
| 11 | **Observabilidade** | `server/services/experience/experienceObservabilityService.ts` | Eventos (contextLoaded, workspaceRegistered, workspaceActivated, navigationGenerated, homeGenerated, capabilityResolved, copilotOpened) por **correlationId**. |

## Licenciamento & Multi-Tenant (Parts 8 e 9)

A experiência é **contratada**: uma capacidade só é habilitada se seu módulo estiver em
`enabledModules` **e** seu id em `capabilities`. Um workspace só aparece se **todas** as suas
`requiredCapabilities` estiverem habilitadas. Assim, cada Tenant vê apenas **workspaces
permitidos**, **capabilities contratadas** e **corpora ativos**. O framework já prepara perfis
para municípios pequenos/grandes, consórcios, câmaras e autarquias.

## Extensibilidade (Part 10)

Todo novo módulo registra apenas **Workspace + Capabilities + Actions + Routes**. **Nunca** altera
`NavigationBuilder` nem `HomeComposer` — o Framework monta toda a experiência automaticamente.

## Explainability (Part 12)

Cada `NavigationItem` carrega uma `NavigationExplanation`: **reason** (por que apareceu),
**capability** (o que habilitou), **module** (quem registrou), **workspace** (a que pertence) e
**tenantId** (quem autorizou). Nunca há informação implícita.

## Garantias

- **Imutabilidade:** `InstitutionContext` é congelado (`Object.freeze`) — estável durante a sessão.
- **Replay Safety:** `replayHash` determinístico do contexto; `buildExperience` sem correlationId
  não tem efeitos colaterais → mesma entrada, mesmo estado.
- **Determinismo:** capacidades/workspaces/navegação/home com ordenação estável.
- **Baixo acoplamento:** camada declarativa; não altera Kernel Cognitivo, Business Domains,
  Document Engine, AIExecutionEngine, Authentication nem UX.
- **Observabilidade & Auditabilidade:** toda operação é recuperável por correlationId.

## Garantias por teste (`rcx1-institutional-experience-framework.test.ts`, ORG 12900)

InstitutionContext (campos + imutabilidade + determinismo + multi-tenant), Capability Matrix
(resolução por licenciamento + bloqueio com razão), Workspace Registry (rejeita workspace sem
Capability + resolução), Navigation Builder (dinâmico + quick actions por capacidade + breadcrumbs
+ determinismo), Home Composer (widgets/cards/recentes/favoritos), Copilot EntryPoint (habilitado
por capacidade, sem IA), Experience Kernel (orquestração + multi-tenant distinto), Explainability,
validação (workspace com capacidade inexistente), observabilidade por correlationId, replay safety.
**Zero regressões.**

## Visão de longo prazo

Após esta RC, nenhum novo módulo precisa alterar a navegação, a Home ou criar menus. Cada módulo
registra apenas Workspace/Capabilities/Actions/Routes, e o **Experience Framework** monta toda a
experiência institucional dinamicamente — para qualquer tipo de tenant, com explainability e
observabilidade completas.
