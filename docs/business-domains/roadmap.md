# Roadmap — Sprints 5.0.1 → 5.5

**Business Domain Architecture & Modular Licensing Foundation**

Este roadmap descreve como a fundação arquitetural da Sprint 5.0.1 é preenchida,
domínio a domínio, nas Sprints 5.1–5.5. **A arquitetura não muda** — apenas
recebe as definições de processo e telas de cada domínio.

## Visão geral

| Sprint | Entrega | Domínio | Status |
|--------|---------|---------|--------|
| **5.0.1** | Fundação arquitetural | — (Kernel + Domínios) | Esta sprint |
| **5.1** | DFD → ETP → Pesquisa → TR → Edital | `processo_licitatorio` | Próxima |
| **5.2** | Dispensa, Inexigibilidade, Credenciamento | `contratacao_direta` | Planejado |
| **5.3** | Contratos e Aditivos | `contratos` | Planejado |
| **5.4** | Parecer Jurídico | `parecer_juridico` | Planejado |
| **5.5** | Gestão do Departamento | `gestao_departamento` | Planejado |

## 5.0.1 — Consolidação da Arquitetura (esta sprint)

Escopo: **arquitetura, não fluxos de negócio.** Entregas:

- Definição permanente: **Kernel Cognitivo Compartilhado × Domínios de Negócio
  Modulares** (nem módulos independentes, nem monólito único).
- Os 4 pilares: Kernel, Domínios Independentes, Licenciamento Modular,
  Workspaces Independentes.
- Registry do Kernel (`cognitiveKernel`) com ~21 serviços; `kernelAccessService`
  como única porta.
- Modelo de domínio: `businessDomain`, `domainWorkspace`, `licensedModule`,
  `moduleDependency`, `featureFlag`, `adaptiveProcessEngine`.
- Serviços: `businessDomainRegistryService`, `domainWorkspaceService`,
  `moduleLicensingService`, `featureFlagService`, `domainNavigationService`,
  `kernelAccessService`.
- Routers: `businessDomainRouter`, `moduleLicensingRouter`.
- Home = **Business Domain Portal** (mostra apenas módulos licenciados).
- Fundamentos: IDs SHA-256 determinísticos, multi-tenant (`organizationId`),
  replay safety, degradação graciosa (`getDb()`).

> Nenhum fluxo DFD/ETP/TR/contrato/parecer é implementado aqui. Apenas a
> fundação que permite implementá-los sem tocar no Kernel.

## 5.1 — Processo Licitatório (`processo_licitatorio`)

Fluxo cognitivo completo: **DFD → ETP → Pesquisa de Preços → TR → Edital**.

- Definição no Adaptive Process Engine (etapas, documentos, obrigatoriedades,
  aprovações, copilotos por etapa).
- Documentos: DFD (art. 12 §1º), ETP (art. 18), TR (art. 6º XXIII), Edital.
- Copilotos: demanda, pesquisa de preços, redação técnica.
- Integração CATMAT/CATSER (via Kernel).
- Core do MVP.

## 5.2 — Contratação Direta (`contratacao_direta`)

- Dispensa de licitação, Inexigibilidade, Credenciamento.
- Definições de processo próprias, reutilizando o mesmo Kernel.
- Documentos e justificativas específicos de contratação direta.

## 5.3 — Contratos e Aditivos (`contratos`)

- Geração contratual com **reaproveitamento de dados processuais** (via Kernel —
  Knowledge Graph / Semantic Memory, nunca acessando outro workspace).
- Aditivos: prorrogação, acréscimo, reequilíbrio.
- Versionamento e aprovações via Version/Approval Engines do Kernel.

## 5.4 — Parecer Jurídico (`parecer_juridico`)

- Parecer inicial, de adjudicação, favorável/desfavorável.
- Apoio técnico-jurídico via RAG institucional sobre a Lei 14.133/2021.
- Explainability obrigatória nas conclusões assistidas por IA.

## 5.5 — Gestão do Departamento (`gestao_departamento`)

- Calendário, protocolos, andamento, indicadores, produtividade.
- Consolida no domínio o que hoje existe no Módulo Gestão (Kanban, dashboard,
  relatórios), agora sob a arquitetura de domínios e workspace próprio.

## Invariantes ao longo de todas as sprints

Em **nenhuma** das Sprints 5.1–5.5:

- ❌ o Kernel é alterado para acomodar um domínio;
- ❌ um domínio duplica infraestrutura (IA, RAG, Timeline, etc.);
- ❌ um domínio acessa o Kernel fora do `kernelAccessService`;
- ❌ workspaces são compartilhados entre domínios;
- ❌ verificações de licença são espalhadas fora do `featureFlagService`.

Cada domínio novo entra por **declaração** (registro + definição de processo +
licença + flags + workspace), nunca por modificação do núcleo.

## Documentos relacionados

- [`architecture.md`](./architecture.md) · [`kernel.md`](./kernel.md) ·
  [`domains.md`](./domains.md) · [`licensing.md`](./licensing.md) ·
  [`workspaces.md`](./workspaces.md) · [`feature-flags.md`](./feature-flags.md) ·
  [`adaptive-process-engine.md`](./adaptive-process-engine.md)
