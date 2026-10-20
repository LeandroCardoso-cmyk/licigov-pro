# Proveniência das cotações e governança do preço de referência (M8)

> Política aprovada pelo Owner em 20/10/2026 (alternativa D). Domínio: `server/domain/quoteProvenance.ts`.

## Invariante

Ter preço positivo **não** torna uma cotação institucionalmente válida. Aprovar o item **não** valida a origem econômica
das suas cotações. Um aviso textual (`[REVISAR]`) **não** substitui o bloqueio estrutural no backend.

## Estados (`price_research_items.provenance_kind`, migration 0319 — aditiva, anulável, sem backfill)

| Valor | Significado | Quem grava |
|---|---|---|
| `ficticia` | fonte **declarada** fictícia/demonstrativa (ex.: "Fornecedor Fictício A", "os valores são fictícios", "dados sintéticos") | parser/importação (declaração explícita) |
| `declarada` | fonte informada/importada, **sem** verificação institucional | parser/importação (padrão) |
| `verificada` | reservado a procedimento legítimo de verificação | **nenhum caminho atual** (nunca por heurística) |
| `NULL` | legado/desconhecido (anterior à 0319) | — |

Leitura efetiva (`effectiveQuoteProvenance`): coluna preenchida ⇒ ela; legado com fornecedor que contém "fictício" ⇒
`ficticia`; legado com o marcador textual antigo ⇒ `suspeita` (aviso, sem bloqueio); demais ⇒ `desconhecida`.

**Declaração × suspeita:** termos genéricos ("teste", "exemplo", "homologação", "simulado", "sintético", "inexistente")
geram só **aviso** de revisão (`SUSPECTED_DEMONSTRATIVE` na prévia) — nunca gravam `ficticia`.

## Reimportação (mesmo id de cotação) — `mergeReimportedProvenance` / `provenanceOnReimportSql`

1. nova declaração `ficticia` prevalece;
2. mesmo fornecedor + valor já `ficticia`/`verificada` ⇒ mantém (remover a nota do texto não "esquenta" a cotação);
3. outro fornecedor/valor ⇒ é outra cotação: vale a proveniência nova (passa pela revisão governada da fonte).

O SQL do upsert lê fornecedor/valor **antigos**: por isso `provenanceKind` vem antes de `supplier`/`value` no objeto do
schema (o Drizzle emite o `SET` nessa ordem; guarda em `m8-price-reference-governance.test.ts`).

## Onde a regra é aplicada (ponto único + emissão)

- **Referência canônica** (`canonicalProcurementContext`): evidência vinculada com cotação fictícia ⇒
  `priceBlockedReason = "FICTITIOUS_SOURCE"` (prevalece sobre `SOURCE_NOT_CURRENT`/`UNIT_MISMATCH`), sem preço de
  referência e sem total. Entra no digest (`blk`) ⇒ replays/derivados invalidados. Consumidores: DFD (estimativa),
  ETP/TR/Edital IA (quadro autoritativo: célula "[REVISAR: preço suspenso — cotação fictícia…]"), Edital BLL
  (`canonicalSources` não preenche valores bloqueados), Itens da contratação (UI).
- **Modo legado** (sem Itens da contratação): `loadApprovedContextItems` e `resolveEditalSources` zeram o preço do item
  com fictícia e marcam o mesmo motivo (o digest muda).
- **Emissão oficial** (`promoteOfficialDocument`): `EMISSION_FICTITIOUS_PRICES` calculado **das fontes** no instante da
  emissão — remover o `[REVISAR]` do texto não libera. Documentos já emitidos permanecem imutáveis.
- **Contratação Direta** (`summarizePriceResearch`): cotação fictícia é **excluída** de média/mediana/mínimo e registrada
  na linhagem (`excludedFictitiousQuoteCount`); item só com fictícias ⇒ `PRICE_RESEARCH_FICTITIOUS` (nenhum valor
  substituto). O `contentHash` da importação não inclui a proveniência (identidade inalterada).
- **Aprovação operacional** do item continua disponível; o painel explica que o preço não vira referência oficial.

## Exceção de homologação sintética (`server/config/homologation.ts`)

Condições **cumulativas**, só no backend: `APP_ENV ≠ production` (em produção a lista é ignorada); id em
`HOMOLOGATION_DEMONSTRATIVE_ORG_IDS`; id ≠ 1 (dados reais de Moreira Sales — recusado sempre); slug **real** da
organização = `homologacao-sintetica`. Ausente ⇒ nenhuma exceção (fail-closed). Nenhum parâmetro do cliente participa.
Na exceção, o valor flui como referência **demonstrativa** e a emissão de homologação é permitida, mas o documento
continua marcado como fonte fictícia. Definir a variável em staging exige autorização operacional específica.

## Vínculo proveniência × conteúdo (itens decididos)

Item aprovado/rejeitado preserva o **retrato** das cotações enquanto a linha da pesquisa pode ser reimportada. A
proveniência gravada na materialização vai no retrato (`suppliers[].provenanceKind`); a da linha só vale para o retrato
quando fornecedor e valor coincidem; nome que declara "fictício" sempre prevalece. Linha legada com o marcador antigo:
notas que declaram fictício ⇒ `ficticia`; senão `suspeita` ⇒ o documento volta a trazer `[REVISAR: … possivelmente
demonstrativa(s) …]` (revisão humana, sem bloqueio estrutural).

Declaração do documento só vale em cabeçalho/metadado/nota/resumo **sem negação** ("não foram aceitas cotações
fictícias" não declara nada); linha não reconhecida e "pesquisa sintética" (= resumida) não declaram.

## Contratação Direta — Ratificação

Antes de publicar, a linhagem da Justificativa de Preço é recalculada com a proveniência atual
(`assertPriceLineageStillEligible`): valor que não se sustenta (só fictícias, ou valor legado que incluía fictícia) ⇒
`PRICE_RESEARCH_FICTITIOUS`; a justificativa deve ser registrada de novo. Justificativa declarada não é afetada.

## Limitações conhecidas

- Não há ação governada para **excluir/reclassificar** uma cotação fictícia de um Item Inteligente (o merge é por
  união de `quoteId`). O bloqueio é seguro (fail-closed), mas o órgão real que importou uma cotação fictícia precisa de
  nova pesquisa/novo item. Recomendação: ação governada de reclassificação (autor, motivo, timeline, revogação da
  aprovação) — exige decisão do Owner.
- Importação por arquivo (sessão de ingestão) classifica por cotação (fornecedor/observação); declaração só no
  cabeçalho do arquivo não é propagada (a extração estruturada não preserva o cabeçalho).
- O bloqueio de emissão é calculado imediatamente antes da transação de emissão (mesmo padrão dos demais bloqueios);
  uma reimportação concorrente nesse intervalo não é vista.
- Contratação Direta exclui a fictícia e calcula com as reais (o servidor escolhe o método explicitamente); Itens
  Inteligentes com mistura ficam suspensos — regras diferentes por desenho (cálculo pontual × referência persistida).

- Não há procedimento de verificação (`verificada`) nesta rodada; a distinção declarada × verificada é preservada.
- Textos documentais legados "cotação(ões) válida(s)" no quadro autoritativo foram mantidos (byte-identidade de replay);
  a UI usa "importada(s) com preço".
