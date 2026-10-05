# Itens do contrato a partir da contratação (planejado × contratado)

> **PROPOSTA — NÃO DECIDIDA.** Nada aqui está implementado. Não há migration, tabela ou código para isto. Exige decisão
> do responsável pelo produto (e, quanto à regra de variação de quantitativo/valor, insumo jurídico — J-3/J-4).
> Origem: SEM-062 (`docs/audits/SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md`), parte "sem itens (planejado × contratado
> impossível de rastrear)". Relacionado: SEM-084 (limites do art. 125 — bloqueado, `LEGAL_REVIEW_DECISION_PACKET.md` J-4).

## 1. Problema

O contrato (`contract_workspaces`) guarda só `value`, `contractor`, `object` e `term`. Os **itens da contratação**
(`procurement_items` / itens do processo, com quantidade, unidade e valor estimado) não chegam ao contrato: não é
possível comparar o **planejado** (itens aprovados no processo) com o **contratado** (o que foi efetivamente
contratado/aditado), nem rastrear o efeito de aditivos quantitativos.

## 2. O que já existe (reaproveitável)

- Itens aprovados do processo (fonte: `procurement items`, quantidade vigente da fonte — PR-13/SEM-049).
- Instrumentos do contrato (`contract_addenda`, `contract_ws_apostilles`) com sequência atômica (SEM-084) e linhagem
  documental própria (SEM-040).
- Herança de contratado/valor com procedência e confirmação humana (SEM-062, implementada): só há evidência canônica
  na contratação direta (decisão de ratificação + propostas). **O processo licitatório não tem registro canônico de
  adjudicação/homologação**; portanto também não há "itens vencedores" canônicos para herdar.

## 3. Proposta (esboço, para decisão)

Nova tabela `contract_items` (migration aditiva, guardada, sem backfill):

| Coluna | Observação |
|---|---|
| `id`, `organization_id`, `contract_id` | tenant-scoped; PK determinística por (org, contrato, ordem) |
| `source_item_id` (NULL) | item planejado de origem (procedência); NULL em contrato avulso/externo |
| `description`, `unit`, `quantity`, `unit_value` | contratado (confirmado por humano); valores em reais DECIMAL |
| `planned_quantity`, `planned_unit_value` (NULL) | cópia **congelada** do planejado no momento da confirmação |
| `created_by`, `created_at`, `correlation_id` | rastreabilidade |
| `superseded_by_instrument_id` (NULL) | aditivo quantitativo que alterou a linha (histórico append-only) |

Regras propostas: item nasce de **proposta + confirmação humana** (nunca inferido); divergência planejado × contratado é
**exibida**, não bloqueada; alteração de quantitativo só por aditivo (instrumento), com linha nova append-only;
nenhuma regra de limite percentual (art. 125) é aplicada — depende de J-3/J-4.

## 4. Decisões necessárias (NÃO DECIDIDO)

1. Criar a tabela de itens do contrato agora ou aguardar o registro canônico de adjudicação/homologação do processo
   licitatório (sem ele, só a contratação direta teria itens com procedência)?
2. Granularidade: por item do processo ou por lote?
3. O aditivo quantitativo passa a gerar/alterar linhas de itens (e com qual validação, dependente de J-4)?
4. Contratos avulsos/externos: itens digitados ou apenas importados da reconstrução assistida?

## 5. Fora do escopo desta nota

Execução financeira, medição, empenho, pagamento (ERP — fora do posicionamento do produto).
