# C.3A-OPS.3 — Correção DATETIME na Contratação Direta (entrega)

> Corrige a falha de `directProcurement.createProcess` (HTTP 500 "Failed query: insert into
> direct_procurement_workspaces") em staging. **Nenhuma migration, nenhum schema, nenhum contrato tRPC,
> nenhum domínio alterado.** `FF_DIRECT_CONTRACT_SHADOW` permanece OFF; homologação C.3A segue pausada.

## Causa
**MAPPER_BUG** (serialização de datetime). O domínio produz timestamps via `new Date().toISOString()`
(`2026-08-24T21:46:17.123Z`, com `T`/`Z`). O writer `server/db/directProcurement.ts` inseria esses
valores **crus** em colunas `DATETIME(3)`. Sob `STRICT_TRANS_TABLES` (staging/produção), o MySQL rejeita
o formato → `ER_TRUNCATED_WRONG_VALUE (1292)` "Incorrect datetime value". Não há schema drift: schema.ts,
migration `0257` e o `CREATE TABLE` do bootstrap são idênticos e imutáveis desde o commit que criou a
tabela. **Nenhuma migration é necessária.**

## Correção — helper canônico reutilizado (sem helper paralelo)
Reutiliza **exatamente** o mecanismo já empregado por `server/db/procurement.ts`:
`toDbDatetime` / `fromDbDatetime` (de `server/db/institutionalConsultations.ts`), via os wrappers locais
`toDb` (escrita: ISO → `YYYY-MM-DD HH:MM:SS.mmm`) e `fromDb` (leitura: DB → ISO `…Z`). Round-trip
determinístico ISO → `DATETIME(3)` → ISO, precisão de ms preservada, UTC (sem timezone inventado).

### Campos corrigidos (todo o writer, não só o 1º INSERT)
- **Escrita (`toDb`):** `createdAt`, `updatedAt`, `ratifiedAt` em todos os inserts/upserts do arquivo.
- **Leitura (`fromDb`):** `createdAt`/`updatedAt`/`ratifiedAt` nos reads que devolvem contrato ISO
  (`getDirectProcurementWorkspace`, `listDirectProcurementWorkspaces`, `getContractJustification`,
  `getRatification`, `listGeneratedPublications`).

### Tabelas atingidas (mesmo writer `server/db/directProcurement.ts`)
`direct_procurement_workspaces`, `direct_procurement_procedures`, `proposal_collections`,
`proposal_documents`, `contract_justifications`, `price_justifications`, `ratifications`,
`generated_publications`. **Sem alteração de schema/bootstrap/migration em nenhuma.**

## Regression smoke (MySQL real, modo estrito)
`server/__tests__/integration/direct-procurement-datetime-mysql-smoke.test.ts` — fixa
`SET sql_mode = STRICT_TRANS_TABLES,…` (GLOBAL para o pool do writer + SESSION para o controle; **nunca
relaxa** o modo). Prova:
1. **Controle:** INSERT direto de ISO cru em `DATETIME(3)` **falha** sob modo estrito (regressão viva —
   se o fix for revertido, o writer volta a falhar aqui);
2. writer real `insertDirectProcurementWorkspace` **persiste** com valores reais do fluxo
   (`dispensa` / `indefinido` / `sem_dfd` / `LEGAL_BASIS` / `rascunho`);
3. round-trip ISO válido com **precisão de ms**; tenant + correlationId preservados;
4. `ON DUPLICATE KEY UPDATE` continua funcionando (novo `updatedAt`);
5. writer irmão `insertRatification` (`ratifiedAt`) também persiste com round-trip.
Step adicionado ao gate MySQL do `ci.yml`. (O CI só testava banco novo sem exercitar este writer sob
modo estrito — por isso ficava verde enquanto staging falhava.)

## Não-regressão preservada
Multi-tenant, contratos tRPC (inalterados), replay/idempotência, domínio de Contratação Direta, feature
flags, shadow OFF por default, auditabilidade — todos intactos. Suíte completa verde.

## Observability gap — follow-up (NÃO nesta PR)
**DB safe error logging gap — follow-up:** o erro do `mysql2` (`code`/`errno`/`sqlState`/coluna) é
encapsulado por Drizzle ("Failed query…") e perdido antes do tRPC; falta um boundary que registre esses
campos de forma segura (sem SQL/params/segredos). Registrado como follow-up; **não** ampliado aqui.
