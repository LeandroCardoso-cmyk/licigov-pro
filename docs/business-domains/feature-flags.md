# Feature Flags — Governança de Funcionalidades

**Sprint 5.0.1 — Business Domain Architecture & Modular Licensing Foundation**

Toda funcionalidade do LiciGov Pro é governada por **feature flags**. Não
existem verificações de licença ou de disponibilidade espalhadas pelo código:
tudo passa pelo `featureFlagService`.

## 1. Princípio

> **Nunca checagens espalhadas.** Toda funcionalidade — domínio, tela, copiloto,
> workflow, documento, operação do Kernel — é governada por uma `featureFlag`
> avaliada por um único serviço: `featureFlagService`.

Isso torna o comportamento da plataforma **previsível, auditável e reversível**:
ligar/desligar uma capacidade é uma mudança de estado de flag, não uma alteração
de código espalhada.

## 2. Entidade `featureFlag`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | `char(64)` | ID SHA-256 determinístico. |
| `key` | `varchar` | Chave estável (ex.: `processo_licitatorio.dfd.generate`). |
| `description` | `text` | O que a flag controla. |
| `defaultState` | `boolean` | Estado padrão quando não há override. |
| `rolloutStrategy` | `json` | Estratégia de rollout (ver seção 4). |
| `ownerDomain` | `varchar` | Domínio dono da flag (ou `kernel`). |
| `createdAt` / `updatedAt` | `timestamp` | Auditoria. |

### Overrides por organização — `organization_features`

O estado efetivo de uma flag para uma organização vive em
`organization_features`:

| Campo | Descrição |
|-------|-----------|
| `organizationId` | Tenant. |
| `flagKey` | Chave da flag. |
| `enabled` | Estado efetivo para o tenant. |
| `source` | Origem (`license`, `admin`, `rollout`). |

Assim, o estado da flag para uma organização deriva de: **licença** (via
`licensedModule`), decisão administrativa, e estratégia de rollout.

## 3. `featureFlagService`

Serviço único de avaliação:

```ts
const enabled = await featureFlagService.isEnabled({
  organizationId,
  flagKey: "contratos.aditivo.generate",
});
if (!enabled) throw new TRPCError({ code: "FORBIDDEN" });
```

Operações:

| Operação | Descrição |
|----------|-----------|
| `isEnabled` | Avalia a flag para a organização (licença + override + rollout). |
| `listForOrganization` | Lista todas as flags efetivas de um tenant. |
| `setOverride` | Define override administrativo (`adminProcedure`). |
| `syncFromLicense` | Sincroniza flags a partir dos `licensedModule` ativos. |

Quando um módulo é ativado/desativado (ver [`licensing.md`](./licensing.md)), o
`moduleLicensingService` chama `syncFromLicense` — mantendo flags e licenças
sempre coerentes.

## 4. Rollout

`rolloutStrategy` permite liberar funcionalidades gradualmente sem deploy:

- **Global** — liga/desliga para todos.
- **Por organização** — lista de tenants habilitados.
- **Percentual** — habilita para X% das organizações (hash determinístico do
  `organizationId`, garantindo estabilidade e replay safety).
- **Por plano** — habilita conforme o `plan` do `licensedModule`.

O percentual usa o **mesmo esquema SHA-256 determinístico** do restante da
plataforma: a mesma organização sempre cai no mesmo "balde", evitando flutuação.

## 5. Relação com os pilares

- **Licenciamento** — módulos licenciados geram flags via `syncFromLicense`.
- **Navegação** — `domainNavigationService` monta menus consultando flags.
- **Kernel** — operações do Kernel podem ser protegidas por flags (`ownerDomain
  = kernel`); o `kernelAccessService` verifica a flag antes de executar.
- **Domínios** — cada capacidade de um domínio tem sua própria flag.

## 6. Anti-padrões proibidos

```ts
// ❌ PROIBIDO — checagem espalhada e hardcoded
if (organization.plan === "enterprise" && domain === "contratos") { ... }

// ❌ PROIBIDO — ler licença direto na tela
const canEdit = licensedModules.includes("parecer_juridico");

// ✅ CORRETO — sempre via featureFlagService
const canEdit = await featureFlagService.isEnabled({
  organizationId, flagKey: "parecer_juridico.edit",
});
```

## 7. Benefícios

- **Fonte única de verdade** para "isto está disponível?".
- **Auditoria** — toda avaliação/override é rastreável (Audit Engine).
- **Reversibilidade** — desligar uma feature é instantâneo e sem deploy.
- **Degradação graciosa** — se `getDb()` falhar, o serviço cai para
  `defaultState`, mantendo a plataforma operacional.

## 8. Documentos relacionados

- [`licensing.md`](./licensing.md) · [`kernel.md`](./kernel.md) ·
  [`architecture.md`](./architecture.md)
