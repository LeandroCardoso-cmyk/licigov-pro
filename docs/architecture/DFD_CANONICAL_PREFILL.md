# DFD assistido — 1º consumidor do Contexto Canônico

> O DFD continua sendo **o mesmo DFD**: mesma página (`DFDWorkspace`), mesmas seções do art. 12, §1º, mesmos
> rótulos, mesmo editor (textarea), mesmo "Salvar rascunho", mesmo "Criar DFD do zero" e mesma importação.
> O que muda: ele já abre com o que o processo sabe, mostra discretamente a origem de cada informação e
> nunca apaga o que o servidor escreveu. Modelo: [`CANONICAL_PROCUREMENT_CONTEXT.md`](CANONICAL_PROCUREMENT_CONTEXT.md).

## 1. Fluxo

1. **Novo Processo** — campo opcional "Unidade requisitante" → fato `demand.requestingUnit` (fonte
   `process`, `confirmed`) gravado **na mesma transação** da criação.
2. **Criar DFD do zero** — `generateDFDDraft` resolve o contexto e renderiza o **mesmo template**
   (`renderDFDContent`) pré-preenchido, sem IA para fatos:
   - Seção 1: objeto, unidade demandante, responsável (nome do usuário responsável pelo processo);
   - Seção 3: objeto + dica de detalhamento;
   - Seção 4: tabela `| Item | Descrição | Unidade | Quantidade prevista |` com os **Itens da contratação**
     (coluna `Lote` à esquerda quando há lotes); quantidade **prevista** ou `[a definir]` (a quantidade da
     cotação **nunca** é copiada). Cada linha é ligada ao Item Canônico por fingerprint (+ lote); linhas sem
     item correspondente não criam item — o DFD indica "N linha(s) … ainda não estão em Itens da contratação"
     e elas podem ser preparadas lá ("Preparar a partir do DFD");
   - Seção 5/7: planejamento, prioridade e prazo quando informados;
   - Seção 6: estimativa **derivada** (previsto × preço de referência) só quando completa;
   - Seção 2 (justificativa): permanece o texto-guia — narrativa é do servidor (ou rascunho de IA a pedido).
   Sem contexto disponível: exatamente o template histórico (`buildDFDDraft`), sem bloquear.
3. **Editar e salvar** — `saveDFDDraft` (ledger `dfd_manual_edit`, concorrência otimista, idempotência
   inalterados) preserva os marcadores e, **na mesma transação**, afirma no contexto o que o servidor
   informou/alterou nos campos afirmáveis (unidade, responsável, planejamento, prioridade, prazo e a
   quantidade prevista de linhas ligadas a um Item Canônico) com fonte `dfd`, `confirmed`, ator e
   `basisValueHash`. O DFD não cria itens (dono = Itens da contratação). A justificativa nunca vira fato.
4. **Recarregar** — o estado de cada campo é função pura de (conteúdo salvo, marcadores, contexto atual):
   reload/polling nunca "voltam" um valor.
5. **Contexto mudou** — campo intocado cujo valor de origem mudou ⇒ **"Informação de origem atualizada"**
   + botão **"Atualizar no rascunho"** (só aquele campo; ledger `dfd_context_reconcile`). Campo editado pelo
   servidor que diverge da origem ⇒ **conflito visível**; substituir exige confirmação explícita.
6. **Rascunho de IA da justificativa** — botão "Gerar rascunho da justificativa (IA)", só com o editor
   salvo. Se a justificativa foi escrita pelo servidor, exige confirmação (`confirmReplace`).

## 2. Estados por campo

| Estado | Indicador | Ação |
|---|---|---|
| `prefilled` | Preenchido pelo *Processo / Cadastro do órgão / DFD salvo / cálculo do sistema…* | — |
| `ai_draft` | Rascunho gerado por IA — revise antes de prosseguir | — |
| `user_modified` | Alterado por você | — |
| `stale` | Informação de origem atualizada | Atualizar no rascunho |
| `available` | Informação disponível (origem) | Atualizar no rascunho |
| `conflict` | Diverge da informação de origem / Fontes em conflito | Usar informação de origem (com confirmação) |
| `unknown` | Informação ainda não definida | — |

A lista fica num bloco recolhível **"Origem das informações"** abaixo do editor. Com edição não salva, as
ações ficam bloqueadas ("Salve suas alterações…") para nunca perder texto do servidor.

## 3. Linhagem no documento (zero schema novo para o DFD)

`generated_documents.sources` (primitive existente) recebe, além de `estrutura:…`/`edicao_manual`:
`ctx:canonical-context/1`, `ctxdigest:<16>` e `ctxv:<n>` (**contexto consumido**), `pf:<campo>=<hash>@<origem>`
(valor posto pelo sistema) e `ai:justificativa=<hash>@<executionId>@<ctxdigest16>` (rascunho de IA).
`draftOrigin` (authoringContext) continua lendo `edicao_manual`/`origem:import` como antes.

## 4. Garantias

- **Prefill ≠ aprovação**: sempre `rascunho`; nada é emitido/aprovado.
- **Nunca sobrescreve edição humana**: regenerar DFD com edição humana, importação ou IA é recusado
  (`DFD_HAS_HUMAN_CONTENT`); reconciliação é campo a campo e explícita.
- **DFD aprovado intocável**: save, regeneração, reconciliação e IA recusam (`DFD_APPROVED`).
- **Replay-safe**: digest do contexto no `payloadHash`; retry = replay; mudança de contexto sob a mesma
  chave = CONFLICT; IA com idempotência dupla (geração + Engine) ⇒ retry não chama o provider de novo.
- **Override preservado**: antes/depois (hash), origem anterior, ator e correlação em `dfd_field_overridden`;
  conteúdo anterior integral no ledger `generated_document_edits.previous_content`.

## 5. IA supervisionada (justificativa)

`server/services/authoring/dfdJustificationAuthoring.ts`, prompt `dfd-justificativa/1`:
- **só** via `executeCognitiveTask` (AIExecutionEngine) — nunca provider direto;
- contexto **governado**: objeto, órgão/localidade, unidade, planejamento, prioridade, itens (descrição/
  unidade) — **sem preços, sem orçamento, sem nome de pessoa**;
- regras: não inventar quantidade/prazo/valor/fundamento/decisão; `[REVISAR: …]` onde faltar;
- **guarda determinística**: número na saída que o processo não confirma vira `[REVISAR: n]`;
- persistência: ledger `dfd_ai_draft`, proveniência cognitiva vinculada ao artefato (obrigatória com
  cognição real — fail-closed), timeline sem conteúdo;
- explicabilidade (`explanation`): executionId, provider, modelo, versão do prompt, contextVersion,
  contextDigest, inputDigest, números não verificados, ator, correlationId, timestamp.

## 6. API (procurementProcess)

| Procedure | Tipo | Papel |
|---|---|---|
| `createProcess` (+ `requestingUnit?`) | mutation | operator |
| `canonicalContext` | query | membro do tenant |
| `dfdAssistState` | query | membro do tenant |
| `reconcileDFDField` | mutation | operator |
| `generateDFDJustification` | mutation | operator |
| `generateDFD` / `saveDFD` / `loadDFD` | inalterados (contrato preservado) | — |

## 7. Itens da contratação (0306)

A quantidade prevista também pode ser informada — e normalmente é — na aba **Itens da contratação**, sem
editar o markdown do DFD e sem precisar do DFD (processo iniciado na Pesquisa). Mudanças lá geram nova versão
do contexto; o DFD em rascunho mostra o campo como desatualizado ("Atualizar no rascunho"); DFD aprovado não
muda e bloqueia a alteração da quantidade que consumiu (`GOVERNED_CHANGE_REQUIRED`). Ver
[`CANONICAL_PROCUREMENT_CONTEXT.md`](CANONICAL_PROCUREMENT_CONTEXT.md) §11.
