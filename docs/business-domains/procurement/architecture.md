# Arquitetura — Business Domain: Processo Licitatório

> Sprint 5.1 — Primeiro Business Domain implementado sobre a arquitetura
> **Kernel × Business Domains** (Sprint 5.0.1).

## 1. Filosofia central

O objetivo deste domínio **não é gerar documentos**. É **conduzir o servidor
público durante todo o ciclo de planejamento da contratação**.

> Todo documento (DFD, ETP, TR, Edital) é **consequência do processo**, nunca o
> contrário.

A experiência não é o preenchimento de formulários. É a **revisão de
recomendações** produzidas pelo Kernel. O servidor decide; o sistema conduz,
sugere, explica e registra. Em nenhum momento o sistema substitui a decisão
humana.

Consequências práticas dessa filosofia:

- Nenhuma etapa é "só um formulário" — cada uma tem estados próprios.
- Nenhum documento é escrito do zero: o sistema sempre parte de um rascunho
  enriquecido com contexto.
- Toda recomendação carrega **reasoning**, **explainability**, **provenance**,
  **confidence** e **possibilidade de rejeição**.

## 2. Posição na arquitetura Kernel × Business Domains

Este é o **primeiro** Business Domain construído sobre o Kernel entregue na
Sprint 5.0.1. A regra estrutural é absoluta:

> **TODO acesso ao Kernel ocorre exclusivamente via `kernelAccessService`.**
> O domínio **nunca** acessa providers, RAG ou Knowledge Graph diretamente.

```
┌─────────────────────────────────────────────────────────┐
│  Business Domain: Processo Licitatório (Sprint 5.1)      │
│                                                          │
│  routers: procurementProcessRouter, itemIntelligenceRouter │
│  workspaces: PriceResearchWorkspace, ItemIntelligence    │
│  engine: Adaptive Process Engine                         │
│  orquestração: Multi-Copilot Orchestrator                │
└───────────────────────────┬──────────────────────────────┘
                            │  (única porta de entrada)
                    ┌───────▼────────┐
                    │ kernelAccess-  │
                    │   Service      │
                    └───────┬────────┘
        ┌───────────────────┼────────────────────┐
        ▼                   ▼                    ▼
   LLM Providers     Institutional RAG     Knowledge Graph
 (via llm.ts)        (Lei 14.133/2021)    (memória institucional)
```

Nenhum router do domínio importa `server/_core/llm.ts`, o RAG ou o KG
diretamente. Toda inferência, recuperação e enriquecimento passa pelo
`kernelAccessService`, que por sua vez usa o pipeline oficial
`server/_core/llm.ts` (Gemini 2.5 Flash).

## 3. Relação com o Cognitive Procurement Workspace (Sprint 5.0)

A Sprint 5.0 entregou o **Cognitive Procurement Workspace** — a base cognitiva
(copilotos, orquestração, memória institucional). A Sprint 5.1 materializa esse
substrato em um **domínio de negócio navegável**: o Processo Licitatório
completo, do Novo Processo ao arquivamento.

- Sprint 5.0 → capacidade cognitiva (o "cérebro").
- Sprint 5.1 → o processo licitatório que usa essa capacidade (o "fluxo").

## 4. Entidades principais

| Entidade | Descrição |
|---|---|
| `ProcurementProcess` | Processo licitatório completo, com etapa atual e estados |
| `DFDState` | DFD como **estado** do processo (não apenas documento) |
| `ETPDraft` | Rascunho de ETP gerado automaticamente e revisado pelo servidor |
| `PriceResearchWorkspace` | Workspace vivo de pesquisa de preços |
| `IntelligentProcurementItem` | Item enriquecido — o diferencial competitivo |
| `TRDocument` | Termo de Referência construído a partir de todas as fontes |
| `NoticeDocument` | Edital, com modalidade, forma e plataforma |
| `TimelineEvent` | Registro **append-only** de todo o histórico |

## 5. Routers do domínio

- **`procurementProcessRouter`** — ciclo de vida do processo: criação, avanço de
  etapas, DFD, ETP, TR, Edital, revisão, emissão e arquivamento.
- **`itemIntelligenceRouter`** — Item Intelligence Workspace: enriquecimento,
  painel lateral, CATMAT, especificações, alertas e aprovação individual.

## 6. Garantias de engenharia

- **IDs SHA-256 determinísticos** — reprodutibilidade e replay safety.
- **Multi-tenant** — todo registro carrega `organizationId`.
- **Degradação graciosa** — acesso ao banco via `getDb()`, tolerante a falha.
- **Rastreabilidade obrigatória** — Timeline append-only cobre importações,
  revisões, decisões, alterações, aprovações, recomendações, atuação de
  copilotos, reasoning e explainability.

## 7. Regras invioláveis

1. Nunca gerar documentos sem passar pelo fluxo.
2. Nunca substituir decisões humanas.
3. Nunca escolher CATMAT automaticamente.
4. Nunca ocultar justificativas.
5. Nunca acessar o Kernel fora do `kernelAccessService`.
