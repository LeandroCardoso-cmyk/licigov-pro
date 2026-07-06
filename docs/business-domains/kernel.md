# Kernel Cognitivo Compartilhado

**Sprint 5.0.1 — Business Domain Architecture & Modular Licensing Foundation**

O **Kernel Cognitivo Compartilhado** é o coração do LiciGov Pro: toda a
inteligência, orquestração e infraestrutura da plataforma vivem aqui. Os
Domínios de Negócio consomem o Kernel — nunca o contrário, e nunca o duplicam.

## 1. Princípio central

> **Nenhum serviço do Kernel pertence a um módulo comercial.**
> Todos pertencem ao Kernel e são compartilhados por todos os domínios.

Consequências diretas:

- Um domínio **não paga** individualmente por IA, RAG ou Timeline — essa
  infraestrutura é do Kernel.
- Adicionar um novo domínio **não exige** replicar nenhum serviço.
- Melhorias no Kernel beneficiam **automaticamente** todos os domínios.

## 2. Os ~21 Kernel Services

| # | Serviço | Responsabilidade |
|---|---------|------------------|
| 1 | **AI Orchestration** | Coordena chamadas de IA (via `server/_core/llm.ts` → Gemini 2.5 Flash). |
| 2 | **Workflow Engine** | Execução genérica de workflows/máquinas de estado. |
| 3 | **Institutional RAG** | Recuperação aumentada sobre a base institucional e Lei 14.133/2021. |
| 4 | **Procurement Knowledge Graph** | Grafo de conhecimento de contratações públicas. |
| 5 | **Semantic Memory** | Memória semântica de longo prazo por organização. |
| 6 | **Provider Layer** | Abstração de provedores externos (IA, storage, integrações). |
| 7 | **Knowledge Retrieval** | Recuperação de conhecimento estruturado. |
| 8 | **Copilot Infrastructure** | Base dos copilotos contextuais dos domínios. |
| 9 | **Document Engine** | Geração, renderização e composição documental. |
| 10 | **Timeline Engine** | Linha do tempo unificada de eventos de processos. |
| 11 | **Version Engine** | Versionamento de documentos e artefatos. |
| 12 | **Approval Engine** | Fluxos de aprovação e assinatura. |
| 13 | **Governance Engine** | Regras de governança e conformidade. |
| 14 | **Observability** | Métricas, tracing e monitoramento. |
| 15 | **Explainability** | Explicabilidade das decisões de IA. |
| 16 | **Replay Engine** | Reexecução determinística (replay safety). |
| 17 | **Integration Layer** | Integrações externas (ex.: `dadosabertos.compras.gov.br`). |
| 18 | **CATMAT/CATSER Engine** | Consulta e classificação de materiais e serviços. |
| 19 | **Adaptive Process Engine** | Monta e executa dinamicamente os fluxos de cada domínio. |
| 20 | **Import Engine** | Importação e ingestão de dados/documentos. |
| 21 | **Audit Engine** | Auditoria e rastreabilidade obrigatória. |

Nenhum desses serviços é vendido isoladamente. Todos são **pré-requisito
compartilhado** de qualquer domínio.

## 3. `kernelAccessService` — a única porta de acesso

Todo acesso de um domínio ao Kernel passa **obrigatoriamente** por
`kernelAccessService`. Domínios nunca importam serviços internos do Kernel
diretamente.

```ts
// ❌ PROIBIDO — acesso direto ao serviço interno
import { aiOrchestration } from "@/server/kernel/ai-orchestration";

// ✅ CORRETO — acesso via porta única
const result = await kernelAccessService.invoke({
  organizationId,
  domain: "processo_licitatorio",
  service: "ai-orchestration",
  operation: "generateDocument",
  payload,
});
```

Benefícios da porta única:

- **Autorização centralizada** — valida licença e feature flags do domínio
  antes de tocar qualquer serviço.
- **Observabilidade e auditoria** — todo acesso é registrado pelo Audit Engine
  e pelo Observability.
- **Replay safety** — chamadas passam por um ponto determinístico único.
- **Multi-tenant** — o `organizationId` é sempre exigido e propagado.
- **Explainability** — a origem (domínio/serviço/operação) fica rastreável.

## 4. Registry do Kernel — `cognitiveKernel`

A tabela `cognitiveKernel` funciona como **registry** dos serviços disponíveis:
identificador do serviço, versão, status (ativo/depreciado) e capacidades
expostas. Os domínios consultam o registry (via Kernel) para saber quais
serviços e operações estão disponíveis — nunca por caminhos codificados.

## 5. O que o Kernel NÃO faz

- Não conhece regras de negócio específicas de um domínio (ex.: prazos de
  edital). Essas regras vivem na definição do domínio; o Kernel apenas executa.
- Não decide o que é vendido — isso é responsabilidade do Licenciamento Modular
  (ver [`licensing.md`](./licensing.md)).
- Não possui workspace próprio — workspaces pertencem aos domínios
  (ver [`workspaces.md`](./workspaces.md)).

## 6. Documentos relacionados

- [`architecture.md`](./architecture.md) — visão definitiva da arquitetura
- [`domains.md`](./domains.md) — como os domínios consomem o Kernel
- [`adaptive-process-engine.md`](./adaptive-process-engine.md) — o motor de processos
