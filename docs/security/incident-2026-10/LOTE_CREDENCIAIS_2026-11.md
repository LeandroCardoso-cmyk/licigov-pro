# Evidência sanitizada — lote de credenciais SEC-AUD-2026-10 (03–05/11/2026)

> **Documento consolidado em 05/11/2026.** O estado final vem primeiro. O histórico de execução (03–05/11) está preservado no fim, sem reescrita.
> Sem valores de segredo, cookies, tokens, links de recuperação ou e-mails. Os sufixos identificam chaves antigas excluídas ou novas preservadas, conforme indicado em cada linha; não são valores completos de credenciais.
> Legenda: **[E]** evidência do executor (GitHub, Railway: deploys, logs e *nomes* de variáveis; execução sintética em staging) · **[O]** confirmação manual do Owner · **[L]** limitação registrada.
> **Este documento não encerra o incidente P0 nem a auditoria geral.** Também não libera a #337 nem a #319.

## 1. Estado final do lote (05/11/2026)

| Frente | Estado final | Fonte |
|---|---|---|
| D1 — #340 em `main`/produção | Merge squash `b917a02`; CI 5/5 (run 41572014774); deploy `02ffaeb5` SUCCESS; `ADMIN_PASSWORD` deixou de ser exigida no boot | [E] |
| D2 — app de staging | Aceito. `JWT_SECRET`, `GEMINI_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` e `BREVO_API_KEY` trocadas; 7 variáveis sem consumidor removidas (incluindo `ADMIN_PASSWORD`); deploy `6cff6965` SUCCESS. Validação: `/readyz` 200; login dos 2 sintéticos (org 2, `manager`); S3 (upload + DOCX + download por URL assinada); Gemini (1 geração); Brevo (e-mails ids 11/12) | [E] + [O] |
| D3 — app de produção | **Aplicado pelo Owner.** Seis verificações funcionais aprovadas pelo Owner: login/painel, download de arquivo existente, exportação DOCX e abertura, IA, recebimento do e-mail de recuperação, `/readyz` com `database=ok`. O executor **não** executou esses testes | [O] |
| GitHub Actions | `GEMINI_API_KEY` **ausente** em Repository secrets (captura do Owner). Nenhuma exclusão foi necessária. `ai-models.yml` aposentado em `main`. A variável `GEMINI_API_KEY` da Railway foi preservada | [O] + [E] |
| Gemini | Chaves antigas `UsxA`, `4ivQ` e `NxKw` **excluídas**. Novas `CcBA` e `V25Q` e a chave do maestro `psCw` **preservadas**, conforme orientação. Nenhuma nova geração de IA depois da exclusão das antigas | [O] |
| AWS | Chave antiga `…Q7NUT` desativada; download e DOCX aprovados nos dois ambientes; **depois excluída**. Usuário antigo, identidades novas e buckets preservados | [O] (+ [E] para o S3 de staging antes da exclusão) |
| Brevo | Chaves antigas `oMmbu9` e `mDo3GT` desativadas; recebimento aprovado nos dois ambientes; **depois excluídas**. Novas chaves, SincroSaúde e SMTP preservados | [O] (+ [E] para os envios de staging) |
| JWT | Staging: `JWT_SECRET` novo no D2 (a rejeição programática da sessão anterior **não** foi demonstrada, ver §4). Produção: rotacionado em rodada anterior pelo Owner (deploy `1a321f9d`, 01/11); não alterado neste lote | [E] + [O] |
| Contas sintéticas de staging | userId 4 (sintético 2): redefinido em 04/11 (na parte B, por engano tratado como admin). userId 5 (sintético 1): redefinido em 05/11. Login dos dois confirmado na org 2 | [E] (logs) + [O] |
| **Administrador REAL** da plataforma em staging | Conta identificada em privado; link recebido; senha redefinida e salva; login administrativo confirmado pelo Owner. **Não** é nenhuma das contas sintéticas (userId 4/5) | [O] |
| Ambiente privado do executor | Nesta sessão, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` têm um valor de **preenchimento** (fora do formato AWS, idêntico nas duas), **diferente** da chave antiga, e **sem consumidor local** neste lote. Variáveis preservadas. Conclusão restrita a esta sessão | [E] |
| Orçamento de e-mails | Autorizados 7; o Owner ampliou para **9**, exclusivamente para o admin real de staging. **9 comprometidos, sem novos envios.** Uso: sintético 2 (2), sintético 1 (2), recuperação de produção após D3 (1), testes de recebimento pós-desativação Brevo em staging e produção (2), recuperação do admin real de staging (2: link recebido e redefinição confirmados; o aviso de senha alterada não foi confirmado separadamente) | [E] + [O] |

## 2. Progresso — escopo explícito: "lote de credenciais aprovado em 03/11/2026"

Escopo: os itens D1, D2 e D3 do lote, as rotações/revogações de Gemini, AWS e Brevo, as recuperações e as conferências pedidas. **Não** inclui a auditoria geral nem o P0.

| # | Item | Estado |
|---|---|---|
| 1 | D1: merge da #340 + deploy de produção validado | ✅ |
| 2 | D2: troca de 5 variáveis + remoção de 7 no app de staging | ✅ |
| 3 | Validação funcional de staging (readyz, logins, S3, Gemini, Brevo) | ✅ (ressalva do JWT, §4) |
| 4 | D3: troca de 4 variáveis + remoção de `ADMIN_PASSWORD` em produção | ✅ [O] |
| 5 | Validação funcional de produção (6 verificações) | ✅ [O] |
| 6 | Gemini: projeto/chaves novas em uso nos dois ambientes | ✅ [O] |
| 7 | Gemini: antigas excluídas | ✅ [O] |
| 8 | AWS: identidades/chaves novas em uso nos dois ambientes | ✅ [O] |
| 9 | AWS: antiga desativada, validada e excluída | ✅ [O] |
| 10 | Brevo: chaves novas em uso nos dois ambientes | ✅ [E] + [O] |
| 11 | Brevo: antigas desativadas, validadas e excluídas | ✅ [O] |
| 12 | Secret `GEMINI_API_KEY` do GitHub Actions resolvido (ausente) | ✅ [O] |
| 13 | Recuperação das 2 contas sintéticas de staging | ✅ |
| 14 | Recuperação do administrador real de staging | ✅ [O] |
| 15 | Conferência do ambiente privado do executor | ✅ [E] |
| 16 | Evidência sanitizada consolidada | ✅ (publicação documental autorizada; integração ainda sujeita a revisão, §6) |

**Concluídos: 16/16 itens do escopo do lote.** O número não representa progresso global da auditoria nem do P0.

## 3. Evidência do executor × confirmação do Owner

- **[E] Executor:**
  - conferências de PR/CI/SHAs;
  - merge da #340 e acompanhamento do deploy de produção `02ffaeb5`;
  - logs de deploy e boot de staging (`6cff6965`, `55f0fb54`) e de produção (`02ffaeb5`);
  - testes sintéticos em staging, todos na org 2:
    - `/readyz`;
    - logins;
    - S3: anexo PDF de 112 B e DOCX de 10.076 B com download assinado HTTP 200;
    - Gemini: 1 geração, 1.963 tokens, ≤ US$ 0,0074, teto prévio ≤ US$ 0,0105 dentro do limite de US$ 0,02 autorizado, sem retentativa;
  - metadados de envio do Brevo (ids 11 e 12, sem falhas);
  - identidade dos userIds 4/5 pelos logs;
  - conferência local do ambiente do executor.
- **[O] Owner:**
  - criação, aplicação, revogação e exclusão de chaves nos provedores;
  - deploys de variáveis (D2, `AI_MAX_ATTEMPTS=1`, D3);
  - as 6 verificações de produção;
  - recebimento dos e-mails;
  - recuperação do admin real;
  - ausência do secret no GitHub;
  - preservação das chaves novas e do maestro.
- O executor **não** leu cofre, valores de variáveis nem consoles de provedores, e não executou testes em produção.

## 4. Limitações (preservadas; não são bloqueios novos por si)

- [L] **JWT de staging:** a rejeição programática da sessão anterior **não** foi demonstrada. Há só a observação do Owner (novo pedido de login) e não há `auth_session_rejected` no log. A rotação não foi repetida para preencher a lacuna.
- [L] **`AI_MAX_ATTEMPTS=1` continua em staging** (evidência manual do Owner, deploy `55f0fb54`). O valor efetivo não foi consultado pelo executor; não se afirma impossibilidade técnica de ler somente essa variável. Restaurar ou manter é decisão do Owner.
- [L] **Objetos sintéticos retidos** no bucket de staging (`tasks/…` PDF e `exports/…` DOCX). O app não tem rota de exclusão consistente com os registros.
- [L] **Isolamento do segredo de migrations:** `MIGRATION_DATABASE_URL` fica no mesmo serviço do app (pre-deploy), acessível ao processo de runtime.
- [L] **Drills de restauração** com validações mínimas de integridade/vínculo (sem homologação de isolamento da aplicação; VERIFY_CA sem conferência de hostname).
- [L] **SincroSaúde:** a ausência de correspondência de chaves nas variáveis do SincroSaúde **não** é auditoria universal dos arquivos, do banco ou dos consumidores externos dele.
- [L] Preço do Gemini usado nos tetos: fontes de terceiros; a página oficial não foi acessível da sessão.
- [L] `ai-models.yml` ainda existe em `staging` e em branches antigas (só disparo manual; sem o secret, falha).
- [L] Admin real de staging: o aviso de senha alterada não foi confirmado separadamente.

## 5. Pendências gerais ainda sustentadas pelos registros

| Pendência | Próxima ação | Critério de conclusão |
|---|---|---|
| **Incidente P0 / auditoria geral** (`incident-2026-10/ROADMAP.md`, critério 7B) | Reavaliar cada critério do roadmap original com as evidências deste lote | Todos os critérios atendidos ou com não aplicabilidade fundamentada, sem crítico/alto aberto; aceite do Owner |
| Logs de acesso/consumo do período do incidente (critério 2B) | Revisar uso por chave no Google Cloud (Gemini), no CloudTrail/S3 (ou registrar a inexistência de data events) e os logs da Brevo, no período exposto | Revisão registrada por provedor, com achados ou ausência fundamentada |
| Identidade e permissões (critérios 3A/3B) | 2FA das 2 contas do Workspace; administradores e recuperação; apps OAuth, contas de serviço e escopos (Google/GitHub/Railway) | Inventário revisado e corrigido, com evidência do console |
| Confirmações operacionais (critérios 6A/6B) | Faturamento regular do Google Cloud/Workspace do LiciGov; encerramento/transferência formal da frente SincroSaúde | Documento ou captura do provedor; dependências compartilhadas resolvidas |
| Dependências (critério 4A) | #319 (`xlsx`) segue em draft, sem liberação; #337 NO-GO | Decisão do Owner sobre cada PR, com CI e validação em staging |
| Produção não homologada (M8 aceita só em staging) | Conforme `roadmap/PRODUCT_ROADMAP.md` (ressalvas M8, M3/M6/M7) | Homologação de produção aceita pelo Owner |
| Integração da evidência documental | Publicar em branch nova e revisar a PR draft para staging (§6) | Documentos revisados e integração autorizada; não implica encerrar P0 |

## 6. Preservação e publicação documental

- O Owner autorizou publicar estes três documentos em uma branch nova, com PR **draft para staging**, sem merge, force-push, deploy ou alteração operacional.
- Base conferida para a preparação: `staging@9226e4bc11aff56d7d22dbc9a2b800474f15fed8`.
- Branch de publicação: `docs/security-credentials-evidence-2026-11-05`.
- Arquivos: este relatório, `docs/security/incident-2026-10/ROADMAP.md` e `roadmap/PRODUCT_ROADMAP.md`. A integração permanece sujeita a revisão; a publicação não altera as branches acompanhadas pelos ambientes.
- A cópia entregue ao Owner foi preservada localmente antes dos ajustes. O antigo commit `1ce4c6c` foi relatado pelo executor como apenas local; ele não é usado como base nem se afirma sua publicação.
- O executor relatou bloqueio automático de um push anterior; o motivo efetivo não foi fornecido. Esta publicação usa o escopo novo expressamente autorizado, sem reescrever a branch antiga.

## 7. Reconciliação das assinaturas e dos critérios gerais

A consulta de produção fornecida pelo Owner em **01/11/2026** retornou `assinaturas_registradas=0` em `digital_signatures`; a coleta anterior de staging também retornou `assinaturas_legadas=0`. A pendência de contar registros atuais está encerrada com essas evidências e datas, sem repetir SQL. Isso não certifica ausência histórica de registros apagados nem homologa outras modalidades de assinatura.

O critério 2B do roadmap exige também revisão de logs de acesso/consumo do período: a revogação das chaves e os testes funcionais estão concluídos para os consumidores verificados, mas essa revisão histórica não é substituída pelos testes. O critério 7B e o P0 geral continuam abertos. A vinculação do novo projeto Gemini de produção ao billing foi confirmada pelo Owner; o vínculo não comprova a situação de todo o Google Cloud/Workspace. Não há recálculo global nesta publicação.

---

# Histórico de execução (03–05/11/2026) — registros originais preservados

> Seções abaixo como foram registradas durante a execução. Onde divergirem do §1, vale o §1 (estado final de 05/11).

> SEC-AUD-2026-10 (pós-incidente Railway). Sem valores de segredo, cookies, tokens, e-mails ou dados pessoais.
> Fontes: GitHub (PR, CI), Railway (deployments, logs e **nomes** de variáveis) e execução sintética em staging.
> Legenda: **PASS** = executado e verificado · **PENDENTE** = depende de ação do Owner · **NOT_TESTED** = não executado.

### D1 — backport da #340 para `main` (produção)

| Item | Evidência | Status |
|---|---|---|
| Conferência antes do merge | head `cd4b46b1835e2878abbb6ff7bf2dfebccbd6d1e3`, base `ffd42738141e6eaae8beca6141f1f8c2eedba2ca`, `mergeable_state: clean`, checks 5/5 (run 41558980787); nenhuma alteração pendente na Railway (production e staging) | PASS |
| Merge | squash condicionado ao head → `main` = `b917a0226209fd556ef4bcfe7b33a4773caa68db` | PASS |
| CI da `main` | run 41572014774 (#849): Typecheck+Lint, Testes, Smoke MySQL+Isolamento, Build, Auditoria de Dependências | PASS |
| Deploy de produção | `02ffaeb5-be36-4938-a883-6d24cd6349b4`: WAITING (aguardou o CI) → SUCCESS às 03:44:18Z; o deploy anterior `1a321f9d` foi para REMOVED | PASS |
| Predeploy | `db:release:predeploy`, conexão `MIGRATION_DATABASE_URL`, lock obtido e liberado, "Migrations aplicadas (ou já em dia)", reference set `noop` (setId=1), concluído em 178 ms | PASS |
| Boot | `APP_ENV=production \| S3=✓ \| AI=✓ (gemini/gemini-3.8-flash)`, "Schema validado … sem mutação em runtime", "Bootstrap concluído. Servidor pronto." | PASS |
| `/readyz` | `railway.json` da `main` define `healthcheckPath: /readyz`. O deploy só fica SUCCESS depois desse healthcheck. A URL de produção não é alcançável desta sessão (proxy), então não houve chamada direta | PASS (via healthcheck) |
| Erros pós-boot | filtro `@level:error OR @level:warn OR denied OR ADMIN_PASSWORD` no deploy: 0 linhas | PASS |
| `ADMIN_PASSWORD` | o boot de produção não a exige mais; a variável continua definida até o D3 | PASS |
| `ai-models.yml` | ausente na `main`; nenhum workflow da `main` referencia `secrets.GEMINI_API_KEY` | PASS |

### Preparação do D2 (staging)

- Duas sessões sintéticas foram capturadas antes do D2 (03:28Z): tenant `homologacao-sintetica` (org 2), papel `manager` e papel de plataforma `user` nas duas. Os cookies ficaram só em memória e num arquivo local restrito, nunca impressos. Servem para provar que o JWT novo derruba as sessões antigas.
- O Owner recebeu uma lista privada única de preparação, sem valores, com:
  - Gemini: projeto exclusivo de produção e chaves restritas à Generative Language API;
  - AWS: usuários `licigov-production-s3` e `licigov-staging-s3` com política mínima por bucket e checagem de KMS e de política do bucket;
  - Brevo: chaves `*-2026-11`;
  - JWT de staging;
  - títulos do cofre, D2/D3 campo a campo, remoção do secret do GitHub e limpeza do ambiente do executor.

### D2 — staging (aplicado pelo Owner; validação do executor em 04/11, 03:58Z)

| Item | Evidência | Status |
|---|---|---|
| Deploy | `6cff6965-a306-423f-85d9-a8f830df7282` SUCCESS (03:34:36Z), commit `9226e4b`. Predeploy via `MIGRATION_DATABASE_URL`, migrations em dia, reference set `noop`, "Schema validado", "Servidor pronto". O `9c95911f` foi para REMOVED. Sem `@level:warn`/`error` no deploy | PASS |
| `/readyz` (GET externo) | HTTP 200 `{"status":"ok","checks":{"database":"ok"}}` | PASS |
| `system.health` | `ok:true, env:staging, db:true, s3:true, ai:true`. Só indicador: S3 e IA não são declarados funcionais por ele | Informativo |
| Login sintético 1 | org 2 `homologacao-sintetica`, papel `manager`, plataforma `user` | PASS |
| Login sintético 2 (userId 4) | A credencial antiga do executor foi recusada porque a parte B ("admin") redefiniu **esta** conta: pelos logs, o login de 03:11Z e o login do Owner depois do D2 (03:51Z) resolveram o userId 4 na org 2. Em 03/11, no login de captura, o userId 4 era o sintético 2 e o 5 era o sintético 1. O login depois do D2 com a senha nova está comprovado pelo log (userId 4, org 2) | PASS (Owner + log) |
| Sessão anterior recusada | Observação do Owner: a janela anterior pediu novo login. Nos logs **não** aparece `auth_session_rejected` depois do deploy. As sessões do executor expiraram antes do deploy (03:28Z × 03:31Z) e não servem de prova. Rotação não repetida | NOT_TESTED (programático) |
| S3 — upload | `departmentTasks.addAttachment`: PDF sintético de 112 B, sha256 `c5085cd4…a77565`, tarefa sintética 1, anexo 1 | PASS |
| S3 — exportação + URL assinada | `procurementProcess.exportDocument` (DFD/DOCX) do processo sintético `aaf87bb9…`: objeto em `exports/`, URL assinada (`X-Amz-Signature`, expira em 3600 s) em `*.s3.us-east-2.amazonaws.com`, **download real HTTP 200**, 10.076 B, cabeçalho DOCX válido, sha256 `3a6be0e1…00bc3c` | PASS |
| S3 — limpeza | **Não executada.** O app não tem caminho que apague o objeto do anexo: `deleteAttachment` remove só a linha e deixaria o arquivo órfão. A exportação não tem rota de exclusão. O executor não usa credencial S3 direta. Os 2 objetos ficam como dados sintéticos marcados e consistentes com os registros | Informativo |
| Gemini (1ª avaliação) | **0 chamadas.** `aiAssistant.improveText` (sem RAG, teto de 1.536 tokens de saída com thinking, ≈ US$ 0,0066 por tentativa) exige processo legado; a org 2 tem 0 e a criação de processo legado está desligada (PR B). As demais rotas usam RAG (embedding cobrado à parte) ou têm teto de 2.048 tokens (≈ US$ 0,009 por tentativa), e uma retentativa passaria de US$ 0,01 | NOT_TESTED |
| Gemini (reavaliado) | Rota `procurementProcess.generateDFDJustification`: uma única geração, sem embedding nem RAG, `maxOutputTokens` 2048 com thinking incluído. Prompt medido em 12 processos sintéticos com DFD em rascunho: no máximo 3.433 caracteres (schema incluído), ou seja, ≤ 1.717 tokens contando 2 caracteres por token. Teto por tentativa: US$ 0,0013 de entrada + US$ 0,0077 de saída = ≤ US$ 0,009. **Impedimento:** o único controle de retentativa é `AI_MAX_ATTEMPTS`; em staging ele existe com valor desconhecido (lê-lo exigiria listar todas as variáveis, o que é vedado), e o padrão do código é 2. Execução condicionada a `AI_MAX_ATTEMPTS=1` (Owner) | NOT_TESTED |
| Gemini (após `AI_MAX_ATTEMPTS=1`) | O Owner aplicou `AI_MAX_ATTEMPTS=1` com o deploy `55f0fb54-1f7e-4b0e-a9d3-5e323c990a78` (SUCCESS 04:19Z: predeploy, migrations, reference set `noop`, schema validado, servidor pronto). O valor no processo **não é verificável** sem ler variáveis ou mudar código: não há rota nem log que o exponha. A antiga estimativa de 2 caracteres por token foi descartada por não ser garantia. O limite demonstrável é **1 token ≤ 1 byte UTF-8** (byte-fallback). Menor payload sintético com DFD em rascunho (`169d6384…`): 3.480 bytes (sistema 427 + usuário 2.398 + schema 655), máximo 3.569. Teto: 3.480 × US$ 0,75/1M + 2.048 × US$ 3,75/1M = **US$ 0,01029**, acima de US$ 0,01 antes até do enquadramento das mensagens. Contagem remota (`countTokens`) indisponível: a chave existe só no servidor e o app não expõe contagem. **0 chamadas, US$ 0** | NOT_TESTED (teto não demonstrável) |
| Gemini (executado com o teto de US$ 0,02 autorizado pelo Owner) | **1 geração, 0 retentativas.** Rota `procurementProcess.generateDFDJustification`, processo sintético `169d6384fd76c9fe00e6` (org 2, DFD em rascunho; o DFD **não** foi alterado, pois a sugestão só é gravada pelo aceite humano). Teto prévio: entrada ≤ 3.480 bytes + 256 de enquadramento = 3.736 tokens; saída ≤ 2.048 com thinking ⇒ **≤ US$ 0,01048**. Resultado: OK em 11,5 s, `finishReason: stop`, `structuredOutputValid: true`, sugestão de 554 caracteres. Consumo real (`totalTokenCount` do usageMetadata, que soma entrada, saída e thinking) **1.963 tokens** ⇒ custo ≤ 1.963 × US$ 3,75/1M = **≤ US$ 0,0074**, contando tudo no preço de saída. Logs do deploy `55f0fb54`: nenhum `ai_retry`, `ai_call_failed`, warn ou error. `AI_MAX_ATTEMPTS=1`: evidência manual do Owner (deploy `55f0fb54` SUCCESS); a leitura do valor efetivo no processo não é possível sem listar variáveis | **PASS** |
| Brevo (chave nova) | Depois do D2 (deploy 04/11 03:34Z), já com a chave nova: `email_sent` id 11 `password_reset` (05/11 01:41:33Z) e id 12 `password_changed` (01:45:11Z), provider brevo. Nenhum `email_permanent_failure`, `email_retry_scheduled`, `template_render_failed` ou `dispatch_cycle_error`. O Owner confirmou o recebimento | **PASS** |
| Identidade do sintético 1 | Depois do `password_changed`, o log de 01:46:27Z resolveu o userId 5 na org 2 (o login do Owner com a senha nova). Às 01:41:11Z há atividade do userId 4 (sessão já aberta do sintético 2); não houve nova redefinição dele | **PASS** |
| Orçamento de e-mail | 4 de 7 usados (ids 9 e 10 do sintético 2; ids 11 e 12 do sintético 1); 1 reservado para produção | OK |

### Pendências e limitações (estado em 04/11, 04:30Z)

- **Aceite de staging: concluído em 05/11.** D3 (produção) e o secret `GEMINI_API_KEY` do GitHub: **PENDENTE** (ação do Owner).
- `AI_MAX_ATTEMPTS=1` continua em staging; restaurar ou manter é decisão do Owner.
- Gemini em staging: PASS em 04/11 (ver acima); o histórico de NOT_TESTED abaixo fica registrado.
  - O preço oficial não pôde ser confirmado desta sessão; a página do Google está bloqueada pelo proxy.
  - Fontes de terceiros indicam US$ 0,75/1M de entrada e US$ 3,75/1M de saída, thinking incluído. Com o teto de 1.536 tokens de saída, uma chamada fica em ≈ US$ 0,0075, mas uma retentativa poderia passar do teto de US$ 0,01.
- `ai-models.yml` ainda existe em `staging` e em branches antigas. É só disparo manual; depois da remoção do secret, esse disparo falha.
- Revogação das chaves antigas (Gemini, `licigov-s3-user`, Brevo): fora deste lote.

- Admin da plataforma de staging: não foi redefinido neste lote (a parte B atingiu o sintético 2). Fica a critério do Owner.
- Orçamento de e-mail: 7 no lote. Usados 2 (sintético 2, na parte B); previstos mais 2 (sintético 1) e 1 (produção).

### Revogação das chaves antigas (informada pelo Owner, 05/11)

| Provedor | Estado informado | Verificação do executor |
|---|---|---|
| Gemini | Chaves antigas terminadas em `UsxA`, `4ivQ` e `NxKw` **excluídas** | Não verificado (sem acesso ao console) |
| AWS | Chave antiga terminada em `Q7NUT` **desativada** | Não verificado |
| Brevo | As 2 chaves antigas **desativadas** | Não verificado |
| Testes posteriores | Armazenamento e e-mail passaram em staging e produção | Informado pelo Owner; não reexecutados pelo executor |

### Ambiente privado do executor (conferência local, 05/11; nenhum valor exibido nem usado)

| Variável | Conferência | Correspondência com a chave antiga `…Q7NUT` |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | Presente; **não** tem formato de Access Key ID da AWS (14 caracteres, minúsculas/hífen, não começa com `AKIA`/`ASIA`) e é **idêntica** a `AWS_SECRET_ACCESS_KEY`. É um valor de preenchimento, não uma credencial | **Não corresponde** (não termina nem contém `Q7NUT`) |
| `AWS_SECRET_ACCESS_KEY` | Presente; mesmo valor de preenchimento (14 caracteres, fora do formato de 40) | — |
| `AWS_CA_BUNDLE` | Presente; é a CA do proxy do executor (`/root/.ccr/README.md`) | — |
| `~/.aws/config` | Só a seção `[default]` com opções `s3`/`payload_signing_enabled`; **sem** credenciais. Não existe `~/.aws/credentials` | — |

**Consumidores identificados de `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`** (mesmos em `main` e `staging`):
- `server/config/aws.ts`: leitura e uso, pelo servidor da aplicação;
- `server/storage.ts`: cliente S3 via config;
- `server/config/env.ts`: validação de presença;
- `server/services/productionMonitoringService.ts`: diagnóstico de prontidão;
- `server/__tests__/integration/rc421-production-readiness.test.ts`: teste;
- documentação (`.env.example`, `CLAUDE.md`, runbooks).

Nenhum script em `scripts/`, no `uso-cache` ou nos scripts temporários do lote usa essas variáveis. Os testes de S3 do lote rodaram **no servidor de staging**, com a credencial do Railway, e não com o ambiente do executor. A AWS CLI não está instalada no executor.

Conclusão: o ambiente do executor **não** guarda a chave antiga nem nenhuma credencial AWS válida. Variáveis preservadas, como pedido pelo Owner.

### Pendente — recuperação do administrador real de staging
- As contas recuperadas neste lote foram **sintéticas**: sintético 2 (userId 4, na parte B) e sintético 1 (userId 5, na parte D).
- O **administrador real da plataforma em staging** **não** teve a senha redefinida, e sua credencial atual pode ser anterior ao incidente.
- Quando for autorizado: "Esqueci a senha" na tela de staging com o e-mail do admin, nova entrada no cofre "LiciGov staging — acesso administrativo", login em janela anônima. São 2 e-mails (link + aviso). O lote tem 7 e-mails; usados 4, mais 1 reservado para o teste de produção.
