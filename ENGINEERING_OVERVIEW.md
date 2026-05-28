# LiciGov Pro — Engineering Overview

> Visão técnica completa do sistema: stack, decisões arquiteturais e padrões de engenharia.
> Atualizado em: 2026-05-27 | Versão: 2.8-stable

---

## Stack Tecnológico

### Backend
| Componente | Tecnologia | Versão | Justificativa |
|---|---|---|---|
| Linguagem | TypeScript | 5.x | Type-safety end-to-end, ecossistema maduro |
| Runtime | Node.js | 20+ LTS | Compatibilidade, performance, Railway-native |
| API Layer | tRPC v11 | 11.x | Type-safety total, zero codegen, RPC sobre HTTP |
| Web Framework | Express | 4.x | Middleware maduro, integração com tRPC |
| ORM | Drizzle ORM | latest | Type-safe SQL, migrations explícitas, MySQL nativo |
| Banco de Dados | MySQL | 8.x | Suporte a JSON nativo, FULLTEXT, transactions ACID |
| Filas | In-process (queue) | — | Simplicidade inicial; migração para Redis/SQS na Sprint 4 |
| Infraestrutura | Railway | — | Deploy automatizado, secrets gerenciados, MySQL managed |

### Frontend
| Componente | Tecnologia | Versão | Justificativa |
|---|---|---|---|
| Framework | React | 19 | Concurrent features, RSC-ready |
| Build | Vite | latest | HMR rápido, ESM nativo |
| Roteamento | React Router | v6+ | SPA com rotas aninhadas |
| Estilo | Tailwind CSS | 3.x | Utility-first, design system consistente |
| Componentes | shadcn/ui | latest | Acessibilidade, customizável |
| State | React Query (TanStack) | 5.x | Cache server-state com tRPC client |

### Testes
| Camada | Ferramenta | Cobertura alvo |
|---|---|---|
| Unitários | Vitest | ≥ 80% |
| Integração | Vitest + testcontainers | Agregados e repositórios |
| E2E | — | Sprint 5 (planejado) |

---

## Arquitetura Geral

O LiciGov Pro segue uma **arquitetura em camadas com DDD** (Domain-Driven Design):

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                        │
│    React 19 SPA  ←→  tRPC v11 Routers  ←→  Express HTTP    │
├─────────────────────────────────────────────────────────────┤
│                   Application Layer                          │
│    Use Cases · Application Services · Command Handlers       │
├─────────────────────────────────────────────────────────────┤
│                      Domain Layer                            │
│    Aggregates · Entities · Value Objects · Domain Events     │
├─────────────────────────────────────────────────────────────┤
│                  Infrastructure Layer                        │
│    Drizzle ORM · MySQL · Outbox · FileStorage · Queues      │
└─────────────────────────────────────────────────────────────┘
```

### Multi-tenant
- `organizationId` é obrigatório em **todos** os aggregates e queries
- Isolamento garantido por repositório: toda query filtra por `organizationId`
- RBAC por papel dentro da organização: `viewer < operator < manager < admin < owner`

---

## Decisões Arquiteturais Chave

### 1. MySQL em vez de PostgreSQL
- Railway oferece MySQL managed com menor latência na região SA
- Drizzle ORM tem suporte excelente para MySQL 8 (JSON, FULLTEXT)
- Time familiarizado com MySQL; PostgreSQL seria incubação

### 2. tRPC v11 em vez de REST ou GraphQL
- Type-safety total entre servidor e cliente sem codegen
- Procedures como contratos: nenhum campo fora de schema
- Melhor DX para frontend React com React Query integration nativa

### 3. Outbox Pattern
- Garante consistência entre mutações de banco e emissão de eventos
- Eventos não são perdidos mesmo em falhas de processo
- Fundamental para conformidade com auditoria legal

### 4. Staging antes de Domínio (Import)
- Raw extraction NUNCA persiste diretamente no domínio
- Staging layer permite validação, normalização e revisão humana
- Rastreabilidade completa de origem de cada dado

### 5. Optimistic Locking
- Campo `version` em entidades mutáveis evita lost-updates concorrentes
- Complementado por soft/hard locks do ConcurrencyService para UX

### 6. Retenção Documental como Código
- RetentionPolicy é um value object do domínio, não config externa
- 7 classes de retenção cobrindo requisitos da Lei 14.133/2021 e LGPD
- Purge automatizado respeitando janelas legais

---

## Padrões de Código

### Nomenclatura
```typescript
// Aggregates: PascalCase singular
class DocumentoLicitatorio { }
class Organization { }

// Repositórios: interface + implementação
interface DocumentoLicitatorioRepository { }
class DrizzleDocumentoLicitatorioRepository implements DocumentoLicitatorioRepository { }

// tRPC procedures: camelCase hierárquico
documents.create
documents.versions.list
imports.session.start
imports.staging.review
```

### Estrutura de Arquivos
```
server/
├── domain/
│   ├── [aggregate]/
│   │   ├── [aggregate].aggregate.ts
│   │   ├── [aggregate].repository.ts
│   │   ├── [aggregate].events.ts
│   │   └── [aggregate].errors.ts
│   └── shared/
│       ├── value-objects/
│       └── domain-events/
├── application/
│   └── [aggregate]/
│       ├── [use-case].command.ts
│       └── [use-case].handler.ts
├── infrastructure/
│   ├── db/
│   │   ├── schema/
│   │   └── repositories/
│   └── services/
└── presentation/
    └── trpc/
        └── routers/
```

### Princípios de Segurança
- Nunca expor IDs internos do banco; usar UUIDs externos
- Validação de entrada com Zod em todas as procedures tRPC
- `organizationId` validado contra claims do JWT em cada request
- Logs de auditoria para todas as mutações de documento

---

## Modelo de Dados Principal

### Entidades Core
```sql
-- Organizations (raiz multi-tenant)
organizations (id, name, cnpj, plan, created_at)

-- Membros com papéis
organization_members (id, organization_id, user_id, role, joined_at)

-- Documentos licitatórios
documentos_licitatorios (
  id, organization_id, type, title, status,
  current_version, lock_type, lock_owner_id,
  retention_class, integrity_hash, created_at
)

-- Versões imutáveis
document_versions (
  id, document_id, organization_id, version_number,
  content_json, diff_from_previous, author_id,
  fingerprint_sha256, created_at
)

-- Sessões de importação
import_sessions (
  id, organization_id, import_type, status,
  file_path, parser_mime, total_rows,
  confidence_summary, created_at
)
```

---

## Performance e Escalabilidade

### Índices Críticos
- `(organization_id, status)` em documentos_licitatorios
- `(organization_id, created_at DESC)` em activity_logs
- `(document_id, version_number)` em document_versions
- TTL index em idempotency_keys (cleanup automático)

### Limites Conhecidos (Sprint 2.8)
- Fila de importação é in-process (não sobrevive a restart)
- Render de DOCX/PDF é síncrono (bloqueia request > 5s para docs grandes)
- Não há cache de queries ainda (React Query é o único cache)

### Plano de Escalabilidade
- Sprint 4: Redis para filas de importação e cache de queries
- Sprint 5: CDN para documentos renderizados
- Sprint 6: Read replicas MySQL para queries de relatório

---

## Conformidade Legal

### Lei 14.133/2021
- Todos os tipos de documento (TR, ETP, Edital, Contrato) são suportados
- Workflow reflete os estágios legais de aprovação
- Retenção mínima de 7 anos para contratos (art. 169)

### LGPD (Lei 13.709/2018)
- RetentionPolicy com purge automatizado
- ActivityLog com TTL de 2 anos por padrão
- Dados pessoais isolados por `organizationId`

### TCU / CGU
- ActivityLog imutável com snapshots before/after para auditoria
- IntegrityService com SHA-256 previne adulteração retroativa
- ExtractionProvenance rastreia origem de cada dado importado

---

*Para decisões arquiteturais detalhadas, ver: [governance/ARCHITECTURAL_DECISIONS.md](governance/ARCHITECTURAL_DECISIONS.md)*
*Para padrões de código, ver: [governance/ENGINEERING_STANDARDS.md](governance/ENGINEERING_STANDARDS.md)*
