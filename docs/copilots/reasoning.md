# copilotReasoningService — Reasoning fundamentado

## Responsabilidade

O `copilotReasoningService` executa o **reasoning especializado** de cada copiloto.
Ele transforma o contexto institucional em uma **recomendação fundamentada**, sempre
roteando a inferência pelo pipeline oficial (`server/_core/llm.ts`).

Regra inviolável: **nunca envia prompt cru**. O reasoning só é acionado sobre um
**contexto fundamentado** montado pelo `PromptContextBuilder`, que combina evidências
do Institutional RAG e caminhos do Procurement Knowledge Graph.

## Posição no pipeline

```
... → Knowledge Graph → Institutional RAG → [Context Assembly] → [Reasoning] → [Recommendation] → ...
                                                └──── copilotReasoningService ────┘
```

## Fluxo interno

1. **Recuperação de contexto** — o serviço consulta:
   - `retrieveFromKnowledgeGraph` — relações e entidades da contratação;
   - `retrieveAll` — trechos relevantes do RAG institucional (Lei 14.133/2021,
     jurisprudência, modelos, memória semântica).
2. **Context Assembly** — o `PromptContextBuilder` monta um contexto estruturado:
   domínio do copiloto, artigo(s) legal(is) pertinentes, entidades do grafo, memória
   semântica e restrições de política.
3. **Roteamento da inferência** — o contexto é enviado ao **Provider Layer** via
   `invokeLLM` / `generateText`. O copiloto **não conhece** o provider; conhece apenas
   a interface do pipeline oficial.
4. **Estruturação da recomendação** — a saída é normalizada em
   `copilotRecommendation`, com evidências vinculadas e nível de confiança.
5. **Registro do trace** — cada passo de reasoning é gravado em `copilotDecisionTrace`
   (ver `explainability.md`).

## PromptContextBuilder

O `PromptContextBuilder` é a única forma de compor o insumo da inferência. Ele garante:

- **grounding obrigatório** — nenhuma afirmação sem evidência recuperável;
- **artigo legal no contexto** — fundamentação da Lei 14.133/2021 sempre presente;
- **escopo do copiloto** — o contexto carrega os limites de `copilotPolicy`;
- **determinismo** — mesma entrada produz o mesmo contexto (hash SHA-256), o que
  sustenta o **replay safety**.

## Recomendações fundamentadas

Toda recomendação produzida:

- é **editável, revisável e validada por humano**;
- carrega as **evidências** que a sustentam (trechos do RAG, nós do grafo);
- declara **confiança** e eventuais **riscos identificados**;
- nunca constitui **decisão jurídica** nem **parecer definitivo** — apenas orientação
  fundamentada para a decisão humana.

## Degradação graciosa — modo grounding-only determinístico

Quando o **provider não está disponível** (falha, indisponibilidade ou ausência de
credenciais), o reasoning **não quebra**: entra em **modo grounding-only
determinístico**.

Nesse modo:

- o serviço retorna apenas o **contexto fundamentado** (evidências do RAG + caminhos
  do Knowledge Graph), sem geração livre de texto;
- a resposta é **determinística** e reproduzível a partir das mesmas entradas;
- a recomendação é marcada como **parcial / grounding-only**, sinalizando ao usuário
  que a síntese por IA não foi executada;
- nenhuma decisão é inferida — a orientação se limita ao que já está fundamentado.

O mesmo princípio vale para ausência de banco (padrão `getDb()`): o reasoning opera em
memória, sem persistir trace, até o DB retornar.

## Garantias

- **IDs determinísticos (SHA-256)** para contexto, recomendação e passos de reasoning;
- **multi-tenant** — todo contexto é isolado por `organizationId`;
- **correlationId** propagado para observabilidade ponta a ponta;
- **replay safety** — o trace permite reexecutar o reasoning de forma idêntica.

## Fluxo resumido

```
input (consulta + copiloto + organizationId)
  → retrieveFromKnowledgeGraph  (entidades e relações)
  → retrieveAll                 (evidências do RAG institucional)
  → PromptContextBuilder        (contexto fundamentado, hash SHA-256)
  → invokeLLM / generateText    (Provider Layer — server/_core/llm.ts)
  → copilotRecommendation       (evidências + confiança + riscos)
  → copilotDecisionTrace        (steps + lineage + snapshot)
```

## O que o reasoning nunca faz

- **nunca** chama o provider fora de `server/_core/llm.ts`;
- **nunca** envia prompt sem grounding do RAG e do Knowledge Graph;
- **nunca** conclui decisão jurídica ou emite parecer definitivo;
- **nunca** aplica a recomendação — isso é papel da Approval Layer.

## Referências

- `server/_core/llm.ts` — `invokeLLM` / `generateText` (Provider Layer)
- `docs/copilots/explainability.md` — cadeia de reasoning e replay
- `docs/copilots/policies.md` — limites aplicados ao contexto
