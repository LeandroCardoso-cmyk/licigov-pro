# Runbook — Migrations & Release Safety (Fase B)

> V1 PRE-PILOT CLOSURE — **RUNTIME & RELEASE SAFETY**. Este runbook descreve como o schema do
> banco muda com segurança no LiciGov Pro depois da Fase B.

## TL;DR

- **Toda mudança de schema mora em migration versionada** (`drizzle/*.sql`). Nada de DDL "mágico"
  em runtime.
- **Aplicar migrations** (staging/produção): `pnpm db:migrate:release` — idempotente, sob advisory
  lock. É o passo de RELEASE, feito **antes** do start da aplicação.
- **O boot NÃO muta o schema.** Ele valida (fail-closed em staging/produção) e sobe.
- **`pnpm db:push` é guardado** (dev/test-only; recusa em staging/produção/CI; `--force` só com
  `DB_PUSH_ALLOW_FORCE=yes` local).

---

## Por que mudou

Antes, o boot rodava um **reconciliador** (`ensureSchema` em `server/bootstrap.ts`) que executava
`ALTER TABLE` / `CREATE TABLE` / `RENAME COLUMN` a cada inicialização para "consertar" o banco, e o
script `db:push` usava `--force` (destrutivo). Isso significava: DDL mutável e potencialmente
destrutivo dirigido pelo runtime, sem versionamento nem revisão. A Fase B fecha isso:

1. A diferença que **só** o reconciliador fechava virou a migration versionada
   `drizzle/0297_phase_b_schema_closure.sql` (guardada, idempotente, preservadora de dados).
2. `ensureSchema` deixou de existir; o boot agora chama `validateSchema` (**detector**, não
   reconciliador).
3. `db:push --force` deixou de ser um caminho oficial.

---

## Comandos

| Objetivo | Comando |
|---|---|
| Gerar migration a partir do schema.ts | `pnpm db:generate` |
| **Aplicar migrations (RELEASE — staging/produção)** | `pnpm db:migrate:release` |
| Aplicar migrations (atalho local com drizzle-kit) | `pnpm db:migrate` |
| Auditar schema.ts × banco | `pnpm db:audit` |
| Push local (dev/test apenas, guardado) | `pnpm db:push` |
| Ver estado das migrations | tabela `__drizzle_migrations` no banco |

### Migration local (desenvolvimento)

```bash
# 1. Alterou drizzle/schema.ts? gere a migration:
pnpm db:generate
# 2. Aplique:
pnpm db:migrate         # ou: pnpm db:migrate:release (mesma segurança do release)
# 3. Suba a app:
pnpm dev
```

### Migration de release (staging/produção)

```bash
# Passo de RELEASE — roda ANTES do start da aplicação:
DATABASE_URL=... pnpm db:migrate:release
# Depois inicie a aplicação normalmente (o boot valida o schema e sobe).
```

`db:migrate:release`:

- aplica **apenas** migrations versionadas;
- é **idempotente** (o ledger `__drizzle_migrations` do Drizzle evita reaplicação);
- usa **advisory lock** (`GET_LOCK`/`RELEASE_LOCK`) — duas execuções concorrentes não corrompem o
  schema; a segunda espera (timeout limitado) e não aplica em paralelo;
- **falha (exit ≠ 0)** se qualquer migration falhar ou se o lock não for obtido — o erro não é
  engolido;
- **não** inicia a aplicação, **não** faz seed, **não** faz `db:push`, **não** reconcilia schema;
- **não** loga `DATABASE_URL`, senha, SQL sensível nem segredos.

---

## Comportamento do boot (schema drift)

O boot chama `validateSchema` (`server/bootstrap.ts`), que **não muta** nada:

- confere que o schema foi **inicializado por migrations** (a tabela de ledger `__drizzle_migrations`
  existe). **Não** confere a *contagem* de linhas do ledger: produção/staging deste projeto nasceram
  de `db:push` com o journal **baseline-stampado** — o ledger é legitimamente esparso (menos linhas
  que a cadeia) mesmo com o schema completo;
- confere a presença de **estruturas críticas** (multi-tenant, segurança da PR 0, acesso
  institucional, ciclo documental oficial, ingestão canônica) — este é o **sinal principal** de
  compatibilidade;
- **desenvolvimento** → apenas **avisa** (um banco local pode legitimamente estar atrás);
- **staging/produção** → **FAIL-CLOSED**: lança e a aplicação **não sobe** — nunca fica online num
  estado parcialmente compatível.

Se o boot falhar por schema incompatível/atrás em staging/produção: rode
`pnpm db:migrate:release` e reinicie. **Nunca** "conserte" o banco à mão em runtime.

---

## Guard do `db:push` (finding RUNTIME-02)

`pnpm db:push` passa por `scripts/db-push-guard.ts` e é **fail-closed**:

- recusado em `APP_ENV` staging/produção;
- recusado na CI;
- `--force` (destrutivo) recusado a menos que haja `DB_PUSH_ALLOW_FORCE=yes` (confirmação local
  explícita) — e nunca injeta `--force` implicitamente.

```bash
# Único jeito de forçar push local (dev), sabendo que pode perder dados locais:
DB_PUSH_ALLOW_FORCE=yes pnpm db:push --force
```

> Escopo honesto: nenhum guard de repositório impede um operador com credenciais de rodar
> `drizzle-kit push --force` **manualmente fora do repo**. O objetivo é tornar **todos os caminhos
> oficiais** do LiciGov Pro (package scripts, CI, runtime) fail-closed.

---

## Renames & preconditions

Renomear coluna nunca é tratado como DDL "simplesmente aditivo". A migration de closure
(`0297`) aplica a matriz de precondição para cada rename (guardada por `INFORMATION_SCHEMA`,
portável entre MySQL 8 e MariaDB — sem `IF [NOT] EXISTS`):

| origem (from) | destino (to) | ação |
|---|---|---|
| existe | ausente | renomeia (`RENAME COLUMN`, preserva dados/tipo/índices) |
| ausente | existe | **no-op** (já convergido) |
| existe | existe | **falha explícita** (ambíguo — nunca escolhe silenciosamente) |
| ausente | ausente | **falha explícita** |

O mesmo princípio vale para adições condicionais: só adiciona se a tabela existe e a coluna falta.

---

## Rollback / forward-fix

DDL no MySQL **não** tem rollback transacional confiável. Portanto:

- migrations de schema preferem mudanças **compatíveis e preservadoras de dados** (ADD/RENAME
  guardados; nenhuma faz `DROP` de dados);
- estados ambíguos **abortam** (precondition) antes de qualquer decisão destrutiva;
- o mecanismo seguro de correção é **forward-fix**: gere uma nova migration que corrige, em vez de
  tentar reverter;
- qualquer migration irreversível/destrutiva exige **backup e decisão explícita** antes — não faz
  parte do fluxo normal.

---

## Clean install × upgrade (provado na CI)

O smoke `reconciliation-mysql-smoke.test.ts` (gate MySQL da CI) prova contra um MySQL real:

- **CLEAN INSTALL** — a cadeia completa de migrations (incluindo a 0297) num banco zerado fecha o
  `schema.ts` em `0/0/0`, **sem** nenhuma reconciliação em runtime;
- **UPGRADE** — a partir do estado anterior à closure (0000..0296), aplicar a 0297 converge e
  **preserva dados**;
- **REPLAY** — reaplicar a 0297 num banco já convergido é no-op seguro (idempotente);
- **RENAME PRECONDITIONS** — os quatro estados da matriz acima.

Testes de contrato (sem DB) em `pr-b-runtime-release-safety.test.ts` travam: boot sem DDL mutável,
`decideSchemaValidation` fail-closed, guard do `db:push`, ausência de `push --force` em
scripts/CI, e o contrato de credencial por provider ativo.

---

## Railway Pre-Deploy — **DEFERIDO PARA A FASE X**

O comando de release (`pnpm db:migrate:release`) está pronto para ser configurado como o
**Pre-Deploy Command** do Railway (ou mecanismo equivalente realmente suportado), de forma que as
migrations rodem **antes** do start da aplicação, fora do boot.

Enquanto isso **não** é configurado externamente:

- o boot ainda aplica migrations versionadas como **ponte transitória** (sob o mesmo advisory lock),
  e depois valida;
- quando o Pre-Deploy for configurado (Fase X), a aplicação de migrations sai do boot e o boot passa
  a **apenas validar** (fail-closed).

> **RAILWAY PRE-DEPLOY CONFIGURATION — DEFERRED TO PHASE X.** Esta PR **não** altera configuração
> externa do Railway (nem região, réplicas, secrets ou produção).

Comando a configurar futuramente no Pre-Deploy:

```bash
pnpm db:migrate:release
```
