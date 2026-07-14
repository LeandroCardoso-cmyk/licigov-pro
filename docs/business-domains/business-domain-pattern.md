# Business Domain Pattern (obrigatório)

> A partir da Sprint 5.3.1, **todo novo Business Domain** do LiciGov Pro deve
> responder às perguntas abaixo **antes** de ser implementado. Este documento é
> parte obrigatória do escopo de qualquer futura Sprint que crie ou evolua um domínio.

O LiciGov Pro é uma **camada cognitiva e operacional** do departamento de licitações.
Não é ERP. Não decide. Não obriga. Não executa atos administrativos. Apenas analisa,
recomenda, fundamenta, explica e apresenta alternativas — **o servidor sempre decide**.

## Perguntas obrigatórias

### 1. Como nasce?
Descreva a(s) origem(ns) do domínio. Todo domínio nasce em um **Workspace próprio**.

### 2. Pode nascer de outro módulo?
Indique se pode ser originado por outro Business Domain (ex.: Contrato nasce do Processo
Licitatório ou da Contratação Direta). Se sim, a origem é **sempre registrada**.

### 3. Pode nascer de documento externo?
Indique se aceita entrada externa (PDF/DOCX). Se sim, a entrada passa por
**Reconstrução Assistida** — nunca "extração perfeita" — e **depende da validação do servidor**.

### 4. Qual Workspace possui?
Nomeie o Workspace-cêntrico (ex.: `ContractWorkspace`) e suas abas/etapas.

### 5. Quais documentos produz?
Liste os documentos oficiais. **Todo** documento produzido na plataforma gera **DOCX e PDF**
(`server/domain/documentFormats.ts`).

### 6. Quais recomendações produz?
Liste as etapas recomendadas pelo **Adaptive Recommendation Engine**. Toda recomendação traz
`reasoning`, `legalBasis`, `confidence`, `alternativas` e **nunca bloqueia** o fluxo.

### 7. Quando utiliza Institutional Request?
Indique quando o domínio troca solicitações com outros domínios (ex.: parecer jurídico via
`LEGAL_OPINION_INITIAL`/`LEGAL_OPINION_FINAL`). **Nunca** integra diretamente outro domínio.

### 8. Quando utiliza Copilotos?
Liste os copilotos do domínio (Multi-Copilot Orchestrator). Copilotos são **supervisionados**
e **nunca decidem** — apenas sugerem, com reasoning/explainability/provenance/confidence.

### 9. O que pertence ao ERP?
Liste explicitamente o que **NÃO** entra (pagamentos, empenhos, financeiro, patrimônio,
almoxarifado, folha, execução orçamentária, controle financeiro). Guarda: `assertNotErp()`.

### 10. O que ficará para Future Evolution?
Liste o que fica de fora do Production Ready Core, com apenas **interfaces, feature flags,
hooks e pontos de extensão** preparados.

## Regras transversais (sempre)

- Todo acesso ao Kernel **exclusivamente** via `kernelAccessService`.
- **Multi-tenant** (`organizationId`), **replay-safe** (IDs via `sha256`, sem `Date.now`/`Math.random`).
- **Explainability** e **Observabilidade** obrigatórias.
- Documentos por **referência** (nunca duplicados).
- Reutilizar Institutional Request Engine, Document Engine, Timeline, Adaptive Recommendation
  Engine e Multi-Copilot Orchestrator — **nunca duplicar infraestrutura**.

## Checklist de aderência

- [ ] Respondeu às 10 perguntas acima
- [ ] Workspace-cêntrico definido
- [ ] Documentos oficiais → DOCX + PDF
- [ ] Recomendações (nunca decisões) com base legal e confiança
- [ ] Zero funcionalidade de ERP
- [ ] Kernel acessado só via Kernel Access Service
- [ ] Multi-tenant, replay-safe, explainability e observabilidade
- [ ] Future Evolution apenas como pontos de extensão
