# Multi-Copilot Orchestrator

O **Multi-Copilot Orchestrator** (`workspaceOrchestratorService`) é o coração
operacional do Workspace Cognitivo. Ele transforma uma **solicitação** do
servidor em uma **recomendação consolidada**, coordenando múltiplos copilotos
em paralelo, resolvendo conflitos e validando o resultado antes de devolvê-lo
para supervisão humana.

> O Orchestrator **recomenda**; o servidor **decide**.

## Pipeline de orquestração

```
Solicitação
    │
    ▼
Classificação ──▶ Seleção dos copilotos ──▶ Execução paralela
                                                   │
                                                   ▼
Servidor ◀── Recomendação ◀── Validação ◀── Consolidação ◀── Resolução de conflitos
```

### 1. Solicitação
O servidor abre uma demanda no Workspace (ex.: "elaborar o TR deste processo").
A solicitação carrega `organizationId`, `workspaceId` e recebe um
`correlationId` que será propagado por todo o pipeline.

### 2. Classificação
O serviço classifica a natureza da solicitação (tipo de documento, etapa do
fluxo DFD → ETP → TR → Edital, complexidade) para determinar **quais domínios
de conhecimento** serão necessários. A classificação consulta o contexto
consolidado por `workspaceContextService` (RAG + KG + memória semântica).

### 3. Seleção dos copilotos
Com base na classificação, o Orchestrator seleciona o **conjunto mínimo de
copilotos** capazes de atender à demanda. A seleção é determinística: a mesma
solicitação e o mesmo contexto produzem a mesma seleção (replay safe).

### 4. Execução paralela
Os copilotos selecionados são executados concorrentemente via `Promise.all`,
cada um chamando `runCopilotReasoning`. Toda inferência passa pelo pipeline
oficial `server/_core/llm.ts` (Gemini 2.5 Flash) — nunca por chamadas diretas.

```ts
const resultados = await Promise.all(
  copilotosSelecionados.map((c) =>
    runCopilotReasoning({ copiloto: c, contexto, correlationId })
  )
);
```

Cada execução recebe o mesmo contexto consolidado e o `correlationId`
compartilhado, permitindo rastrear a contribuição individual de cada copiloto.

### 5. Resolução de conflitos
Copilotos podem divergir (ex.: Jurídico recomenda cláusula que a Pesquisa de
Preços torna inviável). O Orchestrator detecta divergências e aplica regras de
resolução — priorização por domínio, sinalização de conflito e, quando não há
convergência automática, **marcação para decisão humana** (`workspaceDecision`).

### 6. Consolidação
As contribuições compatíveis são consolidadas em uma **resposta única e
coerente**, preservando a rastreabilidade da origem de cada trecho.

### 7. Validação
A saída consolidada é validada (estrutura, aderência à Lei 14.133/2021,
consistência interna). Falhas de validação retornam ao passo de consolidação ou
geram um risco (`workspaceRisk`).

### 8. Recomendação → Servidor
O resultado é entregue como **recomendação supervisionada**, sempre editável,
revisável e sujeita à aprovação humana. Nenhuma saída é aplicada
automaticamente.

## Exemplo: elaboração de um TR

A elaboração de um **Termo de Referência** envolve quatro copilotos em paralelo:

| Copiloto | Contribuição |
|---|---|
| **Planejamento** | Objeto, justificativa e alinhamento ao ETP/DFD |
| **TR Intelligence** | Estrutura do TR conforme art. 6º, XXIII |
| **Jurídico** | Aderência legal e cláusulas obrigatórias (Lei 14.133/2021) |
| **Pesquisa de Preços** | Estimativa e critérios de aceitabilidade de preços |

Fluxo: **Solicitação** ("elaborar TR") → **Classificação** (documento = TR,
etapa = elaboração) → **Seleção** (os 4 copilotos) → **Execução paralela** →
**Resolução de conflitos** (ex.: preço x exigência técnica) → **Consolidação**
(TR único) → **Validação** → **Recomendação consolidada** ao servidor.

O usuário recebe **uma resposta consolidada**, e não quatro respostas
fragmentadas — essa é a diferença central do Workspace em relação aos copilotos
isolados das fases anteriores.

## Garantias

- **Determinismo**: IDs SHA-256 e seleção reproduzível.
- **Rastreabilidade**: `correlationId` propagado a todos os copilotos.
- **Multi-tenant**: execução isolada por `organizationId`.
- **Degradação graciosa**: sem DB (`getDb()`), o Orchestrator opera em modo
  limitado sem persistir, retornando erro explícito quando a persistência é
  obrigatória.
- **Supervisão humana**: toda recomendação passa pela Approval Layer.
