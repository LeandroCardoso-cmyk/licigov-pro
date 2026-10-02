# Autoridade da quantidade — a cotação nunca vira necessidade (R6 / PR-13 · SEM-008 · INV-09)

> Estado: **IMPLEMENTED_LOCAL / TESTED_LOCAL** (branch `work/autonomous-semantic-remediation-r3-r11`).
> Não mergeado, não implantado. Efeito sobre processos existentes depende da decisão humana **R6.2**.

## Regra

| Quantidade | Natureza | Pode ir para TR/Edital como necessidade? |
|---|---|---|
| `plannedQuantity` (Itens da contratação) | decisão humana registrada | **sim** — única fonte |
| `sourceQuantity` / `intelligent_items.quantity` (cotação, DFD) | evidência | **nunca** |

- **TR e Edital** (`generateDocument(kind="tr")`, `generateNotice`): sem Itens da contratação ativos **e** com Itens
  Inteligentes aprovados ⇒ `PRECONDITION_FAILED` `CANONICAL_ITEMS_REQUIRED` **antes** de reservar idempotência ou
  chamar cognição — nada é gravado. Com Itens da contratação valem os bloqueios já existentes
  (`PLANNED_QUANTITY_REQUIRED`, `PRICE_RESEARCH_ITEM_UNLINKED`). Sem item algum, o documento não traz quadro
  quantitativo (nada a afirmar).
- **ETP** continua permitido no modo legado (estudo preliminar), mas a quantidade é **dita** como da cotação:
  prompt `N UN (quantidade da cotação — não confirmada como necessidade)` e quadro com `Qtd. cotada (não confirmada)`,
  `Valor indicativo` e aviso `[REVISAR]`. Nunca "Valor estimado global".
- Os contextos expõem `legacyQuotedItemCount` (itens só com quantidade cotada) — a guarda do serviço é a autoridade.
- Adotar a quantidade da fonte continua possível, mas como **decisão explícita** nos Itens da contratação
  (`adoptSourceQuantity: true` / "Usar N"), auditada no ledger de itens.

## Testes

- MySQL: `tr-canonical-quantity-mysql-smoke` (6: TR legado ⇒ `CANONICAL_ITEMS_REQUIRED`, zero TR),
  `canonical-quantity-documents-mysql-smoke` (5: ETP rotulado, Edital fail-closed), pilotos `p0-pilot-foundation` /
  `p0-pilot-hardening` reescritos com a quantidade prevista declarada (helper `__tests__/helpers/canonicalItems.ts`).
- Unit: `canonical-document-quantity`, `p0-pilot-foundation` (rótulos legados), `p0-edital-generation` (item da
  contratação ativo mockado).
- Os testes que **codificavam** o legado (auditoria: `tr-canonical-quantity-mysql-smoke.test.ts:203`,
  `canonical-document-quantity.test.ts:167`) foram reescritos (R6.4).

## Dependências humanas

- **R6.1** — inventário read-only `scripts/inventory-r6-1-quoted-quantity-without-items.sql` (agregado por órgão;
  validado localmente; **não executado em produção** — BLOCKED_PRODUCTION_ACCESS).
- **R6.2** — decisão: para processos legados com TR/Edital já gerados com quantidade cotada, (a) exigir cadastro dos
  Itens da contratação antes de qualquer regeneração (comportamento implementado), (b) marcar os rascunhos existentes
  como `[REVISAR]`, ou (c) outra orientação. Documentos **emitidos** nunca são alterados automaticamente.
