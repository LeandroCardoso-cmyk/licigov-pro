# Arquitetura de Domínios de Negócio — Visão Definitiva

**Sprint 5.0.1 — Business Domain Architecture & Modular Licensing Foundation**

> Esta sprint **NÃO implementa fluxos de negócio**. Ela consolida, de forma
> permanente, a arquitetura sobre a qual os módulos das Sprints 5.1–5.5 serão
> construídos. Nenhuma decisão descrita aqui deve ser revertida por sprints
> futuras.

## 1. O que o LiciGov Pro é (definição arquitetural permanente)

O LiciGov Pro é uma **plataforma cognitiva** composta por:

1. Um **Kernel Cognitivo Compartilhado** — a inteligência e a infraestrutura
   central (IA, Workflow, RAG, Knowledge Graph, Timeline, CATMAT, Replay,
   Explainability, etc.).
2. **Domínios de Negócio Modulares e Independentes** — cada área funcional
   (licitação, contratos, parecer, etc.) é um domínio próprio.

O LiciGov Pro **NÃO é**:

- ❌ um conjunto de módulos independentes que duplicam infraestrutura;
- ❌ um monólito único onde tudo está acoplado.

É uma composição deliberada: **um Kernel + muitos Domínios**.

## 2. Os 4 Pilares

| # | Pilar | Descrição |
|---|-------|-----------|
| 1 | **Kernel Cognitivo Compartilhado** | ~21 serviços centrais. Nenhum pertence a módulo comercial. Único ponto de infraestrutura. |
| 2 | **Domínios de Negócio Independentes** | 5 domínios iniciais. Cada um define seu próprio fluxo, mas nunca sua própria infraestrutura. |
| 3 | **Licenciamento Modular** | Cada organização contrata apenas os domínios que precisa. A plataforma se adapta automaticamente. |
| 4 | **Workspaces Independentes** | Cada domínio possui seu próprio workspace. Nunca compartilhado. Reutilização só via Kernel. |

## 3. Diagrama de Camadas

```
┌───────────────────────────────────────────────────────────┐
│                  BUSINESS DOMAIN PORTAL                     │
│        (Home — mostra apenas módulos LICENCIADOS)          │
└───────────────────────────────────────────────────────────┘
                            │
        ┌───────────┬───────┼───────┬───────────┐
        ▼           ▼       ▼       ▼           ▼
   ┌─────────┐ ┌─────────┐ ┌────┐ ┌────────┐ ┌────────┐
   │Processo │ │Contrat. │ │Con-│ │Parecer │ │Gestão  │  ← Business
   │Licitat. │ │ Direta  │ │tra-│ │Jurídico│ │Depto.  │    Domains
   │[workspc]│ │[workspc]│ │tos │ │[workspc│ │[workspc│    (workspace
   └─────────┘ └─────────┘ └────┘ └────────┘ └────────┘     próprio)
        │           │       │        │           │
        └───────────┴───────┼────────┴───────────┘
                            ▼
        ┌───────────────────────────────────────────┐
        │            kernelAccessService             │  ← ÚNICA porta
        │        (única porta de acesso ao Kernel)   │
        └───────────────────────────────────────────┘
                            ▼
   ┌───────────────────────────────────────────────────────┐
   │            KERNEL COGNITIVO COMPARTILHADO             │
   │  AI Orchestration · Workflow Engine · RAG · Knowledge │
   │  Graph · Timeline · CATMAT · Replay · Explainability  │
   │  · Adaptive Process Engine · ... (~21 serviços)       │
   └───────────────────────────────────────────────────────┘
                            ▼
        ┌───────────────────────────────────────────┐
        │   Drizzle ORM · MySQL (Railway) · S3       │
        └───────────────────────────────────────────┘
```

## 4. Regras de Arquitetura — o que um Domínio NÃO pode fazer

Estas regras são **não negociáveis**:

1. **Nunca duplicar infraestrutura do Kernel.** Um domínio não pode ter sua
   própria orquestração de IA, seu próprio RAG, seu próprio Timeline, etc.
2. **Nunca acessar o Kernel diretamente.** Todo acesso ocorre exclusivamente
   via `kernelAccessService`. Chamadas diretas a serviços internos do Kernel
   são proibidas.
3. **Nunca compartilhar workspace com outro domínio.** Cada domínio possui um
   `domainWorkspace` próprio.
4. **Nunca implementar verificações de licença espalhadas.** Toda funcionalidade
   é governada por `featureFlagService`.
5. **Nunca definir tabelas de infraestrutura duplicadas.** Reutilização ocorre
   sempre pelo Kernel, nunca por cópia.
6. **Um domínio define o QUÊ (etapas, documentos, aprovações). O Kernel executa
   o COMO.** A execução dos fluxos pertence ao Adaptive Process Engine.

## 5. Modelo de Domínio (entidades desta sprint)

- `businessDomain` — registro de cada domínio de negócio.
- `domainWorkspace` — workspace próprio de cada domínio.
- `licensedModule` — módulo licenciado por organização.
- `moduleDependency` — dependências entre módulos.
- `featureFlag` — governança de funcionalidades.
- `cognitiveKernel` — registry dos serviços do Kernel.
- `adaptiveProcessEngine` — definição de fluxos por domínio.

Todos com **IDs SHA-256 determinísticos**, isolamento **multi-tenant**
(`organizationId`), **replay safety** e **degradação graciosa** via `getDb()`.

## 6. Roadmap (resumo)

| Sprint | Entrega |
|--------|---------|
| **5.0.1** | Consolidação da arquitetura (esta sprint) — sem fluxos de negócio |
| **5.1** | Processo Licitatório: DFD → ETP → Pesquisa → TR → Edital |
| **5.2** | Contratação Direta: Dispensa, Inexigibilidade, Credenciamento |
| **5.3** | Contratos e Aditivos |
| **5.4** | Parecer Jurídico |
| **5.5** | Gestão do Departamento |

Detalhes completos em [`roadmap.md`](./roadmap.md).

## 7. Documentos relacionados

- [`kernel.md`](./kernel.md) — o Kernel Cognitivo Compartilhado
- [`domains.md`](./domains.md) — os 5 domínios de negócio
- [`licensing.md`](./licensing.md) — licenciamento modular
- [`workspaces.md`](./workspaces.md) — workspaces independentes
- [`feature-flags.md`](./feature-flags.md) — governança por feature flags
- [`adaptive-process-engine.md`](./adaptive-process-engine.md) — motor de processos
