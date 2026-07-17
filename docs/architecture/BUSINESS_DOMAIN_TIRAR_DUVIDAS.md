# Business Domain — Tirar Dúvidas (Institutional Consultation) (RC-5.1)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
>
> Primeira funcionalidade **visível ao usuário**. Um **domínio institucional de consulta normativa**
> — **não** é ChatGPT, chat genérico ou chatbot. Toda resposta é **fundamentada, explicável e
> auditável**, construída **exclusivamente** pela infraestrutura já existente. **Nenhuma infraestrutura
> nova de IA/pipeline/engine** é criada.

## O que é

"Tirar Dúvidas" permite que servidores públicos consultem dúvidas sobre licitações públicas usando
o **Official Knowledge Corpus** (RC-4.9) como base oficial, através da **Institutional Knowledge
Integration Layer** (RC-5.0). A experiência é a de uma **ferramenta oficial de consulta técnica**,
não de um chat.

## Fluxo (único, sem caminhos alternativos)

```
Servidor → Página "Tirar Dúvidas" → tRPC (institutionalConsultation.ask) →
  institutionalConsultationService.answerConsultation()
    → executeCognitiveTaskWithInstitutionalContext()   (RC-5.0)
        → InstitutionalContextResolver → KnowledgeRetrievalService → ContextPackage → AIExecutionEngine
    → buildConsultationAnswer()  → Resposta fundamentada + Histórico + Observabilidade
```

O Official Knowledge Corpus e o AIExecutionEngine **jamais** são acessados diretamente — somente pela
Integration Layer. Não há bypass do ContextPackage.

## Componentes

| Camada | Arquivo | Papel |
|---|---|---|
| **Domain** | `server/domain/institutionalConsultation.ts` | Tipos da resposta estruturada, `buildConsultationAnswer` (determinístico), `sanitizeQuestion` (segurança), sugestões iniciais. |
| **Service** | `server/services/institutionalConsultationService.ts` | `answerConsultation()` — orquestra o fluxo institucional; provider do corpus memoizado. |
| **Observabilidade/Histórico** | `server/services/institutionalConsultationObservabilityService.ts` | Histórico auditável (pergunta/resposta/ContextPackage/docs/trechos/replayId/correlationId/tenant/usuário/timestamp/tempos), isolado por tenant. |
| **Router** | `server/routers/institutionalConsultationRouter.ts` | `suggestions` / `ask` / `history` via `tenantProcedure` (isolamento multi-tenant). Registrado em `routers.ts` como `institutionalConsultation`. |
| **Página** | `client/src/pages/TirarDuvidas.tsx` + `client/src/components/tirar-duvidas/TirarDuvidasHome.tsx` | Título "Tirar Dúvidas", campo "Digite sua dúvida", botão "Perguntar", sugestões expansíveis, resposta fundamentada. |
| **Navegação** | `client/src/App.tsx` (`/tirar-duvidas`) + `DashboardLayout.tsx` (item de menu). | Rota autenticada + item no menu lateral. |

## Resposta (nunca texto livre)

Toda resposta contém: **Resposta elaborada** · **Fundamentação** (Lei/Artigos/Normas/Tribunal de
Contas/Norma Municipal, quando houver) · **Documentos utilizados** · **Trechos utilizados** (texto
oficial verbatim) · **Citações** · **Observações** · **Explainability** (“Esta resposta foi construída
utilizando: ✓ Lei 14.133, ✓ LC 123, ✓ Prejulgado 27, ✓ Lei Municipal…”, conforme aplicável).

## Limitações (integridade)

Quando não há base documental suficiente, o sistema **declara isso explicitamente** e **não apresenta
fundamento**. Jamais inventa fundamento, jamais cita documento inexistente, jamais afirma certeza sem
base oficial.

## Multi-Tenant

Toda consulta respeita Tenant → Município → Estado → Federal (via ContextPackage). Um tenant **jamais**
recupera documentos municipais de outro tenant (federais compartilhados; estaduais por estado).

## Segurança

- Entrada sanitizada (`sanitizeQuestion`).
- **Toda** execução ocorre pelo fluxo institucional (ContextPackage + prompt builder tipado) — não há
  acesso direto ao Corpus/AIExecutionEngine, nem bypass do ContextPackage. Injeção de prompt não altera
  o comportamento do sistema.

## Integração com o Kernel e o Corpus

- **Kernel:** via `executeCognitiveTask()` (task `LEGAL_ANALYSIS`) — sem alterar o engine.
- **Corpus:** via `InstitutionalContextResolver` + `KnowledgeRetrievalService` (RC-5.0) — sem alterar o
  Corpus/Pipeline.

## Limites do domínio

Não altera Kernel/AIExecutionEngine/Official Knowledge Corpus/Knowledge Pipeline/Integration Layer/
Business Domains existentes/UX existente. Implementa **apenas** o novo Business Domain e sua página.

## Garantias por teste (`rc51-tirar-duvidas.test.ts`)

Criação do domínio, fluxo completo, consulta simples, legislação federal/estadual/municipal,
explainability, limitações (sem base → declara), histórico/auditoria, tenant isolation, replay safety.
**Zero regressões.**
