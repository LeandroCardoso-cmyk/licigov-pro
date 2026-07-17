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

## Persistência institucional (fonte de verdade = banco)

O histórico e a observabilidade são **persistidos no banco (MySQL/Drizzle)** — nunca em memória de
processo. Tabelas (migration `0284`):

- **`institutional_consultations`** — id (=executionId), organization_id (tenant), user_id, question,
  normalized_question, answer, **status**, limitation_reason, context_package_version,
  context_replay_hash, execution_id, answer_id, replay_id, replay_of_execution_id, correlation_id,
  business_domain, task_type, documents_count, passages_count, retrieval/execution/total_duration_ms,
  context_snapshot (JSON versionado), error_code, error_message (sanitizada), created/started/completed/
  failed/updated_at. Índices: `(org)`, `(org, created_at)`, `(org, user_id, created_at)`,
  `(org, context_replay_hash)`, `(correlation_id)`, `(execution_id)`.
- **`institutional_consultation_sources`** — id, organization_id, consultation_id, document_id,
  document_version, document_title, document_type, authority, jurisdiction, binding_level, citation,
  passage, lineage, source_order. Índices: `(org)`, `(org, consultation_id)`.

O **ContextPackage** é persistido como snapshot versionado (`schemaVersion`, `contextReplayHash`,
documentos/citações/trechos críticos) — **não** como JSON opaco; os elementos auditáveis (documento,
versão, autoridade, jurisdição, binding level, citação, trecho, lineage, posição) permanecem
consultáveis também via a tabela de fontes.

### Estados da consulta

`pending → processing → completed | limited | failed`. **`limited`** = resposta **válida** sem base
documental suficiente (não é erro técnico). **`failed`** = falha técnica (com `error_code` + mensagem
sanitizada; nunca fica falsamente `completed`).

### Repository (`server/db/institutionalConsultations.ts`) — fonte de verdade

`ConsultationRepository`: createConsultation, markProcessing, completeConsultation (persiste fontes
ANTES de concluir), failConsultation, saveSources, findByIdForTenant, getSourcesForTenant, listByTenant,
listByUserForTenant, findReplayCandidate, verifyTenantOwnership. **Toda operação exige tenantId**;
nenhum método busca por id sem validar o tenant (boundary multi-tenant em Router → Service →
Repository → query). O adaptador **in-memory** (`InMemoryConsultationRepository`) é **exclusivo de
testes/dev sem banco** — nunca a fonte oficial em produção.

### Transação

`completeConsultation` persiste **resposta + métricas + fontes** e só então marca `completed`/`limited`;
em falha, `failConsultation` marca `failed`. Resposta e fontes nunca ficam parcialmente persistidas
como execução válida.

### Semântica de identidade

- **contextReplayHash** — identidade determinística do **contexto** (tenant, pergunta normalizada via
  trechos recuperados, município/estado, versões dos documentos, versão do ContextPackage). Identifica o
  contexto, **não** uma resposta específica.
- **executionId** — identifica uma **execução concreta**; único por (tenant, correlationId). Cada request
  novo gera nova execução, **mesmo com contexto idêntico**.
- **answerId** — identifica a **resposta persistida** (derivada do executionId, **não** do
  contextReplayHash). Contexto igual não implica resposta idêntica.
- **replayId** — identifica uma **operação de replay** institucional (só em replay real).
- **replayOfExecutionId** — aponta a **execução original** em um replay real.

### Replay

`replayConsultation` distingue **nova execução** (independente) de **replay real** (nova execução
vinculada à original: `replayOfExecutionId` + `replayId`, preservando contexto/versões/lineage) de
**reuso de resultado persistido**. **Não** há deduplicação automática irreversível: cada execução é
independente; `contextReplayHash` serve para comparação/auditoria (via `findReplayCandidate`).

### Comportamento após restart

O histórico não depende de memória de processo: após reiniciar o serviço, as consultas e fontes são
recuperadas do banco (validado por teste de restart lógico). Múltiplas instâncias compartilham a mesma
fonte de verdade.

## Segurança

- **Entrada sanitizada** (`sanitizeQuestion`) é apenas uma **camada auxiliar** — por si só **não impede
  prompt injection**. Mensagens de erro persistidas são sanitizadas (1ª linha, sem stack/segredos). Não
  se persistem segredos, credenciais, tokens nem stack traces expostos ao usuário.
- **Proteções reais (estruturais):** separação instrução/dado (prompt builder tipado — documentos são
  tratados como **evidência**, não podem alterar instruções do sistema); ContextPackage como evidência;
  ausência de execução autônoma de ferramentas; fluxo fechado pelo Orchestrator (sem acesso direto ao
  Corpus/AIExecutionEngine nem bypass do ContextPackage); validação de saída (Structured Output do
  engine); allowlist de capacidades (tarefa cognitiva fixa `LEGAL_ANALYSIS`); limites de tamanho;
  logging e auditoria persistida. Estas são camadas de mitigação — não uma garantia absoluta.

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
