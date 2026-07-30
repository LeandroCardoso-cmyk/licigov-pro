# CI/CD — Arquitetura de Gates e Deploy (PR D)

> Fonte da verdade dos gates que precedem o deploy. Substitui o gate simbólico anterior
> (o "build" era apenas um `echo`). Workflow: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

## Gatilhos

- `push` na `main` e `pull_request` para `main`.
- `concurrency` cancela runs antigos do mesmo ref.
- Node **22** (fixado em `.nvmrc` e `engines` do `package.json`); pnpm via `corepack`
  (versão do `packageManager`), instalação com `--frozen-lockfile` (reproduzível).

## Matriz de gates

| Job | O que executa | Comando | Bloqueia deploy? |
|---|---|---|:--:|
| **quality** | Typecheck real + lint de não-regressão | `pnpm check` + `eslint <arquivos alterados> --max-warnings 0` | ✅ Sim |
| **test** | Suíte automatizada completa | `pnpm test` | ✅ Sim |
| **mysql-smoke** | Smokes MySQL reais + **isolamento multi-tenant/RBAC** | reconciliação, consulta, criação de processo + `pnpm test:smoke:security` | ✅ Sim |
| **build** | Build de produção real + artefato | `pnpm build` → `dist/` | ✅ Sim |
| **security-audit** | Auditoria de deps com baseline (bloqueia NOVA high/critical) | `pnpm audit:gate` | ✅ Sim |
| **deploy** | Preparação; confirma o artefato validado | `needs: [quality, test, mysql-smoke, build, security-audit]` | — |

O job **deploy** só roda em `main` e **só depois** de todos os gates obrigatórios passarem
(`needs`). Ele não faz deploy em produção — a plataforma (Railway) faz o deploy efetivo; este job
comprova a prontidão e publica o artefato `dist/` validado.

## Regras (o que mudou no PR D)

- **Sem `|| true`** em gate obrigatório; **sem** mascarar exit codes.
- Build e typecheck são **comandos reais** capazes de falhar o pipeline.
- Smokes de **isolamento multi-tenant** entraram no gate (antes ficavam fora do CI) — G7.
- O CI da PR **valida** a mudança, mas **não** faz deploy de produção.

## Lint — regra de transição (não-regressão)

A base tem dívida herdada de lint (~357 erros + ~653 warnings: `no-unused-vars`, `no-explicit-any`,
`no-console`, concentrados em scripts e testes — nenhum em rota de produção). Em vez de mascarar
ou exigir uma faxina ampla fora de escopo, o gate exige **zero problema apenas nos arquivos
`.ts/.tsx` alterados** (diff vs. a branch base). 

**Caminho para o gate completo** (`eslint . --max-warnings 0`), fora do PR D:
1. Zerar `no-unused-vars` (357) — em geral remoção mecânica de imports/vars.
2. Tratar `no-console` (100) — trocar por `serviceLogger`/`structuredLog` onde fizer sentido.
3. Reduzir `no-explicit-any` (552) — tipagem incremental por módulo.
Quando a base ficar limpa, trocar o passo de não-regressão por `pnpm lint` completo.

## Auditoria de dependências — gate de não-regressão (baseline)

`pnpm audit --prod` revela **vulnerabilidades críticas/altas pré-existentes** em dependências
transitivas (3 críticas + 45 altas). Corrigi-las exige upgrades — fora do escopo do PR D. Em vez de
mascarar (`|| true`) ou bloquear no que já existe, o gate usa um **baseline auditável**
([`security/audit-baseline.json`](../../security/audit-baseline.json), 40 GHSA): `pnpm audit:gate`
(`scripts/audit-gate.mjs`) roda o audit, imprime o resumo e **FALHA em qualquer NOVA high/critical
fora do baseline** — sem regressão silenciosa. Triagem em
[`docs/ops/DEPENDENCY_AUDIT_TRIAGE.md`](../ops/DEPENDENCY_AUDIT_TRIAGE.md). Reduzir o baseline via
upgrades é **OPERATOR_ACTION_REQUIRED (SEC)**. O baseline nunca deve crescer silenciosamente
(adicionar um GHSA exige justificativa explícita no arquivo).

## Gate de deploy real — Railway e required checks (ação operacional)

O `needs` do job `deploy` garante a ordem **dentro** do workflow, mas **por si só não bloqueia** um
deploy do Railway nem um merge na `main`. Para que os gates sejam de fato obrigatórios, é necessária
configuração operacional (fora do que o código controla):

1. **Branch protection na `main`** (GitHub → Settings → Branches): marcar como **required status
   checks** os jobs `Typecheck + Lint (gate)`, `Testes Automatizados (gate)`,
   `Smoke MySQL + Isolamento (gate)`, `Build de Produção (gate)` e
   `Auditoria de Dependências (gate de não-regressão)`. Assim nenhum merge ocorre com gate vermelho.
2. **Railway "Wait for CI"** (Railway → Service → Settings → Deploys): habilitar *Check Status /
   Wait for CI* para que o deploy só dispare após os checks do GitHub passarem. Sem essa opção, o
   Railway faz deploy no push independentemente do CI — o `needs` do workflow **não** o impede.
3. **Healthcheck do Railway:** `deploy.healthcheckPath` = `/readyz` já está declarado em
   [`railway.json`](../../railway.json); confirmar no painel que o healthcheck aponta para `/readyz`.

> **Não afirmar** que o deploy está bloqueado apenas porque o job `deploy` tem `needs`: o bloqueio
> efetivo depende de (1) e (2) acima, que são ação operacional no GitHub e no Railway.

## Observabilidade do gate

A falha de qualquer gate obrigatório aparece como **status do job** no GitHub Actions (vermelho,
anotado) e impede o job `deploy` (via `needs`) — nenhuma falha é mascarada.
