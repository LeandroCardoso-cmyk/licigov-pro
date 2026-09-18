# F-EMB1 — Embedding Lineage e Reindexação Governada

## Objetivo

F-EMB1 elimina comparação silenciosa entre espaços vetoriais incompatíveis no RAG jurídico do LiciGov Pro. A identidade de um embedding é composta, no mínimo, por `model + dimensions`; mesma dimensionalidade não implica mesmo espaço vetorial.

Espaço canônico desta frente:

- modelo: `gemini-embedding-2`;
- dimensionalidade: `768`;
- similaridade: cosine similarity;
- corpus: `law_chunks`, global/referencial no modelo arquitetural atual.

## Lineage histórica

A migration `0301_f_emb1_embedding_lineage.sql` preserva a verdade histórica:

- vetores legados são marcados como `text-embedding-004 / 768`;
- nenhum vetor legado é rotulado como `gemini-embedding-2` sem regeneração real;
- `embedding_cache` recebe `dimensions` e a identidade de cache passa a considerar modelo, dimensão e texto normalizado;
- `embedding_reindex_runs` registra execução, ambiente, modelo, dimensão, estado e contadores.

A migration é exclusivamente estrutural. Ela não chama provider externo e não reindexa o corpus.

## Comportamento do RAG

`retrieveRelevantLaw`:

1. seleciona somente `law_chunks` com `embeddingModel === EMBEDDING_MODEL` e `embeddingDimensions === EMBEDDING_DIM`;
2. faz uma segunda validação de lineage em memória antes do boundary de similaridade;
3. não chama o provider quando não existe corpus elegível no espaço atual;
4. rejeita JSON/vetor inválido;
5. nunca usa corpus legado como fallback silencioso;
6. retorna vazio/degradado explicitamente quando não existe grounding compatível.

## Runner de reindexação

Comando canônico:

```bash
pnpm db:embedding:reindex -- --dry-run --environment staging
pnpm db:embedding:reindex -- --apply --environment staging --run-id <uuid>
```

O runner é one-shot e deliberadamente não possui:

- endpoint público;
- scheduler permanente;
- execução automática no boot;
- side effect escondido em migration.

### Dry-run

- não cria ledger;
- não chama provider;
- não altera `law_chunks`;
- informa stale/current por contadores sanitizados.

### Apply

- exige `runId` UUID explícito;
- cria ledger `running` antes do processamento;
- processa apenas chunks fora do espaço canônico;
- gera/valida o embedding;
- persiste `embedding + embeddingModel + embeddingDimensions` e incrementa o ledger na mesma transação por chunk;
- interrompe em falha e marca o run como `failed` com código sanitizado;
- preserva chunks já convertidos;
- retry usa novo `runId` e naturalmente processa somente os stale restantes;
- fecha `completed` somente após confirmar `stale count = 0`.

### Replay

- o mesmo `runId` já `completed` retorna `replayed` e não chama provider novamente;
- `runId` já `running` ou `failed` não é reutilizado silenciosamente;
- uma nova execução após reindexação completa deve concluir com zero stale e zero chamadas ao provider.

## Produção

O CLI suporta produção apenas para o rollout futuro e exige acknowledgement adicional:

```bash
pnpm db:embedding:reindex -- --apply --environment production --run-id <uuid> --production-approved
```

`--production-approved` é somente uma barreira operacional contra execução acidental. Ela **não substitui** a autorização humana/owner exigida pelo processo de governança do LiciGov Pro.

Nenhuma execução produtiva deve ocorrer antes de gate explícito contendo, no mínimo:

- SHA e PR;
- CI verde;
- migration validada em MySQL real;
- staging deploy;
- staging migration;
- staging reindex;
- replay/noop;
- A3 LIVE pós-fix grounded;
- riscos residuais e fallback.

## Observabilidade e segurança

Logs podem conter:

- `runId`;
- modelo;
- dimensão;
- status;
- contadores;
- códigos de erro sanitizados.

Logs não devem conter:

- `GEMINI_API_KEY`;
- `DATABASE_URL`;
- texto jurídico integral;
- prompt sensível;
- embedding completo;
- credenciais ou dados pessoais desnecessários.

## Fallback

Se o corpus compatível estiver ausente ou incompleto, o RAG falha de forma observável e não fabrica grounding. O legado permanece identificado historicamente até regeneração real; não existe conversão de metadata sem novo vetor.


## Checkpoint de integração DATA-039/G8 — 2026-09-18

- DATA-039/G8 reconciliado de forma aditiva sobre F-EMB1/F-RAG1; schema, journal, package e migration 0301 preservados da linha F-EMB1.
- CI de validação integrada #560: SUCCESS; suíte 5.209 passed / 328 skipped; smoke DATA-039 MySQL 8/8 passed.
- CI oficial do PR #226 #561: SUCCESS, incluindo novamente Smoke MySQL + DATA-039.
- Staging web no SHA integrado passou pelo predeploy canônico (migrations replay-safe + reference-data noop).
- F-RAG1 dry-run em staging: setId=1, version=1, total=7, existing=0, materialized=0, replayed=false.
- Apply F-RAG1 permanece gate operacional seguinte; produção e main continuam fora de escopo.
