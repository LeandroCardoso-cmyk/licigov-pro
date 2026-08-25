# C.4A — Replay-Safe Canonical Document Generation

> **Escopo:** geração documental canônica do pipeline `/processos` (DFD → ETP → TR → Edital)
> em `procurementProcessService`. **NÃO** redesenha a fonte-da-verdade `generated_documents` ×
> `official_documents` (isso é **C.4B**). `FF_DIRECT_CONTRACT_SHADOW` permanece **OFF**.

## 1. Problema

A geração documental canônica passou a persistir em **dois lugares** na mesma operação — o rascunho
canônico (`generated_documents`) e o documento oficial versionado (`official_documents` + timeline) —
além de registrar o evento de processo. Sem proteção de replay, um **retry de HTTP**, um **timeout**,
um **duplo clique** ou uma **falha parcial de persistência** podia produzir efeitos duplicados ou,
pior, um estado inconsistente: parte do commit documental gravada e a outra não.

`runWithIdempotency` sozinho **não bastava**: ele fecha a chave como `completed` **depois** de `fn`
resolver, num `saveIdempotencyResult` **separado** do commit documental. Existia a janela proibida
**"official comitado + idempotency falhou"** (crash entre o commit e o save) — que faria um retry
gerar uma **segunda versão oficial**.

## 2. Contrato entregue

### 2.1 `idempotencyKey` (obrigatória)
As 4 mutations (`generateDFD`, `generateETP`, `generateTR`, `generateNotice`) passam a exigir
`idempotencyKey: string` (não-vazia). O cliente gera **uma chave por tentativa lógica**
(`useIdempotencyKey` — `crypto.randomUUID`, em memória, **sem `localStorage`**); o retry de rede do
TanStack Query **reutiliza as variables da mutation** → mesma chave. Uma nova geração deliberada,
**depois de concluída**, recebe nova chave via `rotate()` (chamado em `onSuccess`). O botão fica
`disabled` durante `pending` (anti-duplo-clique), mas a **garantia real é a idempotência do backend**,
não o `disabled` visual.

### 2.2 `payloadHash` determinístico (`generatePayloadHash`)
`sha256` sobre `{ op, organizationId, processId, kind, object, assinatura dos itens aprovados,
modality, form, platform }`. **Exclui** `correlationId`, timestamps e aleatórios. A **assinatura dos
itens aprovados** não é só a lista de IDs: é um snapshot determinístico dos **campos relevantes** de
cada item (`description`, `quantity`, `unit`, `averagePrice`, `suggestedCATMAT`, `status` — os campos
reais de `listIntelligentItems`; **não** há CATSER no domínio de itens hoje), **ordenado por id**.
Assim, mesma request lógica + mesmos itens → mesmo hash (independe da ordem de leitura); **alterar um
campo relevante de um item aprovado muda o hash** e, sob a mesma chave, resulta em **`CONFLICT`**
(nunca sobrescreve efeito com dados diferentes).

### 2.3 Cognição FORA da transação
A parte cognitiva/de rede (`orchestrateMultiCopilot` no ETP/TR; deterministic no DFD/Edital) roda no
callback `produce()`, **antes** de qualquer transação. Nunca se mantém uma transação MySQL aberta
durante uma chamada de modelo/rede.

### 2.4 Commit documental ATÔMICO (`runReplaySafeGeneration`)
Após a cognição, **uma única transação** grava (quando aplicável):
`insertGeneratedDocument` · `generateOfficialDocument` (create/version + timeline oficial) ·
`recordProcessEvent` · **`saveIdempotencyResult` (marca a chave `completed` com a resposta cacheável)**.
Como o `save` da idempotência está **dentro da mesma transação** do commit documental, o estado
proibido "official comitado + idempotency failed" é **impossível**: ou tudo comita, ou nada comita.
Qualquer passo que falhe → **ROLLBACK** de todos os efeitos documentais; em seguida a chave é marcada
`failed` (retry permitido).

### 2.5 Executor plumbing (transação externa compartilhada)
Helpers evoluídos para aceitar um `executor?` opcional (conexão **ou** transação), sem quebrar callers
existentes (`executor ?? await getDb()`):
`idempotencyService.saveIdempotencyResult` · `db/procurement.insertGeneratedDocument` /
`recordProcessEvent` · `documentEngineService.generateOfficialDocument` →
`officialDocumentLifecycleService.createDocument` e folhas de `db/officialDocuments`.
O ciclo oficial preserva **GET_LOCK por linhagem + cálculo de versão serializado + official+timeline
atômicos**: com executor externo usa a transação recebida; sem executor, abre a própria transação
(comportamento anterior). Sem DB, degrada graciosamente (sem persistir, sem idempotência).

### 2.6 Correspondência de linhagem (`canonicalDocumentIdentity`) — SEM nova coluna
Helper **puro e testável** que formaliza `(org + processId + kind)` → id do `generated_document` →
`lineageId` do `official_document`, **reutilizando as mesmas primitivas** do pipeline
(`createGeneratedDocument` / `computeLineageId`) — não há segunda fórmula que possa divergir. Nenhuma
coluna/FK nova nesta fase. A **reconciliação física** é C.4B.

## 3. Matriz de retry

| Estado da chave | Payload | Resultado |
|---|---|---|
| A. `completed` | igual | **replay** da resposta cacheada — sem IA, sem novo `generated`, sem nova versão oficial, sem novo evento |
| B. `processing` | — | **`CONFLICT`** (duplicata em voo) |
| C. `completed` | diferente | **`CONFLICT`** (nunca sobrescreve) |
| D. `failed` (antes do commit) | igual | **retry permitido** — reexecuta |
| E. tx falhou (após generated/após official) | igual | **nenhum efeito parcial** (rollback total); retry permitido; retry cria **UMA** versão final |
| F. resposta HTTP perdida após commit | igual | replay retorna a resposta cacheada; **nenhum efeito novo** |

## 4. O que C.4A GARANTE
- Nenhum estado "official comitado + idempotency failed" (save no mesmo commit).
- Retry/timeout/duplo-clique/perda de resposta → **no máximo um** efeito documental por tentativa lógica.
- Falha parcial (após `generated`, ou após `official`) → **rollback total**, sem versão oficial órfã.
- Concorrência com a mesma chave → **um único efeito** (UNIQUE tenant-aware `idempotency_org_user_key`).
- Isolamento multi-tenant da chave (mesma string em orgs distintas não colide).
- Replay de uma operação **completada NÃO reexecuta cognição** (sem novo custo de IA; sem chain-of-thought).

## 5. O que C.4A NÃO garante (fora de escopo — ver C.4B)
- **Dedup absoluto** de `cognitive_observability` para tentativas que falharam **antes** do commit:
  são tentativas reais e auditáveis; apenas o replay de uma operação **completada** não reexecuta cognição.
- **Reconciliação física** `generated_documents` × `official_documents` (coluna/FK de linhagem).
- Promoção do `official_document` a **autoridade de leitura** (a fonte-da-verdade de leitura continua
  sendo `generated_documents`; frontend e export inalterados).
- DFD **não** cria `official_document` nesta fase (comportamento preservado).
- Qualidade/grounding/provider/fluxo humano de ETP/TR/Edital — **inalterados**.

## 6. Dependência C.4B
C.4B deve: definir a fonte-da-verdade única (leitura), materializar a **coluna de linhagem**
(reconciliação física) usando a correspondência determinística já formalizada em
`canonicalDocumentIdentity`, e decidir a promoção `draft → official` como autoridade — mantendo a
aprovação humana canônica. C.4A deixa o **contrato de identidade/replay** pronto e testado para isso.

## 7. Testes e gates
- **Unitário** (`c4a-replay-safe-generation.test.ts`): matriz A–F, ordem de efeitos provando o `save`
  no mesmo commit, `payloadHash` determinístico/ordem-independente, identidade de linhagem.
- **Smoke MySQL estrito** (`c4a-replay-safe-generation-mysql-smoke.test.ts`, `STRICT_TRANS_TABLES`,
  writer real, `invoke` determinístico — nunca provider real): 7 cenários (1ª geração 1/1; mesma chave
  1/1 sem evento novo; concorrência → 1 efeito; falha após generated → 0/0 + retry; falha após official
  → 0/0 + retry cria UMA versão; replay de resposta equivalente; multi-tenant isolado). Step dedicado
  no gate MySQL do `ci.yml`.
- Gates: typecheck · lint · suíte completa · smoke MySQL estrito · build · audit gate · zero regressões.

**Status: C.4A — READY FOR REVIEW.** C.4B não iniciada.
