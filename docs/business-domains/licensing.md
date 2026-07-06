# Licenciamento Modular

**Sprint 5.0.1 — Business Domain Architecture & Modular Licensing Foundation**

O **Licenciamento Modular** é o terceiro pilar da arquitetura. Ele permite que
cada organização (prefeitura, órgão) contrate **apenas os domínios de negócio
que precisa** — e a plataforma se adapta automaticamente ao conjunto licenciado.

## 1. Princípio

> Uma prefeitura pode contratar **só** Processo Licitatório. Outra, **só**
> Contratos. Outra, **todos** os domínios. A plataforma adapta menus,
> navegação, permissões, copilotos, workflows e documentos automaticamente.

O Kernel Cognitivo é sempre o mesmo e completo — o que muda é **quais domínios
estão liberados** para aquela organização.

## 2. Entidade `licensedModule`

Registra a licença de um módulo (domínio) para uma organização.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | `char(64)` | ID SHA-256 determinístico. |
| `organizationId` | `char(64)` | Tenant licenciado. |
| `domainSlug` | `varchar` | Domínio licenciado (ex.: `contratos`). |
| `plan` | `varchar` | Plano contratado (ver seção 4). |
| `status` | `enum` | `active` / `suspended` / `expired` / `pending`. |
| `activatedAt` | `timestamp` | Data de ativação. |
| `expiresAt` | `timestamp` | Data de expiração/renovação. |
| `metadata` | `json` | Limites, add-ons, observações. |

Dependências entre módulos vivem em `moduleDependency` (ex.: um módulo pode
exigir que outro esteja ativo). O `moduleLicensingService` valida essas
dependências antes de ativar/desativar.

## 3. `moduleLicensingService`

Serviço responsável por todo o ciclo de vida da licença:

| Operação | Descrição |
|----------|-----------|
| **Ativação** | Ativa um módulo para a organização; valida dependências (`moduleDependency`) e provisiona feature flags. |
| **Bloqueio/Suspensão** | Suspende o acesso (ex.: inadimplência) sem apagar dados. |
| **Renovação** | Estende `expiresAt`; reativa se estava expirado. |
| **Consulta** | Retorna os módulos ativos da organização. |

Regra de ouro: **nenhuma verificação de licença é feita de forma espalhada no
código**. Toda checagem passa por `featureFlagService` (ver
[`feature-flags.md`](./feature-flags.md)), que por sua vez reflete o estado do
`licensedModule`.

## 4. Planos

Os planos determinam a profundidade de cada domínio licenciado. Exemplos
ilustrativos (definição comercial final fora do escopo desta sprint):

| Plano | Característica |
|-------|---------------|
| `essencial` | Domínio com funcionalidades base habilitadas. |
| `profissional` | Copilotos avançados e integrações (CATMAT/CATSER). |
| `enterprise` | Todos os domínios + governança e explainability plenos. |

O plano é armazenado em `licensedModule.plan` e traduzido em conjuntos de
`featureFlag`.

## 5. Router — `moduleLicensingRouter`

| Procedure | Função |
|-----------|--------|
| `listModules` | Lista módulos disponíveis na plataforma. |
| `activateModule` | Ativa um módulo para a organização. |
| `deactivateModule` | Desativa/suspende um módulo. |
| `listFeatures` | Lista features de um módulo. |
| `validateLicense` | Valida a licença (status, expiração, dependências). |
| `getOrganizationModules` | Retorna os módulos licenciados da organização. |

`activateModule` e `deactivateModule` são operações administrativas
(`adminProcedure`); as demais são `protectedProcedure`.

## 6. Cenários — prefeituras com módulos diferentes

**Prefeitura A — só Processo Licitatório**
```
licensedModule: [ processo_licitatorio(active) ]
Home mostra: apenas o card "Processo Licitatório".
Menus, copilotos e workflows de contratos/parecer NÃO aparecem.
```

**Prefeitura B — só Contratos**
```
licensedModule: [ contratos(active) ]
Home mostra: apenas "Contratos e Aditivos".
```

**Prefeitura C — todos os domínios**
```
licensedModule: [ processo_licitatorio, contratacao_direta, contratos,
                  parecer_juridico, gestao_departamento ]  (todos active)
Home mostra: os 5 cards, com navegação completa.
```

Em todos os casos, **o mesmo Kernel** serve as três organizações — nenhuma
infraestrutura é duplicada.

## 7. Adaptação automática da plataforma

A partir do conjunto de `licensedModule` ativos, o `domainNavigationService`
constrói dinamicamente:

- **Home / Business Domain Portal** — mostra apenas módulos licenciados.
- **Menus e navegação** — só rotas dos domínios ativos.
- **Permissões** — combinadas com o RBAC da organização.
- **Copilotos e workflows** — só os dos domínios ativos.
- **Documentos** — só os modelos dos domínios ativos.

Nada disso é codificado manualmente por tela: tudo deriva do estado de licença +
feature flags.

## 8. Documentos relacionados

- [`feature-flags.md`](./feature-flags.md) · [`domains.md`](./domains.md) ·
  [`workspaces.md`](./workspaces.md) · [`architecture.md`](./architecture.md)
