# Product Roadmap — LiciGov Pro

**Atualizado:** 28/10/2026 — aceite formal da M8 com ressalvas (ciclo "Jornadas integradas"; seções de maio/2026 preservadas abaixo)\
**Versão:** 1.1

> Fonte de verdade da filosofia: [`docs/architecture/PRODUCT_NORTH_STAR.md`](../docs/architecture/PRODUCT_NORTH_STAR.md).
> Regras de execução: `CLAUDE.md` (LICIGOV-FAST). Roadmaps por domínio em `docs/business-domains/*/roadmap.md`.

---

## Ciclo atual (out/2026) — Jornadas institucionais completas

Mudança de estratégia do Owner: entregar **jornadas utilizáveis de ponta a ponta**, reutilizando a arquitetura
existente (REUTILIZAR → INTEGRAR → CORRIGIR → ESTENDER → CRIAR), homologadas em **staging isolado** antes de produção.

### Mapa de reutilização (Graphify `874ed8e` confrontado com o código)

| Componente | Estado | Reutilização | Lacuna real |
|---|---|---|---|
| DFD | FUNCIONAL | Pré-preenchido do contexto canônico, sem IA (`procurementProcessService.generateDFDDraft`, `dfdPrefill`); exporta DOCX/PDF | — |
| ETP | FUNCIONAL | Autoria estruturada reutiliza o DFD (`authoringContext` + `upstreamAuthority`) | — |
| TR | FUNCIONAL | Reutiliza DFD+ETP, itens canônicos e parâmetros estruturados (`renderTrStructuredBlock`) | Itens canônicos com quantidade prevista são pré-requisito (decisão HD-01) |
| Edital | FUNCIONAL (motor padrão) · PARCIAL (modelo BLL) | Motor institucional (`templateCompositionService`, AST v2, catálogo v2, M1/M2, reuso de contexto) | Revisão 2 (datas diferidas) depende de ativação institucional na org real (política/evidência → disponibilizar → troca atômica de binding) |
| Motor documental | FUNCIONAL p/ Edital · PREPARADO p/ demais | `TemplateDocumentKind` já cobre dfd/etp/tr/edital/parecer/contrato/aditivo; Governance V2 (templates próprios/derivados) | Só existe pacote de modelo para o Edital BLL; demais tipos precisam de pacote (não de motor novo) |
| Contratos | PARCIAL | Contract Workspace (avulso, de processo, de contratação direta, reconstrução de externo), RBAC, CAS, timeline | Ativação `minuta → vigente` pendente de definição jurídica (`docs/design/CONTRACT_ACTIVATION_TRANSITION.md`) |
| Aditivos / apostilamentos | FUNCIONAL sobre contrato vigente | Instrumentos com sequência atômica, linhagem própria, termo gerado e exportável | Finalização pós-parecer (valor/quantitativo) e tipo "reequilíbrio" ainda não existem |
| Contratação direta | FUNCIONAL (sem homologação integrada ainda) | Entrada sem DFD (`startOption: sem_dfd`), documentos oficiais, contrato derivado | — |
| Parecer jurídico | PARCIAL | Workspace, assinatura, versão `emitido`, export | Entrada só via solicitação institucional (não avulsa) |
| Processos legados | FUNCIONAL (acompanhamento) · **corrigido** (contrato vigente) | Registros operacionais + importação assistida; **novo** `contractWorkspace.registerInForceContract` | Importação de contrato pelo pipeline de ingestão não existe (usa reconstrução assistida) |
| Calendário | FUNCIONAL | Eventos operacionais + registros com data (grade mensal) | Contratos/processos não alimentam o calendário sem término informado (regra explícita, de propósito) |
| Centro de Operações | FUNCIONAL · **corrigido** | Painel, indicadores, recomendações, timeline | Indicador "vencendo" contava alertas (inflado) — corrigido |

### Staging alinhado (checkpoint de 14/10/2026)
- Linha de homologação `staging` = `main@874ed8e` + PR #297 (squash `2ddcdf5`, árvore idêntica à do head aprovado nos 5 gates).
- Railway/staging passou a acompanhar a branch `staging` (antes `feat/f-emb1-embedding-lineage@b4c6bad`, sem commits
  próprios pendentes); mudança aplicada só no ambiente staging; produção sem alteração.
- Deploy `c7868b88-8bb6-4eb8-98a1-5c34bd6dc56d` **SUCCESS**: pre-deploy oficial (`pnpm db:release:predeploy`, lock de
  migração) aplicou as migrations pendentes 0302→0318; reference data `noop` (draft, não ativado); boot validou pelo
  ledger que `0318_template_governance_transition` está aplicada + tabelas/FKs críticas; health check `/readyz` aprovado.
- Isolamento: `DATABASE_URL` de staging é referência ao MySQL do próprio ambiente; buckets S3 distintos
  (staging `licigov-pro-staging` × produção `licigov-pro-storage-msales`), confirmados pelo Owner.
- Tenant sintético `homologacao-sintetica` criado pelo Owner (administrador de plataforma), com usuários de teste.
- Integração de #301 → #300 → #299 → #298 por squash, cada merge com deploy automático SUCCESS em staging.

### Entregue neste ciclo
- PR #296 — pendências de publicação do Edital visíveis e não bloqueantes (Revisão 1 preservada).
- Contrato **vigente de processo anterior** registrado por declaração (sem recriar DFD/ETP/TR/Edital) → aditivo direto;
  origem `legado`, informação **DECLARADA** (não verificada) na timeline; não altera a ativação de minutas.
- Término de vigência no Cadastro Rápido (contrato/aditivo/ata externos) ⇒ vencimento + alertas 90/60/30/15/7d automáticos.
- Indicador "contratos vencendo" conta contratos (um por referência, janela de 90 dias), não alertas.
- Smoke integrado `integrated-journeys-mysql-smoke` (J1 processo novo, J2 legado→contrato→aditivo, J3 monitoramento).

### Progresso por marco (integrador — atualizado em 28/10/2026 após o aceite formal da M8 com ressalvas)

Legenda de evidência: **SMOKE** = MySQL real + IA mock (CI) · **HTTP-LOCAL** = executor oficial `pnpm homolog:e2e` contra o
MESMO middleware tRPC do servidor (login/cookie/RBAC reais, IA mock, storage em memória) · **STAGING** = execução no staging.
Homologação visual — histórico: **parcial** em 16/10/2026 (processo `2026/9001`, org 2; TR bloqueado e Edital BLL não
alcançado — seção "Rodada M8 — homologação visual" abaixo). **Integral em 27/10/2026** (processo `8828/2026`, org 2), com o
E2E HTTP 4/4 do run `MVR71VFS`; **M8 aceita com ressalvas pelo Owner em 28/10/2026** (seção "Aceite M8" abaixo). Roteiro em
`docs/ops/M8_STAGING_HOMOLOGATION_RUNBOOK.md`. **Produção não homologada.**

| Marco | Peso | % | Evidência | Próxima ação / bloqueador |
|---|---|---|---|---|
| M0 — Staging e baseline | 10 | 100 | Deploy SUCCESS a cada merge; ledger até 0318; MySQL/S3 próprios; tenant `homologacao-sintetica` | — |
| M1 — Graphify e reutilização | 5 | 100 | Mapa de reutilização; grafo regenerado por merge e idempotente | — |
| M2 — BLL diferido | 10 | 90 | Minuta BLL Rev. 2 gerada sobre TR emitido: 7 dados "A DEFINIR PARA PUBLICAÇÃO", 0 datas inventadas (SMOKE + HTTP-LOCAL) | Rev. 2 vinculada no tenant sintético do staging; ativação na org real é decisão institucional |
| M3 — Motor documental | 10 | 90 | Mesmo motor para Edital BLL; mesma exportação/versionamento para DFD/ETP/TR/termos | Pacotes de modelo para os demais tipos |
| M4 — Jornada principal | 15 | 90 | DFD → ETP → TR (emitido por outro usuário) → Edital BLL → DOCX/PDF, replay (SMOKE + HTTP-LOCAL; STAGING contado em M8) | Homologação visual concluída em 27/10/2026, contada só no M8; percentual mantido até deliberação do Owner |
| M5 — Processos legados | 10 | 90 | Registro legado → contrato vigente → histórico declarado → aditivo; extrator de importação corrigido (STAGING contado em M8) | Jornada B aprovada em staging em 27/10/2026, contada só no M8; percentual mantido até deliberação do Owner |
| M6 — Contratos/aditivos/direta | 10 | 80 | Reagendamento de vigência, termo DOCX/PDF; contratação direta sem DFD (SMOKE) | Ativação de minuta e pós-parecer pendentes (jurídico) |
| M7 — Pareceres/monitoramento | 10 | 80 | Calendário/alertas/indicador sem duplicidade (HTTP-LOCAL); pedido de parecer sem parecer fabricado (SMOKE) | Parecer avulso |
| M8 — Homologação E2E staging | 15 | 100 | **ACEITA COM RESSALVAS (Owner, 28/10/2026)**: HTTP real 4/4 em STAGING (run `MVR71VFS`, processo `9992/2026`; histórico: run `MV9SXMKG`, 15/10/2026) + homologação visual integral (processo `8828/2026`), staging `967a931`, org 2 sintética | Ressalvas pré-produção P1/P2/P3 (seção "Aceite M8"); produção não homologada |
| M9 — Regras/roadmap/integração | 5 | 95 | #298–#304 integrados por squash; conflitos só em artefatos do Graphify (regenerados) | — |
| **Global ponderado** | 100 | **91,25** | Σ(peso × %) / 100; cada entrega contada num único marco | — |

**Cálculo rastreável (28/10/2026):**
- Global anterior: **88,25%** (M8 em 80%).
- O que mudou foi só o M8, de 80% para 100%: os 20% da homologação visual, comprovada em 27/10/2026 e aceita pelo Owner
  com ressalvas em 28/10/2026.
- Novo global = 88,25 + 15 × (100 − 80) / 100 = **91,25%**.
- Demais marcos **inalterados**; pesos e critérios inalterados; a evidência de staging continua contada só no M8.
- **91,25% não significa plataforma homologada para produção.** Permanecem as ressalvas pré-produção da M8, a ativação
  na organização real (decisão institucional), os itens pendentes de M3, M6 e M7 e o incidente de credenciais P0.

**Cálculo rastreável — histórico (15/10/2026):**
- Global anterior: **83,75%**, valor histórico até 15/10/2026, antes da execução em staging.
- O que mudou foi só o M8, de 50% para 80%. Composição do marco:
  - 50%: executor pronto e verde em HTTP-LOCAL (já contado);
  - +30%: execução HTTP real **em STAGING** aprovada 4/4;
  - 20%: homologação visual, pendente.
- Novo global = 83,75 + 15 × (80 − 50) / 100 = **88,25%**.
- M2, M4 e M5 ficaram **inalterados**: a evidência de staging é contada só uma vez, no M8.
- **88,25% não significa plataforma homologada para produção.** Faltam a homologação visual, a ativação na organização
  real (decisão institucional) e os itens pendentes de M3, M6 e M7.

### Rodada M8 — correções da homologação real em staging (15/10/2026)

Origem: homologação manual do Owner no tenant sintético (org 2 "Prefeitura Sintética — Homologação", processo 2026/0001 —
histórico preservado; a validação desta rodada usa processo sintético NOVO). Branch `fix/m8-homologation-round` → PR para `staging`.

| ID | Defeito / melhoria | Correção | Evidência |
|---|---|---|---|
| M8-PRICE-IMPORT-001 | 1 item com 3 cotações virou 36 itens / 46 cotações (leitor "uma linha = um item"); CATMAT para metadados | Leitor estruturado (cabeçalho/metadado/item/quantidade/unidade/cotação/aviso), prévia sem gravação, ambiguidade recusada sem escrita, fonte fictícia sinalizada, CATMAT só para item real, resíduos antigos sinalizados para rejeição humana | Unit + SMOKE J4 (1 item, 3 cotações, média R$ 4.000,00, total R$ 40.000,00, reimportação idempotente, isolamento) |
| M8-AI-DFD-001 | Metadados da IA ("Pontuação de confiança", "Fatos utilizados") no texto do DFD | Contrato estruturado {parágrafos, lacunas, avisos}, validação por parágrafo antes da apresentação, fallback seguro, inserção sem título duplicado | Unit + SMOKE (provider mock no contrato) |
| M8-UX-GOV-001 | Redigitação de autoridade/cargo/ato em cada campo governado | Autoridade eletrônica do usuário autenticado por padrão; ato formal opcional e completo; evidência jurídica inalterada | Unit (router) + SMOKE FAST-6 |
| M8-TR-UX-001 | TR sem reuso de padrões institucionais em tenant novo | Padrões elegíveis definidos uma vez no Perfil (proposta confirmada por processo; nada aplicado em silêncio); métrica `structuredProposed` | Unit (view-model) |
| M8-EDITAL-UX-001 | Pendências sem indicar o que bloqueiam | Nível de bloqueio por pendência (elaboração × só publicação) + resumo; configuração única explicitada | Unit (view-model) |
| ETP coerência | "Fundamentado" com fatos insuficientes | Fundamentação normativa × suficiência factual; viabilidade preliminar com lacunas; divergência texto × base legal estruturada como ressalva | Unit |

Até a execução em staging, os percentuais ficaram **mantidos** (83,75%). O marco só subiu com a evidência registrada a seguir.

**Histórico de integração em `staging` (15–16/10/2026):**
- PR #302 integrado em `staging` por squash (`af0aa48`), com os 5 gates do CI verdes.
- Deploy Railway staging `45831881` **SUCCESS**. Predeploy em 124 ms: migrations já em dia, nenhuma nova; reference
  set em noop. Boot `APP_ENV=staging`, S3 ✓, IA ✓, schema validado, sem erros nem avisos após a inicialização.
  Produção não foi tocada.
- PR #303 (`f867a25`): runbook da homologação e estado real; só documentação. Deploy `1d3a7bd6` SUCCESS.
- PR #304 (`034ce42`): o executor envia `X-Organization-Id` a usuários com várias organizações (`HOMOLOG_ORGANIZATION_ID`)
  e exige papel `manager` ou superior. Regras do backend inalteradas. Deploy `9f783de0` SUCCESS.
  - Primeira tentativa no staging: falhou antes das jornadas com "múltiplas organizações". Esta foi a causa da correção.
- O processo 2026/0001 fica preservado como evidência histórica, com os 36 itens do leitor antigo mantidos e sinalizados.
  Nenhuma limpeza foi feita nem é exigida.
- PR #305 (`4c4b17d`): evidência E2E 4/4, Roadmap Mestre e roteiro visual. Deploy `961c848c` SUCCESS.
- **PR #306 (`4f79127`, 16/10/2026):** correções da homologação visual + CATMAT/CATSER sobre o catálogo oficial.
  - Squash autorizado pelo Owner com HEAD `1a930c8`, CI 5/5 verde e sem conflitos.
  - Smoke real pré-merge OK: GitHub Actions run `38948484321`, consulta por código nos dois catálogos.
  - Deploy Railway staging `6cd34c68` **SUCCESS**:
    - predeploy em 51 ms, com migrations já em dia (nenhuma nova) e reference set em noop;
    - boot `APP_ENV=staging`, S3 ✓, IA ✓, schema validado sem mutação em runtime, servidor pronto;
    - 1 réplica online, 0 falhas, 0 erros ou avisos de runtime;
    - recuperação de importação sem pendências.
  - Nenhum dado modificado.
  - `catalog:sync` **não executado**: a sincronização inicial do CATSER é operação institucional separada, sob autorização
    expressa do Owner.
  - Produção e `main` não tocadas. Percentuais inalterados (M8 80%, global 88,25%).

#### Marco M8 — Homologação E2E HTTP real: **APROVADO (4/4)**

- **Origem dos dados:** transcrição do relatório fornecido pelo Owner, em
  `docs/ops/evidence/M8_E2E_HTTP_STAGING_2026-10-15.json`, sem validação independente adicional.
- **Execução:**
  - Run `MV9SXMKG`, em 15/10/2026, no Console do Railway staging.
  - Código em staging: `034ce42`.
  - Organização 2 (`homologacao-sintetica`), com papéis `manager` / `manager`.
  - Modo: HTTP real pelas APIs oficiais.
  - Vitest: 1 arquivo e 4 testes aprovados, em 122,97 s.
- **Jornada A:** novo processo `4256/2026` → DFD → ETP → Pesquisa → Itens → TR → Edital BLL **Revisão 2 (BOUND)**.
  - Oito exportações DOCX/PDF, todas em **rascunho**: DFD 9.108/3.911 B; ETP 10.957/9.876 B; TR 11.028/9.898 B;
    Edital 37.911/87.723 B.
  - Não houve publicação oficial nem aprovação jurídica definitiva.
- **Jornada B:**
  - Contrato legado `11dc53b1f99127512a03` registrado, com 1 aditivo anterior reconhecido.
  - Novo término em 2027-11-29.
  - Termo DOCX/PDF com 9.031/3.731 B.
  - Repetição da chamada (replay) validada.
- **Jornada C:** registro `6de147d28fe137a95311`, com 3 eventos no calendário e alertas sem duplicidade, integrados ao
  Centro de Operações.
- **Isolamento:** acesso entre organizações recusado no cenário coberto.
- **Correções M8 validadas no cenário testado** (não generalizar para todos os formatos documentais):
  - Pesquisa de preços: 1 item e 3 cotações, média R$ 4.000,00 e total R$ 40.000,00; 7 linhas não-item ignoradas;
    entrada ambígua recusada.
  - IA do DFD: contrato estruturado, com 7 lacunas e 2 avisos fora do texto e 0 trechos descartados.
- **Pendências legítimas:** são pendências da fase atual, não defeitos.
  - Marcadores `[REVISAR]`: ETP 11, TR 9 e Edital 3. São lacunas factuais e precisam de revisão humana.
  - Publicação diferida: `complete: false`, com 7 dados pendentes, conforme o contrato `DEFERRED_PUBLICATION` da Rev. 2.
    - As 10 ocorrências do texto vêm dessas 7 variáveis; o AST do modelo tem 12 referências, 6 delas ao número do pregão.
    - Nenhuma data fictícia foi preenchida.
- **Limites do escopo:**
  - Não é homologação visual.
  - Os documentos são rascunhos, não documentos oficiais publicados.
  - A IA do staging foi exercitada só na sugestão do DFD.
  - Nada foi executado na organização real.

#### Produtividade operacional (medida na execução) — o que é automático × o que ainda é humano

| Etapa | Automático / reaproveitado | Ainda humano | Leitura |
|---|---|---|---|
| DFD | 6 de 11 campos pré-preenchidos; sugestão de IA estruturada | 5 campos desconhecidos; revisar lacunas (7) e avisos (2) | Adequado; IA supervisionada |
| Pesquisa | 1 item e 3 cotações agrupados; 7 linhas ignoradas | Conferir a prévia e importar | Defeito M8 corrigido no cenário |
| TR | 0 pré-preenchidos, 0 propostas | **21 de 37 parâmetros confirmados manualmente**; 9 `[REVISAR]` | **Maior carga manual restante** |
| Edital BLL | 20 automáticos, 33 do órgão, 21 vindos do TR, 1 projeção do TR | 12 decisões do certame; 7 dados de publicação (depois) | Bom reuso; decisões do certame legítimas |

- **TR:** a ausência de propostas é **efeito do cenário**, não regressão. As propostas vêm só dos padrões institucionais
  do Perfil. O executor registrou o Perfil sem padrões e mediu o TR antes das confirmações.
  - O recurso M8-TR-UX-001 permite definir padrões no Perfil para até 9 campos elegíveis: pagamento, prazos, recebimento
    e reajuste.
  - Esse recurso **não foi exercitado** na execução. Medir na homologação visual quanto ele reduz os 21 campos manuais.
- **Edital:** `MANUAL_DECISIONS_VISIBLE: 0` é o estado medido **depois** das 12 decisões registradas pelo executor, não
  ausência de trabalho humano.

### Rodada M8 — homologação visual (parcial) e correções direcionadas (16/10/2026)

Origem: homologação visual do Owner no staging (`4c4b17d`, deploy `961c848c`), org 2, processo `2026/9001`, Perfil revisão 5
com 9 padrões do TR. Branch `fix/m8-visual-round` → PR para `staging` (sem merge automático). Nenhuma migration; nenhum
processo histórico, binding ou decisão registrada alterados.

**Comprovado na tela (preservado):** padrões do TR reduziram as pendências de 21 para 12 (−42,9%); sugestão de IA do DFD
editada e aceita ("Alterado por você"); importação de preços com 1 item, 3 cotações, 10 unidades, média R$ 4.000,00, total
R$ 40.000,00 e 7 linhas ignoradas; item aprovado (CATMAT não confirmado) e incorporado; ETP com 6 evidências normativas,
8 lacunas factuais e emissão bloqueada por `[REVISAR]`; Edital pedindo modalidade/forma.

| Achado | Classificação | Causa (código) | Tratamento |
|---|---|---|---|
| P1 DFD — `[REVISAR: …]` e hipóteses não fundamentadas na justificativa | **Confirmado** | Prompt mandava marcar lacunas no texto e não proibia presumir motivação/impactos | Prompt `dfd-justificativa/3` + contrato `/2`: frase com marcador sai do texto e vira lacuna listada; recusa explícita quando nada sobra, dizendo o que falta. Lacunas continuam visíveis; aceite humano; histórico intacto |
| P1 TR — "Autoria estruturada inválida (fail-closed) … Fundamentação" | **Confirmado** | O prompt do TR não declarava as seções de mínimo legal; a IA as omitia e a validação (correta) recusava com mensagem técnica | Validação **inalterada**. Prompt declara as seções de mínimo legal (redigir com `[REVISAR]` o que faltar). Recusa traduzida: motivo, onde complementar (ex.: Fundamentação → ETP), próxima ação, e distinção rascunho × emissão. Proveniência `failed` continua gravada; nada é gravado no documento (SMOKE J5) |
| P1 ETP "v1 · gerado" em "Documentos oficiais (versões emitidas)" | **Confirmado (apresentação)** | Cada geração grava um snapshot técnico `gerado` no ledger oficial (append-only, usado no replay); o painel listava tudo | Painel separa versões **emitidas** de "Versões técnicas (snapshots — não emitidas)", recolhidas. Ledger, numeração, hashes e replay inalterados |
| P1 Edital — formulário da aba × fluxo BLL Rev. 2 | **Confirmado (UX)** | Os campos legados (critério/regime) apareciam antes de saber se havia modelo vinculado | Campos legados só aparecem quando não há modelo vinculado; antes disso, orientação única. Nenhum padrão assumido; Rev. 2, binding, `DEFERRED_PUBLICATION` e preflight inalterados |
| P2 indicador de itens sem atualizar após incorporar | **Confirmado** | Invalidação de cache incompleta | Invalida participação dos itens e preparação/preflight do Edital |
| P2 botão "Aprovar item" após aprovado | **Confirmado** | Rótulo não refletia o estado | "Item aprovado" desabilitado com fonte vigente; aprovação desatualizada continua mostrando o motivo. Idempotência do backend inalterada |
| P2 CATMAT "confiança 80%" | **Confirmado** | Candidatos gerados localmente (código derivado da descrição) e pontuados por palavras em comum — não há consulta ao catálogo oficial | **Resolvido na reconciliação abaixo** (decisão do Owner: reutilizar a integração oficial existente). Limiar não configurado; decisões intactas |
| P2 ETP — conclusões (lote único, benefícios) sem análise | **Confirmado** | Prompt não distinguia fato × conclusão | Regra de inferência no prompt (conclusão sem análise ⇒ `[REVISAR: decisão/análise necessária]`); lista "O que falta completar" por seção no ETP/TR, sem caçar marcadores |
| `Load failed` na 1ª criação do `2026/9001` | **Não reproduzido** | Intermitente de rede/cliente; sem evidência no servidor | Registrado; nenhuma correção especulativa |
| Edital — modalidade/forma vazias após recarregar | **Comportamento conhecido** | O rascunho institucional não persiste esses parâmetros | Documentado para rodada futura (fallback pelo processo/manifesto) |

**Evidência:** client 79 arquivos / 951 testes; servidor afetado 18 / 264; smokes MySQL 16 / 112 (incl. J5 novo); `tsc`,
lint dos arquivos alterados e build limpos.

**Percentuais mantidos (M8 80%, global 88,25%).** Os 20% restantes do M8 exigem a homologação visual completa — TR gerado
e Edital BLL alcançado na tela —, o que ainda não ocorreu.

#### Reconciliação CATMAT/CATSER com o catálogo oficial (16/10/2026, mesmo PR #306)

**Diagnóstico (Graphify + código):**
- A integração oficial já existia: `catmatRouter`, com consulta a `dadosabertos.compras.gov.br`. Só a busca pública do
  modal legado do TR a usava, e esse modal está fora da navegação.
- Os Itens Inteligentes usavam `catmatCandidates()`: códigos de 6 dígitos derivados de SHA-256 da descrição, sem existência
  comprovada. Esse gerador era chamado em três pontos: enriquecimento pós-importação, `resolveAvailableSuggestions` e
  `searchCATMAT`.
- A tabela `item_catmat_matches` não guarda a fonte da sugestão. Por isso o ledger registrava `catalogo-interno` por padrão.
- **Brecha confirmada:** com o limiar configurado, um código gerado por hash podia ser confirmado como `catalogo-interno`.
  - O limiar só era exigido como existente, nunca comparado ao score.
  - A exposição real não foi medida: esta sessão não tem acesso aos bancos de staging e produção. Decisões já registradas
    não foram alteradas.
  - Na homologação visual do `2026/9001`, o limiar não estava configurado, e nenhuma confirmação foi feita.
- A infraestrutura `catalog_snapshots` / `catalog_entries` (migrations 0070/0071) existia sem nenhum gravador em runtime.

**Fluxo único:**
1. Item: a importação de preços não gera nem consulta catálogo, para não prender a pesquisa à latência da API externa.
2. "Buscar classificação": o servidor indica a natureza (CATMAT = material, CATSER = serviço), e o mesmo cliente do
   `catmatRouter` consulta o catálogo oficial.
3. Evidência por órgão: snapshot imutável com fonte, URL, consulta, instante, checksum e correlationId, mais as entradas com a
   descrição oficial e a situação.
4. Ranking textual, aplicado só aos códigos retornados.
5. Decisão humana no ledger. Confirmar exige sugestão **verificada** (mesmo código, mesma descrição oficial, ativa), e a fonte
   gravada é `api-comprasgov:catmat|catser`.

**Garantias:**
- Sugestão legada ou gerada por hash continua visível, mas marcada "sem proveniência" e **não confirmável**, mesmo com limiar
  configurado (`CATMAT_SUGGESTION_UNVERIFIED`, nada gravado).
- A verificação roda dentro da execução idempotente: o replay devolve a decisão original mesmo que a fonte mude depois.
- Nova consulta não substitui a decisão humana.
- Substituição manual continua permitida, com justificativa. Ela recebe o rótulo `manual+api-comprasgov:…` só se o mesmo código
  tiver evidência oficial.
- Catálogo indisponível (desligado, timeout, HTTP, rede ou resposta malformada) resulta em "indisponível": nenhum código, nada
  gravado, classificação pendente, falha registrada na linha do tempo e retentativa possível.
- Sem migration. Histórico (sugestões, decisões, `suggestedCatmat` antigo) preservado, sem reescrita.

**Evidência:**
- Unit: catálogo oficial 17 testes (parser, timeout real, cache, indisponibilidade, código inexistente/inativo, verificação
  adversarial).
- SMOKE novo `catalog-official-classification-mysql-smoke`: 6 testes (importação M8 preservada, hash não confirmável com
  limiar, busca → evidência → confirmação → replay, CATSER, indisponível, tenant).
- Smokes CATMAT existentes adaptados ao fluxo oficial, sem afrouxar asserções.
- Suíte completa sem banco: 545 arquivos, sem falhas.
- Smoke de segurança: 39 arquivos / 408 testes.
- `tsc`, lint dos arquivos alterados e build limpos.

**Validação real (Owner, Console do Railway staging, 16/10/2026) — o 1º contrato estava incorreto:**
- CATMAT `descricaoItem=notebook`: HTTP 200, `resultado: []`, `totalRegistros: 0`.
- CATSER `descricaoItem=limpeza`: HTTP 200, mas devolveu endoscopia e outros serviços hospitalares. O filtro textual não
  existe nesse endpoint e foi ignorado. O payload usa `codigoServico`/`nomeServico`/`statusServico`.
- As duas APIs exigem `tamanhoPagina` ≥ 10.
- O 1º commit usava `descricaoItem`/`statusItem`/`codigoItem` nos dois catálogos. **Merge suspenso pelo Owner.**

**Emenda (mesmo PR #306) — estratégia que funciona com a API real:**
- **Contratos HTTP separados** no mesmo cliente (`OFFICIAL_CATALOG_CONTRACTS`):
  - CATMAT `codigoItem`/`statusItem`/`descricaoItem`;
  - CATSER `codigoServico`/`statusServico`, sem parâmetro textual. Enviar um é recusado no próprio código;
  - `pagina` + `tamanhoPagina` (≥ 10) sempre enviados.
- **CATMAT:** a busca textual oficial passa sempre pelo filtro de relevância local (`catalogSearchEngine`, que já existia).
  - Vazio é resposta legítima.
  - Linhas sem relação com o termo são tratadas como filtro possivelmente ignorado, e nada é sugerido.
  - O comportamento real de `descricaoItem` (exato × parcial × maiúsculas) é **medido** pelo `catalog:smoke`, não presumido.
- **CATSER:** índice de pesquisa sincronizado reaproveitando `catalog_snapshots`/`catalog_entries` (organização global 0,
  convenção existente de `normalizeCatalogEntry`), sem migration.
  - A sincronização é explícita e limitada (`pnpm catalog:sync -- catser`). Tem limite de páginas, uma leitura por página e
    snapshot versionado com checksum. Falha não grava nada; atingir o limite gera snapshot parcial.
  - A busca usa o mesmo motor local.
  - Os ≤ 5 melhores candidatos são **verificados um a um por `codigoServico`** na fonte, e só os ativos e relevantes viram
    sugestão.
  - Sem índice, a resposta é "busca indisponível", com orientação para verificar o código.
- **Verificar código** (CATMAT/CATSER): o servidor informa o código e a fonte confirma existência, descrição e situação.
  Inexistente ou inativo não gera sugestão.
- **Preservado:** verificação oficial por código, evidência por órgão, snapshots imutáveis, replay, isolamento (o índice
  global só encontra candidatos; a evidência é do órgão) e decisão humana no ledger.

**Evidência da emenda:**
- Unit do catálogo: 22 (contratos por catálogo, paginação, vazio legítimo, filtro ignorado, "limpeza" × serviços
  hospitalares, timeout, cache, código).
- SMOKE do fluxo: 11 (sincronização paginada, parcial e com falha; CATSER por índice + `codigoServico`; defasagem
  inativa; CATMAT vazio e filtro ignorado; verificar código; confirmação; replay; tenant).
- Smokes CATMAT, jornadas e isolamento verdes.

**Atomicidade e exclusividade do índice (revisões do Owner):**
- A publicação usa **uma conexão dedicada**, porque o `GET_LOCK` pertence à conexão. A ordem é GET_LOCK, transação nessa
  conexão, commit ou rollback, RELEASE_LOCK e devolução da conexão.
  - O lock fica retido até o commit efetivo.
  - A espera pelo lock é limitada (30 s, configurável). Esgotada, a publicação é recusada e nada é gravado.
- As regras são revalidadas **dentro** da serialização:
  - parcial sobre completo vigente ⇒ recusado;
  - conteúdo igual ao vigente ⇒ replay sem escrita;
  - conteúdo de um snapshot anterior ⇒ reconduzido a vigente, alterando só o metadado.
- O snapshot vigente é o de maior `publishedAt`, tirado do relógio do MySQL dentro da serialização (segue a ordem dos commits).
- As entradas são versionadas **por snapshot**: o índice publicado nunca é reescrito.
- Falha no meio da gravação ⇒ rollback: nada visível, índice anterior intacto.
- Testes MySQL de concorrência real nas duas ordens. A 1ª publicação fica pausada dentro da transação e a 2ª fica comprovadamente
  bloqueada até o commit.
  - Parcial → completo: o completo publica e vira vigente.
  - Completo → parcial: o parcial é recusado.
  - Replay e recondução verificados.

**Smoke real PRÉ-MERGE:** workflow manual `catalog-official-smoke.yml`, disparado pela label `catalog-smoke` no PR ou por
`workflow_dispatch`.
- Roda `pnpm catalog:smoke` sobre o HEAD exato do PR.
- Sem segredos e sem banco, com token só de leitura.
- O relatório fica nos logs e no artefato `catalog-smoke-<sha>`.

**Smoke real PRÉ-MERGE — RESULTADO** (GitHub Actions run `38948484321`, HEAD `16e80d4`, 16/10/2026, sem segredos e sem
banco; saída 0):
- **CATMAT:**
  - Envelope `resultado/totalRegistros/totalPaginas/paginasRestantes`; total **250.034** itens.
  - `codigoItem=206504` encontrado, descrição idêntica, ativo.
  - `descricaoItem` = **descrição oficial COMPLETA**: 1 linha, que contém a amostra.
  - `descricaoItem` = 1ª palavra (maiúsculas ou minúsculas), "notebook", "NOTEBOOK" ou termo inexistente: **0 linhas**.
  - ⇒ O filtro é aplicado, mas só como **correspondência exata da descrição completa**. Não serve como busca livre.
  - `tamanhoPagina=9` ⇒ HTTP 400 (mínimo 10 confirmado).
- **CATSER:**
  - Mesmo envelope; total **3.022** serviços.
  - `codigoServico=7250` encontrado, descrição idêntica, ativo.
  - `descricaoItem` (não documentado) **ignorado** (devolve linhas), como previsto.
  - `tamanhoPagina` 100 e 500 aceitos ⇒ sincronização ≈ 31 páginas de 100 (ou 7 de 500).
- **Conclusões:**
  - Contratos por catálogo e consulta por código **confirmados em runtime**.
  - Busca CATSER por índice + `codigoServico` **viável e dimensionada** (3.022 linhas).
  - No CATMAT, o caminho prático é **"Verificar código"**. A busca textual oficial só acha a descrição exata, e a tela agora diz
    isso.
  - Busca livre no CATMAT exigiria índice próprio (250 mil itens ≈ 500 páginas de 500) ou a hierarquia PDM. **Decisão do
    Owner, fora deste PR.**

**Sincronização `catalog:sync` NÃO executada.** Ela só pode ocorrer após a validação real, o dimensionamento pelo smoke e a
autorização expressa do Owner.

### Aceite M8 — homologação conclusiva em staging (27–28/10/2026)

**Decisão do Owner (28/10/2026):** M8 **ACEITA COM RESSALVAS — 100%**. Progresso global ponderado aprovado: **91,25%**.
- A aceitação é **funcional e limitada ao staging**. Não constitui aprovação para uso institucional em produção.
- Não autoriza publicar documentos, promover `staging` → `main` nem encerrar outras pendências institucionais.
- **Produção: NÃO HOMOLOGADA.** Incidente de credenciais P0 **permanece aberto**.

**Histórico que antecede o aceite (preservado):**
- 15/10/2026 — E2E HTTP 4/4 (run `MV9SXMKG`, processo `4256/2026`), seção "Marco M8" acima.
- 16/10/2026 — homologação visual parcial (processo `2026/9001`) e correções, seção "Rodada M8 — homologação visual" acima.
- 27/10/2026 — reexecução integrada **3/4** (run `MVQO27FI`, processo `8830/2026`): B, C e ISO aprovados; A parou na emissão
  do TR com `EMISSION_FICTITIOUS_PRICES` (exceção de valores demonstrativos não habilitada). Origem do pré-flight antes de
  qualquer escrita (registro no runbook M8).
- 27/10/2026 — PR #329 (correções pós-homologação, incluindo NEW-007 e pré-flight com bloqueios registrados no relatório)
  integrado em `staging` por squash (`967a931`), CI 5/5 no head `f59cfce`; deploy Railway staging `f94200ac` SUCCESS.

**Ambiente da homologação conclusiva:**
- Staging `967a931`; deployment Railway `a7a30280` (reinício único para ativar a exceção demonstrativa); `/healthz` e
  `/readyz` HTTP 200 com banco `ok`.
- Organização 2 (`homologacao-sintetica`). Identidades: usuário 5 (elabora) e usuário 4 (emite), distintos, papel
  `manager`, vínculo ativo só na org 2. É segregação técnica de identidades, operadas pela mesma pessoa; não equivale a
  duas autoridades independentes. Nenhum ato desta homologação é ato institucional de órgão real.

#### Homologação HTTP — executor oficial `pnpm homolog:e2e`, run `MVR71VFS`: **APROVADO 4/4**
- Pré-flight de segurança `PASSED` antes de qualquer escrita (`writesPerformed: 0`): destino autorizado, duas identidades
  distintas `manager`, tenant sintético, exceção demonstrativa habilitada.
- **A** — processo novo `9992/2026`: pesquisa com 1 item e 3 cotações (média R$ 4.000,00, total R$ 40.000,00, 7 linhas
  ignoradas, entrada ambígua recusada); DFD 6 de 11 campos pré-preenchidos; TR com 37 parâmetros ativos (9 propostos por
  padrão institucional, 21 confirmados) e `redundantReviewMarkers = 0`; TR emitido por outra identidade; Edital BLL
  Revisão 2 `BOUND` (185 campos do modelo, 7 dados de publicação diferidos); DOCX/PDF de DFD, ETP, TR e Edital.
- **B** — contrato legado com 1 aditivo anterior declarado → aditivo com novo término → termo DOCX/PDF.
- **C** — contrato externo com término → 3 eventos no calendário, sem duplicidade → Centro de Operações.
- **ISO** — organização alheia recusada (HTTP 403 confirmado nos logs do Railway). Limites: o teste usa um id inexistente,
  não a organização 1, e não fica registrado no JSON do relatório.
- No executor, os `[REVISAR]` do TR são substituídos por script antes da emissão; a revisão humana real foi exercitada
  na jornada visual.

#### Homologação visual integral — processo novo `8828/2026`, pela interface
Interface real do staging operada por navegador automatizado, com as duas identidades acima.
- **DFD:** sugestão de justificativa por IA sem metadados técnicos; 4 lacunas e 3 avisos fora do texto; aceita sem
  edição; persistida após recarregar.
- **Pesquisa de Preços:** prévia antes da importação — 1 item, 3 cotações, média R$ 4.000,00, total R$ 40.000,00, fonte
  fictícia identificada, 7 linhas ignoradas; importação sem duplicar.
- **Itens:** item aprovado; CATMAT/CATSER **não confirmado** (limiar institucional não configurado — fail-closed mantido,
  sem alteração de limiar); item da contratação confirmado com quantidade prevista 10.
- **ETP:** gerado (6 evidências normativas, 12 lacunas legítimas listadas fora do texto). **Não emitido** nesta jornada.
- **TR:** 21 parâmetros estruturados confirmados (detalhe nas métricas). Geração recusada com mensagem clara enquanto
  faltavam os itens da contratação; depois, rascunho com todos os parâmetros no texto e 6 `[REVISAR]` legítimos,
  resolvidos com texto sintético marcado e revisado.
- **Emissão interna do TR** pela identidade emissora (usuário 4): versão oficial **v2** (`4b46d60f`), preservada e
  imutável; nova emissão de conteúdo idêntico bloqueada.
- **Edital BLL Revisão 2** (modelo `33ee30bc`), vinculado ao TR emitido: 74 informações reaproveitadas; 4 dados
  resolvidos na origem (data-base 10/10/2026 e divulgação pública na Pesquisa; participação exclusiva ME/EPP nos Itens);
  12 decisões do certame registradas pelo usuário autenticado, sem ato formal; minuta composta pelo modelo; 4 `[REVISAR]`
  de narrativas resolvidos; 2 desvios estruturais reconhecidos; emissão interna **v2** pela identidade emissora.
- **DOCX/PDF verificados:** TR (4 páginas) e Edital (24 páginas) com status `EMITIDO`, versão 2, sem `[REVISAR]`, dados
  de publicação como "A DEFINIR PARA PUBLICAÇÃO" (nenhuma data inventada), sem conteúdo de organização real.
- Nenhuma publicação externa, envio à BLL/PNCP, parecer jurídico ou ato institucional.

#### Métricas LICIGOV-FAST (jornada visual)
| Etapa | Automático / reaproveitado | Humano | Leitura |
|---|---|---|---|
| DFD | Sugestão de IA aceita sem edição | Revisão das lacunas | Adequado |
| TR | **9 de 21** parâmetros por padrão institucional, com 1 confirmação | **12** preenchidos (11 + 1 condicional); 6 `[REVISAR]` legítimos | **Nenhum pedido redundante** (métrica textual e leitura humana) |
| Edital BLL | **74** informações reaproveitadas | 4 dados na origem; 12 decisões do certame; 7 de publicação diferidos | Bom reuso; decisões legítimas |

**Pontos de atrito remanescentes:** itens da contratação em passo separado (com o atalho "Usar 10 como quantidade
prevista"); decisões condicionais do modo de disputa "aberto" exibidas só após a 1ª gravação; dotação orçamentária
pedida no TR e de novo no Edital.

#### Contenção da exceção de valores demonstrativos
1. Exceção autorizada pelo Owner exclusivamente para a organização sintética 2 (`HOMOLOGATION_DEMONSTRATIVE_ORG_IDS`),
   só no serviço staging; reinício único (`a7a30280`).
2. Homologação concluída (E2E e jornada visual).
3. Variável removida do serviço staging pelo Owner (28/10/2026).
4. Deployment staging `a9a6dbcc` **SUCCESS**, mesmo commit `967a931`; predeploy sem alterações; schema validado no boot.
5. `/healthz` e `/readyz` HTTP 200, banco `ok`.
6. `demonstrativePricesAllowed = false` novamente para a organização 2 (consulta somente leitura).
7. `main` (`9ea5bcd`) e produção (deployment `02a34d52`) inalteradas.

#### Auditoria independente (somente leitura)
Configuração, isolamento (logs com apenas a organização 2 e as identidades 4 e 5), ausência de efeitos externos (DNS só
banco, S3 do staging e provedor de IA) e documentos confirmados. Nenhum impedimento ao aceite funcional; ressalvas abaixo.

#### Ressalvas pré-produção (abertas)
- **P1 — Interface do Edital:** na preparação, o campo desaparece depois de preenchido; em campos de duração, a unidade
  permanece no padrão "dia(s)" se não for escolhida antes do número.
- **P2 — Integridade/apresentação documental:** id interno e hash do TR aparecem no Anexo I do Edital emitido; rodapé de
  rascunho aparece no TR emitido.
- **P3 — Qualidade e experiência:** textos "Texto sintético de <chave>" vindos do perfil de homologação; lista técnica de
  fontes no TR; rótulo "v2" na primeira emissão; dotação solicitada novamente; decisões condicionais exibidas somente
  após gravação.

**Limitações de cobertura:**
- Acompanhamento assíncrono da geração não exercitado visualmente (as gerações concluíram dentro da requisição).
- Recusa de autoemissão pela mesma identidade não exercitada visualmente.
- Proteção da organização 1 fundamentada em código e testes, sem autenticação ou escrita de homologação nela.
- Capturas de tela da homologação contêm e-mails das contas de teste e não são anexadas nem publicadas.

#### Pendências independentes (preservadas, sem nova classificação)
- Incidente de credenciais P0 — aberto.
- Políticas institucionais pendentes, incluindo G-3 (novas versões oficiais) e a segregação solicitante × parecerista.
- Numeração ambígua de processos.
- Parecer avulso.
- Contratos/aditivos: ativação de minuta e finalização de aditivo pós-parecer ainda não concluídas.
- Ativação da Revisão 2 do Edital BLL na organização real — decisão institucional.
- Demais limitações de prontidão para produção registradas nos marcos M3, M6 e M7.

Processos sintéticos `9992/2026` e `8828/2026` preservados como evidência.

### P0 — disponibilização funcional
- ✅ Staging alinhado à baseline de produção (branch `staging`, banco/secrets/storage próprios) — 14/10/2026. ✅ Homologação integrada pelas telas (tenant sintético) — aceita com ressalvas em 28/10/2026 (M8); **produção não homologada**.
- Motor documental reutilizado; jornada DFD → ETP → TR → Edital com placeholders contextuais, elaboração e exportação.
- Entrada flexível de processos legados (acompanhamento, contrato vigente, aditivo).
- Ativação da Revisão 2 do Edital BLL na organização real — **decisão institucional da prefeitura**, nunca simulada.

### P1
- Contratos e aditivos: comando de ativação de minuta (após definição jurídica), finalização de aditivo pós-parecer, reequilíbrio.
- Contratação direta: homologação integrada da jornada completa.
- Parecer jurídico assistido: entrada avulsa (sem solicitação prévia) com análise/conclusão/assinatura humanas.
- Calendário e Centro de Operações: datas de sessão do processo e vigência de contratos do workspace como fontes, com regra explícita.
- Templates próprios e derivados para DFD/ETP/TR/contrato/aditivo (pacotes no mesmo motor).

### P2
- Integrações adicionais (PNCP, CATMAT/CATSER ampliado, assinatura digital).
- Ampliação de modelos por prefeitura.
- Inteligência contextual avançada.
- Refinamentos operacionais.

> As seções abaixo são o roadmap de maio/2026, preservado como histórico. Entregas posteriores estão registradas acima
> e nos roadmaps por domínio; nenhum item concluído foi rebaixado por esta reorganização.

---

## Visão do Produto

LiciGov Pro é o sistema de gestão de licitações públicas mais avançado do Brasil, projetado para conformidade total com a Lei 14.133/2021 e operação segura em ambiente multi-tenant enterprise.

---

## Progresso Atual

| Sprint | Título | Status | Testes |
|--------|--------|--------|--------|
| Sprint 1 | Multi-tenant Foundation | ✅ Concluída | ~56 |
| Sprint 1.5 | Hardening Multi-tenant | ✅ Concluída | 22 |
| Sprint 1.8 | Optimistic Locking | ✅ Concluída | — |
| Sprint 2 | Core Documental | ✅ Concluída | 55 |
| Sprint 2.5 | Hardening Documental | ✅ Concluída | 76 |
| Sprint 2.8 | Import Foundation Layer | ✅ Concluída | 99 |
| **Sprint 3** | **Import Avançado + CATMAT** | 📋 Planejada | — |
| Sprint 4 | IA Assistente | 📋 Planejada | — |
| Sprint 5 | Dashboard + Analytics | 📋 Planejada | — |
| Sprint 6 | Assinatura Digital | 📋 Planejada | — |

---

## Curto Prazo (Sprint 3)

### Import Avançado
- Extração real PDF com `pdf-parse`
- Extração real DOCX com `mammoth`
- Normalização semântica de itens
- Interface de revisão humana (aprovação/rejeição por item)

### CATMAT/CATSER
- Import completo do catálogo CATMAT
- Matching semântico item bruto → código CATMAT
- Score de matching com threshold configurável

### Queue Persistente
- Migração de fila em memória → BullMQ + Redis
- Jobs persistentes entre deploys
- Dashboard de filas

### ItemTR Integration
- Aprovação de staging → ItemTR no domínio
- Regras de negócio Lei 14.133/2021
- Proveniência preservada

---

## Médio Prazo (Sprint 4–5)

### Sprint 4 — IA Assistente
- Sugestão automática de descrição normalizada (LLM)
- Matching CATMAT assistido por IA
- Revisão automatizada de cláusulas contratuais
- Detecção de inconsistências entre TR e proposta

### Sprint 5 — Dashboard + Analytics
- Painel de controle por organização
- Indicadores de pesquisa de preço
- Histórico de importações com métricas
- Relatórios de conformidade Lei 14.133/2021
- Alertas de prazo e validade de documentos

---

## Longo Prazo (Sprint 6+)

### Sprint 6 — Assinatura Digital
- Assinatura eletrônica de documentos
- ICP-Brasil (certificados digitais)
- Protocolo de assinatura multi-parte
- QR Code de autenticidade

### Sprint 7 — Integrações Governamentais
- PNCP (Portal Nacional de Contratações Públicas)
- ComprasNet
- Diário Oficial Eletrônico
- SIAFI/SIAPE (federal)

### Sprint 8 — Mobile + Offline
- App mobile para revisão de documentos
- Modo offline com sincronização
- Notificações push de prazos

---

## Invariantes do Produto

1. **Multi-tenant**: `organizationId` obrigatório em toda operação
2. **Staging barrier**: raw extraction nunca persiste no domínio
3. **Auditoria imutável**: timeline e activity_logs são append-only
4. **Conformidade LGPD**: retenção por classe, purge com legalHold
5. **Integridade criptográfica**: SHA-256 em versões e snapshots
