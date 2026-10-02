# Contrato de decisão institucional (R4.1 / PR-07)

> Programa: Remediação de Autoridade Semântica — fase R4 (Authority & Institutional Roles).
> Estado: **IMPLEMENTED_PENDING_REVIEW** na branch `work/autonomous-semantic-remediation-r3-r11`.
> Achado: SEM-004 (ratificação com default "ratificado", clicante como autoridade, upsert que mantinha o 1º responsável).
> Código: `server/domain/institutionalDecision.ts` (regra pura), `server/db/institutionalDecisions.ts`,
> `server/services/institutionalDecisionService.ts`, migration `drizzle/0312_institutional_decision_ledger.sql`.

## 1. Campos do contrato

| Campo | Significado | Origem |
|---|---|---|
| `decisionType` / `outcome` | tipo e resultado da decisão, de catálogo fechado (`ratification`: `ratificado` \| `nao_ratificado`) | escolha explícita de quem registra — **sem default** |
| `decidedByName`, `decidedByRole` | autoridade que **decidiu**, como declarada no ato | informado; nunca inferido do usuário logado |
| `decidedByUserId` | a autoridade, se ela própria for usuário do sistema | opcional; hoje sempre `null` pelo ratify |
| `decidedAt` | data do ato (AAAA-MM-DD) | informado |
| `basisReference` | referência do ato (despacho, portaria, documento) | informado |
| `reason`, `evidence` | justificativa (mín. 10 caracteres) e evidências | informado |
| `recordedByUserId` | quem **registrou** (usuário autenticado) | contexto da sessão |
| `revision`, `supersedesDecisionId` | revisão monotônica por assunto e decisão superada | calculados sob lock |
| `authorityValidation` | validação de competência da autoridade | sempre `NOT_VALIDATED_POLICY_PENDING` |
| `idempotencyKey`, `requestHash`, `correlationId` | replay e rastreabilidade | cliente / derivado / contexto |

## 2. Regras

1. **Quem decide ≠ quem registra (INV-13).** `orgRoleProcedure("manager")` continua sendo apenas o piso técnico de quem
   **registra**. O sistema não presume que esse usuário é a autoridade competente e não valida competência: isso depende
   do insumo jurídico R4.2 (`docs/audits/LEGAL_REVIEW_DECISION_PACKET.md`), hoje **BLOCKED_LEGAL_REVIEW**.
2. **Sem default (fail-closed).** Resultado ausente ou fora do catálogo ⇒ `BAD_REQUEST`; ato incompleto ⇒
   `DECISION_FIELDS_REQUIRED`. Nada é gravado.
3. **Append-only.** Cada registro é uma nova linha. Uma nova decisão sobre o mesmo assunto exige `expectedRevision` igual
   à revisão corrente (CAS) e **supera** a anterior explicitamente (`supersedesDecisionId`); a anterior permanece intacta.
   Não há UPDATE/DELETE na tabela (guarda estática D10).
4. **Idempotência (INV-11).** Mesma chave + mesmo pedido ⇒ a mesma decisão, sem escrita (`replayed: true`); mesma chave
   + pedido diferente ⇒ `DECISION_IDEMPOTENCY_CONFLICT`.
5. **Concorrência.** `SELECT … FOR UPDATE` na linha-pai do assunto serializa os registros; o id da decisão é
   determinístico por (órgão, assunto, revisão), então uma corrida residual colide na PK ⇒ `DECISION_STALE_REVISION`.
6. **Status de domínio (INV-08).** Só `ratificado` move a contratação direta para a etapa/status de ratificação.
   `nao_ratificado` nunca grava status `ratificado`.
7. **Consumo.** A publicação (`generatePublications`) exige a decisão **corrente** do ledger com resultado `ratificado`.
   Linhas legadas de `ratifications` (pré-0312, sem autoridade/data/referência) são histórico legível
   (`getRatificationDecision.legacyRatification`) e **não** bastam para publicar.
8. **Transação.** Só persistência local (decisão, etapa, timeline com id estável = id da decisão). Sem IA, S3, HTTP,
   e-mail ou provider remoto.

## 3. Observabilidade

`institutional_decision_recorded` (`RECORDED`), `institutional_decision_replayed` (`IDEMPOTENT_CONVERGENCE`),
`institutional_decision_conflict` (`CONFLICT`, com o código) e `institutional_decision_rejected` (campos ausentes, só os
**nomes**) — sempre com organizationId, assunto, registrador, correlationId e `durationMs`. Nenhum texto da justificativa
é logado.

## 4. Limites e pendências

- **R4.2 (BLOCKED_LEGAL_REVIEW):** quem é a autoridade competente para ratificar e se o parecer prévio é obrigatório.
  Quando houver parecer, a política entra como validação adicional (`authorityValidation` passa a ter outros valores);
  o contrato de campos não muda.
- **HUMAN:** contratações diretas ratificadas pelo caminho antigo e ainda não publicadas precisarão registrar a decisão
  com os dados do ato antes de publicar (ver `docs/audits/HUMAN_DECISION_PACKET.md`).
- O vocabulário de status da Contratação Direta não tem "não ratificado"; depois de uma revogação, o status do workspace
  pode continuar `ratificado` se a 1ª decisão foi `ratificado` (a publicação permanece bloqueada pelo ledger). Registrado
  como NEW-028.
