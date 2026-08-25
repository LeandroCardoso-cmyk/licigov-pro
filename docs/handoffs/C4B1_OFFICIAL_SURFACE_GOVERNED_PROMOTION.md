# C.4B.1 — Official Surface & Governed Promotion

> **Escopo:** tornar `official_documents` a autoridade institucional do Processo Licitatório
> **somente após promoção humana governada** (ETP/TR/Edital), **sem** migrar a fonte-da-verdade
> operacional do frontend. **DFD fora do escopo.** `FF_DIRECT_CONTRACT_SHADOW` permanece **OFF**.

## 1. Modelo de autoridade (ratificado — Modelo A)

| Entidade | Papel | Status |
|---|---|---|
| `generated_documents` | **rascunho operacional** (leitura/edição/geração + export de rascunho) | superfície de trabalho inalterada |
| `official_documents` | **autoridade institucional versionada** | `gerado` = snapshot técnico **NÃO** oficial · `emitido` = versão institucional autorizada |
| `documents` (legado) | **congelado** | reutilizamos o **padrão** (SoD/ledger), **não** a tabela |

**Autoridade oficial = apenas `official_documents.status = 'emitido'`.** O snapshot `gerado` produzido
pela C.4A **não** é oficial. Não exigimos o passo `revisado → emitido` em dois atos: `revisado`
permanece disponível no lifecycle, mas não é etapa obrigatória.

## 2. Contrato de promoção (rascunho → `emitido`)

`documentPromotionService.promoteOfficialDocument` (ETP/TR/Edital):

- **Fonte:** conteúdo **ATUAL** de `generated_documents` (nunca o snapshot `gerado`).
- **Governança humana (backend, fail-closed):** papel mínimo `manager` (`orgRoleMeets`); **ator humano**
  e **revisor/emissor ≠ autor** via `assertInstitutionalDecisionRules({ toState: "approved", … })`
  (reuso do padrão C.2B — IA/sistema nunca emite). O **autor** do rascunho vem da nova coluna
  `generated_documents.author_user_id` (gravada na geração ETP/TR/Edital).
- **Integridade:** `contentHash = sha256(conteúdo do rascunho)`; `expectedContentHash` opcional
  (concorrência otimista — emite exatamente a versão revisada, senão `CONFLICT`).
- **Replay-safe (idempotencyService):** `payloadHash = sha256(op, org, processId, kind, contentHash)`.
  Mesma chave+conteúdo → **replay** (sem nova versão); chave+conteúdo diferente → **CONFLICT**;
  em processamento → **CONFLICT**; concorrência → **uma única emissão** (UNIQUE tenant-aware do ledger
  + GET_LOCK por linhagem + reserva de idempotência).
- **Commit ATÔMICO (uma transação):** versão oficial `emitido` (append-only, `createDocument`, GET_LOCK
  por linhagem serializa a numeração) + **ledger imutável** `official_document_promotions` + marcação
  da idempotency key **COMPLETED**. Cognição/carregamento roda **fora** da transação.
- **Imutabilidade:** a versão `emitido` **nunca** é alterada. Editar o rascunho depois **não** altera a
  versão emitida — uma **nova promoção** cria uma **nova** versão oficial.

## 3. Ledger imutável (auditoria)

`official_document_timeline` (já existente) **não** carregava versão/hash/autor/aprovador/idempotência
de forma estruturada, e `document_review_decisions` está **acoplado à tabela legada `documents` (IDs
int)** — por isso **não** foi reutilizado. Criamos a menor estrutura aditiva:

`official_document_promotions` (append-only, nunca atualizado): `organization_id, process_id,
official_document_id, lineage_id, document_kind, version, content_hash, actor_user_id (emissor),
author_user_id, previous_status, next_status ('emitido'), reason, correlation_id, idempotency_key,
created_at` · `UNIQUE(organization_id, idempotency_key)`. Além disso, a emissão registra um evento
`documento_emitido` na `official_document_timeline`. **Sem chain-of-thought.**

## 4. Export (duas ações distintas)

- **"Exportar rascunho"** → `generated_documents`, marca `RASCUNHO`, **comportamento inalterado**.
- **"Baixar/Emitir documento oficial"** → `official_documents`, **somente `emitido`**, versão específica
  imutável, via o pipeline institucional existente (`OfficialDocumentPanel` → `documentEngine.export
  Institutional`). Gate `requireStatus: "emitido"` no adapter (`exportOfficialDocument`) — **nunca
  exporta `gerado` como oficial**. Outros domínios (Contratos/Contratação Direta/Parecer) não passam
  `requireStatus` → **inalterados**.

## 5. UI (ETP/TR/Edital)

`OfficialPromotionSection` (compartilhado): rascunho continua claramente identificado acima; ação
**"Emitir documento oficial"** com **confirmação**; mostra a **versão oficial emitida**; sinaliza
**divergência** quando o hash do rascunho difere da última versão emitida (`officialSummary`). Reusa o
`OfficialDocumentPanel` existente (`businessDomain="processo_licitatorio"`, `requireStatusForExport=
"emitido"`) para versões/status/timeline/export oficial. **Sem lógica jurídica autônoma.**

## 6. DFD (fora de escopo — explícito)

DFD **não** cria `official_document`, **não** ganha promoção e **não** tem o lifecycle alterado nesta
fase (é documento preparatório). A promoção rejeita `dfd` com `BAD_REQUEST`.

## 7. Migração / compatibilidade

Aditivo e idempotente (migration `0295_c4b1_official_promotion`, hand-written no padrão do projeto —
`ALTER` dinâmico via INFORMATION_SCHEMA + `CREATE TABLE IF NOT EXISTS`; convergência defensiva também no
`ensureSchema`): (1) `generated_documents.author_user_id INT NULL`; (2) tabela
`official_document_promotions`. **Sem** backfill, **sem** dual-write, **sem** remoção de tabelas, **sem**
migração de dados da fonte-da-verdade. Rollback = a superfície fica atrás do painel/promoção; export de
rascunho permanece o padrão.

## 8. Observabilidade da emissão

`organizationId · processId · officialDocumentId · lineageId · documentKind · version · contentHash ·
actor (emissor) · author · previousStatus · nextStatus='emitido' · reason · correlationId ·
idempotencyKey · timestamp` — no ledger + timeline. Sem chain-of-thought.

## 9. Testes e gates

- **Unit** `c4b1-official-promotion.test.ts` (13): SoD/humano/RBAC, commit atômico (ordem official →
  ledger → idempotency-save), replay/CONFLICT/processing/failed, expectedHash, hash determinístico, DFD fora.
- **Unit** `c4b1-export-gate.test.ts` (3): `gerado` → FORBIDDEN sem exportar; `emitido` → passa o gate;
  sem `requireStatus` → inalterado.
- **Smoke MySQL estrito** `c4b1-official-promotion-mysql-smoke.test.ts` (10 casos, `STRICT_TRANS_TABLES`,
  writer real, `invoke` determinístico): os 12 requisitos (SoD, ator não-humano, 1 versão emitida,
  replay, CONFLICT, concorrência, imutabilidade, nova versão, multi-tenant, export gate, DFD). Step
  dedicado no gate MySQL do `ci.yml`. **Validado localmente contra MySQL/MariaDB real (10/10).**

## 10. Fora de escopo (C.4B.2 e além)

Coluna/FK física de linhagem (reconciliação); promoção do DFD; deprecar/remover `generated_documents`
ou `documents`; migrar C.2B/legado para o fluxo canônico; auto-sync rascunho → oficial; backfill;
`revisado → emitido` em dois atos.

**Status: C.4B.1 — READY FOR REVIEW.** C.4B.2 não iniciada.
