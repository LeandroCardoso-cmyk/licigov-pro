# G5 — Auditoria de Prontidão de Segredos (2026-09-20)

### LiciGov Pro · Gate de Produção Interna · item G5 ("Segredos fora do repositório e rotacionados")

> **Nenhum valor de segredo aparece neste documento.** A auditoria usa apenas **nomes de variáveis**,
> **formatos** e **presença** — jamais valores. Este documento não altera código nem produção.

## Escopo

Auditar, de forma auditável e não-destrutiva, se os segredos do LiciGov Pro estão fora do repositório
e se os segredos comprometidos foram/ deverão ser rotacionados — condição de PASS do G5. Complementa
(não substitui) o runbook operacional já existente
[`PR_A_SECRET_ROTATION_RUNBOOK.md`](./PR_A_SECRET_ROTATION_RUNBOOK.md).

## Evidência do repositório (verificável, read-only)

| Verificação | Resultado |
|---|---|
| `.env`, `.env.local`, `.env.*.local` no `.gitignore` | **SIM** (`.gitignore` linhas 11–15) |
| Arquivos `.env*` rastreados no HEAD | Apenas **`.env.example`** (template) — nenhum `.env` real rastreado |
| `.env.example` contém valores reais (AIza/sk-/AKIA/base64 longo) | **NÃO** — somente placeholders |
| Segredos de alta entropia hardcoded em `server/**` (fora de teste) | **NENHUM** (único match é fixture **falso** em `failure-message-sanitize.test.ts`, usado para testar a redação) |
| `mysql://` com credenciais inline em código de produção | **NENHUM** — os matches são **hints/exemplos** (`server/config/env.ts`), **comentário de redação** (`cognitiveProvenance.ts`) e docstring de `scripts/bootstrap-admin.ts`; CI usa `root:root@localhost` (serviço efêmero) |
| Config lê de `process.env` via `server/config/*` (fonte única) | **SIM** |
| Fail-closed em produção/staging (sem default inseguro) | **SIM** — `server/config/auth.ts` **lança** se `JWT_SECRET` ausente; `ADMIN_PASSWORD` obrigatória (CONFIG-005); default de TTL de 1 ano removido; `ALLOW_PUBLIC_REGISTRATION` default `false` |
| Diagnóstico de presença sem exibir valor | **SIM** — `environmentDiagnostic()` retorna `present: boolean` (`server/config/env.ts`) |

## Exposição histórica (incidente já catalogado — SEC-018)

Um `.env` de 7 linhas foi **adicionado** em `195d895` (#172) e **removido do índice** em `9e0c17d`
(PR A #185). O histórico do Git **ainda contém** o blob (não há reescrita de histórico). Auditoria
independente do blob (apenas nomes/formatos, **sem valores**):

| Variável versionada | Classificação da auditoria | Ação |
|---|---|---|
| `NODE_ENV`, `PORT` | Não são segredos | — |
| `DATABASE_URL` | **Sem** credenciais inline (URL curta, estilo host/dev) | Rotacionar por precaução (P2) |
| `JWT_SECRET` | **Alta entropia, aparenta REAL** (48 chars) | **Rotacionar — P1 (crítico)** |
| `GEMINI_API_KEY` | **Placeholder** (19 chars; não casa com formato `AIza…`) | Já rotacionada (ver G12) |

Isto coincide exatamente com o runbook existente (JWT_SECRET P1, DATABASE_URL P2, GEMINI_API_KEY P3),
que já traz a ordem segura de rotação, validação por presença e invalidação do valor anterior.

## Estado por critério de PASS do G5

1. Segredos ativos não versionados — **ATENDIDO** (apenas `.env.example`).
2. Credenciais comprometidas rotacionadas/revogadas — **PARCIAL**: `GEMINI_API_KEY` **rotacionada e
   validada em staging** (G12); **`JWT_SECRET` e `DATABASE_URL` dependem de rotação/confirmação
   operacional no Railway/provedor** (não verificável pelo repositório).
3. Config produtiva depende de env/secret store — **ATENDIDO**.
4. Sem defaults inseguros em produção — **ATENDIDO** (fail-closed).
5. Runbook de rotação/recuperação — **ATENDIDO** (`PR_A_SECRET_ROTATION_RUNBOOK.md`).
6. Evidência auditável — **ATENDIDO** (este documento).
7. Nenhum segredo no commit da correção — **ATENDIDO** (mudança documental).

## Classificação e bloqueio

**G5 = PARTIAL (bloqueante).** O lado de **código está completo** (`CODE_COMPLETE`); o lado
**operacional** permanece `OPERATOR_ACTION_REQUIRED` / `VERIFICATION_REQUIRED` para `JWT_SECRET` e
`DATABASE_URL`. **Não é promovido a PASS por inferência** e a rotação **não foi executada aqui**
porque é ação irreversível que afeta produção (invalida sessões / troca credencial de banco) e
depende de credenciais externas fora do controle do repositório — conforme a regra "PARE antes da
mutação irreversível".

## Condição objetiva de PASS (checklist do operador)

Executar conforme [`PR_A_SECRET_ROTATION_RUNBOOK.md`](./PR_A_SECRET_ROTATION_RUNBOOK.md) e atestar:

- [ ] `JWT_SECRET` rotacionado no Railway (novo ≥32 chars); relogin exigido confirmado (sessões antigas invalidadas).
- [ ] `DATABASE_URL` rotacionado no provedor + Railway; boot/health OK após a troca.
- [ ] `GEMINI_API_KEY` — chave antiga **revogada** no console (nova já ativa/validada — G12).
- [ ] `ADMIN_PASSWORD` forte definida (G4 já PASS) — reconfirmar.
- [ ] Credenciais AWS rotacionadas **se** algum dia versionadas (não constavam no `.env` auditado).
- [ ] Verificação **por presença** via `environmentDiagnostic()` (`present: true`, sem exibir valores).

**Atestação do operador (preencher para fechar G5):** responsável __________ · data __________ ·
método de verificação (presença + relogin + health) __________. Somente após esta atestação o G5
passa a **PASS** no `INTERNAL_PRODUCTION_GATE.md`.

---

## Adendo — Atestação da rotação do JWT_SECRET (2026-09-21)

Rotação operacional **executada pelo operador** (owner) no Railway e **validada** por este agente via
Railway MCP + confirmação de login do operador. **Nenhum valor de segredo passou por este agente**,
foi impresso, lido ou persistido — somente metadata abaixo.

```
secretName:            JWT_SECRET
rotationStatus:        completed
environment:           production
projectId:             893a1317-51ad-4b18-9d9a-f6e579e09351
serviceId:             2d497607-3208-4996-9295-0f919b6a93bd   (web: licigov-pro)
environmentId:         3efa7f99-8641-48e1-ad33-3c98bf5e91c7
baselineDeploymentId:  baf6c189-e1b5-427f-aa65-7d0e651e25e0   (REMOVED após a rotação)
newDeploymentId:       120edffb-7e75-499c-925c-85e7b689fb6e   (SUCCESS, commit 751b120)
timestamp:             2026-09-21T01:06:13Z (deploy) / 01:08:54Z (boot pronto)
readyz:                PASS   (healthcheckPath=/readyz gatilho do SUCCESS)
database:              PASS   (readyz + boot "Schema validado")
loginSmoke:            PASS   (operador autenticou com sessão nova; sessões antigas invalidadas)
bootFailClosed:        OK     (boot concluiu → JWT_SECRET presente/válido; sem fallback/default)
referenceInstaller:    noop / replay-safe (contentHash 332a9cb3…196832; NÃO ativado)
oldSecretInvalidated:  true
rollbackRequired:      false
operator:              leandrocardoso-cmyk (owner)
```

**Critérios de PASS do G5 — todos atendidos:** (1) novo `JWT_SECRET` em produção; (2) segredo
histórico deixou de ser ativo (relogin exigido/confirmado); (3) deployment SUCCESS; (4) `/readyz`
PASS; (5) database PASS; (6) nova autenticação PASS; (7) config fail-closed mantida; (8) nenhuma
credencial exposta durante a operação; (9) evidência registrada sem segredo.

**Classificação: G5 = PASS.** (`DATABASE_URL` histórica sem credencial inline; `GEMINI_API_KEY` já
rotacionada — G12. Segue como boa prática operacional revogar/expirar credenciais antigas nos
respectivos consoles, follow-up não bloqueante.)
