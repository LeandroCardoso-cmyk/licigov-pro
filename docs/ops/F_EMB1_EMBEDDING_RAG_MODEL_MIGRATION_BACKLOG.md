# F-EMB1 — Embedding/RAG Model Migration & Lineage

> **Estado:** `PLANNED — PRE-PILOT BLOCKER`
> **Origem:** homologação LIVE A3 (staging, deployment `c14ea1fc-a1e0-4195-bad8-90055783e7cf`).
> **NÃO implementar durante a correção A3** — este documento é apenas o REGISTRO FORMAL do backlog.

## Contexto (finding não-bloqueante da homologação A3)

A LIVE A3 mostrou que o fluxo RAG usado por Suggestions chama o modelo de embedding
`text-embedding-004`, que retornou **`404 Not Found`** na Gemini API. O fluxo Suggestion **passou
corretamente** mesmo assim, como `completed_degraded` / `groundingState=ungrounded` /
`evidenceFingerprint=null` — ou seja, a **semântica de degraded state está correta e honesta** (o
sistema não fabricou grounding). Portanto **não é** defeito da A3 e **não** deve ser corrigido na
janela de correção A3.

## Por que NÃO trocar o modelo de embedding agora (risco)

Trocar `text-embedding-004` por outro modelo não é "mudar uma string": o estado atual mistura
espaços vetoriais e cache incompatível se feito sem lineage. Riscos concretos identificados:

- `embedding_cache.textHash` é UNIQUE **sem o modelo na identidade do cache** — um novo modelo
  reutilizaria vetores de outro espaço.
- Existe coluna `model`, mas o **lookup atual é por `textHash`** (ignora o modelo).
- `law_chunks.embedding` **não tem lineage de model/version**.

Trocar imediatamente poderia **misturar embedding spaces** ou reutilizar cache incompatível —
corrompendo silenciosamente o RAG.

## Escopo mínimo futuro (quando F-EMB1 for autorizado)

- Modelo de embedding **estável e pinado** (sem alias móvel).
- **Model/version na identidade do cache** (`embedding_cache`) — nunca só `textHash`.
- **Vector dimension contract** explícito.
- **Lineage de embedding** em corpus/`law_chunks` (model + version).
- Estratégia de **regeneração/reindex** do corpus.
- **Zero mistura** entre embedding spaces (isolamento por model/version).
- **Replay/observability** do RAG.
- **Migration/versioning** do schema de embeddings.
- **Homologação RAG real** (evidência recuperada validada).

## Fora de escopo agora

Não implementar nesta fase. Não alterar `text-embedding-004` na correção A3. Não iniciar C/D/E/F.
Este item é um **bloqueador de pré-piloto** a ser tratado em janela própria, sob autorização.
