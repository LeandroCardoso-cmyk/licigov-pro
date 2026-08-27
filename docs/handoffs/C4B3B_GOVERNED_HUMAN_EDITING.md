# C.4B.3B — Governed Human Editing (ETP / TR / Edital)

> **Escopo:** habilitar a **edição humana governada** dos rascunhos canônicos ETP/TR/Edital
> (`generated_documents`), reusando integralmente a fundação **C.4B.3A**. **Sem** rich editor/autosave/
> diff/rollback/versionamento. **Não emite/aprova.** Preserva C.4A / C.4B.1 / C.4B.2 / C.4B.3A.
> `FF_DIRECT_CONTRACT_SHADOW` **OFF**.

## 1. Write contract (backend)

Runner ÚNICO `runGovernedDraftEdit` (extraído — **sem duplicar** a lógica do `saveDFD`): tanto
`saveDFDDraft` (`dfd_manual_edit`) quanto `saveReviewableDraft` (`human_edit`) usam o **mesmo** contrato
institucional de write governado.

`procurementProcess.saveReviewableDraft` — `orgRoleProcedure("operator")` — input
`{ processId, kind: etp|tr|edital, content, expectedContentHash, idempotencyKey }`:
- `organizationId` + `actorUserId` **sempre** do ctx (nunca do cliente);
- `requireProcess` tenant-scoped; carrega o draft canônico por (org, process, kind) → **NOT_FOUND** se
  ausente (não cria por esta via); título **preservado** do draft existente;
- `expectedState = { type: "present", contentHash: expectedContentHash }`, revalidado **SOB LOCK** via
  `applyDraftContentMutationTx` (C.4B.3A);
- em **UMA transação**: update do working draft + **preserva `author_user_id`** + último ator
  substantivo (só em mudança material) + append `generated_document_edits` (`operation=human_edit`,
  `previous_content` + prev/new hashes, actor real, `idempotencyKey`, correlação da EDIÇÃO) + process
  timeline com actor real + idempotency COMPLETED;
- retorna o **SNAPSHOT CANÔNICO** persistido (`response = cache da idempotência = estado de
  generated_documents`);
- **FAIL-CLOSED sem DB** (nunca sucesso simulado).

## 2. Substantive edit (inalterado de C.4B.3A)

`draftContentHash(new) != draftContentHash(current)` → substantiva. Hash igual → **NO-OP**: sem ledger,
sem mudar último ator, sem alterar author, sem falsa proveniência.

## 3. Proveniência

- `author_user_id` = **originador estável** (preservado na edição);
- `last_substantive_actor_user_id` = **editor** (em mudança material);
- `generated_documents.correlation_id` = correlação da **ORIGEM**; `generated_document_edits.correlation_id`
  = correlação da **edição**.

## 4. Idempotência / concorrência

`op = procurement.draft.edit`; `payloadHash = sha256(op, org, process, kind, expectedContentHash,
draftContentHash(new))`. Mesma chave+payload → **replay** (sem novo ledger; response = estado
persistido); mesma chave+conteúdo diferente → **CONFLICT**; `expectedContentHash` obsoleto (sob lock) →
**CONFLICT** (nada sobrescrito). Retry transitório reusa a mesma chave (idempotente).

## 5. RBAC / SoD (inalterada)

Editar = **`operator+`**; emitir = **`manager+`** (C.4B.1). SoD C.4B.3A intacta: após edição por B com
originador A → `emitter != A` **e** `emitter != B` (fail-closed, sem bypass). Um terceiro `manager+`
emite.

## 6. UI (ETP/TR/Edital)

Componente compartilhado `DraftEditor` (textarea; **sem** rich editor) montado nas três workspaces no
lugar do `<pre>` read-only. Carrega `reviewableDraft.content` + `contentHash`; **"Salvar alterações"**
envia `{ processId, kind, content, expectedContentHash = snapshot carregado, idempotencyKey }`.
- **SUCCESS:** rotaciona a key, invalida `reviewableDraft` + `officialSummary`, re-sincroniza com o
  snapshot persistido, mostra "Alterações salvas".
- **CONFLICT:** rotaciona a key, invalida/refetch, **substitui** o editor pelo conteúdo canônico
  recarregado, avisa "O rascunho mudou desde o carregamento. Revise novamente antes de salvar."
- **Transitório/INTERNAL/network:** **mantém** a key e o conteúdo local (retry seguro).
Política de rotação reusa `saveKeyPolicy` (C.4B.3A).

## 7. Interação com emissão

Salvar muda o `contentHash` → `reviewableDraft` retorna novo hash, `officialSummary` pode sinalizar
divergência, o confirmation pin anterior (C.4B.2) deixa de valer, a emissão continua exigindo o
`expectedContentHash` do conteúdo revisado, e a SoD usa o `lastSubstantiveActor` atualizado.
`OfficialPromotionSection` **não** foi alterado. **Não** auto-abre confirmação, **não** auto-emite.

## 8. Author NULL histórico

`author_user_id = NULL` continua NULL; a edição é permitida e define o último ator; a **emissão continua
bloqueada** (`PRECONDITION_FAILED`). Sem provenance recovery / backfill.

## 9. Testes

- **Unit** `c4b3b-save-reviewable-draft.test.ts` (5): operator edita; viewer → FORBIDDEN; ausente →
  NOT_FOUND; TR/Edital mesmo contrato; sem auth → UNAUTHORIZED; `operation=human_edit`, `expectedState`
  present, tenant do ctx.
- **Smoke MySQL estrito** `c4b3b-governed-human-editing-mysql-smoke.test.ts` (8): ETP/TR/Edital edit,
  proveniência, ledger + previous_content + correlações, no-op, concorrência (CONFLICT), idempotência
  (replay/CONFLICT), response=persisted, SoD de 3 atores, author NULL, isolamento tenant. Step no
  `ci.yml`.
- **Regressão preservada:** C.4A, C.4B.1, C.4B.2, C.4B.3A, procurement-create, security/isolation.

## 10. Fora desta fase

Autosave, TipTap/rich editor, diff/rollback UI, versionamento completo de rascunho, comentários/workflow
novos, nova role, provenance recovery para author NULL, DFD promotion, write direto em
`official_documents`, mudança na autoridade de emissão, CATMAT, provider/grounding, C.4B.4.
