# Domínios de Negócio

**Sprint 5.0.1 — Business Domain Architecture & Modular Licensing Foundation**

Um **Business Domain** é uma área funcional independente do LiciGov Pro. Cada
domínio define **o que** faz (etapas, documentos, aprovações), mas **nunca**
possui infraestrutura própria — toda inteligência vem do Kernel Cognitivo
Compartilhado, acessado via `kernelAccessService`.

## 1. Os 5 domínios iniciais

| Slug | Domínio | Escopo | Sprint |
|------|---------|--------|--------|
| `processo_licitatorio` | **Processo Licitatório** | DFD → ETP → Pesquisa → TR → Edital | 5.1 |
| `contratacao_direta` | **Contratação Direta** | Dispensa, Inexigibilidade, Credenciamento | 5.2 |
| `contratos` | **Contratos e Aditivos** | Geração contratual, aditivos, reaproveitamento | 5.3 |
| `parecer_juridico` | **Parecer Jurídico** | Parecer inicial, adjudicação, favorável/desfavorável | 5.4 |
| `gestao_departamento` | **Gestão do Departamento** | Calendário, protocolos, indicadores, produtividade | 5.5 |

> Nesta sprint os domínios são **registrados**, não implementados. Os fluvos de
> negócio chegam nas Sprints 5.1–5.5.

## 2. Entidade `businessDomain`

Cada domínio é um registro na tabela `businessDomain`, criado pelo
`businessDomainRegistryService`.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | `char(64)` | ID SHA-256 determinístico do domínio. |
| `organizationId` | `char(64)` | Tenant proprietário (multi-tenant). |
| `slug` | `varchar` | Identificador estável (ex.: `processo_licitatorio`). |
| `name` | `varchar` | Nome de exibição. |
| `description` | `text` | Descrição funcional. |
| `requiredKernelServices` | `json` | Serviços do Kernel exigidos pelo domínio. |
| `supportedWorkflows` | `json` | Workflows que o domínio suporta. |
| `workspaceType` | `varchar` | Tipo do workspace próprio do domínio. |
| `status` | `enum` | `active` / `inactive` / `roadmap`. |
| `createdAt` / `updatedAt` | `timestamp` | Auditoria. |

### `requiredKernelServices`

Lista **declarativa** dos Kernel Services que o domínio consome. Exemplo para
Processo Licitatório:

```json
["ai-orchestration", "institutional-rag", "document-engine",
 "workflow-engine", "catmat-catser-engine", "approval-engine",
 "timeline-engine", "audit-engine"]
```

O `businessDomainRegistryService` valida, no registro, que todos os serviços
declarados existem no registry `cognitiveKernel`. Se um serviço não existir, o
domínio **não** é registrado — evitando dependências fantasmas.

### `supportedWorkflows`

Descreve, de forma declarativa, os workflows do domínio (nome, etapas de alto
nível). A execução real é responsabilidade do Adaptive Process Engine — ver
[`adaptive-process-engine.md`](./adaptive-process-engine.md).

### `workspaceType`

Define o tipo de workspace próprio do domínio. Cada domínio tem **um workspace
exclusivo**, nunca compartilhado — ver [`workspaces.md`](./workspaces.md).

## 3. Como consultar domínios — `businessDomainRouter`

| Procedure | Função |
|-----------|--------|
| `listDomains` | Lista domínios da organização (respeitando licença). |
| `getDomain` | Detalhes de um domínio. |
| `createWorkspace` | Cria o workspace próprio do domínio. |
| `launchWorkspace` | Abre o workspace do domínio. |
| `getDomainStatus` | Estado do domínio (ativo, licenciado, roadmap). |
| `getDependencies` | Dependências de módulos/serviços do domínio. |

Todas as procedures são `protectedProcedure` e exigem `organizationId` no
contexto.

## 4. Como criar novos domínios SEM alterar o Kernel

A arquitetura permite adicionar domínios **sem tocar** no Kernel. Passos:

1. **Registrar** o domínio via `businessDomainRegistryService.register()`,
   declarando `slug`, `requiredKernelServices`, `supportedWorkflows` e
   `workspaceType`.
2. **Definir o fluxo** no Adaptive Process Engine (etapas, documentos,
   exceções, obrigatoriedades, aprovações, copilotos predominantes).
3. **Criar a licença** correspondente (`licensedModule`) e as `featureFlag`s.
4. **Provisionar o workspace** próprio (`domainWorkspace`).

Nenhum desses passos altera código do Kernel: o domínio apenas **declara** o que
precisa e **consome** os serviços existentes via `kernelAccessService`. É assim
que a plataforma escala para novos domínios (ex.: futuros "Compras
Sustentáveis", "Registro de Preços") sem regressão no núcleo.

## 5. Regras invioláveis dos domínios

- Um domínio **nunca** duplica infraestrutura do Kernel.
- Um domínio **nunca** acessa o Kernel fora do `kernelAccessService`.
- Um domínio **nunca** compartilha workspace.
- Um domínio só aparece para a organização se estiver **licenciado**.

## 6. Documentos relacionados

- [`kernel.md`](./kernel.md) · [`licensing.md`](./licensing.md) ·
  [`workspaces.md`](./workspaces.md) · [`architecture.md`](./architecture.md)
