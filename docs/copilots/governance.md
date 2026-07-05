# Governança e Approval Layer

## Responsabilidade

A governança dos copilotos garante que **toda decisão permaneça humana**. Nenhuma
recomendação de copiloto produz efeito jurídico ou processual sem passar pela
**Approval Layer** e por **supervisão humana**.

O `copilotGovernanceRouter` (tRPC) expõe as operações de aprovação, rejeição, consulta
de políticas e auditoria.

## Princípio inviolável

> Copilotos jamais emitem parecer jurídico definitivo.

Os copilotos **orientam, estruturam, sugerem, explicam, fundamentam e identificam
riscos**. A emissão de parecer, a adjudicação, a homologação e qualquer ato decisório
são **exclusivos do servidor público responsável**.

## copilotGovernanceRouter

Procedures principais (todas `protectedProcedure`, escopo multi-tenant por
`organizationId`):

- `approveRecommendation` — aprova uma `copilotRecommendation`, registrando o
  aprovador humano, o instante e a justificativa;
- `rejectRecommendation` — rejeita a recomendação, com motivo obrigatório;
- `listPolicies` — lista as políticas aplicáveis ao copiloto/organização;
- `getAuditTrail` — recupera o audit trail de uma sessão ou recomendação.

Cada operação recebe e propaga um `correlationId` e valida entradas com **Zod**.

## Approval Layer

A Approval Layer é a barreira entre **recomendação** e **efeito**:

1. o copiloto produz `copilotRecommendation` no estado `pending`;
2. a recomendação é apresentada com suas **evidências** (RAG + Knowledge Graph) e o
   `copilotDecisionTrace`;
3. um humano habilitado **aprova** ou **rejeita**;
4. apenas recomendações aprovadas podem alimentar documentos ou o Workflow Engine.

Estados de uma recomendação:

```
pending → approved   (por humano, com justificativa)
pending → rejected   (por humano, com motivo)
pending → escalated  (conflito ou risco → supervisão adicional)
```

## Supervisão humana obrigatória

- Nenhuma recomendação é aplicada automaticamente.
- Recomendações de alto risco ou em conflito (ver `orchestrator.md`) são **escaladas**.
- O copiloto `juridico` **nunca** conclui análise jurídica; ele apenas fundamenta e
  aponta riscos para decisão do responsável legal.
- A revisão humana é registrada e vinculada à recomendação (autor, data, decisão).

## Auditoria e audit trail

Toda ação de governança é auditável e rastreável (regra fundamental do projeto):

- **quem** aprovou/rejeitou (identidade do servidor);
- **quando** (timestamp) e sob qual `correlationId`;
- **o que** foi decidido e com qual justificativa;
- **sobre qual** recomendação e trace (lineage completo).

O audit trail é imutável e reconstrói a cadeia completa: consulta → copiloto →
recomendação → evidências → decisão humana. Combinado ao `copilotDecisionTrace`, ele
oferece **replay safety** — a decisão pode ser reproduzida e verificada.

## Políticas na governança

A governança consome `copilotPolicy` (ver `policies.md`) para impedir que qualquer
recomendação fora de escopo chegue à aprovação. Ações proibidas — como emitir decisão
jurídica ou parecer definitivo — são bloqueadas por `evaluatePolicy` **antes** da
Approval Layer, não dependendo do julgamento do aprovador.

## Degradação graciosa

Sem banco (padrão `getDb()`), a governança opera em modo somente-leitura seguro:
recomendações não podem ser persistidas como aprovadas, evitando efeitos sem
rastreabilidade. Nada é aplicado ao processo até que o audit trail possa ser gravado.

## Fluxo de aprovação (resumo)

```
Recommendation (pending)
   → apresentação com evidências + copilotDecisionTrace
   → evaluatePolicy (bloqueia ações proibidas)
   → decisão humana: approve | reject | escalate
   → registro no audit trail (quem, quando, por quê, correlationId)
   → apenas 'approved' alimenta documentos / Workflow Engine
```

## Papéis e responsabilidades

- **Servidor responsável** — único apto a aprovar recomendações que produzem efeito;
- **Copiloto** — fundamenta e apresenta evidências; não decide;
- **Approval Layer** — garante que nada seja aplicado sem decisão humana registrada;
- **Controle interno** — usa o audit trail e o replay para verificação posterior.

## Referências

- `docs/copilots/policies.md` — `copilotPolicy` e `evaluatePolicy`
- `docs/copilots/explainability.md` — `copilotDecisionTrace` e replay
- `docs/copilots/orchestrator.md` — escalonamento de conflitos
