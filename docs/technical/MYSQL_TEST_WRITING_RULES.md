# Regras para escrever testes (MySQL real e "sem banco")

Origem: *test baseline hardening* — 49 falhas preexistentes em 16 arquivos eram, todas, defeitos de **isolamento de teste**, não de produto.
Estas regras existem para que a suíte seja repetível (mesmo banco reutilizado), independente de ordem e segura em paralelo.

## Como a suíte roda

| Contexto | Banco | Quem roda |
|---|---|---|
| `pnpm test` (job "Testes Automatizados") | **sem** `DATABASE_URL` | tudo; os smokes `*-mysql-smoke` ficam `skipIf(!DATABASE_URL)` |
| Job "Smoke MySQL + Isolamento" | MySQL efêmero | arquivos listados no `ci.yml`, um passo por arquivo |
| Local com `DATABASE_URL` | MySQL local, **reutilizado** | `pnpm vitest run` (paralelo) deve passar também |

## Regras

1. **Sujeito único por cenário.** Um teste não pode depender de um identificador que fique ocupado por uma execução anterior
   (`COUNT(*) = 0`, `revision = 1`, id/número de processo fixo). Derive ids de `RUN`/`STAMP` ou crie um sujeito novo por cenário.
2. **Idempotência: estável no cenário, distinta entre execuções.** `idempotency_keys` retém a resposta por 24 h. Uma chave fixa
   (`smoke-dfd-400-2026`) ou derivada só de (org, id) faz a 2ª execução ser um *replay* da 1ª. Inclua o `RUN` na chave; o replay
   que o teste quer provar usa a MESMA chave **dentro** do cenário.
3. **Fixtures escopadas por tenant.** Limpeza só nos orgs/sujeitos do arquivo (`WHERE organization_id IN (...)`), nunca
   `DELETE FROM tabela` nem apagar flag/linha de outro tenant. `cleanupOrgs` (helpers) já cobre ledgers por tenant, inclusive `idempotency_keys`.
4. **Ids de órgão fixos são únicos entre arquivos** (guarda: `mysql-smoke-isolation-guards.test.ts`). Os smokes de Modelos têm faixa própria
   (`BASE_ORG = <faixa> + (STAMP % 20_000) * 100`); novos arquivos escolhem uma faixa livre.
5. **Estado global ⇒ exclusão mútua explícita.** Tabelas sem `organization_id` (ex.: `legal_reference_*`) só podem ser mutadas por um
   arquivo por vez: `useGlobalFixtureLock("legal_reference")` (GET_LOCK do MySQL). Só os arquivos que declaram o recurso se serializam;
   o resto da suíte continua paralelo. Não use `--no-file-parallelism` global para esconder colisão.
6. **Sem contador GLOBAL do servidor.** `SHOW GLOBAL STATUS` (ex.: `Com_select`) conta o MySQL inteiro e quebra em paralelo. Meça o
   que o **app** faz (ex.: contar `query/execute/getConnection` do pool de `getDb()`).
7. **Testes "sem banco" não dependem do ambiente.** Chame `useNoDatabase()` no topo do arquivo: `DATABASE_URL` fica vazia durante os
   testes (e é restaurada). Do contrário, com MySQL presente, o teste afirma "sem banco" contra um banco real **e escreve nele**.
8. **Restaure tudo que trocar.** Relógio (`clock` das ports), `configureTemplateCompositionPorts`, `db.transaction`, env, mocks:
   sempre em `finally`/`afterEach`. Um teste não pode deixar estado para o seguinte.
9. **Harness fiel ao contrato.** O `ctx` de teste precisa ter o contrato mínimo que o router usa (ex.: `res.cookie` no aceite de convite).
10. **Guardas estruturais testam o invariante**, não a posição textual de uma implementação.

## Reproduzir limpo / sujo

```bash
# banco limpo
mysql -uroot -e "CREATE DATABASE licigov_clean CHARACTER SET utf8mb4"
DATABASE_URL=mysql://root:root@127.0.0.1:3306/licigov_clean pnpm db:migrate:release
DATABASE_URL=mysql://root:root@127.0.0.1:3306/licigov_clean pnpm vitest run
# 2ª execução sobre o MESMO banco (deve passar sem limpeza manual)
DATABASE_URL=mysql://root:root@127.0.0.1:3306/licigov_clean pnpm vitest run
```
