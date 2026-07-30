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
| **security-audit** | Auditoria de dependências (transparente) | `pnpm audit --prod` | ⚠️ Não (advisory) |
| **deploy** | Preparação; confirma o artefato validado | `needs: [quality, test, mysql-smoke, build]` | — |

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

## Auditoria de dependências — por que é advisory

`pnpm audit --prod` revela **vulnerabilidades críticas/altas pré-existentes** em dependências
transitivas. Corrigi-las exige upgrades de dependências — fora do escopo do PR D e com risco de
regressão. O job roda o audit **completo e visível** (sem `|| true`), mas é marcado
`continue-on-error` (transparente, não bloqueia o gate de código). A correção está registrada
como **OPERATOR_ACTION_REQUIRED (SEC)** no [runbook de restore/ops](../ops/DB_RESTORE_RUNBOOK.md)
e no [resumo do PR D](../audits/production-readiness/PR_D_PRODUCTION_RESILIENCE.md).

## Observabilidade do gate

A falha de qualquer gate obrigatório aparece como **status do job** no GitHub Actions (vermelho,
anotado) e impede o job `deploy` (via `needs`) — nenhuma falha é mascarada.
