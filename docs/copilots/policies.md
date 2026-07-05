# Políticas dos Copilotos — copilotPolicy

## Responsabilidade

O `copilotPolicyService` define e aplica os **limites operacionais** de cada copiloto.
Ele responde à pergunta: *este copiloto pode fazer isto, neste domínio, nesta
organização?* A política é avaliada **antes** do reasoning e **antes** da Approval
Layer, funcionando como guarda-corpo determinístico.

## Modelo `copilotPolicy` (Drizzle / MySQL)

Cada política, escopada por `organizationId`, declara para um copiloto:

- **domínio permitido** — o escopo funcional (ver mapa em `architecture.md`);
- **capacidades permitidas** — quais `copilotCapability` podem ser exercidas;
- **ações proibidas** — lista explícita de operações vedadas;
- **exigência de supervisão** — se toda recomendação requer aprovação humana (padrão: sim);
- **limites operacionais** — restrições de escopo, volume ou sensibilidade.

Os identificadores de política são determinísticos (**SHA-256**), garantindo avaliação
reproduzível e **replay safety**.

## Ações proibidas (transversais a todos os copilotos)

Independentemente do domínio, **nenhum copiloto pode**:

- **tomar decisão jurídica** — a decisão é sempre humana;
- **emitir parecer jurídico definitivo** — apenas fundamentar e apontar riscos;
- **homologar, adjudicar ou assinar** qualquer ato do processo;
- **aplicar recomendação sem aprovação** via Approval Layer;
- **acessar o provider de IA diretamente** — toda inferência passa por
  `server/_core/llm.ts`;
- **atuar fora do próprio domínio** — cada copiloto tem escopo restrito.

## Escopo restrito por copiloto

Cada copiloto opera **apenas** no seu domínio. Exemplos de fronteira:

| Copiloto | Pode | Não pode |
|---|---|---|
| `juridico` | fundamentar, apontar risco legal | emitir parecer definitivo, decidir |
| `pesquisa_precos` | montar cesta de referência, sugerir preços | fixar preço oficial da contratação |
| `pregoeiro` | orientar atos da sessão | praticar o ato ou decidir recurso |
| `tr_intelligence` | estruturar/revisar TR | aprovar o TR |
| `contratos` | minutar contrato/aditivo | assinar ou vincular a organização |
| `controle_interno` | checklist de conformidade | declarar conformidade final |
| `planejamento` | estruturar DFD/ETP/calendário | autorizar a contratação |
| `agente_contratacao` | coordenar o fluxo | substituir decisão do gestor |

Uma consulta que exija ação fora do escopo é **rejeitada** ou **escalada** ao
orquestrador para eventual cooperação supervisionada com o copiloto competente.

## evaluatePolicy

`evaluatePolicy(input)` é a função central de avaliação. Dado o copiloto, a ação
pretendida, o contexto do processo e o `organizationId`, ela retorna:

- `allowed: boolean` — se a ação é permitida;
- `reason` — justificativa determinística da decisão;
- `requiresApproval: boolean` — se exige supervisão humana (padrão verdadeiro);
- `violations[]` — lista de limites violados, quando houver.

Características:

- **determinística** — mesmas entradas, mesmo veredito (hash SHA-256);
- **multi-tenant** — sempre avaliada no escopo da `organizationId`;
- **fail-safe** — na ausência de política aplicável ou de banco (padrão `getDb()`),
  assume o modo mais restritivo: exige supervisão e bloqueia ações sensíveis;
- **rastreável** — a avaliação é registrada com `correlationId` e alimenta o
  `copilotDecisionTrace`.

## Integração com as demais camadas

- **Orchestrator** — descarta copilotos fora de escopo na seleção;
- **Reasoning** — recebe os limites de política dentro do contexto do
  `PromptContextBuilder`;
- **Governance** — bloqueia ações proibidas antes da Approval Layer, sem depender do
  julgamento do aprovador.

## Exemplo de avaliação

```
evaluatePolicy({
  copilot: "juridico",
  action: "emitir_parecer_definitivo",
  organizationId,
  context,
})
→ {
    allowed: false,
    requiresApproval: true,
    reason: "ação proibida: parecer jurídico definitivo é decisão humana",
    violations: ["forbidden_action:emitir_parecer_definitivo"],
  }
```

A mesma chamada para `action: "fundamentar_risco_legal"` retornaria `allowed: true`
com `requiresApproval: true`, pois fundamentar risco está dentro do escopo do copiloto
`juridico`, mas ainda exige supervisão humana.

## Referências

- `docs/copilots/governance.md` — Approval Layer e supervisão humana
- `docs/copilots/architecture.md` — mapa de domínios dos copilotos
- `docs/copilots/explainability.md` — registro das avaliações no trace
