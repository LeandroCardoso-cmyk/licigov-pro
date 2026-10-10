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
| `UPSTREAM_ITEMS` | Itens da contratação (quantidade = prevista) | Itens | 1 |
| `UPSTREAM_PRICE_RESEARCH` | Estimativa da Pesquisa de Preços aprovada (só divulgação pública) | Pesquisa de Preços | 1 |
| `ORG_ROLE_PROFILE` | Papéis do Perfil de Licitações | Configurações → Perfil | 8 |
| `ORG_POLICY_PROFILE` | Políticas do órgão (prazos, canais, foro, sanções…) | Configurações → Perfil | 26 |
| `UPSTREAM_TR` | **Parâmetros estruturados do TR** (fatos no Contexto Canônico) | TR → "Parâmetros estruturados da contratação" | 37 |
| `TRUE_PROCESS_DECISION` | decisão nova do certame | Preparação do Edital | 27 |
| `CONDITIONAL` | oculta até a condição ativar; a entrada segue a autoridade do pai (TR, Perfil ou Preparação) | idem | 53 |
| `POST_AWARD` | pós-homologação | fora da preparação | 20 |
| | | **Total** | **185** |

Cada linha tem `entry` (onde se informa) e `defaultEligible` (pode virar padrão institucional). A classificação de preparação
(`classifyVariable`) herda a matriz: papéis ⇒ `ORG_PROFILE` (regra `ORG_ROLE`), parâmetros do TR ⇒ `TR_PROJECTION` (regra `TR_PARAM`).

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
