# RAG-QUALITY-003 — Truncamento (MAX_TOKENS), retry único e cobertura dos artigos primários

## Contexto

Após o RAG-QUALITY-002, o usuário testou 4 perguntas no staging: o retrieval melhorou (Art. 191 e a
pergunta sobre transição vieram completas e corretas), mas 3 respostas vieram **truncadas**:
contratação direta (terminou no meio da frase), inexigibilidade (terminou em "aquisição de") e
instrução do processo (terminou no primeiro item da lista).

## 1. Consulta aos logs — limitação declarada

Não há acesso à URL/credenciais de staging neste ambiente para ler os logs `[cognitive-observability]`
diretamente (mesma limitação declarada em todas as revisões anteriores desta sessão). A causa foi
inferida a partir de evidência de código, não de logs reais:

- `finishReason` (instrumentado no RAG-QUALITY-002) é o único sinal disponível para confirmar
  `MAX_TOKENS` — nesta revisão, ele foi propagado e usado corretamente, mas sua LEITURA real em
  staging depende do usuário observar o log.
- O padrão relatado (perguntas com evidência de múltiplos artigos truncam; a pergunta sobre um único
  artigo — Art. 191 — completa) é consistente com o teto de saída (`CONSULTATION_MAX_OUTPUT_TOKENS`,
  1500) sendo insuficiente quando a evidência recuperada é mais rica — o modelo consome parte do
  orçamento em raciocínio interno antes do texto visível, e tende a gerar respostas mais longas
  quando há mais dispositivos a citar, mesmo com a instrução de objetividade.
- Não há nenhum CSS de truncamento (`overflow-hidden`/`max-h-`/`line-clamp`) no bloco de resposta do
  frontend (`TirarDuvidasHome.tsx`) — confirmado por grep, sem mudança desde o RAG-QUALITY-002 — o que
  aponta para corte no backend, não no frontend.

A correção foi implementada para tratar corretamente `MAX_TOKENS` **sempre que ele ocorrer**
(condicional em runtime, via `finishReason`), independentemente de eu conseguir confirmar
pessoalmente o valor exato nos logs de staging.

## 2. Orçamento configurável + retry único

### `server/config/ai.ts`
`resolveLegalAnalysisMaxOutputTokens(env)` — configurável via `LEGAL_ANALYSIS_MAX_OUTPUT_TOKENS`;
default aumentado de 1500 para **3000** (dobro), com fallback ao default para valores ausentes/
inválidos/não-positivos. `LEGAL_ANALYSIS_MAX_OUTPUT_TOKENS` exportado, resolvido uma vez no boot.

### `server/services/institutionalConsultationService.ts`
- `CONSULTATION_MAX_OUTPUT_TOKENS` agora referencia o valor configurável.
- **Retry único em MAX_TOKENS**: a chamada combinada `executeCognitiveTaskWithInstitutionalContext`
  foi separada em `resolveInstitutionalContextPackage` (recuperação — chamada **uma única vez**) +
  `executeCognitiveTask` (chamada ao provider — até 2 vezes). Se a 1ª tentativa retorna
  `finishReason === "max_tokens"`, uma 2ª tentativa é feita com orçamento maior
  (`×1.6`, teto de 6000) — nunca uma 3ª tentativa (sem laço).
- **correlationId preservado**: as duas tentativas usam o MESMO `correlationId` — não é tratado como
  replay (`replayId`/`replayOfExecutionId` continuam reservados a replay EXPLÍCITO do usuário).
- **Sem duplicidade de persistência**: `repo.createConsultation`/`repo.completeConsultation` continuam
  sendo chamados exatamente uma vez cada (a lógica de retry está inteiramente contida DENTRO do bloco
  que precede a persistência final) — estruturalmente impossível duplicar o registro da consulta ou
  as fontes.
- **Sem duplicidade de auditoria de recuperação**: como a recuperação roda uma única vez, os eventos
  `[institutional-integration-observability]` (contextResolution/knowledgeRetrieval/...) não se
  repetem. Os eventos `[cognitive-observability]` (um por chamada ao provider) aparecem 1x ou 2x
  propositalmente — é o rastro de auditoria de CADA tentativa de geração, não uma duplicação da
  consulta; a persistência em `cognitive_observability` (tabela) já é um UPSERT por
  `hash(correlationId, replayHash)` — como `replayHash` não depende de `maxOutputTokens`, a 2ª
  tentativa sobrescreve a 1ª no mesmo registro, sem criar linha duplicada.

## 3. Respostas completas — reforço no prompt

`server/services/cognitive/promptBuilders.ts` — `GROUNDING_RULES` ganha uma regra explícita: a
resposta deve terminar de forma completa (nunca no meio de uma frase/item de lista); se o limite de
~200 palavras não couber tudo, o modelo deve cortar itens/exemplos secundários, nunca a última frase.
Complementa (não substitui) a correção do orçamento — defesa em profundidade.

## 4. Cobertura dos artigos primários (72, 74, 75) na pergunta geral

Medido: mesmo após o RAG-QUALITY-002, a pergunta geral "qual artigo... trata da contratação direta?"
só trazia o Art. 75 entre os arts. 72-75 — Art. 89 e Art. 14 (sem relação direta com contratação
direta) ocupavam as outras 2 vagas do top-3, mesmo com folga generosa (`maxPassagesPerDocument=8`,
Art. 72 não aparecia nem entre os 8 primeiros).

**Causa**: a vizinhança estrutural (RAG-QUALITY-001) agrupava por Seção (nível mais profundo), mas o
Capítulo VIII "Da Contratação Direta" tem 3 Seções distintas — Processo (Art. 72), Inexigibilidade
(Art. 74) e Dispensa (Art. 75) — cada uma como grupo isolado, sem reforço cruzado entre elas.

**Correção**: a chave de agrupamento de vizinhança passa a usar o nível de **Capítulo** (Título +
Capítulo), não a Seção mais profunda — um Capítulo é a unidade que a Lei usa para agrupar um único
instituto jurídico. Adicionalmente, quando a passagem líder de um documento pertence a um cluster
temático específico, os DEMAIS membros desse cluster têm prioridade sobre concorrentes incidentais de
outros capítulos ao preencher as vagas do top-N, mesmo que estes pontuem um pouco mais alto
isoladamente.

**Resultado medido**: para a pergunta geral, o top-3 de `lei-14133-2021` passa a ser exatamente
**Art. 75º, Art. 74º, Art. 72º** — os 3 artigos primários do capítulo, substituindo Art. 89/Art. 14.
Os cenários já corretos (inexigibilidade→74, dispensa→75, instrução do processo→72, Art. 191/
transição) permanecem inalterados.

## Testes

Novo arquivo `server/__tests__/integration/rag-quality-003-truncation-retry.test.ts` (12 testes):
- `resolveLegalAnalysisMaxOutputTokens` (default, override, valores inválidos, comparação com o teto
  antigo);
- prompt exige conclusão completa (regex no system prompt);
- retry único via provider controlável (injetado com `setActiveProvider`, mesmo padrão já usado em
  `grounding-and-municipal-resolution.test.ts`): 1ª tentativa MAX_TOKENS → 2ª com orçamento maior →
  resposta final é a completa, correlationId preservado, `replayId` nulo (não é replay);
  finishReason=stop na 1ª → nenhum retry (1 chamada); MAX_TOKENS em ambas → exatamente 2 chamadas
  (nunca 3), `evidenceSufficiency` nunca "fundamentada", limitação registrada; sem duplicidade —
  exatamente 1 registro de histórico e 1 conjunto de fontes mesmo com retry;
- cobertura dos arts. 72/74/75 na pergunta geral + regressão dos 4 cenários já corretos.

## Validação executada

- `tsc --noEmit`: 0 erros.
- `build`: sucesso.
- Suíte completa: **3881 passed / 92 skipped / 0 falhas** (RAG-QUALITY-002 deixou 3869; +12 testes
  novos, zero regressões).

## Fora do escopo

`@google/genai`, production, PR B, migrations/schema, revogação de chave — não tocados. Não foi
possível confirmar `finishReason=MAX_TOKENS` diretamente nos logs reais de staging (sem acesso) — a
correção é condicional em runtime (lê `finishReason` real a cada chamada) e funciona corretamente
independentemente da causa exata; validação final depende do teste manual do usuário.
