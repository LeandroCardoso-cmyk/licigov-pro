# C.4B.3A — Draft Provenance Foundation & SoD Hardening

> **Escopo:** estabelecer a FUNDAÇÃO institucional de proveniência do rascunho canônico
> (`generated_documents`) e endurecer a segregação de deveres da emissão — **sem** ainda entregar o
> editor humano de ETP/TR/Edital (isso é **C.4B.3B**). Preserva integralmente C.4A, C.4B.1 e C.4B.2.
> `FF_DIRECT_CONTRACT_SHADOW` permanece **OFF**.

## 1. Semântica de autoria — `author_user_id` = ORIGINADOR ESTÁVEL

`generated_documents.author_user_id` passa a significar o **originador do rascunho**, definido **apenas
na criação inicial** e **nunca** sobrescrito depois:

- regeneração (ETP/TR/Edital) **não** transfere o originador;
- edição manual (DFD) **não** transfere o originador;
- `insertGeneratedDocument` teve o `ON DUPLICATE KEY UPDATE` corrigido para **não** gravar
  `author_user_id` (só conteúdo/status/updated_at); a criação (INSERT) grava o originador.

## 2. Último ator substantivo — `last_substantive_actor_user_id`

Novo conceito: o **último HUMANO responsável por uma alteração MATERIAL do conteúdo atual** — inclui a
edição manual e o **humano que solicitou a regeneração por IA** (a IA nunca é ator institucional). Não é
"lastEditor" genérico: regeneração por IA também altera materialmente o conteúdo e por isso registra o
solicitante como último ator substantivo.

## 3. Edição substantiva — regra única determinística

Uma alteração é **substantiva** ⇔ `draftContentHash(newContent) !== draftContentHash(currentContent)`
(mesma primitive de integridade de C.4B.1/C.4B.2, agora no domínio: `domain/generatedDocument.ts`).
Qualquer mudança de bytes em `content` conta (texto, whitespace, Markdown, formatação). **Sem**
classificação subjetiva e **sem** IA. Hash igual → **NO-OP**: não muda o último ator substantivo e
**não** grava ledger.

## 4. Ledger imutável — `generated_document_edits`

Tabela nova, append-only, **string-keyed** (nunca acoplada a `documents(int)`):
`{ organization_id, process_id, generated_document_id, kind, actor_user_id, previous_content_hash,
new_content_hash, previous_content (LONGTEXT), operation, reason?, correlation_id, idempotency_key,
created_at }`. Unique `(organization_id, idempotency_key)`; índice
`(organization_id, process_id, kind, created_at)`.

`operation ∈ { ai_regenerate, dfd_regenerate, dfd_manual_edit, human_edit }`:
- **`ai_regenerate`** — ETP/TR/Edital gerados/regenerados por IA (Kernel/copilotos);
- **`dfd_regenerate`** — regeneração DETERMINÍSTICA (template, sem IA) do DFD "criar do zero" (o ledger
  institucional nunca registra uma operação não-IA como IA);
- **`dfd_manual_edit`** — edição humana manual do DFD (`saveDFD` governado);
- **`human_edit`** — reservado para o editor humano de ETP/TR/Edital (C.4B.3B).

**Snapshot canônico = estado persistido:** a resposta devolvida (e cacheada na idempotency key, na mesma
transação) reflete EXATAMENTE a linha de `generated_documents` após a operação — originador preservado, e
`correlation_id` = correlação da ORIGEM/criação do rascunho (a correlação de cada alteração vive em
`generated_document_edits.correlation_id`). O `UPDATE` material não altera `correlation_id` da linha.

**`previous_content` é deliberado:** o hash sozinho não permite reconstrução/diff forense. O **novo**
conteúdo é a working copy vigente e será o `previous_content` da próxima alteração — a cadeia
prev→new é a trilha de proveniência. **Não** se persiste chain-of-thought.

## 5. Contrato transacional (`applyDraftContentMutationTx`)

Primitive tenant-scoped, chamada **dentro** da transação do caller:
1. `SELECT ... FOR UPDATE` por (org, process, kind) — lock de linha;
2. revalida `expectedContentHash` **SOB LOCK** (a verificação fora da transação é só fast-fail e não a
   substitui); divergência → **CONFLICT** (não sobrescreve alteração concorrente);
3. hash novo == atual → **no-op** (sem ledger, sem mudar último ator);
4. mudança material → atualiza conteúdo, **PRESERVA** `author_user_id`, define
   `last_substantive_actor_user_id` + `last_substantive_at`, e faz **APPEND** no ledger;
5. criação (`allowCreate`) quando o rascunho ainda não existe (author = actor; sem ledger).
Sem partial commit — rollback atômico do caller.

## 6. Regeneração por IA — proveniência + concorrência

`generateDocument` (ETP/TR) e `generateNotice` (Edital):
- capturam o `startingHash` **ANTES** da cognição (fora da transação);
- a IA roda fora da transação; na persistência, o primitive revalida sob lock que o hash vigente ainda é
  o `startingHash` — se o rascunho mudou durante a cognição → **CONFLICT** (não sobrescreve edição
  concorrente; nenhum ledger; nenhuma autoridade alterada);
- se persiste conteúdo diferente: **preserva** o originador, `last_substantive_actor` = humano
  solicitante, ledger `operation=ai_regenerate` com `previous_content` + prev/new hashes;
- conteúdo idêntico → no-op substantivo.

**Nota de idempotência (decisão de engenharia):** o `payloadHash` da GERAÇÃO permanece derivado do
INPUT lógico (objeto/itens), **não** do hash de estado vivo — do contrário um replay legítimo por chave
(inclusive o da 1ª geração) viraria falso CONFLICT após o commit mudar o estado. A vinculação ao estado
de partida é feita pela **revalidação sob lock** (stale → CONFLICT). O caminho client-provided
`expectedContentHash` fica exercido pelo **save de DFD** (edição humana), onde o valor é estável entre
retries.

## 7. SoD estendida da emissão

`documentPromotionService.promoteOfficialDocument` carrega `authorUserId` **e**
`lastSubstantiveActorUserId` e exige, **fail-closed, sem bypass** (nem owner/admin/platform-admin):

- `author == null` → **PRECONDITION_FAILED** (guard existente C.4B.1);
- `actor == author` → **FORBIDDEN** (via `assertInstitutionalDecisionRules` — helper legacy **inalterado**);
- `actor == lastSubstantiveActor` → **FORBIDDEN** (guard **novo**, específico do domínio Processo
  Licitatório; não altera o helper global acoplado a `documents(int)`);
- terceiro `manager+` (≠ originador e ≠ último ator substantivo) → permitido.

`lastSubstantiveActorUserId` entra na **metadata** da versão oficial (evidência aditiva) — sem alterar a
autoridade nem o ledger `official_document_promotions`.

## 8. DFD — prova da fundação (sem promoção)

`saveDFD` virou **write governado**: `orgRoleProcedure("operator")`, `organizationId`+`actorUserId`
**sempre** do ctx, input `{ processId, content, expectedContentHash, idempotencyKey }`, concorrência
otimista + idempotência obrigatórias, aplica o primitive transacional (`operation=dfd_manual_edit`),
**preserva** o originador, registra o **usuário real** na timeline e faz append no ledger. Corrige os
defeitos confirmados do antigo `saveDFDDraft` (actor = organizationId, author zerado, overwrite sem
ledger, sem concorrência/idempotência). **DFD continua fora do lifecycle de emissão** (C.4B.1/C.4B.2).

## 9. Author NULL histórico — política fail-closed

Rascunhos com `author_user_id IS NULL`: edição/regeneração **podem** ocorrer e registram o último ator
substantivo, mas o originador **permanece NULL** (não se inventa, não se faz backfill com o ator atual).
A **emissão continua bloqueada** (`PRECONDITION_FAILED`). O reestabelecimento explícito de proveniência
fica **fora** desta fase.

## 10. Leitura revisável

`reviewableDraft` e `loadDFD` passam a expor, de forma aditiva e mínima, `authorUserId`,
`lastSubstantiveActorUserId` e `contentHash` (este último no DFD para alimentar o `expectedContentHash`
da edição governada). O contrato de review de conteúdo exato de C.4B.2 permanece intacto.

## 11. Migration

`0296_c4b3a_draft_provenance.sql` — aditiva, idempotente (padrão 0288/0294/0295: ALTER dinâmico via
`INFORMATION_SCHEMA` + `CREATE TABLE IF NOT EXISTS`): adiciona
`generated_documents.last_substantive_actor_user_id` e `last_substantive_at` e cria
`generated_document_edits`. Convergência defensiva espelhada em `bootstrap.ts`. **Não** toca
`official_documents`/`official_document_promotions`.

## 12. O que fica para C.4B.3B

Editor humano de ETP/TR/Edital (`saveReviewableDraft` + textarea/rich editor por tipo + invalidação de
review/summary), autosave, versionamento completo de rascunho, UI de diff/rollback, e o reestabelecimento
governado de proveniência para `author NULL`. Nada disso foi implementado aqui.
