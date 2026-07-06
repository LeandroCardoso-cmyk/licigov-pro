# Workspaces Independentes

**Sprint 5.0.1 — Business Domain Architecture & Modular Licensing Foundation**

O quarto pilar da arquitetura: **cada Domínio de Negócio possui seu próprio
Workspace**. Workspaces nunca são compartilhados entre domínios. Toda
reutilização acontece **via Kernel**, jamais por acoplamento entre workspaces.

## 1. Princípio

> Cada Business Domain define um **Workspace próprio**. Nunca compartilhado.
> Reutilização só via Kernel.

Isso garante isolamento funcional: o trabalho no Processo Licitatório não
"vaza" para Contratos, e vice-versa — mesmo que ambos usem os mesmos serviços do
Kernel por baixo.

## 2. Entidade `domainWorkspace`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | `char(64)` | ID SHA-256 determinístico. |
| `organizationId` | `char(64)` | Tenant proprietário. |
| `domainSlug` | `varchar` | Domínio dono do workspace (ex.: `parecer_juridico`). |
| `workspaceType` | `varchar` | Tipo do workspace (derivado do `businessDomain`). |
| `state` | `json` | Estado próprio do workspace do domínio. |
| `status` | `enum` | `provisioning` / `ready` / `archived`. |
| `createdAt` / `updatedAt` | `timestamp` | Auditoria. |

O `domainWorkspaceService` provisiona, abre e arquiva workspaces. Cada par
`(organizationId, domainSlug)` tem **um** workspace exclusivo.

## 3. Por que workspaces não são compartilhados

| Se fossem compartilhados | Com workspaces próprios |
|--------------------------|-------------------------|
| Acoplamento entre domínios | Isolamento funcional total |
| Um bug em Contratos afeta Licitações | Falhas contidas por domínio |
| Permissões emaranhadas | Permissões por domínio |
| Difícil licenciar módulos separados | Licenciamento modular limpo |

O compartilhamento existe **apenas no Kernel** — que é infraestrutura, não
espaço de trabalho.

## 4. Reutilização acontece via Kernel — nunca entre workspaces

Quando um domínio precisa de algo produzido "em outro lugar" (ex.: Contratos
reaproveitar dados do Processo Licitatório), o caminho **nunca** é acessar o
workspace do outro domínio diretamente. O fluxo correto é:

```
Workspace(Contratos)
      │  precisa reaproveitar dados de processo
      ▼
kernelAccessService  ──►  Kernel (Knowledge Graph / Semantic Memory /
                                   Document Engine / Timeline)
      ▼
dado recuperado devolvido ao Workspace(Contratos)
```

Assim, a reutilização é **mediada e auditada** pelo Kernel, preservando o
isolamento dos workspaces e a rastreabilidade obrigatória (Audit Engine).

## 5. Relação com o Cognitive Procurement Workspace (Sprint 5.0)

Na **Sprint 5.0** foi introduzido o **Cognitive Procurement Workspace** — o
ambiente cognitivo unificado de trabalho, apoiado pelos serviços do Kernel
(copilotos, RAG, timeline, explainability).

Na **Sprint 5.0.1**, esse conceito é **generalizado**:

- O Cognitive Procurement Workspace deixa de ser um workspace único e passa a
  ser o **modelo de workspace** que cada domínio instancia como o **seu**
  `domainWorkspace`.
- Cada domínio recebe a mesma potência cognitiva (via Kernel), mas em um espaço
  **próprio e isolado**.
- O "workspace de procurement" original corresponde, na prática, ao workspace do
  domínio **Processo Licitatório** — os demais domínios ganham workspaces
  equivalentes, cada um com seu `workspaceType`.

Ou seja: 5.0 entregou o **conceito** de workspace cognitivo; 5.0.1 o transforma
em um **padrão replicável por domínio**, sem duplicar infraestrutura.

## 6. Ciclo de vida (`domainWorkspaceService`)

| Operação | Descrição |
|----------|-----------|
| `provision` | Cria o workspace de um domínio para a organização (`provisioning` → `ready`). |
| `launch` | Abre o workspace (usado por `businessDomainRouter.launchWorkspace`). |
| `getState` | Retorna o estado próprio do workspace. |
| `archive` | Arquiva o workspace (ex.: módulo desativado). |

O provisionamento é **idempotente** graças aos IDs SHA-256 determinísticos: o
mesmo `(organizationId, domainSlug)` sempre resolve o mesmo `id`, garantindo
replay safety.

## 7. Regras invioláveis

- Um workspace pertence a **exatamente um** domínio.
- Nenhum workspace lê/escreve diretamente em outro workspace.
- Toda reutilização cross-domínio passa pelo **Kernel**.
- Workspaces respeitam licença: sem `licensedModule` ativo, não há workspace
  acessível.

## 8. Documentos relacionados

- [`domains.md`](./domains.md) · [`kernel.md`](./kernel.md) ·
  [`licensing.md`](./licensing.md) · [`architecture.md`](./architecture.md)
