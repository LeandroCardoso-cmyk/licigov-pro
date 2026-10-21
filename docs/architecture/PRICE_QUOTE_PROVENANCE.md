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

## Emenda de integridade — emissão concorrente (P1-A)

`promoteOfficialDocument` recalcula `EMISSION_FICTITIOUS_PRICES` **dentro** da transação de emissão com
`lockedFictitiousPriceItemCount`: trava as fontes do processo (FOR SHARE, locks de registro por chave primária — sem gap
lock, sem contenção com outros processos/órgãos) e conta a partir das MESMAS leituras com trava (último estado
confirmado; sem conexões extras do pool). Ordem estável, a mesma dos escritores: `price_research_items` →
`intelligent_items` → `procurement_items` → `procurement_item_source_links`. Importação manual e promoção da ingestão
repetem a transação inteira em deadlock (SEM-084). Escritor que já tinha a linha ⇒ a emissão espera e enxerga o
commit; escritor que chega depois ⇒ espera a emissão (ou expira com erro explícito). Deadlock ⇒ retry governado
(SEM-084). Nenhum fail-open: sem a trava/recontagem, não há emissão.

## Emenda de integridade — declaração do arquivo (P1-B)

A extração compartilhada (`tableToRawItems`, `linesToRawItems`, texto nativo e texto OCR de PDF, parágrafos de DOCX,
demais abas de XLSX) procura, em linhas
que **não** são cotação (título acima do cabeçalho, notas, parágrafos — linha com número/valor fica de fora), uma
declaração explícita do conjunto (`classifyDocumentDeclaration`: o sujeito coletivo GOVERNA o predicado — "dados/valores/
preços/cotações/itens/empresas/exemplo fictícios", "todos … fictícios", "planilha com valores demonstrativos" — sem
negação; rótulo isolado ou cotação singular ⇒ só revisão) e grava o aviso estruturado `DOCUMENT_DECLARES_FICTITIOUS` em `import_sessions.warnings`
(recalculado a cada reextração). Na promoção, `documentFictitiousDeclaration` ⇒ `global` marca TODAS as cotações da sessão
como `ficticia` (correção de linha não remove); declaração parcial (`DOCUMENT_PARTIAL_FICTITIOUS_DECLARATION`) ou lida
SÓ por OCR com `OCR_LOW_CONFIDENCE` ⇒ só revisão (texto nativo nunca é rebaixado). Rótulo isolado ("Fornecedor Fictício
A") segue a regra por cotação. Na colagem (linhas já classificadas estruturalmente como não-cotação), qualquer declaração
explícita sem escopo parcial vale para o conjunto.

## Emenda de integridade — sessões legadas de importação (P1-C)

A AUSÊNCIA de `DOCUMENT_DECLARES_FICTITIOUS` só significa "nada declarado" quando a análise RODOU. Por isso a extração
grava, só pelo backend, a evidência versionada `import_sessions.extractionSummary.provenanceScan`
(`PROVENANCE_SCAN_VERSION`, checksum do arquivo, parser/versão, veredito, origem, instante) — também quando nada é encontrado.
Sem migration (coluna JSON existente).

- **Quem grava:** o worker, na extração, na reextração governada e na revalidação. Só grava se o parser declarar que a
  análise rodou naquele caminho (`ParseResult.declarationScan`: CSV, XLSX, DOCX e PDF nativo/OCR no modo de linhas) e se o
  sha256 do arquivo lido for igual ao `checksum` da sessão. Também exige que todas as páginas tenham sido lidas: com
  `OCR_REQUIRED`, `OCR_REQUIRED_PARTIAL`, `OCR_FAILED`, `OCR_PAGE_LIMIT`, `OCR_PAGES_INCOMPLETE` (o OCR devolveu menos
  páginas do que recebeu) ou `PAGE_LIMIT` (PDF acima do limite de páginas do parser), há texto que não foi examinado e,
  por isso, não há evidência.
  - Uma lacuna do arquivo registrada nos avisos invalida inclusive evidência gravada antes de ela ser considerada lacuna.
  - Tabela de DOCX pulada pelo limite de itens continua tendo a declaração examinada.
  - A extração parcial continua disponível para revisão, mas nunca é apresentada como análise integral.
  - Quando a lacuna é do próprio ARQUIVO (`PAGE_LIMIT`), reanalisá-lo não resolve. Por isso a revalidação é recusada
    (`COVERAGE_INCOMPLETE`), o painel não oferece a ação, e tanto a promoção quanto a prévia orientam a dividir o
    arquivo. Nenhum parâmetro do cliente participa. A reextração substitui
  o sumário inteiro, então a evidência anterior nunca sobrevive a uma nova extração.
- **Quem exige:** `promoteApprovedSessionToDomain`, dentro da transação, com a sessão travada (FOR UPDATE) e antes de
  qualquer escrita, e também `previewSessionPromotion`. Se a evidência faltar, estiver em versão antiga ou for de outro
  arquivo, a promoção é recusada com `PRECONDITION_FAILED` / `PROVENANCE_SCAN_REQUIRED` e orientação acionável. Nunca há
  fallback para `declarada`. Como a transação inteira é revertida, nada fica gravado: nem ledger, nem pesquisa, cotação,
  Item Inteligente ou evento. O veredito `global` da evidência também classifica o conjunto, valendo o mais restritivo.
- **Sessão legada (antes desta emenda):**
  - **Sem revisão:** usa o reprocessamento governado já existente.
  - **Com revisões, correções ou aprovação:** usa `ingestion.revalidateProvenance` (operador+). O worker reanalisa o
    ARQUIVO ORIGINAL (mesmo checksum) fora de transação. `commitProvenanceRevalidation` grava, sob lock da sessão, só a
    evidência, os avisos de declaração do documento e o histórico append-only `provenanceRevalidations`, além da auditoria
    `import_provenance_revalidated` na MESMA transação.
  - **O que não muda:** staging, correções e decisões por item, pois o conteúdo revisado é o mesmo.
  - **Avisos:** a revalidação faz a UNIÃO com os avisos já registrados e NUNCA remove uma declaração. O veredito é o mais
    restritivo entre os avisos registrados e a nova análise.
  - **Aprovação:** se a declaração for NOVA para a revisão, a aprovação da SESSÃO volta para `awaiting_review`
    (compare-and-set sob o lock, como na correção supervisionada) e o revisor confirma de novo (um clique). Sem
    declaração nova, a aprovação é preservada.
  - **Falha:** se a reanálise não reconhecer cotações, não ler todas as páginas ou o arquivo divergir, nada é aplicado. O
    motivo aparece no painel e fica auditado (`import_provenance_revalidation_not_applied`).
  - **Recusa da revalidação:** se o estado mudou entre a pré-checagem e o commit (promovida, reextração reservada, outro
    arquivo, evidência já vigente), nada é aplicado.
- **Sessão já promovida:** nada é reprocessado nem reclassificado; o replay da promoção continua idempotente e a
  revalidação é recusada (histórico concluído é imutável).
- **UI:** o painel de promoção mostra a orientação e o botão "Revalidar arquivo original" (um clique, sem formulário).
- **Mudou o que a análise examina?** Incrementar `PROVENANCE_SCAN_VERSION`: as sessões ainda não promovidas passam a
  exigir revalidação.

## Emenda final — declaração acompanhada de número

Ano, número de item ou código não fazem de uma linha de texto uma cotação.
- **Tabelas (`tableToRawItems`, CSV/XLSX/DOCX/layout de PDF/OCR):** a linha é cotação quando a estrutura já reconhecida
  mostra preço nas colunas de preço (ou de fornecedor, no mapa comparativo) ou um fornecedor informado. As demais linhas
  (título, notas) são examinadas. Uma nota que declara o documento ("DADOS FICTÍCIOS PARA HOMOLOGAÇÃO;2026;;;") não vira
  item de revisão.
- **Linhas sem estrutura (texto de PDF/OCR, parágrafos, demais abas):** só um token com cara de PREÇO (`isPriceToken`:
  moeda ou centavos) exclui a linha.
- **Colagem:** linha delimitada sem valor e sem fornecedor que declara o documento é nota.
- **Classificação:** global × parcial × negação × genérico segue com `classifyDocumentDeclaration` (sem regra nova). Uma
  declaração parcial com números ("Somente os itens 3 e 4 são fictícios") passa a gerar o aviso de revisão; antes era
  descartada.

## Limitações conhecidas

- Não há ação governada para **excluir/reclassificar** uma cotação fictícia de um Item Inteligente (o merge é por
  união de `quoteId`). O bloqueio é seguro (fail-closed), mas o órgão real que importou uma cotação fictícia precisa de
  nova pesquisa/novo item. Recomendação: ação governada de reclassificação (autor, motivo, timeline, revogação da
  aprovação) — exige decisão do Owner.
- A trava da emissão é por REGISTRO (linhas existentes): cotação/item NOVO inserido durante a emissão não é travado —
  por desenho, pois não fundamenta o conteúdo revisado que está sendo emitido; a próxima emissão o enxerga.
- Declaração do documento lida por OCR de baixa confiança, ou restrita a parte das cotações, fica só como revisão
  (cotações `declarada`); não há fluxo para retirar uma declaração global do arquivo (exigiria decisão do Owner).
- ~~Sessões de ingestão EXTRAÍDAS antes da emenda P1-B seguiam a regra por cotação.~~ Resolvido pela P1-C: sem a
  evidência vigente, a promoção é recusada e a sessão é revalidada (ou reextraída, quando ainda não tem revisão).
- Num ambiente com OCR desligado, PDF com página digitalizada nunca recebe evidência e não é promovível até o OCR estar
  disponível (fail-closed, por desenho).
- O histórico de revalidações sobrevive à reextração (`provenanceRevalidations`); a evidência é sempre a da extração vigente.
- Revalidação roda na fila em memória do worker. Se o processo reiniciar no meio, nada é aplicado e basta pedir de novo.
  Também falha de forma explícita, com auditoria, se o arquivo original não puder mais ser lido ou reanalisado. Nesse
  caso a promoção continua bloqueada (fail-closed). Reenviar o MESMO arquivo reaproveita a sessão (checksum), e não há
  fluxo para descartar uma sessão APROVADA e não promovida, então criar esse fluxo exige decisão do Owner.
- Contratação Direta exclui a fictícia e calcula com as reais (o servidor escolhe o método explicitamente); Itens
  Inteligentes com mistura ficam suspensos — regras diferentes por desenho (cálculo pontual × referência persistida).

- Não há procedimento de verificação (`verificada`) nesta rodada; a distinção declarada × verificada é preservada.
- Textos documentais legados "cotação(ões) válida(s)" no quadro autoritativo foram mantidos (byte-identidade de replay);
  a UI usa "importada(s) com preço".
