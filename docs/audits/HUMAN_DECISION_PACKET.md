# Pacote de decisões humanas — lote autônomo R0 → R11

> Estado: **AWAITING_OWNER_DECISIONS** · branch `work/autonomous-semantic-remediation-r3-r11` · 2026-10-02.
> Cada item traz o que já está implementado localmente (sem merge, sem deploy), a pergunta objetiva e as opções.
> **Nenhuma** destas decisões foi tomada por inferência. Decisões jurídicas estão em `LEGAL_REVIEW_DECISION_PACKET.md`.

| ID | Tema | Pergunta objetiva | Opções | O que acontece sem resposta |
|---|---|---|---|---|
| HD-01 | **R6.2** processos legados sem Itens da contratação (SEM-008) | Para processos com TR/Edital já gerados a partir da quantidade da cotação, o que fazer? | (a) exigir o cadastro dos Itens da contratação antes de qualquer nova geração — **implementado** (PR-13); (b) além de (a), marcar os rascunhos existentes como `[REVISAR]`; (c) outra orientação | PR-13 não deve ser mergeada sem a escolha; documentos **emitidos** nunca são alterados |
| HD-02 | **R6.1** inventário read-only | Autoriza a execução do SELECT agregado `scripts/inventory-r6-1-quoted-quantity-without-items.sql` em produção, por mecanismo read-only legítimo? | sim (quem executa e por qual mecanismo) / não | o tamanho do impacto de HD-01 permanece desconhecido |
| HD-03 | **R7.2** versões já emitidas sem snapshot institucional (SEM-013) | Como tratar versões `emitido` anteriores à PR-15 (que reexportam com a identidade vigente)? | (a) manter o fallback vigente com log `official_export_identity_live_fallback` — **implementado**; (b) backfill do snapshot a partir de registro histórico confiável (se existir); (c) reemissão governada | (a) continua valendo; nada é reescrito |
| HD-04 | **R2.3** uso real de dados legados | Autoriza a consulta agregada read-only de `R2_LEGACY_DATA_USAGE_READONLY.md` §4 (`legal_opinions`, `direct_contracts`, `contracts`, `processes`)? | sim (mecanismo) / não | PR-14 corrige as saídas legadas mas a decisão corrigir × retirar (CUTOVER) fica pendente |
| HD-05 | **R2.2** flag `FF_CANONICAL_INGESTION` | Confirmar por leitura read-only o estado atual da flag do tenant piloto (a decisão Opção B já está registrada) | confirmar / informar o estado | R2.2 continua IN_PROGRESS; nenhuma flag é alterada |
| HD-06 | **Pilot Reset 2026/253** | Após merge + deploy da 0313, autoriza um **preview** read-only do processo real e, em seguida, decide a ação? | `RESET_DRAFT` (elegível pelo discovery) / `ARCHIVE` / nenhuma | nada acontece com o processo real |
| HD-07 | **Workspaces de contratação direta ratificados no legado** (PR-07) | Linhas antigas de `ratifications` (sem autoridade/ato) não bastam mais para publicar. Como regularizar? | (a) re-registrar a decisão no ledger (autoridade declarada, data, ato) — fluxo implementado; (b) outra orientação | publicação desses workspaces fica bloqueada (fail-closed) |
| HD-08 | **Checklist com `s3://anexo`** (PR-16) | Itens antigos marcados "anexado/validado" com a referência fictícia não validam mais. Como tratar? | (a) reanexar o arquivo real — fluxo implementado; (b) marcar em lote como `pendente` (exige script autorizado) | os itens antigos continuam com o status antigo, mas não podem ser (re)validados sem arquivo |
| HD-09 | **NEW-028** vocabulário de status da ratificação | Uma decisão "não ratificado" que supera "ratificado" deve mudar o status do workspace? Para qual valor? | novo status `nao_ratificado` (migration) / manter o status e exibir a decisão vigente | o ledger registra corretamente; o status do workspace pode continuar "ratificado" após superação |
| HD-10 | **R9.1** plano dos 54 P1 | Aprovar (ou repriorizar) `R9_P1_REMEDIATION_PLAN.md` | aprovar / ajustar grupos e ordem | nenhum P1 além do SEM-050 é corrigido |
| HD-11 | **R10** P2 e LEG-007 | Aprovar `R10_P2_REMEDIATION_PLAN.md`; decidir remover ou manter UI morta (LEG-007) | aprovar / ajustar | P2 seguem abertos |
| HD-12 | **Fatiamento em PRs** | Aprovar a ordem de PRs proposta em `AUTONOMOUS_REMEDIATION_EXECUTION_REPORT.md` §8 (migrations 0310→0314 em ordem) | aprovar / ajustar | nenhuma PR é aberta por este lote |
| HD-13 | **SEM-027** método do valor de referência | Qual método institucional (média, mediana, menor preço, com/sem exclusão de outliers) e quem decide por processo? | definir | P1 permanece aberto |
| HD-15 | **CONTRACT_NUMBER_SCOPE** (2º passe) | O número oficial do contrato deve ser único por órgão independentemente da origem? | **A** único por órgão, qualquer origem (SQL pronto e testado em `drizzle/policy-pending/`, com preflight read-only; aborta se já houver duplicatas); **B** único por órgão **e** origem — comportamento atual (PK hash(org, origem, número)); **C** outro padrão (ex.: normalização de caixa — NEW-027) | B continua valendo; o SEM-007 já está resolvido sem depender da escolha (INSERT-only na PK). Impacto de A: o mesmo número em outra origem e o rename para número usado passam a ser CONFLICT; exige preflight sem duplicatas |
| HD-14 | **SEM-051** emissão do DFD | O DFD passa a ter emissão oficial governada (como ETP/TR/Edital)? | sim / não | guardas de "aprovado" do DFD seguem inalcançáveis |

## Riscos que o owner precisa aceitar ou recusar explicitamente

- **Ordem de merge das migrations**: 0310, 0311, 0312, 0313 e 0314 formam uma cadeia linear no journal; mergear fora de
  ordem quebra o ledger de migrations. Nenhuma foi executada em produção.
- **Comportamento fail-closed novo** (PR-07, PR-11, PR-13, PR-16, PR-17): fluxos que antes "funcionavam" com dados
  inventados passam a recusar com código estável. É intencional — mas muda a experiência do piloto.
