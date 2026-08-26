# C.4B.2 — Canonical Draft Reviewable Read & Pre-Emission Content Review

> **Escopo:** garantir que ETP, TR e Edital exibam — inclusive **após recarregar a página** — o
> **rascunho persistido EXATO** (`generated_documents`) que será submetido à emissão oficial, fechando o
> contrato: **conteúdo visto pelo humano = conteúdo cujo hash é confirmado = conteúdo revalidado pelo
> backend = conteúdo persistido em `official_documents` emitido**. **Sem edição** nesta fase.
> **DFD fora do escopo** (já tem carga/edição própria). `FF_DIRECT_CONTRACT_SHADOW` permanece **OFF**.

## 1. Problema que a C.4B.2 resolve

Antes desta fase, as workspaces de ETP/TR/Edital só mostravam o rascunho **quando a mutation de geração
retornava na sessão atual** (`draft = generate*.data?.document`). Ao **recarregar o navegador**, o
conteúdo persistido em `generated_documents` **desaparecia da tela**, e a superfície de emissão
(`OfficialPromotionSection`) autorizava a promoção **sem o aprovador ver o conteúdo exato** que seria
emitido — o hash vinha do `officialSummary` sem o conteúdo correspondente à vista do humano. Havia risco
de **autorizar às cegas** e de **duas fontes de verdade** na mesma tela.

## 2. Contrato de leitura canônica (`reviewableDraft`)

Uma **única** superfície de leitura reload-safe para ETP/TR/Edital:

`procurementProcess.reviewableDraft` — `tenantProcedure` — input `{ processId, kind: etp|tr|edital }`:

- **Tenant-scoped no servidor:** valida o processo no tenant (`requireProcess(processId, organizationId)`)
  e carrega via `getGeneratedDocumentByKind(processId, organizationId, kind)`. O `organizationId` vem
  **sempre do contexto autenticado**, **nunca** do cliente. Nunca retorna conteúdo de outro tenant.
- **Retorno mínimo:** `{ id, kind, title, content, status, contentHash, updatedAt }` sob a chave `draft`.
- **Hash = mesma primitive da emissão:** `contentHash = draftContentHash(content)` — a **exata** primitive
  (`sha256` do conteúdo) usada por `documentPromotionService.promoteOfficialDocument`. **Não** há cálculo
  de hash paralelo no frontend nem duplicação do algoritmo.
- **Rascunho ausente/vazio → `{ draft: null }`** (não fabrica conteúdo).

## 3. Uma versão visível = um hash (vínculo conteúdo↔hash)

- A resposta de `reviewableDraft` é o **REVIEW SNAPSHOT** mostrado ao humano. A UI usa
  `reviewableDraft.content` + `reviewableDraft.contentHash` como **par inseparável**.
- Na emissão, `expectedContentHash = reviewableDraft.contentHash` — exatamente o hash **pareado com o
  conteúdo exibido**. Nunca se usa o hash do `officialSummary` sozinho sem o conteúdo à vista do humano.
- O backend de promoção **continua** reconsultando o rascunho vigente e comparando hashes. Se o rascunho
  **mudou** após a carga → **CONFLICT** (fail-closed preservado da C.4B.1).

## 4. Leitura reload-safe (ETP/TR/Edital)

As três workspaces deixaram de depender de `generate*.data?.document` como única fonte visual:

- Cada workspace carrega o rascunho persistido via `trpc.procurementProcess.reviewableDraft.useQuery(
  { processId, kind }, { enabled: !!processId })` e usa `draft = reviewable.data?.draft ?? null`.
- Após gerar (`generateETP/generateTR/generateNotice`), o `onSuccess` **invalida** `reviewableDraft`
  (`utils.procurementProcess.reviewableDraft.invalidate({ processId, kind })`) → refetch → o conteúdo
  **persistido** é renderizado. A mutation ainda retorna o documento, mas a **superfície apresentada
  converge para `generated_documents`**.
- Após **recarregar o navegador**, a query carrega e o **título + conteúdo reaparecem**.

## 5. Revisão pré-emissão (conteúdo exato) e emissão dependente do snapshot

- A workspace carrega `reviewableDraft` **uma vez** e passa o `reviewSnapshot` (conteúdo+hash) ao
  `OfficialPromotionSection` — **fonte única** na mesma tela (o painel só consulta adicionalmente
  `officialSummary` para última versão/divergência, **nunca** para conteúdo).
- O bloco de emissão exibe o **conteúdo integral revisável** (`kind`/`title` + `<pre>` do conteúdo +
  `updatedAt`) e o estado de última emissão/divergência (C.4B.1).
- O botão **"Emitir documento oficial"** só habilita quando existe review snapshot com conteúdo
  **não-vazio** + `contentHash` válido (`hasReview`). Na confirmação,
  `expectedContentHash = reviewSnapshot.contentHash`.
- **CONFLICT (fail-closed):** ao emitir com hash obsoleto, o backend responde `CONFLICT`; a UI **não**
  auto-emite — mostra aviso de que o rascunho mudou, **invalida/refetcha** `reviewableDraft` (recarrega
  conteúdo+hash vigentes) e **exige nova revisão/confirmação**.

## 6. O que a C.4B.2 **NÃO** implementa

- **Sem edição:** nenhum textarea/rich editor, nenhum `saveETP/saveTR/saveEdital`, autosave,
  `lastEditorUserId`, alteração de `author_user_id`, ledger de edição, snapshots de rascunho ou migration.
  C.4B.2 é **apenas leitura persistente + revisão pré-emissão**.
- **DFD inalterado:** mantém sua carga/edição própria (`loadDFD` + `saveDFD` + textarea); não foi
  promovido, redesenhado nem unificado artificialmente. Zero regressão.
- **Arquitetura preservada:** `generated_documents` = rascunho de trabalho; `official_documents` emitido =
  autoridade. **Não** houve unificação de tabelas, FK/linhagem física, alteração de
  idempotência/promoção/lifecycle oficial/provider/grounding/CATMAT/`FF_DIRECT_CONTRACT_SHADOW`/Railway.
- **Observabilidade:** fase **read-only** — nenhum evento de auditoria para mera visualização; conteúdo
  integral **não** é logado; `correlationId` preservado.

## 7. Testes

**Backend (unit — `c4b2-reviewable-draft.test.ts`):** ETP/TR/Edital retornam conteúdo exato + hash =
`draftContentHash(content)`, tenant-scoped (org do contexto, nunca do cliente); rascunho inexistente e
conteúdo vazio → `{ draft: null }`; processo inexistente no tenant → `NOT_FOUND` (sem consultar o
documento); sem auth → `UNAUTHORIZED`.

**Smoke MySQL estrito (`c4b2-reviewable-draft-mysql-smoke.test.ts`):** contra MySQL real sob
`STRICT_TRANS_TABLES`, semeia rascunhos ETP/TR/Edital pelo pipeline C.4A e prova: leitura **byte-a-byte**
do conteúdo persistido; hash lido == `draftContentHash(content)` (mesma primitive); esse hash é o
`expectedContentHash` que a promoção reconsulta (emissão do **mesmo byte** revisado); rascunho ausente →
`null`; **isolamento cross-tenant** (tenant A não lê o rascunho do tenant B). Roda **isolado** no CI
(seu `beforeAll` aplica as migrations); não deve rodar em paralelo com smokes que derrubam/reconstroem o
schema (ex.: reconciliação), que correm em worker separado sobre o mesmo banco físico.

**Regressão:** os smokes C.4B.1 (replay/SoD/export) e o fluxo DFD permanecem verdes.

## 8. Dependência futura (C.4B.3)

A **edição humana** do conteúdo de ETP/TR/Edital (editor + `save*` + autoria/ledger de edição +
eventual migration) é a evolução **C.4B.3**, fora desta fase. A C.4B.2 entrega a base necessária:
leitura persistente reload-safe + revisão pré-emissão com vínculo conteúdo↔hash inseparável, sobre a qual
o editor poderá ser construído sem quebrar o contrato de integridade da emissão.
