# Roadmap — Business Domains sobre o Kernel

> A Sprint 5.1 entrega o primeiro Business Domain — **Processo Licitatório** —
> sobre a arquitetura Kernel × Business Domains (Sprint 5.0.1). Os próximos
> domínios reutilizam o mesmo Kernel via `kernelAccessService`.

## 1. O que a Sprint 5.1 entrega

O **Processo Licitatório** completo, conduzindo o servidor por todo o ciclo de
planejamento da contratação:

- 10 etapas com estados próprios (NEW_PROCESS → … → ARCHIVED);
- Wizard de Novo Processo com DFD opcional e **Adaptive Process Engine**;
- ETP com rascunho automático revisável;
- **Pesquisa de Preços** como workspace vivo;
- **Item Intelligence Workspace** — o diferencial competitivo;
- CATMAT/CATSER com decisão sempre humana;
- **TR Inteligente** construído das fontes;
- **Edital** com modalidade, forma, plataforma e justificativa automática;
- Copilotos coordenados pelo **Multi-Copilot Orchestrator**;
- **Timeline append-only** com reasoning e explainability.

Routers entregues: `procurementProcessRouter`, `itemIntelligenceRouter`.

## 2. Próximos Business Domains

| Sprint | Domínio | Escopo |
|---|---|---|
| **5.2** | Contratação Direta | Dispensa, Inexigibilidade, Credenciamento |
| **5.3** | Contratos | Geração contratual, aditivos, reaproveitamento processual |
| **5.4** | Parecer | Parecer inicial, adjudicação, favorável/desfavorável |
| **5.5** | Gestão | Calendário, protocolos, andamento, indicadores, produtividade |

Cada domínio segue o mesmo princípio: **conduzir o servidor**, não apenas gerar
documentos; acesso ao Kernel **exclusivamente** via `kernelAccessService`;
recomendações com reasoning, explainability, provenance, confidence e
possibilidade de rejeição.

## 3. Sequência lógica

```
5.0  Cognitive Procurement Workspace  (base cognitiva)
5.0.1 Kernel × Business Domains        (arquitetura)
5.1  Processo Licitatório      ← primeiro domínio (esta sprint)
5.2  Contratação Direta
5.3  Contratos
5.4  Parecer
5.5  Gestão
```

Os domínios compartilham o mesmo Kernel: providers de LLM (via
`server/_core/llm.ts`), Institutional RAG (Lei 14.133/2021), Knowledge Graph e
memória institucional — todos acessados apenas pelo `kernelAccessService`.

## 4. Reaproveitamento entre domínios

A arquitetura Kernel × Business Domains permite que cada novo domínio reaproveite:

- copilotos e o Multi-Copilot Orchestrator;
- memória institucional e Knowledge Graph;
- padrões de rastreabilidade (Timeline append-only);
- IDs SHA-256 determinísticos, multi-tenant (`organizationId`), replay safety e
  degradação graciosa (`getDb()`).

Ex.: os dados processuais do Processo Licitatório (5.1) alimentam a geração de
Contratos (5.3) com **reaproveitamento processual**, evitando retrabalho.

## 5. Integração com ERPs municipais — sem substituí-los

O LiciGov Pro é a **camada inteligente operacional do departamento de
licitações**, um **sistema satélite especializado**. O roadmap prevê
**integração** com ERPs municipais, **sem substituí-los**:

- o LiciGov Pro **não** é ERP, sistema contábil, tributário, de RH ou
  patrimonial;
- integra-se para **trocar dados** (empenho, dotação, itens, fornecedores) sem
  assumir as funções do ERP;
- o objetivo é **complementar** o ERP com engenharia documental e inteligência
  operacional, não competir com ele.

## 6. Princípios que se mantêm em todo o roadmap

1. Conduzir o servidor — o documento é consequência do processo.
2. Nunca substituir decisões humanas.
3. Nunca escolher CATMAT automaticamente.
4. Nunca ocultar justificativas.
5. Toda recomendação com reasoning, explainability, provenance e confidence.
6. Acesso ao Kernel apenas via `kernelAccessService`.
7. Rastreabilidade obrigatória via Timeline append-only.
8. Integração com sistemas legados (ERPs municipais) sem substituí-los.
