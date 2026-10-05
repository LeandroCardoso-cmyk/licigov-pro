# Fast-Track — Decisões registradas do owner

> Registro **somente** das decisões do owner que autorizam o fast-track (ondas críticas) da remediação semântica.
> Não altera a baseline `SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md`, não reabre nenhuma decisão e **não aprova**
> nenhum item jurídico.

## Decisões

| ID | Decisão | Status registrado |
|---|---|---|
| HD-01 | Exigir o cadastro dos **Itens da contratação** antes de qualquer **nova** geração de TR/Edital. A quantidade da cotação é evidência, nunca necessidade. Documentos emitidos não são alterados; rascunhos antigos não recebem retrofit automático. | `OPTION_A_APPROVED` |
| HD-10 | Plano técnico dos 54 P1 (`R9_P1_REMEDIATION_PLAN`) | `TECHNICAL_PLAN_APPROVED` |
| HD-11 | Plano técnico dos P2 (`R10_P2_REMEDIATION_PLAN`); a decisão sobre a UI morta LEG-007 permanece adiada | `TECHNICAL_PLAN_APPROVED_WITH_LEG007_DEFERRED` |
| HD-12 | Fatiamento em PRs: substituído pelas ondas do fast-track (caminho crítico → ondas auditáveis) | `SUPERSEDED_BY_FAST_TRACK_WAVES` |

## Bloqueios preservados individualmente

| Categoria | Status |
|---|---|
| Bloqueios jurídicos (LEG-*) | `PRESERVED` — nenhum item jurídico foi aprovado por este registro |
| Bloqueios de produção | `PRESERVED` |

## Observações

- Este registro não autoriza PR, merge, deploy, mudança de flag ou qualquer ação em produção.
- Os documentos `HUMAN_DECISION_PACKET.md`, o relatório de execução e o plano de empacotamento residem no pacote de
  documentação da candidate (ainda fora da main) e devem espelhar estes status quando integrados.
