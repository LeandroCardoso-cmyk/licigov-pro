# RAG-QUALITY-001 — Correção da recuperação jurídica no "Tirar Dúvidas"

## Contexto

Após a correção do bug `thinkingConfig` (commit `15ccc9e`), o Gemini voltou a responder de verdade
no "Tirar Dúvidas". Ao testar em staging, a pergunta **"qual artigo da lei 14133 fala da contratação
direta?"** retornou uma resposta marcada **"Fundamentada"**, mas os trechos recuperados eram os
arts. 6º, 9º e 14 — dispositivos sem relação direta com a pergunta. A resposta correta está nos
arts. 72 a 75 (Capítulo VIII — "Da Contratação Direta").

Esta sprint corrige **exclusivamente** essa falha de recuperação (retrieval), sem tocar em geração,
schema, autenticação ou qualquer código fora do fluxo `institutionalConsultation.ask`.

## Causa raiz (medida, não presumida)

O diagnóstico partiu de medição direta contra o corpus real (`buildOfficialKnowledgeCorpus()`), não
de suposição. Rodando a consulta relatada contra os 209 blocos (artigos) da Lei 14.133/2021 com o
código **anterior**:

| Posição | Artigo | Score | Termos casados |
|---|---|---|---|
| #1 | Art. 6º | 0.491 | qual, artigo, lei, contratacao, direta |
| #1 (empate) | Art. 14º | 0.491 | qual, artigo, lei, contratacao, direta |
| #3 | Art. 92º | 0.414 | qual, lei, contratacao, direta |
| **#8** | **Art. 75º** | 0.336 | artigo, lei, contratacao, direta |
| **#19** | **Art. 74º** | 0.274 | artigo, contratacao, direta |
| **#22** | **Art. 72º** | 0.259 | lei, contratacao, direta |
| **#48** | **Art. 73º** | 0.197 | contratacao, direta |

Com `maxPassagesPerDocument = 3`, apenas Art. 6º, Art. 14º e Art. 92º chegavam ao Gemini — os
arts. 72-75 nunca entravam na evidência, mesmo casando vários termos da pergunta.

Três causas concorrentes, todas confirmadas lendo o código-fonte e medindo o corpus real:

1. **Chunking por artigo sem normalização de comprimento.** `officialTextParser.ts` gera **um bloco
   por artigo** (`buildKnowledgeDocument` em `officialCorpusIngestion.ts`). O Art. 6º é um glossário
   de ~60 incisos (945 tokens — 4 a 8× maior que a média). O score antigo era uma soma de IDF sobre
   presença binária de termo (`Set`, sem TF, sem length normalization) — um bloco enorme tem chance
   muito maior de conter qualquer termo da consulta só por amplitude de vocabulário, não por
   relevância temática.
2. **O título descritivo do capítulo/seção era parseado e descartado.** O texto oficial traz, antes
   do Art. 72, as linhas `CAPÍTULO VIII` / `DA CONTRATAÇÃO DIRETA` / `Seção I` / `Do Processo de
   Contratação Direta`. O parser (`parseOfficialText`) já capturava essas linhas em
   `segments[].text`, mas o array `path` (usado no retrieval) só guardava o **identificador**
   (`"Capítulo VIII"`), nunca o **rótulo temático** (`"Da Contratação Direta"`) — a única parte do
   texto que contém, literalmente, a expressão da pergunta. Esse sinal simplesmente não existia no
   retrieval.
3. **Ruído de termos interrogativos e do número da norma.** `expandQueryTerms` tokenizava "qual" e
   "fala" como termos de conteúdo. "qual" aparece **incidentalmente** em blocos grandes (conectivo
   comum em texto jurídico longo), inflando o score de artigos irrelevantes; "fala" e "14133" nunca
   ocorrem no corpo de nenhum artigo (df=0), mas seguiam consumindo peso no denominador do IDF,
   deflacionando todos os scores de forma desigual.

O selo "Fundamentada" agravava o problema: `hasSufficientBasis` em
`server/domain/institutionalConsultation.ts` era **binário** —
`documents.length > 0 && retrievedPassages.length > 0`. Bastava UMA passagem, de qualquer
relevância, para o rótulo "Fundamentada" aparecer. Não havia verificação de cobertura de termos nem
de força do score.

## Correção implementada

Toda a correção permanece **100% lexical/determinística** — nenhuma IA, embeddings ou vetor foi
introduzido (fora de escopo desta sprint e da arquitetura desta camada).

### 1. `server/services/officialCorpus/officialTextParser.ts`
`ParsedSegment` ganha um campo opcional `label` (o rótulo temático da linha seguinte ao marcador
estrutural). `ParsedArticle` ganha `headingText: readonly string[]`, paralelo a `path`, com o rótulo
de cada nível estrutural (ex.: `["Título II", "Capítulo VIII — Da Contratação Direta", "Seção I —
Do Processo de Contratação Direta"]`). `path` continua idêntico (usado pela árvore normativa) — a
mudança é aditiva.

### 2. `server/domain/officialCorpus/officialCorpusIngestion.ts`
`headingText` passa a integrar `metadata` do `KnowledgeBlock` de cada artigo (fragmento e bloco).

### 3. `server/services/institutionalIntegration/knowledgeRetrievalService.ts` (motor reescrito)
- **BM25-lite com normalização de comprimento**: `tokenizeCounts` produz frequência (TF); o score
  usa `k1=1.4`, `b=0.75` — blocos mais longos que a média são penalizados proporcionalmente,
  blocos mais curtos ganham um pequeno bônus. Isso elimina a vantagem estrutural do Art. 6º.
- **Descarte de termos "df=0"**: termos que não ocorrem em NENHUM bloco candidato (ex.: o número da
  norma citado na pergunta) são excluídos do denominador do IDF — generaliza para qualquer número/
  termo fora do vocabulário do corpus, sem tratamento especial.
- **STOPWORDS estendido**: pronomes interrogativos e verbos auxiliares de pergunta ("qual", "quais",
  "quando", "fala", "pode", "deve", "preciso" etc.) somam-se aos conectivos já filtrados —
  generaliza para qualquer pergunta, não hardcoda o caso de teste.
- **Boost de título/seção** (`HEADING_BOOST_WEIGHT = 0.6`): os termos da consulta são também
  comparados ao `headingText` do bloco; quando casam com o rótulo do capítulo/seção, TODOS os
  artigos daquele container recebem o sinal — aproxima o comportamento de um profissional navegando
  a lei por título/matéria.
- **Vizinhança estrutural** (`NEIGHBOR_BOOST_WEIGHT = 0.15`): artigos do mesmo container de um artigo
  bem pontuado recebem reforço proporcional ao pico do grupo — o cluster inteiro (arts. 72-75) tende
  a emergir junto, não só o artigo isoladamente mais forte.
- **2ª rodada de busca determinística** (`retrieveKnowledge`): se a cobertura de termos "alcançáveis"
  nas passagens retornadas for baixa (`< 0.5`) e não houver passagem já muito forte (`< 0.6`), uma
  2ª rodada mais permissiva (`minScore` reduzido pela metade, `maxPassagesPerDocument` dobrado, teto
  8) é tentada — no máximo 2 rodadas, sem aleatoriedade, resultado nunca pior que a 1ª rodada.
  `RetrievalResult` ganha `searchRounds`, `coverageRatio`, `maxPassageScore` (auditáveis).

### 4. `server/domain/institutionalConsultation.ts` — selo de 3 estados
`classifyEvidenceSufficiency(pkg)` substitui o corte binário:
- **`insuficiente`**: nenhuma passagem recuperada (idêntico ao `hasSufficientBasis=false` anterior).
- **`fundamentada`**: `coverageRatio >= 0.5` **e** `maxPassageScore >= 0.25`.
- **`parcial`**: há passagem(ns), mas cobertura/score abaixo do limiar de confiança — a resposta
  ganha uma limitação explícita ("os trechos recuperados podem não ser o dispositivo mais diretamente
  aplicável — confirme com a autoridade competente").

`hasSufficientBasis` (boolean) é preservado como `evidenceSufficiency !== "insuficiente"` —
compatibilidade total com consumidores existentes. `status` (`completed`/`limited`/`failed`) não
muda de semântica; **nenhuma migration/schema foi criada** (`status` já era `varchar(20)` livre).

### 5. Frontend (`TirarDuvidasHome.tsx`)
O badge da resposta passa a ter 3 estados: **Fundamentada** (verde), **Resposta parcial** (âmbar),
**Evidência insuficiente** (vermelho) — antes só existiam 2 (verde/âmbar).

## Prova (corpus real, pós-correção)

Repetindo a mesma medição para a pergunta relatada, agora com o motor corrigido — top-3 para
`lei-14133-2021`:

| Posição | Artigo | Score |
|---|---|---|
| #1 | **Art. 75º** | 2.251 |
| #2 | Art. 1º | 2.023 |
| #3 | **Art. 72º** | 1.954 |

Com folga de passagens (`maxPassagesPerDocument=10`), o cluster completo (arts. 72, 73, 74 e 75)
emerge — prova de que a vizinhança estrutural funciona, não só o boost de título isoladamente.
`coverageRatio = 1.0`, `maxPassageScore = 2.251`, `searchRounds = 1` (cobertura já alta, sem
necessidade de 2ª rodada) → `evidenceSufficiency = "fundamentada"`, mas agora **apoiada nos
dispositivos corretos**.

## Testes

- `server/__tests__/integration/rag-quality-001-legal-retrieval.test.ts` (novo, 14 testes): parser
  (heading preservado), `expandQueryTerms` (ruído descartado), recuperação real da pergunta
  relatada (arts. 72-75 superam o Art. 6º; cluster completo emerge com folga; coverage/maxScore/
  searchRounds), 2ª rodada de busca (força e recusa de escalonamento), selo de 3 estados
  (`classifyEvidenceSufficiency` + `buildConsultationAnswer`, todas as combinações), fluxo completo
  (`answerConsultation`) para a pergunta que motivou o bug.
- `server/__tests__/integration/query-expansion.test.ts` (1 teste atualizado + 1 novo): o teste
  antigo esperava `"quando"` como termo válido — esse era exatamente o comportamento que causava
  ruído; atualizado para refletir o novo filtro, com um teste dedicado explicando o motivo.
- Suítes pré-existentes que exercitam o retrieval real (`rc49`, `rc50`, `rc51`,
  `grounding-and-municipal-resolution`, `sprint47-institutional-rag`, `rc451`) — **sem alterações**,
  todas verdes.

## Validação executada

- `tsc --noEmit`: 0 erros.
- `vite build` + `esbuild` (bundle do servidor): sucesso.
- Suíte completa (`vitest run`): **3844 passed / 92 skipped / 0 falhas** (antes desta sprint: 3829;
  +15 testes novos, zero regressões).
- Medição direta contra o corpus real (script ad-hoc, executado e removido — não commitado) antes e
  depois da correção, documentada acima.

## Fora do escopo (não tocado)

`@google/genai` (SDK), `production`, chave de API de produção, PR B, dashboard, migrations/schema,
PR C/D, Kernel Cognitivo (reestruturação), embeddings/IA real/busca vetorial. Nenhuma resposta foi
hardcoded para a pergunta de teste — a correção é do mecanismo geral de recuperação (BM25-lite +
título + vizinhança + 2ª rodada + selo de suficiência), validada com múltiplas perguntas diferentes
durante a medição (dispensa de licitação, modalidades de licitação, registro de preços — todas com
`coverageRatio` alto e `searchRounds=1`, sem regressão perceptível).

## Pendente (ação do usuário)

Esta sprint **não abre PR e não altera production**, por instrução explícita. Falta:
1. Push da branch `claude/rebuild-licigov-pro-bFyTO` (sem PR).
2. Validação manual no staging: login + as 4 perguntas de teste (a que motivou o bug + as 3
   variações de checagem) — sem acesso a URL/credenciais de staging neste ambiente, esta etapa
   depende da execução do usuário, como nas sprints anteriores desta sessão.
