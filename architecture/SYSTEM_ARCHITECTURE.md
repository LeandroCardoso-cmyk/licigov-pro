# LiciGov Pro — Arquitetura do Sistema

> Visão arquitetural completa do LiciGov Pro: componentes, fluxos e integrações.
> Versão: 2.9 | Atualizado em: 2026-07-17

---

## Visão Geral

O LiciGov Pro é construído sobre uma **arquitetura em camadas com DDD** (Domain-Driven Design), deployado no Railway como monolito modular.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                 │
│  React 19 SPA  (Vite + TanStack Query + shadcn/ui + Tailwind CSS)   │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ tRPC v11 (HTTP + WebSocket)
┌──────────────────────────▼──────────────────────────────────────────┐
│                       PRESENTATION LAYER                             │
│    tRPC Routers  ·  Zod Validation  ·  Express Middleware            │
│    Auth Middleware  ·  Rate Limiting  ·  CORS                        │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ Validated Context (userId, orgId, role)
┌──────────────────────────▼──────────────────────────────────────────┐
│                      APPLICATION LAYER                               │
│    Use Case Handlers  ·  Command/Query Handlers                      │
│    PolicyEngine  ·  Event Dispatchers                                │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ Domain objects
┌──────────────────────────▼──────────────────────────────────────────┐
│                        DOMAIN LAYER                                  │
│    Aggregates  ·  Entities  ·  Value Objects  ·  Domain Events       │
│    DocumentoLicitatorio  ·  Organization  ·  ImportSession           │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ Repository interfaces
┌──────────────────────────▼──────────────────────────────────────────┐
│                    INFRASTRUCTURE LAYER                              │
│    Drizzle ORM  ·  MySQL 8  ·  Outbox Worker  ·  Import Queue        │
│    FileStorage  ·  ConcurrencyService  ·  IntegrityService           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Componentes Principais

### 1. tRPC API Layer
- Routers modularizados por aggregate
- Context injetado via middleware (userId, organizationId, role)
- Validação de input com Zod
- Error handling uniforme

### 2. Domain Layer (DDD Aggregates)

#### Organization
- Root aggregate do multi-tenant
- Gerencia membros e papéis RBAC
- Emite eventos de membership via Outbox

#### DocumentoLicitatorio
- Aggregate central da plataforma
- Versionamento imutável de conteúdo
- State machine de workflow
- PolicyEngine para autorização granular

#### ImportSession
- Aggregate que representa uma sessão de importação
- Coordena Parser → Staging → Review → Promotion
- Confiança por item com proveniência completa

### 3. Infrastructure Services

#### Outbox Worker
- Polling de `outbox_events` pendentes
- Processamento garantido (at-least-once)
- Marcação de eventos como `processed` ou `failed`

#### Import Queue
- Fila in-process para sessões de importação
- Retry com backoff exponencial (3 tentativas)
- Dead Letter Queue para falhas persistentes

#### IntegrityService
- SHA-256 por versão de documento
- Fingerprinting em cadeia
- Verificação on-demand e em background

#### ConcurrencyService
- Soft locks (advisory) e Hard locks (exclusivos)
- Timeout automático (60min soft, 4h hard)
- Forçar liberação por admin com audit trail

---

## Modelo de Dados — Visão Geral

### Tabelas Principais

```
organizations (1)
    ├── organization_members (N) → users
    ├── documentos_licitatorios (N)
    │   ├── document_versions (N)
    │   ├── document_templates (N)
    │   ├── document_comments (N)
    │   ├── document_attachments (N)
    │   └── document_timeline (N)
    ├── import_sessions (N)
    │   └── import_staging (N)
    ├── activity_logs (N)
    └── outbox_events (N)
```

### Esquema de Migrações

| Faixa | Área | Migrações |
|---|---|---|
| 0001–0032 | Legacy (pre-rebuild) | — |
| 0033–0038 | Multi-tenant Foundation | organizations, members, RBAC, activity_logs |
| 0039–0042 | Hardening Multi-tenant | snapshots, outbox_v2, idempotency |
| 0043 | Optimistic Locking | version field |
| 0044–0049 | Core Documental | documentos, versions, workflow, templates, comments |
| 0050–0053 | Hardening Documental | policy, diff, retention, integrity |
| 0054–0055 | Import Foundation | import_sessions, import_staging |

---

## Fluxo de Request

### Request Autenticado Típico
```
1. Browser envia request tRPC com Bearer token
2. Express middleware valida JWT
3. tRPC context construído: { userId, organizationId, role, requestId, correlationId }
4. Zod valida input da procedure
5. Handler de use case executa lógica
6. Repositório Drizzle persiste com organizationId
7. Evento de domínio escrito no Outbox (mesma transação)
8. Resposta tipada retorna ao cliente
9. Outbox worker processa evento assincronamente
```

### Request de Importação
```
1. Usuário faz upload de arquivo
2. FileIngestionService valida MIME e tamanho
3. Arquivo persistido no storage
4. ImportSession criada com status 'uploaded'
5. Session enfileirada no ImportQueueService
6. Worker executa: parsing → staging → normalização → cálculo de confiança
7. Session muda para 'awaiting_review'
8. Usuário revisa e aprova
9. ImportStagingService promove ao domínio
```

---

## Deploy e Infraestrutura

### Railway
- **Serviço principal**: Node.js + Express + tRPC
- **Banco de dados**: MySQL 8 managed
- **Volume**: Para armazenamento de arquivos importados
- **Variáveis de ambiente**: Gerenciadas pelo Railway

### Environments
| Environment | Branch | URL |
|---|---|---|
| Production | main | licigov-pro.railway.app |
| Staging | develop | licigov-staging.railway.app |
| Development | local | localhost:3000 |

---

## Experience Architecture (RC-X.1)

Terceiro pilar arquitetural, ao lado do **Cognitive Architecture** e dos **Business Domains**: o
**Institutional Experience Framework** (`server/domain/experience/`) organiza permanentemente toda
a experiência do usuário — **sem** implementar UX definitiva, React, Design System ou IA.

```
InstitutionContext (imutável)
        │
        ▼
   ExperienceKernel ──► Capability Matrix ──► Workspace Registry
        │                                            │
        ├──► Navigation Builder (sidebar/topnav/quick actions/breadcrumbs/menus)
        ├──► Home Composer (widgets/cards/recentes/favoritos/workspaces)
        └──► Copilot EntryPoint (sem IA)
```

Princípios:
- **Nenhum módulo constrói menus/navegação/home diretamente.** Cada módulo registra apenas
  **Workspace + Capabilities + Actions + Routes**; o Framework monta a experiência dinamicamente.
- **Licenciamento & Multi-Tenant:** capacidade habilitada = módulo ativo **E** contratada; um
  workspace só aparece se todas as suas capacidades exigidas estiverem habilitadas. Cada tenant
  (município pequeno/grande, consórcio, câmara, autarquia) vê apenas o que contratou.
- **Explainability:** todo item de navegação explica por que apareceu, qual capacidade habilitou,
  qual módulo registrou, a qual workspace pertence e qual tenant autorizou.
- **Replay Safety / Determinismo / Observabilidade / Baixo Acoplamento** preservados.

Ver [docs/architecture/INSTITUTIONAL_EXPERIENCE_FRAMEWORK.md](../docs/architecture/INSTITUTIONAL_EXPERIENCE_FRAMEWORK.md).

---

## Decisões de Escalabilidade

### Estado Atual (MVP)
- Monolito modular — toda lógica em um processo
- Fila de importação in-process (não sobrevive a restart)
- Sem cache de queries (React Query é o único cache)

### Roadmap de Escalabilidade
- **Sprint 4**: Redis para filas e cache (sessões de importação sobrevivem a restarts)
- **Sprint 5**: CDN para documentos renderizados (PDF/DOCX)
- **Sprint 6**: Read replicas MySQL para queries de relatório
- **Futuro**: Considerar microserviços apenas se necessário (não prematuro)

---

*Para domínio: [architecture/DOMAIN_OVERVIEW.md](./DOMAIN_OVERVIEW.md)*
*Para multi-tenant: [architecture/MULTI_TENANT_MODEL.md](./MULTI_TENANT_MODEL.md)*
*Para motor documental: [architecture/DOCUMENT_ENGINE.md](./DOCUMENT_ENGINE.md)*
