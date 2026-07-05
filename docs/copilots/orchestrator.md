# copilotOrchestratorService — Orquestração

## Responsabilidade

O `copilotOrchestratorService` é o ponto de entrada lógico de toda consulta ao sistema
de copilotos. Ele:

1. classifica a **intenção** da consulta (intent classification);
2. **seleciona o copiloto** adequado ao domínio;
3. **coordena múltiplos copilotos** quando a consulta cruza domínios;
4. **resolve conflitos** entre recomendações concorrentes;
5. **distribui tarefas** e consolida a resposta final.

O orquestrador **não infere diretamente**: toda inferência necessária é delegada ao
`copilotReasoningService`, que roteia pelo pipeline oficial (`server/_core/llm.ts`).

## Posição no pipeline

```
Consulta → [Intent Classification] → [Copilot Selection] → Knowledge Graph → RAG → ...
             └────────── copilotOrchestratorService ──────────┘
```

## Mapa intent → copiloto

| Intent (exemplo) | Copiloto selecionado |
|---|---|
| Conduzir/coordenar a contratação | `agente_contratacao` |
| Dúvida sobre sessão pública / atos do pregão | `pregoeiro` |
| Planejar contratação, DFD, ETP, calendário | `planejamento` |
| Elaborar/revisar Termo de Referência | `tr_intelligence` |
| Fundamentação legal, risco jurídico | `juridico` |
| Pesquisa de preços, referência de mercado | `pesquisa_precos` |
| Contrato, aditivo, prorrogação | `contratos` |
| Conformidade, checklist de controle | `controle_interno` |

A classificação de intent é fundamentada (usa Knowledge Graph e sinais do processo),
não apenas correspondência de palavras-chave. Quando a confiança da classificação é
baixa, o orquestrador prefere `agente_contratacao` como coordenador padrão.

## Seleção do copiloto

A seleção considera:

- **intent classificado** e sua confiança;
- **estado do processo** no Workflow Engine (fase DFD → ETP → TR → Edital);
- **capacidades declaradas** (`copilotCapability`) de cada copiloto;
- **escopo de política** (`copilotPolicy`) — copilotos fora de escopo são descartados.

O identificador da seleção é determinístico (**SHA-256** sobre intent + contexto +
`organizationId`), garantindo **replay safety** e correlação via `correlationId`.

## Coordenação de múltiplos copilotos (cooperação supervisionada)

Consultas complexas frequentemente exigem mais de um domínio. Exemplo: revisar um TR
com implicações jurídicas e de preços aciona `tr_intelligence`, `juridico` e
`pesquisa_precos`.

O orquestrador opera em **cooperação supervisionada**:

- designa um copiloto **coordenador** (geralmente `agente_contratacao`);
- distribui subtarefas aos copilotos de domínio;
- cada copiloto produz uma recomendação fundamentada (`copilotRecommendation`);
- o coordenador consolida, mas **não sobrepõe a decisão humana**.

Toda cooperação é registrada no `copilotDecisionTrace`, preservando quem contribuiu
com o quê.

## Resolução de conflitos

Quando dois copilotos produzem recomendações divergentes, o orquestrador:

1. **não escolhe silenciosamente** um lado;
2. registra ambas as recomendações e suas evidências (RAG + Knowledge Graph);
3. sinaliza o conflito para **supervisão humana** via Approval Layer;
4. quando aplicável, apresenta os trade-offs de forma explícita ao usuário.

A regra é conservadora: **na dúvida, escala para o humano**. Copilotos nunca resolvem
conflito jurídico por conta própria.

## Distribuição de tarefas

A distribuição respeita os limites de escopo:

- cada subtarefa é roteada apenas para copilotos cujo domínio a comporta;
- tarefas que excedem qualquer escopo são rejeitadas por `copilotPolicyService`;
- a paralelização é permitida, mas a consolidação é sequencial e determinística.

## Degradação graciosa

Sem banco disponível (padrão `getDb()`), o orquestrador opera em modo reduzido:
mantém a seleção determinística e a coordenação em memória, sem persistir sessão ou
trace. O fluxo não quebra — apenas perde persistência e histórico até o DB retornar.

## Referências

- `docs/copilots/reasoning.md` — inferência fundamentada
- `docs/copilots/policies.md` — escopo e limites por copiloto
- `docs/copilots/explainability.md` — `copilotDecisionTrace`
