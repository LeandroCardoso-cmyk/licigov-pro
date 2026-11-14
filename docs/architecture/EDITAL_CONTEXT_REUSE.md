# Reuso de contexto no Edital — CONTEXT_REUSE 2.0

> **O LiciGov é context-aware, não um template-variable-entry-system.**
> O servidor público só informa o que o LiciGov ainda **não sabe** e o que exige decisão **nova** do certame. O que já existe no cadastro
> do órgão, no Perfil de Licitações, no Processo, no DFD, nos Itens, na Pesquisa de Preços, no TR ou em política institucional
> versionada **não é digitado de novo**. Isso não esconde informação: tudo o que o modelo exige continua exigido — só muda **de onde
> vem** e **onde se informa uma única vez**.

Estende (sem reescrever) `EDITAL_PREPARATION_ZERO_REENTRY.md`. Mesmo ledger de decisões (`institutional_decisions`), mesmo
`GovernedSourceService`, mesmo Contexto Canônico (`procurement_context_facts`), mesmo TR exato (pin), mesmo M1/M2, CAS, replay,
lineage e `SOURCE_CHANGED`. **Sem migration, sem segundo ledger, sem IA em autoridade.**

## 1. Authority Matrix (`editalAuthorityMatrix.ts`)

Tabela literal, uma linha por variável do modelo `EDITAL_PREGAO_ELETRONICO_BLL` (teste garante 100% de cobertura; variável nova sem
linha falha o teste — nunca vira "manual por omissão").

| Classe operacional | Origem | Onde se informa (se faltar) | BLL |
|---|---|---|---|
| `EXISTING_CANONICAL` | Cadastro do órgão; divulgação do orçamento | — (somente leitura) | 8 |
| `UPSTREAM_PROCESS` | Processo (número, ano, objeto) | — | 3 |
| `UPSTREAM_DFD` | Contexto canônico (unidade requisitante: Processo e/ou DFD) | abertura do Processo / DFD | 1 |
| `UPSTREAM_ETP` | *(nenhuma — ver §2)* | — | 0 |
| `UPSTREAM_ITEMS` | Itens da contratação (quantidade = prevista); **forma de julgamento (item × lote) e regime de participação, DERIVADOS** (PR #288) | Itens | 3 |
| `UPSTREAM_PRICE_RESEARCH` | Estimativa e **data-base** da Pesquisa de Preços; divulgação do orçamento registrada UMA vez na Pesquisa de Preços (PR #288) | Pesquisa de Preços | 2 |
| `PLATFORM_PROFILE` | **Perfil da plataforma** (endereço oficial, versão do regulamento, regras de cronograma): PR #288 | Configurações → Perfil | 2 |
| `ORG_ROLE_PROFILE` | Papéis do Perfil de Licitações | Configurações → Perfil | 8 |
| `ORG_POLICY_PROFILE` | Políticas do órgão (prazos, canais, foro, sanções…) | Configurações → Perfil | 26 |
| `UPSTREAM_TR` | **Parâmetros estruturados do TR** (fatos no Contexto Canônico) | TR → "Parâmetros estruturados da contratação" | 37 |
| `CERTAME_CONFIG` | decisão do certame registrada UMA vez na **CertameConfig** (PR #288; substitui `TRUE_PROCESS_DECISION`) | Configuração do certame | 15 |
| `CERTAME_SCHEDULE` | cronograma: datas/horas independentes; o resto só deriva por regra declarada da plataforma (PR #288) | Configuração do certame | 6 |
| `LIFECYCLE_SYSTEM` | data de emissão atribuída pelo sistema (PR #288) | — | 1 |
| `CONDITIONAL` | oculta até a condição ativar; a entrada segue a autoridade do pai (TR, Perfil ou Preparação) | idem | 53 |
| `POST_AWARD` | pós-homologação | fora da preparação | 20 |
| | | **Total** | **185** |  (ETP 0 · demais 8+3+1+3+2+2+8+26+37+15+6+1+53+20 = 185)

Cada linha tem `entry` (onde se informa) e `defaultEligible` (pode virar padrão institucional). A classificação de preparação
(`classifyVariable`) herda a matriz: papéis ⇒ `ORG_PROFILE` (regra `ORG_ROLE`), parâmetros do TR ⇒ `TR_PROJECTION` (regra `TR_PARAM`).

## 1.1 PR #288 — CertameConfig como autoridade (fim da reentrada residual)

O piloto real mostrou 21 "decisões deste certame". Várias **não eram decisões do Edital**. Cada uma foi auditada
(`CERTAME_AUDIT` em `certameAuthority.ts`, coberta 1:1 por teste: VARIABLE / CURRENT_AUTHORITY / CORRECT_AUTHORITY / ENTRY_POINT /
REUSABLE / DERIVABLE / PROCESS_SPECIFIC / REASON) e posta no domínio correto. Nada foi escondido: o que mudou foi a **autoridade**.

| Variável | Autoridade correta | Como o Edital obtém |
|---|---|---|
| `processo.enderecoEletronicoBll`, `processo.regulamentoBllVersao` | `PLATFORM_PROFILE` | Perfil da plataforma (registro do ÓRGÃO no ledger existente, campo `platforms`, versionado por revisão; sem 2ª tabela, sem migration) |
| `julgamento.dataOrcamentoEstimado` | `UPSTREAM_PRICE_RESEARCH` | **data-base registrada UMA vez na Pesquisa de Preços** (decisão humana no ledger governado, seção `BUDGET`; `recordBudgetBaseDate`); `price_research.created_at` é timestamp técnico e NÃO é autoridade (só sugestão de UX a confirmar); ausente ⇒ "Data-base do orçamento não registrada." na Pesquisa de Preços |
| divulgação do orçamento (`controle.orcamentoSigilosoSimNao`) | `EXISTING_CANONICAL` | decisão registrada UMA vez na Pesquisa de Preços (`BudgetDisclosureCard`); o Edital não tem o campo |
| `decisao.formaJulgamento` | `UPSTREAM_ITEMS` | todos os itens em lote ⇒ `lote`; nenhum ⇒ `item`; misto ⇒ **ambíguo, fail closed**, decide-se em Itens |
| `julgamento.regimeParticipacao` | `UPSTREAM_ITEMS` | agregado do regime por item > lote > padrão configurado em Itens (`ItemsParticipationCard`); regimes diferentes ⇒ literal de combinação do modelo; item sem regime ⇒ pendência em Itens; "padrão dos itens" do Edital foi removido |
| `processo.dataEmissaoEdital` | `LIFECYCLE_SYSTEM` | **late-bound**: data do ATO REAL de emissão oficial (America/Sao_Paulo). No M1 não existe: o texto traz o marcador interno `[[SYSTEM_LATE_BOUND:processo.dataEmissaoEdital]]` e o M1 registra `lateBound = PENDING_OFFICIAL_ISSUANCE`. A emissão materializa a data antes do conteúdo oficial/hash e o M2 registra `lifecycleBindings` (variável, valor, instante, hash antes/depois). Escrita humana é recusada |
| `processo.dataFimRecebimentoPropostas`, `…horarioFim…`, `…dataInicio…` | `CERTAME_SCHEDULE` | **somente** se o Perfil da plataforma DECLARAR a regra (limite = sessão; início = divulgação + horário declarado). Sem declaração são datas independentes. Nada é presumido da BLL |
| `controle.dataDivulgacaoPrevista`, `processo.dataAbertura`, `processo.horarioAbertura` | `CERTAME_SCHEDULE` | independentes (horário aceita padrão institucional explícito) |
| `processo.numeroPregao` | `CERTAME_CONFIG` | persistido UMA vez; outros documentos leem por `procurementProcess.certameConfig`; nunca copiado de outro processo; sem geração automática (não há regra governada) |
| `utilizaSrp`, `inversaoFases`, `criterioJulgamento`, `modoDisputa`, `prazoValidadeProposta`, `parametroExequibilidade`, `intervaloMinimoLances`, `propostaSemIdentificacao`, `anexosAdicionais`, `tratamentoRegional`, `exclusivoMeEpp`, `cotaReservada`, `beneficioAfastado`, `regulamentoMunicipalVerificado` | `CERTAME_CONFIG` | decisões do processo; `modoDisputa`/`prazoValidadeProposta`/`parametroExequibilidade`/`intervaloMinimoLances`/`propostaSemIdentificacao` e o horário da sessão aceitam **padrão institucional explícito** (nunca "último processo"); os enquadramentos da LC 123 **não** são derivados de valor (regra legal não presumida) |

**Escrita semântica.** `institutionalTemplates.governed.recordCertameConfig` (decisões do certame; recusa o que é de outra origem:
`NOT_CERTAME_CONFIG`), `recordItemsParticipation` (regime, em Itens), `recordBudgetDisclosure` (Pesquisa de Preços) e
`recordLicitacoesProfile({ platforms })` (órgão). Leitura: `certameConfig`, `itemsParticipation`, `budgetDisclosure`. A escrita humana de
qualquer caminho derivado no Edital é recusada (`DERIVED_AUTHORITY_OWNED`); valor legado no ledger é preservado como história e **ignorado**.

**Revisão do Perfil/plataforma** ⇒ nova revisão no ledger ⇒ fingerprint do Perfil (`perfilLicitacoes`) e o dado derivado mudam ⇒
`SOURCE_CHANGED` em M1 pendente; documento emitido permanece imutável; processo novo usa a revisão vigente.

**Campo legado do cabeçalho (critério/regime de execução).** Com modelo vinculado (BOUND) o critério vira resumo somente leitura da
CertameConfig; o regime de execução não é variável do modelo institucional (histórico legado apenas). Sem modelo, o legado segue como antes.

### Data de emissão late-bound (LIFECYCLE_SYSTEM)

`processo.dataEmissaoEdital` é "Atribuída na emissão" (catálogo publicado, **inalterado** — o motor lê `source = LIFECYCLE`, `path = dataEmissaoEdital`).
M1 ≠ emissão oficial, então:

- **Composição/M1**: o composer NÃO fabrica data nem a exige; renderiza o marcador interno (protegido por fragmento: remover/alterar ⇒
  bloqueio) e o M1 registra o campo late-bound. O marcador não é `[REVISAR]`, não é IA e não conta como pendência humana. A revisão mostra
  "Data de emissão: será atribuída automaticamente no ato da emissão oficial".
- **Revalidação**: o texto composto não depende de relógio ⇒ mudança de dia entre M1 e M2 **não** é `SOURCE_CHANGED`. Marcador forjado,
  duplicado, removido ou substituído por data digitada ⇒ `LATE_BOUND_TAMPERED`/`PROTECTED_NODE_MISSING` (emissão bloqueada).
- **Emissão**: o instante oficial (`clock` do fluxo de emissão) → AAAA-MM-DD em America/Sao_Paulo → `bindLifecycleVariables` materializa o
  valor ANTES do conteúdo oficial e do hash. O M2 guarda `lifecycleBindings` e `documentContentHash` = hash do conteúdo OFICIAL; a cadeia de
  edições humanas termina em `beforeContentHash` (edição humana ≠ transformação do sistema).
- **Replay/retry**: retry de emissão já persistida devolve o mesmo documento (idempotência por chave, sem recalcular data); falha antes do
  commit não persiste nada (sem "emissão fantasma"); o retry usa a data do ato efetivamente persistido. O oficial nunca é recalculado com "hoje".
- Documentos oficiais antigos não são reescritos; manifests sem campo late-bound mantêm hashes idênticos (campos novos só entram quando presentes).
- Janela residual: a data é fixada em `prepare` (antes da transação); um deadlock-retry reaproveita o mesmo conteúdo preparado.

- **Exportação da minuta**: o DOCX/PDF de RASCUNHO troca o marcador interno por "(data atribuída automaticamente na emissão oficial)"
  (`displayLateBoundForDraft`, só na apresentação). O rascunho persistido, seu hash e a integridade da emissão não mudam.

### Numeração do processo no Edital (jornada integrada DFD → ETP → TR → Edital)

Os modelos escrevem "Nº {processo.numeroProcesso}/{processo.ano}" (e "Nº {numeroPregao}/{ano}"); o catálogo define o número como
"único no exercício". Fonte única `processNumberParts` (`domain/institutionalTemplates/processYear.ts`), usada pela preparação e pela
fonte canônica PROCESS: `AAAA/NNNN` e `NNNN/AAAA` ⇒ exercício + sequência ("2026/253" ⇒ 253/2026; "45/2026" ⇒ 45/2026); outro formato
⇒ sem exercício (pendência na origem, com a instrução de corrigir o número — nunca "ano corrente"). Exercícios inteiros
(`EXERCISE_YEAR_VARIABLES`) são renderizados sem separador de milhar ("2026", não "2.026"). Revisões, AST e catálogos publicados não mudam.

## 2. Auditoria do que é realmente estruturado (provado por código/teste)

- **Processo**: schema só estrutura número, objeto e modalidade (`procurement_processes`).
- **DFD**: texto + 5 fatos canônicos (`demand.requestingUnit`, `demand.responsibleParty`, `planning.pcaAlignment/priority/desiredDate`) e
  Itens; só a unidade requisitante alimenta o modelo. Nenhum caminho do Contexto Canônico é exclusivo do DFD/ETP (teste).
- **ETP**: documento textual, **sem dado estruturado** ⇒ `UPSTREAM_ETP = 0`. Declarado, não inventado.
- **Itens / Pesquisa**: quantidade prevista, unidade, descrição, preço de referência e estimativa (já canônicos). `dataOrcamentoEstimado`
  **não** tem data estruturada (o Item Inteligente não guarda data de aprovação) ⇒ continua decisão do certame.
- **TR**: texto + `metadata.object` do documento oficial. Prazos, local, pagamento, garantias etc. **não** eram estruturados — daí a camada abaixo.

Adapters de fronteira são explícitos (nome da variável → fonte), sem heurística de equivalência e sem IA.

## 3. Parâmetros estruturados do TR (sem outro documento, sem migration)

Camada estruturada **do mesmo fluxo do TR**. Persistência: `procurement_context_facts` (ledger append-only existente), caminho
`tr.param.<variável>`, fonte `tr`, ator humano, status `confirmed`, `sourceVersion = rev:<id anterior>[;def:<revisão do padrão>]`
(proveniência explícita; reverter A→B→A grava 3 fatos). Valor = JSON canônico do valor **tipado** normalizado pelo catálogo.

- Política de autoridade: **só `tr`** afirma (`ai_draft`, `user`, `dfd`, `etp`, `process`… são recusados na escrita e ignorados na leitura).
- O Contexto Canônico do DFD é **inalterado** (digest e versão idênticos; teste).
- UI: seção compacta e colapsável no TR ("Parâmetros estruturados da contratação"), orientada por exceção: pendentes, opcionais
  (que ativam campos), confirmados com origem; condicionais ativam ao vivo; padrões institucionais aparecem como **proposta** que exige confirmação.
- O **texto do TR** e o **Edital** consomem os **mesmos fatos**: `generateTR` anexa um bloco determinístico (sem IA) e inclui o digest no
  `payloadHash` (mudou o parâmetro ⇒ não há replay com contexto velho); o Edital lê os mesmos fatos por `editalContextReuse`.
- Tenant: processo de outra organização ⇒ `NOT_FOUND` (anti-enumeração); `viewer` não confirma.

## 3.1 Lineage exata: parâmetros estruturados × TR oficial pinado

**Invariante:** o Edital com `officialPins.TR` consome `UPSTREAM_TR` do **mesmo snapshot lógico** do TR oficial pinado. É impossível
compor "TR v1 + parâmetros posteriores à v1".

- **Digest do snapshot** (`trParamsDigest`): nome + estado + hash do **valor** de cada parâmetro vigente (independe de quem/quando
  confirmou: voltar ao mesmo valor volta ao mesmo digest). Mesmo digest do marcador `trparams:<64 hex>` que o rascunho do TR carrega: o vínculo autoritativo usa o **SHA-256 completo**, nunca um prefixo.
- **Emissão:** a promoção oficial grava `metadata.structuredParamsDigest` no documento emitido, copiado do marcador do rascunho
  (sem marcador ⇒ sem digest; **nunca inventado**; marcador curto/malformado nunca é copiado). Sem tabela nova: o lineage existente do documento basta (`MIGRATION = NONE`).
- **Hash curto só para exibição/log** (`shortDigest`, 16 hex). Comparação de autoridade, persistência, replay, preflight e emissão usam os 64 hex; um `structuredParamsDigest` de 16 hex **não** é aceito (fail closed, `TR_STRUCTURED_LINEAGE_UNAVAILABLE`), sem fallback.
- **Geração / preflight / preparação** (`checkTrStructuredLineage`): compara o digest do TR pinado com o do estado **atual**:
  - TR sem lineage + parâmetros confirmados ⇒ `TR_STRUCTURED_LINEAGE_UNAVAILABLE` (TR anterior à feature, importado ou gerado antes dos parâmetros);
  - digest diferente (parâmetros alterados ou limpos depois da versão) ⇒ `TR_STRUCTURED_SOURCE_CHANGED`;
  - nada confirmado e TR sem lineage ⇒ compatível (histórico preservado).
  Falha fechada: preflight `BLOCKED`, **zero draft, zero M1**; a preparação não reaproveita os parâmetros atuais e mostra: *"O Termo de
  Referência oficial selecionado não corresponde aos parâmetros estruturados atuais. Revise/emita a versão correspondente do TR antes de prosseguir."*
- **Menor mudança:** alterar parâmetros depois do TR oficial continua permitido (é preparação de uma futura revisão); o Edital só os usa
  depois que uma **nova versão oficial do TR** (regerada com o bloco e emitida) carregar o digest correspondente. O pin nunca é relaxado;
  pin v1 com v2 existente segue a política de stale (`OFFICIAL_PIN_STALE`).
- **M1:** referencia o TR (id, versão, hash) e a fonte `tr` inclui `parametrosEstruturadosDigest` no snapshot (entra no digest do M1);
  o metadata do TR responde "qual digest" sem reprocessar. Mesmo input ⇒ replay; digest diferente ⇒ outro M1.
- **Revalidação** (sem pin) não aplica a checagem: a mudança aparece como `SOURCE_CHANGED` da fonte `tr`.

## 4. Perfil institucional de Licitações

Configurações → "Perfil institucional de Licitações" (e card único na preparação: *"Complete o Perfil Institucional de Licitações —
configuração única — N campos pendentes — Configurar agora"*; nada de despejar campos).

Mesmo ledger ORG (`institutional.policy`, subject `governed-fields`); o payload ganhou `roles` e `defaults` (ao lado de `sections`),
com CAS e idempotência por registro inteiro. Cada gravação cria **nova revisão**; revisões anteriores ficam no histórico.

**Papéis** (`ROLE_KEYS`): `CHEFE_DO_EXECUTIVO`, `AUTORIDADE_COMPETENTE`, `AGENTE_DE_CONTRATACAO`, `PREGOEIRO`, `EQUIPE_DE_APOIO`,
`AUTORIDADE_SANCIONADORA`, `DIRETOR_LICITACOES`, `ASSINANTE_DO_EDITAL`. Cada um: nome, cargo/função, ato/portaria/delegação,
data de referência, vigência. Uma pessoa pode ter vários papéis; **nenhum papel deriva de outro** (Prefeito ≠ autoridade competente).
Designação **vencida** (`vigenciaAte`) nunca é usada em silêncio: o campo vira "perfil incompleto" com o motivo e o preflight bloqueia.
Campos institucionais registrados antes dos papéis (legado) continuam válidos até o papel ser designado.

## 5. Padrões institucionais (nunca "último processo")

Único mecanismo de reaproveitamento entre processos: **ação humana explícita** "Usar como padrão institucional nos próximos
processos", com consentimento que mostra a política criada/atualizada e a autoridade humana declarada. Só variáveis `defaultEligible`
(nunca data do certame, objeto, quantidade, valor ou decisão jurídica casuística — teste por tipo e por nome). Escrita estrita
(inelegível/tipo inválido/variável desconhecida ⇒ recusa); leitura tolerante (padrão incompatível com o catálogo atual é **descartado**
e o motivo fica visível). Decisões do certame: padrão aplicado aparece como "Padrão institucional (revisão N)", alterável no processo
(a decisão do processo vence). Parâmetros do TR: o padrão é só **proposta**, exige confirmação humana.

## 6. Lineage, replay e `SOURCE_CHANGED`

- Mudança de ocupante ⇒ nova revisão do perfil; **novo Edital usa a atual**; Edital emitido/M1 antigo **não** é reescrito.
- O manifest não tem chave própria para `IDENTITY`; por isso o snapshot `POLICY` recebe `perfilLicitacoes` (hash de papéis + padrões),
  **somente** quando o órgão usa papéis/padrões — órgãos que não usam mantêm exatamente o digest anterior. Resultado: troca de papel/padrão
  entre M1 e emissão ⇒ `SOURCE_CHANGED`.
- Parâmetro do TR (fonte `tr`), DFD/contexto (fonte `processo`) ou quantidade de item (fonte `itens`) mudou após o M1 ⇒ `SOURCE_CHANGED`;
  voltar ao valor original volta a coincidir. Mesmas autoridades ⇒ mesmo M1 (replay convergente, zero escrita).

## 7. Migration gate

`MIGRATION = NONE`. Tentado e suficiente: `procurement_context_facts` (parâmetros do TR: `path varchar(120)`, `value_json text`, dedup por
`organization_id + dedup_key`, escopo `organization_id + process_id`) e `institutional_decisions` (perfil: `evidence` com payload canônico +
hash, `revision` com CAS). `pnpm db:generate` não gera diferença.

## 8. Medição (cenário sintético realista, MySQL real — `templates-edital-context-reuse-mysql-smoke.test.ts` R2)

Órgão configurado, Itens + Pesquisa, TR estruturado e TR oficial. Números do teste (Pregão eletrônico BLL, menor preço, disputa aberta):

| | Primeiro processo (tenant novo) | Processo seguinte (tenant configurado) |
|---|---|---|
| Perfil institucional (campos + papéis) | 33 (uma vez) | **0** |
| Parâmetros do TR digitados | 21 | 12 (+ 9 propostas de padrão confirmadas numa ação) |
| Decisões do certame visíveis (inicial) | 19 | **14** (18 contando as condicionais ativadas em cascata) |
| Entradas manuais no total | 79 | 30 |

As decisões que restam no processo seguinte (14 visíveis de início; 18 com as condicionais ativadas em cascata) **não têm autoridade reutilizável**: datas do certame (`dataAbertura`,
`dataInicioRecebimentoPropostas`, `dataFimRecebimentoPropostas`, `dataEmissaoEdital`, `dataDivulgacaoPrevista`, `dataOrcamentoEstimado`),
número do pregão, SRP, inversão de fases, critério de julgamento, forma de julgamento, regime de participação — e, conforme o
cenário, condicionais do certame (duração da etapa de lances, regra de prorrogação, dotação, fonte de recursos, base do lance, casas
decimais). Nada é ocultado para atingir meta: o inventário fecha em 185 e cada campo restante é listado pelo teste com o motivo da matriz.

## 9. Limites declarados

- O texto do DFD/ETP/TR não é interpretado: só fatos estruturados alimentam o Edital.
- O TR continua sendo texto revisável; os parâmetros são uma camada **adicional** confirmada por pessoa (não há extração por IA).
- Modelos fora da Authority Matrix mantêm a classificação anterior (derivada de `PreparationClass`).
- Definir padrão exige papel `manager`+ (mesmo piso das demais decisões institucionais governadas).

## 10. Addendum — LICIGOV-FAST PR-2: dotação e fonte de recursos do processo (pendência informativa)

Decisão do Owner (05/11/2026): a ausência de informação documental — inclusive dotação orçamentária e fonte de recursos — **não bloqueia,
por si só,** a geração nem a emissão institucional do documento; o sistema indica a pendência, orienta e reaproveita o dado quando ele surgir.
Completude documental ≠ autorização de ato: a formalização da contratação continua exigindo a indicação dos créditos (Lei 14.133/2021, art. 150).

- **Autoridade única (processo):** `julgamento.dotacaoOrcamentaria` e `julgamento.fonteRecursos` passam de condicional da CertameConfig a
  `UPSTREAM_PROCESS` / entrada `PROCESS_BUDGET` (derivação `BUDGET_ALLOCATION`). Escritor único: `institutionalTemplates.governed.recordBudgetAllocation`
  (mesmo registro governado do processo e **mesmo caminho** que a CertameConfig gravava — valores anteriores continuam válidos, sem migração;
  CAS, idempotência, confirmação humana; substituir valor registrado diferente exige `confirmReplace`). A escrita genérica e a CertameConfig recusam.
- **Um preenchimento:** "Dados orçamentários do processo" no card da Pesquisa de Preços e embutido no TR e no Edital (nenhuma etapa é obrigatória
  nem proprietária). Status visível: **Declarado** (nunca "verificado") · **Pendente** · **Não aplicável** (registro de preços: indicada na
  formalização de cada contratação, conforme o regulamento de SRP aplicável ao órgão — o regulamento federal não é presumido).
- **Pendência informativa em código** (`contentPending.ts`, sem alterar catálogo/AST publicados nem o hash semântico): ausente ⇒ a composição
  segue, o texto traz o marcador governado ("A INDICAR PELO SETOR RESPONSÁVEL PELA EXECUÇÃO ORÇAMENTÁRIA" / "A INDICAR COM A DOTAÇÃO
  ORÇAMENTÁRIA"; nunca `[REVISAR]`). **O formato do manifesto M1/M2 não muda** (gate R1 do PR #342): a pendência não é campo persistido;
  o registro auditável é o próprio texto com o marcador, selado por `composedOutputHash` (M1) e `documentContentHash` (M2). Leitores de
  versões anteriores leem e validam esses manifests (teste de contrato com as chaves do leitor da staging `9226e4b`). Num rollback de código,
  a versão anterior volta à regra antiga e recusa a emissão do rascunho pendente (bloqueio seguro, sem emitir nada). A recuperação NA versão
  anterior depende da revisão do modelo: com recomposição governada (Revisão 2), registra-se a dotação, recompõe-se e emite-se; sem ela
  (Revisão 1), o rascunho só volta a ser emitível reaplicando a versão nova (a recomposição é recusada e o reset do processo é bloqueado
  depois da emissão do TR).
- **R3 — recuperação governada da minuta (corrigido):** registrar a dotação/fonte (ou outro dado do processo) DEPOIS de compor o Edital e
  ANTES de emiti-lo torna a minuta divergente das fontes (`SOURCE_CHANGED`). A recomposição governada existente passa a valer também para
  revisões SEM a capability de dados de publicação (Revisão 1), **somente** nesse caso: mesma revisão exata do modelo, mesmo órgão e alguma
  fonte/autoridade mudou desde o M1 (`sourceRefreshRecompositionAllowed`, mesma regra `changedAuthorities` da revalidação). Mantém todas as
  garantias da recomposição: só rascunho de origem modelo, nunca documento aprovado/emitido, CAS do conteúdo visto, confirmação explícita
  quando há edição humana, conteúdo anterior no histórico append-only, novo M1, idempotência. Sem mudança de fonte, o comportamento legado
  permanece. Não exige reset do processo, não toca no TR emitido nem em outro documento oficial; a emissão segue a revisão humana e a SoD.
  (Num rollback para versão anterior a esta correção, a recuperação da Revisão 1 volta a depender de reaplicar a versão nova.)
  **X → Y → X (corrigido, Revisões 1 e 2):** quando uma fonte VOLTA a um valor já usado, a composição reproduz um M1 que já existe. Conteúdo
  idêntico não é estado idêntico: o M1 VIGENTE da minuta é o do vínculo explícito `tpl-m1:` (não o gravado por último), o rascunho é
  ressincronizado a esse M1 pelas mesmas regras governadas (já vinculado ⇒ replay puro; texto idêntico ⇒ só o vínculo; recomposição governada
  ⇒ conteúdo, com CAS, confirmação de edição humana e histórico; sem ela ⇒ CONFLICT), sem criar M1 nem versão técnica nova, e a cadeia de
  edições humanas da emissão parte da ocorrência MAIS RECENTE do texto composto. A chave de idempotência da recomposição é única por recomposição (M1 + última linha do histórico de edições, lida sob lock), sem colisão em X → Y → X → Y.
- **TR:** bloco determinístico "DADOS ORÇAMENTÁRIOS DO PROCESSO" (declarado/pendente/não aplicável), digest no hash do pedido e marcador
  `orcamento:` na linhagem (fora do digest `trparams:` da linhagem TR → Edital). Dado registrado depois da geração ⇒ aviso informativo para
  atualizar a seção, sem bloqueio. Documentos emitidos não mudam.
- **Preservado:** RBAC (`govern` = manager + membership real), isolamento, SoD na emissão, `[REVISAR]` continua bloqueando a emissão,
  as demais variáveis obrigatórias continuam `MISSING_REQUIRED`.
- **Limitação conhecida (R2 — provisória; NÃO atende ao requisito geral do LICIGOV-FAST):** dotação e fonte pertencem ao processo, e esta
  implementação reutiliza o registro governado existente do processo. Hoje, porém, registrar e ler esses dados depende de um catálogo de
  Edital resolvível (módulo de modelos institucionais habilitado e modelo de Edital vinculado; sem escopo do Edital definido, só quando há um
  único catálogo vigente). Órgãos sem modelo vinculado não conseguem usar integralmente o recurso (o TR deles segue o comportamento anterior).
  A evolução prevista é um fato canônico do processo, independente de modalidade, plataforma e modelo (proposta em deliberação do Owner).

### 10.1 Correções A1–A4 (homologação funcional H1–H5 em staging, 05/11/2026)

- **A1 — SRP indefinido não é presumido.** A preparação do Edital só mostra dotação/fonte como "Não aplicável (registro de preços)" quando o
  processo DECLAROU `controle.utilizaSrp = true`. Antes, a condição `requiredWhen` (`utilizaSrp == false`) avaliada com o SRP ainda não decidido
  dava `false` e o campo caía no ramo de SRP. Indefinido ⇒ pendência informativa (igual a `budgetAllocationView`: `srp null ⇒ PENDING`).
- **A2 — aviso "TR desatualizado" só para mudança material.** O digest gravado (hash do pedido de geração do TR e marcador `orcamento:`) mantém o
  formato v1 — replay e rascunhos existentes intactos. A leitura `budgetDisclosure.allocation` passa a expor `equivalentDigests`: os digests com os
  MESMOS status/valores de dotação e fonte e outro SRP (o texto do bloco e o contexto da autoria dependem só desses status/valores). A tela compara
  com esse conjunto; mudança de valor ou de status (inclusive SRP com dotação ausente ⇒ não aplicável) continua acusando o aviso (informativo).
- **A3 — autoria do TR com registro de preços declarado.** O bloco orçamentário expõe `notApplicable` e o prompt recebe o contexto: indicação na
  formalização de cada contratação decorrente da ata, conforme o regulamento de SRP aplicável ao órgão (nenhum regulamento presumido), sem inventar
  valores, sem afirmar dotação indicada/conferida, sem `[REVISAR]` só pela ausência — e sem dispensar a indicação dos créditos na formalização.
  `[REVISAR]` legítimos continuam. Nenhuma chamada de IA nova; o prompt não entra em hash (o digest do pedido não muda).
- **A4 — Perfil de Licitações: prontidão geral × contextual.** Sem processo, o Perfil continua contando só as políticas incondicionais, mas não diz
  mais "Perfil completo" quando há políticas condicionais sem valor: lista "exigida(s) só quando: …" (rótulo operacional da condição) e mostra o
  motivo em cada campo. Com `processId`, as políticas que ESTE processo exige vêm da MESMA fonte do preflight (`upstream.profilePending` da preparação)
  e aparecem como pendentes (`summary.contextPending`, incluídas no `pendingCount`). O preflight mantém o código `LICITACOES_PROFILE_INCOMPLETE` e o
  bloqueio, e passa a nomear os campos e onde informá-los. (As 3 políticas de SRP deixaram de bloquear: pendência informativa — §10.2.) Nenhum valor é atribuído; nenhuma política é alterada; o requisito vinculante não muda.
- **Ajustes da auditoria independente:** (C1) política condicional cuja condição depende SÓ de dados do próprio órgão e está ativa (ex.:
  `habilitacao.registroCadastralAceito` quando o órgão registrou que aceita registro cadastral) é pendência GERAL do Perfil, não "condicional";
  (C2) `licitacoesProfile({ contextual: false })` dispensa a leitura contextual quando a tela só usa padrões/revisão (`UseAsDefaultButton`);
  (P1) o prompt veda tratar regulamento federal presente no contexto como aplicável ao órgão, salvo indicação de adoção; (P3) a ressalva de políticas
  condicionais usa tom neutro (governança discreta); (P4) a mensagem do preflight cita até 5 campos ("e mais N").
  Risco residual P2 (leitura contextual do Perfil sem o pin do TR): **resolvido em §10.2**.
- **Bloqueio de composição do Edital SRP (H5) — resolvido nesta rodada (§10.2).** A deliberação registrada antes deste ponto foi decidida pelo Owner
  (LICIGOV-FAST: a ausência de conteúdo não impede elaborar/gerar/exportar a minuta).

### 10.2 Edital SRP: políticas do órgão como pendência informativa (H5) e prontidão contextual do Perfil (P2)

**Causa do bloqueio (H5).** Em registro de preços, `decisao.adesaoAta`, `srp.marcoInicialVigenciaAta` e `srp.prazoAssinaturaAta` (fonte POLICY,
`requiredWhen controle.utilizaSrp = sim` no catálogo publicado) bloqueavam em três pontos: (1) `resolveTemplateVariables2` (composer2) ⇒
`MISSING_REQUIRED`; (2) o grupo excludente `adesao_ata` (exactly-one, ramos `admite`/`veda`) sem ramo verdadeiro ⇒ `CHOICE_NOT_EXACTLY_ONE`;
(3) a preparação as listava como "perfil incompleto", o que desabilitava o botão de gerar na tela.

**Correção (mesmo mecanismo, sem motor novo).** As três entram na política em código `contentPending.ts` (com `neededBefore: "PUBLICATION"`;
dotação/fonte ficam com `CONTRACTING`). Catálogo, AST e hash semântico publicados **não mudam**.
- Composição: ausente ⇒ segue com o marcador governado ("… A DEFINIR PELO ÓRGÃO ANTES DA PUBLICAÇÃO"), nunca `[REVISAR]`. Na decisão de adesão
  ausente, o compositor **não escolhe ramo** — o "padrão: veda" da descrição do catálogo não é decisão do órgão — e insere um parágrafo com o
  marcador. Qualquer outro grupo excludente sem ramo continua `CHOICE_NOT_EXACTLY_ONE` (fail-closed). Presente ⇒ o valor do Perfil é usado.
- O marcador ocupa o LUGAR da decisão, na forma comum dos ramos: item numerado no corpo do Edital e a própria seção "DA ADESÃO" no anexo da Ata
  (numeração preservada). Vale só para a política NÃO obrigatória com condição de exigência ATIVA; grupo misto ou condição inativa ⇒ fail-closed.
  O bloco pendente é âncora "incluída": removê-lo na revisão ⇒ `INCLUDED_BLOCK_REMOVED` (reconhecimento obrigatório).
- Manifesto: formato M1/M2 **inalterado** (R1). As decisões dos ramos continuam registradas (todas falsas) e o texto com o marcador fica selado
  pelo `composedOutputHash`. Replay determinístico. Os textos dos marcadores fazem parte do contrato de replay: mudar a redação faz rascunhos
  pendentes acusarem `COMPOSITION_DRIFT` na emissão (exige recomposição) — por isso estão fixados por igualdade em teste.
- Finalização: as três entram na lista "Antes de publicar oficialmente este Edital" (`neededBefore: "PUBLICATION"`), que não bloqueia a emissão.
- Preparação/tela: as três passam de "perfil incompleto" (bloqueante) a `CONTENT_PENDING` em `upstream.contentPending` (`fix: ORG_PROFILE`),
  exibidas como "Pendências informativas — não impedem gerar a minuta", com o caminho para o Perfil de Licitações.
- Registro posterior no Perfil ⇒ `SOURCE_CHANGED` ⇒ recomposição governada (R3 na Revisão 1; capability na Revisão 2), com CAS, confirmação de
  edição humana e histórico. Decidir "admite" ativa a decisão do processo `srp.limiteAdesaoAta`, que é pedida (nunca presumida).

**Classificação das exigências (o sistema não é gate de publicação).**
| Parâmetro | Natureza | Momento em que é indispensável | Referência (confirmação jurídica pendente) |
|---|---|---|---|
| `decisao.adesaoAta` | decisão institucional do órgão | antes da publicação do edital | Lei 14.133/2021, art. 86 (adesão por não participantes) |
| `srp.marcoInicialVigenciaAta` | conteúdo do edital/ata | antes da publicação | art. 84 (vigência da ata) e regulamento de SRP do órgão |
| `srp.prazoAssinaturaAta` | conteúdo do edital (regra de convocação) | antes da publicação | art. 25 (regras de convocação) e arts. 82 a 86 |

A emissão institucional interna (versão emitida no sistema) **não** é bloqueada por esses marcadores, como já ocorre com os dados de publicação
diferidos ("A DEFINIR PARA PUBLICAÇÃO") e com a dotação: emitir ≠ aprovar ≠ publicar. O documento emitido carrega a pendência no próprio texto.
Controles preservados: autoridade e SoD na emissão, `[REVISAR]` bloqueando, `SOURCE_CHANGED`, `EMISSION_TR_NOT_EMITTED`, demais variáveis
obrigatórias (`MISSING_REQUIRED`) e `utilizaSrp` obrigatório (SRP indefinido continua recusando a composição — nada é presumido).
**Decisão pendente (Owner/Jurídico):** se a emissão institucional interna deve exigir as três políticas (hoje não exige); o regulamento de SRP de
cada município (o federal não é presumido).

**P2 — pin exato do TR na leitura contextual do Perfil.** Causa: `licitacoesProfile` chamava a preparação sem o pin; as condições das políticas
condicionais dependem também de parâmetros estruturados do TR (`tratamentoDadosPessoais`, `repactuacao`, `exigeGarantiaContratual`), que o
preflight descarta quando o pin é inválido ou desatualizado — e o Perfil se declarava contextual mesmo assim. Correção: a rota aceita
`officialPins.TR` e o repassa à MESMA validação da preparação/preflight (órgão + processo + versão + hash). O Perfil expõe
`contextStatus`: `GENERAL` (sem processo), `CONFIRMED` (TR exato validado), `UNVERIFIED` (sem pin, pin inválido ou leitura indisponível, com
`contextReason`). "Não verificada" nunca vira "completo"; falha de leitura não bloqueia nada. Nenhum binding, política ou modelo muda. Hoje nenhuma
tela chama o Perfil com processo e pin (o painel usa a leitura geral; "usar como padrão" dispensa o contexto): o contrato fica pronto e testado no
servidor para quando a tela de preparação passar a exibi-lo.

### 10.3 Correções F1/F2 (homologação H5 Etapa 1 em staging, processo 2167/2026)

**F1 — acesso do Gestor ao Perfil de Licitações.** O backend já autoriza `manager` a gravar o Perfil
(`institutionalTemplates.governed.recordOrganizationFields`/`recordLicitacoesProfile` = `templatesProcedure("govern")`, piso `manager` +
membership real — SECURITY-02), mas a única tela do Perfil ficava em Configurações (admin+), e os links da preparação ("Configurar agora",
"Informar no Perfil de Licitações", "Abrir o Perfil") levavam o Gestor a "Acesso não autorizado". Correção (só frontend, RBAC do backend
inalterado): rota própria **`/perfil-licitacoes`** com o MESMO `LicitacoesProfilePanel` (sem segunda implementação), item de menu "Perfil de
Licitações" para `manager`/`admin`/`owner` com o módulo de Modelos Institucionais ligado, gate `canGovernLicitacoesProfile` que espelha
`TEMPLATE_ACTION_MIN_ROLE.govern` (teste de contrato), aviso claro para Operador/Visualizador e mensagem do preflight
(`LICITACOES_PROFILE_INCOMPLETE`) apontando para o item do menu. Configurações (identidade institucional/documental, usuários) continua
admin+; "Corrigir cadastro do órgão" continua em Configurações. Os campos canônicos da identidade continuam recusados pelo servidor no Perfil
(`AUTHORITY_OWNED_PATHS`).

**F2 — rótulo neutro da adesão à Ata.** A descrição técnica do catálogo publicado ("Adesão à Ata de Registro de Preços (padrão: veda)") aparecia
nas pendências informativas e em "Antes de publicar", sugerindo uma decisão do órgão que não existe (o compositor não aplica "padrão"; sem
registro, a minuta traz o marcador). Rótulo/pergunta neutros na camada de apresentação (`editalPresentation.ts`, via `describeVariable`).
Catálogo, AST, hash semântico, manifests e documentos já compostos: inalterados (sha256 dos arquivos fixado em teste). Valor registrado
(admite/veda) continua exibido como tal. Testes: `fast-f1-f2-profile-access.test.ts`.
