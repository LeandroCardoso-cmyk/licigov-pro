# Edital — dados de publicação diferidos

> Subordinado à Constituição do Produto (`PRODUCT_NORTH_STAR.md`). Fluxo único do Edital: nenhum wizard/etapa nova.

## Princípio
Número do pregão e cronograma do certame **não impedem a elaboração do Edital**. São necessários para **publicar**, não para **compor**.
A composição também **não depende** de parecer, autorização ou módulo jurídico (o parecer é uma etapa/documento do processo, nunca um gate de geração).

## Os 7 dados de publicação (`DEFERRED_PUBLICATION`)
`processo.numeroPregao` · `controle.dataDivulgacaoPrevista` · `processo.dataAbertura` · `processo.horarioAbertura` ·
`processo.dataInicioRecebimentoPropostas` · `processo.dataFimRecebimentoPropostas` · `processo.horarioFimRecebimentoPropostas`.

- Metadado EXPLÍCITO no catálogo (`completionPolicy: "DEFERRED_PUBLICATION"`, só em variável não obrigatória); nenhum segundo motor de regras.
- Ausente ⇒ renderiza **"A DEFINIR PARA PUBLICAÇÃO"** (nunca `[REVISAR]`, nunca data/número inventado, nunca "último + 1", nunca a data atual).
- M1 registra `deferredPublication`: `DEFERRED` (sem valor) ou `RESOLVED` (com `valueHash`), ordem determinística. Replay determinístico; nova composição ⇒ novo hash.
- Contadores: fora de `PROCESS_DECISIONS_TOTAL`; contados à parte em `DEFERRED_PUBLICATION_TOTAL`. Matriz de autoridade inalterada.

## Revisão 1 × Revisão 2
A Revisão 1 (publicada) é **imutável**: continua exigindo os dados. A semântica nova vive na **Revisão 2 CANDIDATA** (`models/edital-pregao-eletronico-bll-1.0.2/`),
não publicada e não vinculada. **Enquanto o Owner não publicar/vincular a Revisão 2, o comportamento em produção não muda.**

## Preencher depois (mesmo fluxo)
Bloco recolhido **"Dados para publicação"** na preparação. A gravação usa a CertameConfig governada (ator, instante, revisão, correlationId, CAS, idempotência).
- `PublicationReadiness` (`complete`, `missing`) e `PublicationScheduleProjection` estáveis no estado da preparação.
- **Recomposição governada:** com o hash do rascunho visto (`expectedContentHash`), `generateNotice` recompõe o rascunho de origem `template` como NOVA versão:
  o conteúdo anterior fica no ledger append-only (`generated_document_edits`), o M1 anterior permanece imutável, o novo M1 tem novo hash.
  Recusa: documento aprovado/oficial (`OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE`); edição humana sem `confirmReplace` (`HUMAN_EDIT_WOULD_BE_OVERWRITTEN`); hash desatualizado.
  Sem o hash, rascunho existente com outro conteúdo continua ⇒ CONFLICT (nunca sobrescreve).

## Downstream
Não há consumidor existente que leia a CertameConfig (calendário/Centro de Operações usam `operation_records`/`operational_events`); o outbox existente não tem
consumidor/dispatcher. Por isso **só a projeção é exposta** e **`PROCUREMENT_PUBLICATION_SCHEDULE_READY` não é emitido** (sem dual-write improvisado).

## SRP
`controle.utilizaSrp` é apresentado como **"Sistema de Registro de Preços (SRP)"** — "Esta contratação utilizará Sistema de Registro de Preços?" (Sim/Não),
por *presentation override* (`editalPresentation.ts`; o catálogo da Revisão 1 não é editado). Não há fonte canônica anterior no fluxo (nem o TR, nem Itens, nem Pesquisa
de Preços registram o SRP): continua **decisão humana**; nenhuma heurística textual sobre o objeto.
