# DATA-039 (follow-up) — Atomicidade & concorrência de Aditivo/Apostilamento/Ocorrência

> **Estado:** `PLANNED — FOLLOW-UP` · **Origem:** auditoria de hardening DATA-039 (Bloco D).
> **NÃO implementado nesta rodada** — exige redesign (alocação de sequência sob concorrência +
> ciclo reserve→generate→finalize em torno de geração pesada). Este documento é o REGISTRO FORMAL.

## Escopo auditado (não reescrito)

- `contractService.createAddendum` / `createApostille` / `registerOccurrence`
- `server/domain/contractInstruments.ts` (fábricas + ids)
- `server/db/contractWorkspace.ts` (`insertContractAddendum`, `insertContractApostille`,
  `insertContractOccurrence`, `updateContractWorkspaceStatus`)

## Fluxo real

```
createAddendum:  insertContractAddendum(minuta)
                 → generateContractDocument   [PESADO: IA/DOCX/PDF/S3]
                 → insertContractAddendum(status atualizado)
                 → updateContractWorkspaceStatus
                 → recordProcessEvent
createApostille: insertContractApostille → generateContractDocument [PESADO] → updateStatus → event
registerOccurrence: insertContractOccurrence → recordProcessEvent   (sem geração pesada)
```

## Causa raiz (defeitos reais)

1. **Sequência por contagem, não atômica.** `sequence = countContractAddenda(...) + 1` e
   `id = sha256("add:org:contractId:sequence")` (idem apostilamento). Dois `createAddendum`
   CONCORRENTES no mesmo contrato contam o mesmo N → computam a **mesma** `sequence` → o **mesmo id**.
   Resultado: **lost update** (upsert sobrescreve o primeiro) **ou** erro de PK duplicada — nunca dois
   aditivos distintos corretos. **Não é replay-safe concorrente.**
2. **Estado parcial na geração intermediária.** Se `generateContractDocument` falhar após o insert
   inicial, o aditivo fica em `minuta` sem documento, workspace não atualizado e sem evento. Um
   **retry recomputa `sequence`** (a contagem agora inclui o aditivo preso) → **novo id** → **aditivo
   duplicado**. Retry não é idempotente.
3. **Transação × geração pesada.** Atomizar o fluxo inteiro manteria transação SQL aberta durante
   IA/PDF/S3 — anti-padrão (o próprio DATA-039 evita isso). Portanto a solução NÃO é "envolver em
   `db.transaction`", e sim redesenhar a alocação de sequência e o ciclo de vida.

> `registerOccurrence` (occ + evento, sem geração pesada) é o caso mais simples: `id =
> sha256("occ:org:contractId:index:description")` com `index` default 0 → determinístico por
> (contrato, descrição), mas duas ocorrências legítimas de mesma descrição colidiriam. Atomizável
> com o padrão `createProcessWithInitialEvent`, PORÉM exige tornar `insertContractOccurrence`
> executor-aware (módulo `contractWorkspace`, fora do núcleo procurement) — pequeno, mas separado.

## Proposta (a ser executada em janela própria, sob autorização)

- **Alocação de sequência atômica:** UNIQUE `(organization_id, contract_id, sequence)` +
  `INSERT ... ON DUPLICATE KEY` com retry de próximo número, **ou** contador dedicado por contrato
  com `SELECT ... FOR UPDATE` (padrão já usado em `documentVersionService`/`officialDocumentLifecycle`).
- **Ciclo reserve → generate → finalize:** reservar o aditivo (`pending`) numa transação curta;
  gerar o documento FORA de transação; finalizar (`ready`/`failed`) em transação curta com o evento.
  `failed` observável e re-executável; nunca sucesso silencioso.
- **`registerOccurrence`:** helper atômico `insertOccurrenceWithEvent` (executor-aware), espelhando
  `createProcessWithInitialEvent`, com `idempotencyKey` estável para o evento.

## Critérios de aceite

- 2+ `createAddendum` concorrentes no mesmo contrato → sequências distintas e sem lost update (MySQL real).
- Falha na geração → estado íntegro (`failed`/`pending`), retry não duplica.
- Isolamento multi-tenant (ids namespaced por `organizationId`).
- Nenhuma transação SQL aberta durante IA/PDF/S3.
- correlationId/lineage preservados; erro sanitizado; sem mascaramento de falha.

## Não fazer

- Não manter transação aberta durante geração pesada.
- Não migrar/renumerar schema antes da reconciliação com `feat/f-emb1-embedding-lineage`
  (F-EMB1 já detém a migration `0301`; qualquer migration deste follow-up é ≥ `0302`, **PENDING
  INTEGRATION**, criada só após a reconciliação das branches).
