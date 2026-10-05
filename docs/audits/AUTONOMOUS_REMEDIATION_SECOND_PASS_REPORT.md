# Relatório do 2º passe de remediação autônoma — exaustão técnica

> Branch `work/autonomous-semantic-remediation-r3-r11` · base `main` `aac42411f86dd482684c5017867322d64ff5d730` · 2026-10-05 · head `22d0ed8` (+ commit de docs) · 63 commits à frente / 0 atrás da `main`.
> **Estado da branch: LOCAL_CANDIDATE.** Não é MERGED, não é DEPLOYED, não é VALIDATED_PRODUCTION.
> **Sem PR · sem merge · sem deploy · sem force-push · sem `--no-verify` · produção intocada · processo real 2026/253 intocado · nenhum dado real.**
> Baseline `SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md` sha256 `08edc7344c9038889978e1b2f9204f4fd523e3fef36e6b29b47ff324ae0810b3` — conferido no início e **ao fim do gate: inalterado**.

## 1. Escopo e regras aplicadas

Continuação exata da branch existente (HEAD inicial `5081ec7c…`, `main` `aac42411…`, 50 à frente / 0 atrás, 0 PRs abertas — tudo conferido), sem refazer o que já estava DONE.
Fora de escopo por instrução: decisões HD-01/03/06/07/08/09/13/14/15 (e `drizzle/policy-pending/*` permanece pendente), decisões jurídicas (SEM-004, 010, 011, 033, 059, 063, 082, limites do SEM-084, SEM-091),
correção de NEW-037, qualquer acesso à produção. Regras de arquitetura: só persistência determinística dentro de transação (IA e chamadas remotas fora); IA sempre sugestão até aceite humano;
chave de idempotência presa à operação (reuso incompatível = CONFLICT); timeline com um id por evento e ator humano `user:<id>`; autoridade a montante emitido > aprovado > rascunho; estimativas de valor escritas pelo servidor.

## 2. Mapa de commits (sobre `5081ec7`)

| Commit | Conteúdo | Achados | Migration |
|---|---|---|---|
| `23554f3` | agregações de contratação direta sem filtro de órgão removidas | NEW-034 | — |
| `446171e` | infra de teste determinística; contadores escopados | NEW-033, NEW-031 | — |
| `5d97fec` | justificativa de preço com lineage do servidor; status derivado dos atos | SEM-042, 064 | — |
| `ac51bfd` | ledger append-only de artefatos por formato | SEM-043 | **0315** |
| `27e9992` | sequência atômica de aditivos; lineage por instrumento; herança; chave HMAC própria | SEM-084, 040, 062, 083 | — |
| `d6904da` | governança fail-closed; quantidade prevista; marcador de edição humana; emissão do processo; chave lógica | SEM-050 (leitura), 037, 038, 044, 045, 087B, 089, 090 | — |
| `bc74f6f` | superfícies legadas e hardening de tenant | SEM-034, 036, 046, 073, 077, 078, 079, 086, 088, 092 | — |
| `4037745` | sugestão da IA ≠ decisão; rótulos = efeito | SEM-058, 060, 061 | — |
| `abc2a69` | valor do contrato avulso em reais | NEW-038 | — |
| `35a6c6d` | guardas R11 comportamentais + fiação no CI e no `test:smoke:security` | R11 | — |
| `df1a717` | total global parcial rotulado PARCIAL | SEM-081 | — |
| `988e555` | UI de resolução humana da identidade do item | SEM-054 (UI) | — |
| `22d0ed8` | corrige o smoke C.4B.3B (SEM-044); renomeia labels R11-B1…B7 | — | — |
| (docs) | este relatório e as atualizações de R9/R10/matrizes/bloqueios/decisões/reauditoria | — | — |

Detalhe por commit (testes, dependências): `AUTONOMOUS_REMEDIATION_COMMIT_MAP.md` (linhas 32–45).

## 3. Migration

**0315 `official_document_artifacts`** — única migration do 2º passe. Aditiva e append-only: tenant, documento, lineage, versão, formato, `artifact_hash`, tamanho, mime, `storage_key`,
`source_content_hash`, `source_replay_hash`, `identity_fingerprint`, `correlation_id`, `created_by = user:<id>`; `UNIQUE(tenant_id, document_id, format, artifact_hash)`.
Rollback: `DROP TABLE official_document_artifacts` (nenhum dado de outra tabela depende dela). As colunas legadas `storage_key`/`mime_type`/`size_bytes`/`content_hash` de `official_documents`
deixam de ser escritas (o export de um formato não sobrescreve mais o de outro). Journal idx 315 com snapshot; ledger 316 = journal 316 no MySQL 8 limpo. **Nunca aplicada em produção.**

## 4. DONE / PARTIAL / BLOCKED

Placar dos 66 achados do plano (54 P1 + 12 P2): **47 IMPLEMENTED_PENDING_REVIEW · 8 PARTIAL_LOCAL · 2 BLOCKED_HUMAN_DECISION · 5 BLOCKED_LEGAL_REVIEW · 4 OPEN dependentes de R2.3**.
"IMPLEMENTED_PENDING_REVIEW" = implementado e testado localmente, **sem** revisão humana, merge ou validação em produção.

### 4.1 P1 (54)

| SEM | Estado | Detalhe |
|---|---|---|
| SEM-027 | BLOCKED_HUMAN_DECISION | (HD-13: método institucional do valor de referência) |
| SEM-028 | IMPLEMENTED_PENDING_REVIEW | `c7e6921` |
| SEM-029 | IMPLEMENTED_PENDING_REVIEW | `c7e6921` |
| SEM-030 | IMPLEMENTED_PENDING_REVIEW | `c7e6921` |
| SEM-031 | IMPLEMENTED_PENDING_REVIEW | `c7e6921` |
| SEM-032 | OPEN (depende de R2.3) | — depende de R2.3 e de migration (`contractedValue`); PR-14 já rotula "valor estimado" nas saídas legadas |
| SEM-033 | BLOCKED_LEGAL_REVIEW | (limites — J-2) |
| SEM-034 | IMPLEMENTED_PENDING_REVIEW | `bc74f6f` (escritores não-escopados não exportados + guard estático; callers legados desligados por LEG-005) |
| SEM-035 | IMPLEMENTED_PENDING_REVIEW | `a05debe` |
| SEM-036 | IMPLEMENTED_PENDING_REVIEW | `bc74f6f` (+ LEG-009): nenhum caller montado; assistente de IA não alimenta `estimatedValue || 0` |
| SEM-039 | IMPLEMENTED_PENDING_REVIEW | `d5d9309` |
| SEM-040 | PARTIAL_LOCAL | `27e9992` (lineage própria por instrumento NOVO; backfill das versões existentes: BLOCKED_HUMAN_DECISION) |
| SEM-041 | IMPLEMENTED_PENDING_REVIEW | `c875b5c` |
| SEM-042 | IMPLEMENTED_PENDING_REVIEW | `5d97fec` (justificativa de preço com lineage do servidor; `characterizeNeed`/`importDFD` recusam com código estável por falta de tabela de persistência) |
| SEM-043 | IMPLEMENTED_PENDING_REVIEW | `ac51bfd` (migration 0315: ledger append-only de artefatos por formato) |
| SEM-047 | IMPLEMENTED_PENDING_REVIEW | `d5d9309` |
| SEM-048 | IMPLEMENTED_PENDING_REVIEW | `1c921a3` |
| SEM-049 | IMPLEMENTED_PENDING_REVIEW | `380fd08` |
| SEM-050 | IMPLEMENTED_PENDING_REVIEW | `c56b0ae` (escritas) + `d6904da` (leitura: estado `unknown`/locked, nunca "sem restrição") |
| SEM-051 | BLOCKED_HUMAN_DECISION | (HD-14: o DFD passa a ter emissão oficial?) |
| SEM-052 | IMPLEMENTED_PENDING_REVIEW | `8b0ed58` |
| SEM-053 | IMPLEMENTED_PENDING_REVIEW | `1c921a3` |
| SEM-054 | IMPLEMENTED_PENDING_REVIEW | `8b0ed58` + `988e555` (UI de resolução humana da identidade) |
| SEM-055 | IMPLEMENTED_PENDING_REVIEW | `380fd08` |
| SEM-056 | IMPLEMENTED_PENDING_REVIEW | `380fd08` |
| SEM-057 | IMPLEMENTED_PENDING_REVIEW | `9375eca` |
| SEM-058 | IMPLEMENTED_PENDING_REVIEW | `4037745` (sugestão ≠ decisão; aceite explícito com CAS e lineage) |
| SEM-059 | BLOCKED_LEGAL_REVIEW | (catálogo — J-2) |
| SEM-060 | IMPLEMENTED_PENDING_REVIEW | `4037745` |
| SEM-062 | PARTIAL_LOCAL | `27e9992` (gestor/fiscal aplicados pelo instrumento; herança de valor/contratado só da contratação direta com evidência canônica; licitação sem registro canônico; itens do contrato: nota de design, NOT DECIDED) |
| SEM-063 | BLOCKED_LEGAL_REVIEW | (efeito do parecer desfavorável) |
| SEM-064 | IMPLEMENTED_PENDING_REVIEW | `5d97fec` (status derivado dos atos registrados; `configureFlags` com evento; `publish` sem extrato fabricado; vocabulário inalterado — HD-09) |
| SEM-065 | OPEN (depende de R2.3) | — legado `contractsRouter` (LEG-016): corrigir × retirar depende de R2.3 |
| SEM-066 | OPEN (depende de R2.3) | — legado (LEG-016): depende de R2.3 |
| SEM-067 | IMPLEMENTED_PENDING_REVIEW | `380fd08` |
| SEM-068 | IMPLEMENTED_PENDING_REVIEW | `380fd08` |
| SEM-069 | IMPLEMENTED_PENDING_REVIEW | `380fd08` (recusa explícita; sem reativação — política não decidida) |
| SEM-070 | IMPLEMENTED_PENDING_REVIEW | `970211a` |
| SEM-071 | IMPLEMENTED_PENDING_REVIEW | `970211a` |
| SEM-072 | IMPLEMENTED_PENDING_REVIEW | `b603d7a` (sem versão `final`: último rascunho em `rascunhos_NAO_OFICIAIS/`, controlado por `includeLatestDraftWhenNoOfficial` — escolha técnica, não política) |
| SEM-073 | IMPLEMENTED_PENDING_REVIEW | `bc74f6f` (organização do contexto; `organizationId` divergente recusado) + LEG-028 à frente |
| SEM-074 | IMPLEMENTED_PENDING_REVIEW | `b603d7a` |
| SEM-075 | IMPLEMENTED_PENDING_REVIEW | `c0e5b7c` |
| SEM-076 | IMPLEMENTED_PENDING_REVIEW | `bdfabef` (timeline do processo; demais timelines: NEW-004 residual) |
| SEM-077 | PARTIAL_LOCAL | `bc74f6f` (superfície em memória só dev, atrás de LEG-028: tenant do contexto, aprovador = usuário autenticado, aprovador contado uma vez, agente simulado nunca `completed`; persistência não implementada) |
| SEM-078 | IMPLEMENTED_PENDING_REVIEW | `bc74f6f` (+ LEG-009) |
| SEM-079 | PARTIAL_LOCAL | `bc74f6f` (+ LEG-009; backfill + NOT NULL: BLOCKED_HUMAN_DECISION) |
| SEM-080 | IMPLEMENTED_PENDING_REVIEW | `d088a33` |
| SEM-081 | IMPLEMENTED_PENDING_REVIEW | `df1a717` (total parcial rotulado PARCIAL) |
| SEM-082 | BLOCKED_LEGAL_REVIEW | (conteúdo mínimo) |
| SEM-083 | PARTIAL_LOCAL | `27e9992` (chave HMAC própria via config + verificação com fallback documentado; assinante = designado confirmado; rotação de chave e SoD "designado ≠ quem recebe": BLOCKED_HUMAN_DECISION) |
| SEM-084 | PARTIAL_LOCAL | `27e9992` (sequência atômica sob lock; limites do art. 125: BLOCKED_LEGAL_REVIEW J-4) |
| SEM-085 | OPEN (depende de R2.3) | — depende de R2.3 (FCC-06: a 0310 cobre `contract_workspaces`, não `contracts`) |
| SEM-086 | IMPLEMENTED_PENDING_REVIEW | `bc74f6f` (hipótese CONFIRMADA e corrigida: tenant + processo do autor) |

### 4.2 P2 (12)

| SEM | Estado | Detalhe |
|---|---|---|
| SEM-037 | IMPLEMENTED_PENDING_REVIEW | `d6904da` |
| SEM-038 | IMPLEMENTED_PENDING_REVIEW | `d6904da` |
| SEM-044 | IMPLEMENTED_PENDING_REVIEW | `d6904da` |
| SEM-045 | IMPLEMENTED_PENDING_REVIEW | `d6904da` |
| SEM-046 | IMPLEMENTED_PENDING_REVIEW | `bc74f6f` |
| SEM-061 | IMPLEMENTED_PENDING_REVIEW | `4037745` (confirmação de limiar só na UI; política de limiar não decidida) |
| SEM-087 | PARTIAL_LOCAL | `d6904da` (parte B: `issueProcess` exige ETP/TR/Edital emitidos; parte A, escopo da SoD: BLOCKED_HUMAN_DECISION) |
| SEM-088 | IMPLEMENTED_PENDING_REVIEW | `bc74f6f` |
| SEM-089 | IMPLEMENTED_PENDING_REVIEW | `d6904da` |
| SEM-090 | PARTIAL_LOCAL | `d6904da` (quantidade nula ≠ 0 no domínio e nos documentos; o token "0" da chave lógica persistida exige migração versionada de chave) |
| SEM-091 | BLOCKED_LEGAL_REVIEW | (J-5) |
| SEM-092 | IMPLEMENTED_PENDING_REVIEW | `bc74f6f` |

### 4.3 Itens com parcialidade — o que ficou de fora e por quê

- **SEM-040** — só instrumentos novos ganham lineage própria; backfill das versões existentes depende de decisão humana (HD-16 proposto).
- **SEM-062** — a licitação não tem registro canônico de valor/contratado; os itens do contrato são só uma nota de design (`docs/design/CONTRACT_ITEMS_FROM_PROCUREMENT.md`, NOT DECIDED).
- **SEM-077** — superfície em memória, só dev, atrás de LEG-028; persistência não implementada.
- **SEM-079** — escrita nova fail-closed; backfill e NOT NULL dependem de decisão (HD-17).
- **SEM-083** — chave HMAC própria via `server/config/signature.ts` (opcional, ≥ 32 caracteres) com fallback para `JWT_SECRET` e log `signature_hmac_key_not_configured`; rotação e SoD "designado ≠ quem recebe": HD-18.
- **SEM-084** — sequência atômica (lock da linha do contrato + `MAX(sequence)+1` na mesma transação); **limites do art. 125 permanecem bloqueados** (parecer J-4).
- **SEM-087** — só a parte B (emissão do processo exige ETP, TR e Edital emitidos — `PROCESS_ISSUE_REQUIRES_EMITTED_DOCUMENTS`); parte A (escopo da SoD): HD-19.
- **SEM-090** — quantidade nula ≠ 0 no domínio e nos documentos; o token "0" da chave lógica persistida exige migração versionada de chave (B-20).

## 5. Achados novos

| ID | Sev. | Achado | Estado |
|---|---|---|---|
| NEW-038 | P1 | O contrato avulso gravava em **centavos** um campo `contract_workspaces.value` DECIMAL(15,2) em **reais** (erro ×100), na via avulsa e na de herança | corrigido localmente (`abc2a69`: `parseReaisInputToDecimal`, teste `client/src/lib/money.test.ts`) |
| (lacunas) | — | SEM-081 (rótulo do total parcial) e SEM-054 (UI de resolução da identidade) tinham só metade pronta: backend sem UI/rótulo | fechados (`df1a717`, `988e555`) |
| NEW-031/033/034 | P3 | infra de teste (contador global; "degrada sem DB"; agregação sem órgão) | corrigidos (`446171e`, `23554f3`) |
| NEW-036 | P0 (candidato) | centavos como reais na minuta legada | corrigido localmente (`adea553`, 1º lote) |
| NEW-037 | P3 | `invitations-mysql-smoke` 8/10 | **PRE_EXISTING_MAIN_FAILURE** — as mesmas 2 falhas (`ctx.res.cookie is not a function`; bind `undefined`) reproduzem na `main` `aac4241`. **Apenas documentado; não corrigido, por instrução.** |
| NEW-028 | P2 | vocabulário de status sem "não ratificado" | aberto — HD-09 (fora de escopo) |

## 6. Decisões humanas pendentes

Nenhuma foi tomada. HD-01/03/06/07/08/09/13/14/15 seguem como estavam (HD-15 = escopo do número do contrato entre origens; `drizzle/policy-pending/*` pendente).
Propostos neste passe (`HUMAN_DECISION_PACKET.md`): **HD-16** backfill de lineage (SEM-040) · **HD-17** backfill + NOT NULL (SEM-079) · **HD-18** rotação da chave HMAC e SoD (SEM-083) ·
**HD-19** escopo da SoD (SEM-087A) · **HD-20** política de reativação (SEM-069) · **HD-21** itens do contrato (SEM-062).

## 7. Decisões jurídicas pendentes

Nenhuma regra jurídica foi alterada. SEM-010 (`includes("75, I")`) e SEM-011 (`originalValue * 0.5`) estão **inalterados no código** e continuam P0 **abertos**.
SEM-033, 059, 063, 082, 091 e os limites do art. 125 (SEM-084) seguem BLOCKED_LEGAL_REVIEW. Ver `LEGAL_REVIEW_DECISION_PACKET.md` (J-1…J-5).

## 8. Guardas R11 (FASE 6)

`server/__tests__/unit/r11-semantic-authority-behavior-guards.test.ts` — 17 testes que exercitam o comportamento (PRNG semeado, executor falso, mutações), não a presença de texto:
**R11-B1** nenhum `*-mysql-smoke` fora da cadeia da CI / do smoke de segurança (as 7 exceções são exatamente os órfãos pré-existentes, listados); **B2** timeline: um id por evento, resumo nunca reescrito, ator humano;
**B3** a IA nunca cria autoridade numérica (valor fora do quadro do sistema marcado; estimativa nunca inferida); **B4** `process.object` vence o objeto digitado; **B5** só fonte VIGENTE gera preço/total (qualquer estado desconhecido suspende);
**B6** auditoria de tenant: amostra do chamador ≠ varredura; sem banco ⇒ não saudável; **B7** centavos ⇄ texto sem erro de unidade.
Uma verificação por mutação (ids baseados em contagem) fez o B2 falhar como esperado. Os labels foram renomeados de R11.7–R11.13 para R11-B1…B7 porque colidiam com o checkpoint R11.7 (re-auditoria).
Fiação: `.github/workflows/ci.yml` ganhou o passo "Smoke — autoridade semântica R9/R10 (2º passe)" (16 arquivos, antes do `GATE OBRIGATÓRIO 4`); `package.json` → `test:smoke:security` recebeu 5 smokes novos
(`sp2d-legacy-misc`, `sem043` ledger, `sem084/062/040` instrumentos, `sem062` herança, `sem042/064` direta). **Mudança de CI documentada: sim, as duas acima.**

## 9. Evidência de testes (gate final, MySQL 8.0.46 limpo, head `988e555` + correção `22d0ed8`)

| Passo | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | OK |
| MySQL 8 limpo + `pnpm db:migrate:release` (0000 → 0315) | OK — ledger **316** = journal **316**, última `0315_official_document_artifacts` |
| `pnpm db:audit` | OK |
| `pnpm db:generate` (sem drift de schema) | OK — nenhum arquivo versionado alterado |
| `pnpm check` (tsc) | OK, 0 erros |
| ESLint nos arquivos `.ts/.tsx` alterados vs `main` (`--max-warnings 0`) | OK — **413 arquivos, 0 problemas**; `pnpm lint` do repositório inteiro OK (informativo) |
| `pnpm test` (sem `DATABASE_URL`) | OK — **360 arquivos passaram / 101 pulados (461); 7019 testes passaram / 798 pulados (7817); 0 falhas** |
| Cadeia MySQL equivalente à CI (48 passos) | todos OK **exceto 1** (C.4B.3B, abaixo); 44 comandos com testes somaram **757 testes passados**; migration safety 1/1; **`test:smoke:security` 39 arquivos / 396 testes**; passo novo R9/R10 **16 arquivos / 59 testes** |
| `pnpm build` | OK |
| `pnpm audit:gate` | OK |
| Baseline (sha256) | `08edc734…810b3` — inalterado |
| Os 7 smokes MySQL fora da CI (passo extra) | 6 OK · **`invitations` 8/10** = NEW-037 (PRE_EXISTING_MAIN_FAILURE): 52 testes, 50 passaram, 2 falharam (as mesmas 2 da `main`) |

**Ressalva honesta sobre o "gate único".** O gate rodou uma vez e **reprovou 1 passo**: `c4b3b-governed-human-editing-mysql-smoke`, testes 10 e 11. Eles afirmavam `sources` idênticas após `human_edit`,
mas o SEM-044 (`d6904da`) passou a acrescentar `edicao_humana`, `edicao_humana:ator=<id>` e `edicao_humana:hash=<16>` — mudança intencional; o teste estava desatualizado, **não** havia defeito de produto.
Corrigi o teste (`22d0ed8`: lineage de geração preservada na ordem + exatamente o marcador esperado) e **reexecutei só esse arquivo**: 11/11 no MySQL 8; ESLint do arquivo OK; R11 17/17 após o rename.
**Não** reexecutei o gate completo depois dessa correção (a correção só toca testes e um comentário do `ci.yml`; os passos 08, build e `audit:gate` já haviam rodado sobre o código de produção idêntico).
Se a revisão exigir um gate 100 % verde de ponta a ponta sobre o head final, é preciso rodá-lo de novo.

## 10. Matriz OFFICIAL_MAIN × LOCAL_CANDIDATE

| Visão | Critério | Resultado |
|---|---|---|
| **OFFICIAL_MAIN** | checkpoints PASS na `main` `aac42411` (produção: deploy `83381768…`, SUCCESS) | **24/87 = 27,6%** — inalterado; a branch **não** está na `main` |
| **LOCAL_CANDIDATE** | PASS oficial + PASS_LOCAL + IMPLEMENTED_PENDING_REVIEW nesta branch | **56/87 = 64,4%** (+1 sobre o 1º lote: R9.7) |

R9.1–R9.6, R9.8–R9.10 e R10.2 estão **PARTIAL_LOCAL** (ou BLOCKED, no R9.1): não entram na contagem local. A visão local **não é progresso oficial**: nada foi revisado, mergeado, implantado nem validado em produção.
P0: 26 — 5 FIXED_IN_MAIN · 19 CLOSED_LOCAL · **2 OPEN (SEM-010, SEM-011; jurídico)**; NEW-036 corrigido localmente. R11.7 = **TECHNICAL_REAUDIT_COMPLETE, não PASS** (`SEMANTIC_AUTHORITY_CLOSURE_REAUDIT.md` §5).

## 11. Graphify

Hook `pre-commit` ativo em todos os commits do passe (sem `--no-verify`), com toolchain fixada e `PYTHONHASHSEED=0`; `graphify-out/.graphify_root` restaurado a cada commit.
Estado final do grafo: **19.984 nós · 43.181 arestas · 1.013 comunidades** (antes do passe: 19.139 / 40.786 / 1.007). **Observação:** o campo "Built from commit" do `GRAPH_REPORT.md` do commit `5081ec7` aponta para o **commit pai**, não para o próprio `5081ec7`: o hook `pre-commit` roda antes de o novo commit existir,
e o hash exibido é o do HEAD no momento da geração (o grafo descreve a árvore *staged*). No fim do passe o relatório mostra `df1a7177`, um commit anterior ao HEAD pelo mesmo motivo. É uma limitação conhecida do campo — não use-o para provar frescor; compare as contagens/arquivos.
Os commits somente de documentação não tocam `server/` nem `client/` e não regeneram o grafo.

## 12. Limitações

- Todo teste de integração rodou em MySQL 8.0.46 local com dados sintéticos; nada foi exercitado em produção, S3 real, Brevo real ou IA real (mock/fake).
- O gate não foi repetido por completo após `22d0ed8` (ver §9).
- A UI nova (SEM-054, SEM-058, SEM-060/061, NEW-038) tem testes unitários das funções puras de visão/validação, mas **não** teve revisão visual humana nem E2E de navegador.
- Fallback de assinatura para `JWT_SECRET` permanece enquanto `SIGNATURE_HMAC_KEY` não for configurada (decisão de rotação pendente: HD-18).
- Os 7 `*-mysql-smoke` pré-existentes fora da cadeia da CI (a3-failure-provenance, catmat-governance, cognitive-provenance-a1, contrato-avulso, document-generation, invitations, p0-edital-generation) continuam fora dela; o meta-guard R11-B1 impede **novos** órfãos (e falha se um órfão conhecido entrar na cadeia sem sair da lista), mas não os incorpora.

## 13. Riscos

1. **Ordem das migrations**: 0310 → 0315 formam uma cadeia linear; mergear fora de ordem quebra o ledger. A 0315 é aditiva (rollback = `DROP TABLE`), mas exige staging antes de produção.
2. **Fail-closed novo** (várias recusas com código estável: `PROCESS_ISSUE_REQUIRES_EMITTED_DOCUMENTS`, divergência de valor de referência na contratação direta, `characterizeNeed`/`importDFD` recusados por falta de tabela de persistência, `acceptDFDJustification` exige `confirmAccept` + CAS): muda a experiência do piloto — é intencional.
3. **Legado de exportação**: `official_documents.storage_key`/`mime_type`/`size_bytes`/`content_hash` deixaram de ser escritos; leitores que ainda dependam deles devem ler `official_document_artifacts` (query `documentEngine.artifacts`).
4. **Tamanho**: 63 commits e 1 migration em uma só branch — recomenda-se o fatiamento em PRs já proposto no §8 do relatório de execução.

## 14. Itens bloqueados (resumo)

HD: SEM-027, 051 (+ backfills HD-16/17, SoD HD-18/19, políticas HD-20/21). Jurídico: SEM-010, 011, 033, 059, 063, 082, 091, limites do SEM-084. R2.3 (acesso à produção, não autorizado): SEM-032, 065, 066, 085 e o destino do módulo legado.
PRs/merge/deploy/validação em produção (B-01…B-03): fora deste passe por instrução. Lista completa: `AUTONOMOUS_REMEDIATION_BLOCKERS.md` (B-16…B-21 novos).
