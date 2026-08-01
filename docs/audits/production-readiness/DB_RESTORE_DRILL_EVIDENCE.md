# Evidência — Drill de Restauração REAL (G11)

> Registro operacional do drill de restauração com **backup real**, executado inteiramente pelo
> workflow gated `db-backup.yml` (job `restore-drill`), em **banco MySQL descartável e isolado**
> (`RESTORE_TARGET_URL`) — nunca produção, nunca staging. **Nenhum dado, host, URL ou secret é
> exposto neste registro.**

## Resultado — `PASS`

| Campo | Valor |
|---|---|
| Workflow / run | `db-backup.yml` — "Backup do Banco (agendado + manual)" #8 (run id `30682397855`) |
| Branch / head | `claude/rebuild-licigov-pro-bFyTO` @ `b8ce558` |
| Data (UTC) | 2026-08-01 |
| Origem | backup **cifrado** de produção (somente leitura via `mysqldump --single-transaction`; **não modificada**) |
| Destino | banco MySQL **descartável e isolado** (`RESTORE_TARGET_URL`, endpoint público); **vazio** antes do restore |
| Criptografia | **AES-256-CBC / PBKDF2** (`openssl enc`) |
| Checksum SHA-256 (artifact) | `b882…685e` (conferido **antes** de decifrar) |
| Duração do drill | **770s** |
| **Tabelas restauradas** | **312** |
| **Migrations (journal `__drizzle_migrations`)** | **120** |
| Isolamento multi-tenant | **versões órfãs = 0 · mismatch tenant↔documento = 0** |
| Evidência publicada | artifact `restore-drill-evidence` (retenção 90 dias) |

## Validações executadas (todas ✅)

1. **Origem ≠ destino** (host+porta+banco distintos) — nunca restaurar sobre a origem.
2. **Destino acessível** e **vazio** (0 tabelas antes do restore) — salvaguarda contra alvo errado (prod/staging teriam tabelas).
3. **Checksum SHA-256** do artifact cifrado conferido **antes** de decifrar.
4. **Decifração** (AES-256-CBC/PBKDF2) somente no runner → **restore exclusivamente** no `RESTORE_TARGET_URL`.
5. **Schema restaurado** — 312 tabelas.
6. **Migrations aplicadas** — journal `__drizzle_migrations` com 120 registros.
7. **Tabelas essenciais** presentes e legíveis: `organizations`, `users`, `processes`, `documents`, `document_versions`, `activity_logs`, `official_documents`.
8. **Isolamento multi-tenant e consistência mínima** — órfãs=0, mismatch=0.
9. **Smoke funcional** — join canônico `documents ↔ document_versions` executa.

## Segurança da execução

- **Nenhum secret/host/URL/dado** impresso nos logs (secrets mascarados como `***`; só contagens/aggregates).
- **Nenhuma aplicação** conectada ao destino (apenas o cliente `mysql`).
- **Origem só-leitura** — o drill nunca escreve na origem.
- **Arquivos decifrados removidos** do runner (`rm`), que é efêmero; o banco de destino **não foi dropado** (exclusão do projeto Railway é **manual, pelo operador**).

## Ressalva — falso negativo de cleanup (não afeta o resultado)

O job terminou com status **"failure" (exit code 2)** por um **falso negativo posterior a TODAS as
validações**: a verificação final de cleanup (`ls *.sql.gz *.sql *.enc`) roda **depois** do `rm`;
sem correspondência, `ls` sai com código 2 e, sob `set -euo pipefail`, derruba o script — o que,
ironicamente, **confirma que o cleanup funcionou** (não havia mais arquivos). O **resultado
substantivo do drill é `PASS`** (backup → checksum → restore → validações → evidência).

**Correção preventiva:** commit **`0fd5099`** (`{ ls … || true; } | wc -l`) neutraliza o `ls` sem
correspondência mantendo a verificação. A correção **não** autoriza nova execução com dados reais;
a evidência original do run `30682397855` é **preservada e aceita**.

## Política de backup — nota

O artifact de backup tem **retenção de 14 dias** e criptografia at-rest — aceito para este drill
inicial. Isso **ainda não** representa a **política definitiva de backup institucional** (retenção
de longo prazo, rotação e cofre off-site permanecem como follow-up).
