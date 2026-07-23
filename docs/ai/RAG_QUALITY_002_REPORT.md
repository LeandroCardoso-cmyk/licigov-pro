# RAG-QUALITY-002 — Revisão focalizada pós-validação em staging

## Contexto

Após o RAG-QUALITY-001, o usuário testou 4 perguntas no staging:

| Pergunta | Resultado |
|---|---|
| inexigibilidade → art. 74 | correto |
| dispensa → art. 75 | correto |
| instrução do processo → art. 72 | correto |
| "Qual artigo da Lei 14.133 trata da contratação direta?" | **incorreto** — respondeu Art. 191, resposta cortada |

Esta revisão corrige exclusivamente essa regressão, preservando os 3 cenários que já funcionavam.

## Causa raiz (medida contra o corpus e o código reais)

### 1. Art. 191 duplicado 3× no texto-fonte

`data/lei_14133_2021.txt` traz o Art. 191 **três vezes em sequência** — histórico de redações pela
Medida Provisória nº 1.167/2023 mantido inline (texto anterior à MP, texto da MP, texto vigente após
a MP perder eficácia). Sem dedup, o parser produzia **3 blocos independentes** para o mesmo artigo;
com `maxPassagesPerDocument=3`, **2 das 3 vagas** do top-3 iam para o Art. 191 duplicado, expulsando
os arts. 72-75 por completo.

### 2. Nenhuma penalização para container genérico concorrente

Art. 191 está em "Disposições Transitórias e Finais" e cita "contratação direta" de passagem
(regra de transição sobre o prazo de opção entre leis). Nada no motor de recuperação reconhecia que
um capítulo **temático específico** ("Da Contratação Direta") competia e deveria prevalecer sobre uma
disposição de transição.

### 3. Mudança de fraseado reintroduziu ruído

A nova pergunta trocou "fala" (filtrado) por "**trata**" — verbo comum de remissão jurídica ("de que
trata o inciso..."), presente em dezenas de artigos administrativos/transitórios sem relação com a
matéria perguntada. Não estava na lista de termos ignorados.

### 4. Selo binário demais

`hasSufficientBasis`/`evidenceSufficiency` (RAG-QUALITY-001) já distinguia 3 estados, mas media
apenas cobertura/score — não se a passagem de maior score era **tematicamente relevante** à
intenção da pergunta ou apenas citava os termos incidentalmente.

### 5. `finishReason` descartado

`GeminiProvider.generate()` já calcula `finishReason` (`"max_tokens"` quando a API corta a geração),
mas `aiExecutionEngine.ts::executeCognitiveTask` nunca lia esse campo — uma geração incompleta não
deixava rastro algum e era tratada como resposta válida e completa.

**Investigação do corte (ponto 4 do pedido):** não há acesso à URL/credenciais do staging neste
ambiente para inspecionar a resposta bruta da tRPC diretamente — declarado honestamente, sem
fabricar um teste. Evidência de código: (a) nenhuma CSS/overflow de truncamento existe no
`TirarDuvidasHome.tsx` (`grep` por `max-h-`/`overflow-hidden`/`line-clamp`/`truncate` no bloco da
resposta não encontrou nada — o único uso de `truncate` é no texto do item de histórico, não na
resposta); (b) `finishReason` nunca era lido, então uma geração cortada por `MAX_TOKENS` no backend
era estruturalmente indistinguível de uma resposta completa. Isso aponta para truncamento no
**backend** (não no frontend), mas sem prova direta contra o ambiente real — por isso a correção trata
a causa estruturalmente (audita e sinaliza `finishReason`) em vez de presumir e alterar o orçamento
de tokens sem medição.

## Correção implementada

### 1. `server/services/officialCorpus/officialTextParser.ts` — dedup de artigos duplicados
Ao final de `parseOfficialText`, artigos com o mesmo `identifier` são colapsados em um só,
mantendo a **última ocorrência** (texto vigente/consolidado mais recente na leitura linear do
documento) na posição da **primeira aparição** (preserva a ordem natural). 209 → 207 artigos na
Lei 14.133 (só o Art. 191 tinha duplicatas).

### 2. `server/services/institutionalIntegration/knowledgeRetrievalService.ts`
- **STOPWORDS**: nenhuma mudança adicional foi necessária para "trata" — a penalização de container
  genérico (abaixo) resolveu o caso sem precisar tratar "trata" como stopword (que apareceria em
  contextos legítimos também, ex.: "o artigo que trata da dispensa").
- **Penalização de container genérico** (`GENERIC_HEADING_PATTERN`, `GENERIC_CONTAINER_PENALTY=0.4`):
  detecta títulos boilerplate — "Disposições Gerais/Transitórias/Finais/Preliminares" (padrão comum
  a qualquer lei brasileira, não específico da 14.133). Quando existe, no MESMO documento, um
  capítulo temático específico cujo rótulo já casa com a consulta, artigos em container genérico têm
  o score de corpo reduzido em 60%.
- **Normalização de comprimento relaxada para match temático específico** (`BM25_B_THEMATIC=0.25`):
  descoberta durante a validação desta revisão — o Art. 75 (dezenas de hipóteses de dispensa, sob a
  seção "Da Dispensa de Licitação") é o artigo mais longo da lei e a normalização de comprimento do
  RAG-QUALITY-001 o penalizava mais que o necessário, deixando o Art. 76 (Alienações, que também cita
  "dispensa" repetidamente) na frente. Quando o PRÓPRIO título/seção do artigo casa especificamente
  com a consulta, a normalização de comprimento relaxa (b menor) — o comprimento nesse caso é
  profundidade temática, não diluição genérica.
- `RetrievalResult.topPassageGenericContainer: boolean` — novo sinal: a passagem de maior score veio
  de um container genérico enquanto um concorrente temático existia. Propagado ao `ContextPackage.metadata`.

### 3. `server/domain/institutionalConsultation.ts` — suficiência separada de relevância
`classifyEvidenceSufficiency` passa a exigir 3 condições para "fundamentada": cobertura+score
suficientes (já existia) **E** a passagem líder ser tematicamente relevante (`!topPassageGenericContainer`)
**E** a geração não ter sido cortada (`!generationTruncated`, novo parâmetro opcional). Falhar
qualquer uma rebaixa para "parcial" — nunca simplesmente "insuficiente" (ainda há base documental).
`buildConsultationAnswer` registra a limitação específica de cada causa (container genérico vs.
geração truncada) separadamente.

### 4. `finishReason` auditável (não mais descartado)
- `CognitiveOutcome` (domain/aiExecutionContext.ts) ganha `finishReason` — mesma categoria de
  `tokens`/`latencyMs` (fora do replayHash, que cobre só insumos determinísticos).
- `aiExecutionEngine.ts` captura `generated.finishReason` (antes ignorado) e o inclui no outcome.
- `CognitiveObservability` (log estruturado `[cognitive-observability]`) passa a incluir
  `finishReason` — auditável por correlationId, sem migration (persistido dentro do `payload` JSON já
  existente).
- `institutionalConsultationService.ts::answerConsultation` lê
  `execution.context.outcome.finishReason === "max_tokens"` e passa `generationTruncated` para
  `buildConsultationAnswer` — a resposta nunca é "fundamentada às cegas" quando a geração foi cortada.

## Prova (corpus real, medido antes e depois)

Pergunta relatada — top-3 para `lei-14133-2021` ANTES desta revisão (herdando o RAG-QUALITY-001):

| Posição | Artigo | Observação |
|---|---|---|
| #1 | Art. 1º | — |
| #2 | **Art. 191º** (duplicata 1) | Disposições Transitórias — 3 blocos existiam |
| #3 | **Art. 191º** (duplicata 2) | mesmo artigo, ocupando 2 das 3 vagas |

Depois desta revisão:

| Posição | Artigo | Score |
|---|---|---|
| #1 | **Art. 75º** | 1.465 |
| #2 | Art. 89º | 1.276 |
| #3 | Art. 14º | 1.245 |

`topPassageGenericContainer = false`. Art. 191 não aparece mais no top-3 (verificado inclusive com
`maxPassagesPerDocument=10`).

Os 3 cenários já corretos permanecem corretos, incluindo o caso descoberto durante a validação desta
revisão (Art. 75 vs. Art. 76 na pergunta de "dispensa"):

| Cenário | Top-1 antes desta revisão | Top-1 depois |
|---|---|---|
| inexigibilidade | Art. 74º (1.322) | Art. 74º (1.322) — inalterado |
| dispensa | **Art. 76º** (1.053) — Art. 75 caiu para 3º | **Art. 75º** (1.116) — corrigido |
| instrução do processo | Art. 72º (2.007) | Art. 72º (2.007) — inalterado |

## Testes

Novo arquivo `server/__tests__/integration/rag-quality-002-staging-regression.test.ts` (17 testes):
- confirma a causa (3 ocorrências de "Art. 191." no texto-fonte real);
- dedup do parser (unitário + no corpus real ingerido);
- preserva ordem natural do documento após dedup;
- a pergunta relatada nunca mais retorna Art. 191 como fundamento principal (isolado + com folga +
  fluxo completo via `answerConsultation`);
- os 3 cenários que já passaram no staging, como regressão explícita;
- `classifyEvidenceSufficiency`: container genérico e geração truncada capeiam em "parcial";
- `buildConsultationAnswer`: limitações específicas para cada causa;
- `finishReason` exposto por `executeCognitiveTask`.

Suítes pré-existentes (`rag-quality-001`, `rc49/50/51`, `grounding-and-municipal-resolution`,
`sprint47-institutional-rag`, `rc451`, `query-expansion`) — sem alterações necessárias, todas verdes.

## Validação executada

- `tsc --noEmit`: 0 erros.
- `vite build` + `esbuild`: sucesso.
- Suíte completa (`vitest run`): **3861 passed / 92 skipped / 0 falhas** (RAG-QUALITY-001 deixou
  3844; +17 testes novos desta revisão, zero regressões).

## Fora do escopo (não tocado)

Não foi aumentado `CONSULTATION_MAX_OUTPUT_TOKENS` nem alterado `shouldDisableThinking` — sem acesso
ao staging para confirmar que o corte era de fato por `MAX_TOKENS` (vs. outra causa), a correção
trata a causa estruturalmente (audita `finishReason`, nunca classifica "fundamentada às cegas"
quando a geração é cortada) em vez de ajustar orçamento de tokens por presunção. `@google/genai`,
production, PR B, dashboard, migrations/schema, Kernel Cognitivo — não tocados.

## Pendente (ação do usuário)

Sem push, sem PR, sem alteração em production, por instrução explícita — commit local único.
Validação funcional real no staging (as 4 perguntas + observar se `finishReason=max_tokens` aparece
nos logs de `[cognitive-observability]` quando uma resposta vier incompleta) depende da execução do
usuário, como nas revisões anteriores desta sessão.

## Adendo — checagem de confirmação antes do push (mesma revisão, sem reabrir a sprint)

Antes de autorizar o push, o usuário pediu 3 confirmações. As duas primeiras foram medidas e
confirmadas sem exigir mudança de código; a terceira revelou um bug real, corrigido nesta mesma
revisão (commit único, ainda não publicado).

### 1. Inventário dos 207 identificadores + explicação da diferença 209→207

Medido diretamente: o texto-fonte tem **209 linhas** que iniciam com `Art. N` — e **exatamente uma**
delas se repete: `Art. 191º` (3 ocorrências). Nenhum outro identificador tem duplicata. 209 − 2
(ocorrências extras do Art. 191) = 207, batendo exatamente com `parsed.articles.length`. Os 207
identificadores do corpus ingerido são todos únicos e coincidem exatamente com os identificadores
únicos do texto-fonte (nenhum artigo real foi perdido pelo dedup). Nota à parte (não é um problema
introduzido por esta correção): a numeração bruta do texto-fonte inclui 12 artigos "Art. 337º-E" a
"Art. 337º-P" fora de sequência — são os NOVOS artigos do Código Penal inseridos pelo Art. 178 da Lei
14.133 (tipos penais), citados verbatim dentro do próprio Art. 178; não são duplicatas, cada um
aparece uma única vez, e não foram alterados por esta revisão.

### 2. Prova de que a ocorrência mantida é a redação vigente

Teste dedicado isola as 3 ocorrências brutas por posição no arquivo: as duas primeiras contêm o
marcador `Medida Provisória`/`Vigência encerrada` (a 1ª tem o parágrafo único marcado como revogado
pela MP 1.167/2023; a 2ª É a própria redação da MP, cuja vigência se encerrou); a 3ª — a mantida pelo
dedup — não contém nenhum desses marcadores, e seu texto é verificado como substring literal do
artigo deduplicado.

### 3. Consultas explícitas sobre Art. 191/disposições transitórias não sofrem a penalização temática

**Aqui a checagem encontrou um bug real**, medido contra o corpus: a pergunta "até quando a
administração pode optar pela lei 8666 em vez da lei 14133?" (sobre o próprio conteúdo do Art. 191)
não trazia o Art. 191 nem entre as 5 primeiras passagens. Causa: `hasSpecificHeadingMatch` disparava
o "concorrente temático" com **qualquer** casamento de palavra isolada no título de OUTRO artigo —
inclusive palavras estruturais genéricas como "lei" (presente no título "Do Âmbito de Aplicação desta
Lei", Capítulo I) ou "administração" (presente em "Das Prerrogativas da Administração"), que casam
com quase qualquer pergunta sobre a própria lei. Isso penalizava o Art. 191 (container genérico) por
"concorrência" com um match espúrio de uma única palavra comum, mesmo sem nenhuma relação temática
real.

**Correção**: `hasSpecificHeadingMatch` agora exige 2+ termos casados no título do concorrente, ou 1
termo isolado com score ≥ 0.5 (muito específico/raro) — títulos temáticos reais em normas brasileiras
quase sempre são expressões de 2+ palavras ("Da Contratação Direta", "Da Dispensa de Licitação");
uma única palavra genérica ("lei", "administração", "disposições") não basta mais.

**Resultado medido, depois da correção**:
- "até quando a administração pode optar pela lei 8666...?" → Art. 191 passou a ser a passagem de
  maior score (1.423) — antes nem aparecia no top-5.
- "o que diz o artigo 191 da lei 14133?" → Art. 191 continua correto (não regrediu).
- Os 4 cenários já corretos do staging (contratação direta→75, inexigibilidade→74, dispensa→75,
  instrução do processo→72) **continuam corretos** — o ajuste de limiar não alterou nenhum deles.
- "o que são as disposições transitórias da lei 14133?" — pergunta lexicalmente rasa ("disposições"
  só existe em títulos, nunca no corpo dos artigos; "lei" é extremamente genérico). O Art. 191 ainda
  não vence o ranking nesse caso específico, mas **medido e confirmado**: `topPassageGenericContainer
  = false` — a fraqueza vem da pobreza lexical da pergunta (limitação geral de busca puramente
  lexical, sem paráfrase/sinônimos, pré-existente e fora do escopo desta correção), não da
  penalização temática introduzida nesta sprint. Documentado explicitamente para não ser confundido
  com uma regressão em revisões futuras.

Testes: 8 novos casos (`rag-quality-002-staging-regression.test.ts` passa de 17 para 25),
cobrindo os 3 pontos acima. Suíte completa após o ajuste: **3869 passed / 92 skipped / 0 falhas**
(+8 sobre a validação anterior desta mesma revisão). `tsc --noEmit` e `build` sem erros.
