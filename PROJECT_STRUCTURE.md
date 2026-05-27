# LiciGov Pro — Project Structure

> Referência completa da estrutura de diretórios e finalidade de cada pasta

---

## Visão Geral

O projeto é organizado em três grandes áreas:
1. **`src/`** — Código-fonte da aplicação (TypeScript)
2. **Documentação e Governança** — Artefatos de conhecimento e decisão
3. **Infraestrutura de Desenvolvimento** — Configurações, migrações, testes

---

## Estrutura Completa do Repositório

```
licigov-pro/
│
├── src/
│   ├── domain/
│   │   ├── organization/               # Aggregate Organization + Members
│   │   │   ├── organization.aggregate.ts
│   │   │   ├── organization-member.aggregate.ts
│   │   │   ├── organization.repository.ts
│   │   │   └── organization.events.ts
│   │   ├── document/                   # Aggregate DocumentoLicitatorio
│   │   │   ├── documento-licitatorio.aggregate.ts
│   │   │   ├── documento-licitatorio.repository.ts
│   │   │   ├── document-template.aggregate.ts
│   │   │   ├── document-comment.aggregate.ts
│   │   │   └── documento.events.ts
│   │   ├── import/                     # Aggregate ImportSession
│   │   │   ├── import-session.aggregate.ts
│   │   │   ├── import-session.repository.ts
│   │   │   └── import.events.ts
│   │   └── shared/                     # Value objects, tipos compartilhados
│   │       ├── activity-log.aggregate.ts
│   │       ├── outbox.aggregate.ts
│   │       └── types.ts
│   │
│   ├── application/
│   │   ├── documents/                  # Use cases documentais
│   │   │   ├── create-document.usecase.ts
│   │   │   ├── submit-for-review.usecase.ts
│   │   │   ├── approve-document.usecase.ts
│   │   │   └── export-document.usecase.ts
│   │   ├── imports/                    # Use cases de importação
│   │   │   ├── start-import-session.usecase.ts
│   │   │   ├── process-import.usecase.ts
│   │   │   └── approve-import.usecase.ts
│   │   └── policies/                   # PolicyEngine, RetentionPolicy
│   │       ├── policy-engine.ts
│   │       └── retention-policy.ts
│   │
│   ├── infrastructure/
│   │   ├── db/
│   │   │   ├── schema/                 # Drizzle schema definitions
│   │   │   ├── migrations/             # SQL migrations (0033+)
│   │   │   └── repositories/          # Implementações concretas
│   │   ├── parsers/                    # CSV, XLSX, PDF, DOCX parsers
│   │   │   ├── csv.parser.ts
│   │   │   ├── xlsx.parser.ts
│   │   │   ├── pdf.parser.stub.ts
│   │   │   ├── docx.parser.stub.ts
│   │   │   └── parser-registry.ts
│   │   ├── rendering/                  # HTML, DOCX, PDF renderers
│   │   │   ├── html.renderer.ts
│   │   │   ├── docx.renderer.ts
│   │   │   └── pdf.renderer.ts
│   │   ├── services/                   # Serviços de infraestrutura
│   │   │   ├── integrity.service.ts    # SHA-256, fingerprinting
│   │   │   ├── diff.engine.ts          # Diff semântico
│   │   │   ├── concurrency.service.ts  # Locks soft/hard
│   │   │   ├── attachment.service.ts   # Gestão de anexos
│   │   │   └── render.service.ts
│   │   └── queue/                      # Filas e processamento assíncrono
│   │       ├── import-queue.service.ts
│   │       └── outbox-processor.ts
│   │
│   └── presentation/
│       ├── routers/                    # tRPC routers
│       │   ├── documents.router.ts
│       │   ├── imports.router.ts
│       │   ├── organizations.router.ts
│       │   └── admin.router.ts
│       └── pages/                      # React 19 pages
│           ├── documents/
│           ├── imports/
│           └── organizations/
│
├── docs/                               # Documentação do projeto
│   ├── README.md                       # Padrão documental e convenções
│   ├── technical/                      # Docs técnicas: APIs, schemas, erros
│   ├── functional/                     # Docs funcionais: fluxos, regras de negócio
│   ├── domain/                         # Domínio jurídico-operacional
│   ├── imports/                        # Motor de importação
│   ├── security/                       # Segurança, RBAC, multi-tenant
│   ├── workflows/                      # State machines, fluxos documentais
│   ├── integrations/                   # Integrações externas (PNCP, CATMAT)
│   ├── infrastructure/                 # Railway, MySQL, Redis
│   ├── observability/                  # Logs, métricas, rastreamento
│   ├── catmat/                         # Catálogo de materiais CATMAT/CATSER
│   ├── ai/                             # IA, scoring, sugestões
│   └── legal/                          # Referências legais
│
├── governance/                         # Governança de engenharia
│   ├── GOVERNANCE.md                   # Documento principal de governança
│   ├── ENGINEERING_STANDARDS.md        # Padrões de código e arquitetura
│   ├── DOCUMENT_POLICY.md             # Política documental
│   ├── ARCHITECTURAL_DECISIONS.md      # Registro de decisões (ADRs)
│   ├── decisions/                      # ADRs individuais
│   ├── standards/                      # Padrões específicos por área
│   ├── conventions/                    # Convenções de nomenclatura e estrutura
│   ├── policies/                       # Políticas operacionais
│   ├── operating-model/                # Modelo operacional de desenvolvimento
│   └── guidelines/                     # Guias práticos
│
├── architecture/                       # Visões arquiteturais
│   ├── SYSTEM_ARCHITECTURE.md         # Arquitetura completa do sistema
│   ├── DOMAIN_OVERVIEW.md             # Visão do domínio DDD
│   ├── MULTI_TENANT_MODEL.md          # Modelo multi-tenant e RBAC
│   ├── DOCUMENT_ENGINE.md             # Motor documental
│   ├── IMPORT_ENGINE.md               # Motor de importação
│   ├── domain/                         # Diagramas e docs de domínio
│   ├── backend/                        # Arquitetura de backend
│   ├── frontend/                       # Arquitetura de frontend
│   ├── database/                       # Modelo de dados, índices
│   ├── integrations/                   # Integrações externas
│   ├── workflows/                      # Máquinas de estado
│   ├── imports/                        # Pipeline de importação
│   ├── rendering/                      # Pipeline de renderização
│   ├── observability/                  # Observabilidade
│   └── security/                       # Segurança por camada
│
├── sprints/                            # Histórico de sprints
│   ├── sprint-1/                       # Multi-tenant Foundation
│   ├── sprint-1.5/                     # Hardening Multi-tenant
│   ├── sprint-1.8/                     # Preparação Core Documental
│   ├── sprint-2/                       # Core Documental
│   ├── sprint-2.5/                     # Hardening Documental
│   ├── sprint-2.8/                     # Import Foundation Layer
│   └── sprint-3/                       # CATMAT Integration (planejado)
│
├── prompts/                            # Prompts de IA para desenvolvimento
│   ├── PROMPT_GUIDELINES.md           # Como criar e usar prompts
│   ├── PROMPT_HISTORY_INDEX.md        # Índice histórico de prompts
│   ├── architecture/                   # Prompts de arquitetura
│   ├── implementation/                 # Prompts de implementação
│   ├── governance/                     # Prompts de governança
│   ├── imports/                        # Prompts do motor de importação
│   ├── catmat/                         # Prompts CATMAT
│   ├── ai/                             # Prompts de IA/ML
│   ├── workflows/                      # Prompts de workflows
│   └── historical/                     # Prompts históricos arquivados
│
├── releases/                           # Gestão de releases
│   ├── RELEASE_STRATEGY.md            # Estratégia de releases
│   ├── VERSIONING_POLICY.md           # Política de versionamento semântico
│   ├── snapshots/                      # Snapshots de estado por versão
│   ├── release-notes/                  # Notas de cada release
│   ├── production/                     # Artefatos de produção
│   └── staging/                        # Artefatos de staging
│
├── roadmap/                            # Roadmap de produto
│   ├── PRODUCT_ROADMAP.md             # Roadmap completo
│   ├── BACKLOG_STRATEGY.md            # Estratégia de backlog
│   ├── TECHNICAL_DEBT.md              # Dívida técnica
│   ├── short-term/                     # Sprint atual + próximas 2
│   ├── medium-term/                    # Próximos 3-6 meses
│   ├── long-term/                      # 6+ meses
│   └── backlog/                        # Itens não priorizados
│
├── exports/                            # Artefatos exportados
│   ├── reports/                        # Relatórios gerados
│   ├── schemas/                        # Schemas JSON/OpenAPI exportados
│   ├── diagrams/                       # Diagramas exportados (PNG, SVG)
│   ├── migrations/                     # SQL de migrações exportadas
│   └── snapshots/                      # Snapshots de dados para testes
│
├── backups/                            # Backup e recuperação
│   ├── BACKUP_POLICY.md               # Política de backup
│   ├── RECOVERY_GUIDE.md              # Guia de recuperação
│   └── DISASTER_RECOVERY.md           # Plano de disaster recovery
│
├── changelog/                          # Histórico de mudanças
│   ├── CHANGELOG.md                    # Log principal por sprint/versão
│   └── RELEASE_HISTORY.md             # Histórico de releases para produção
│
├── MASTER_INDEX.md                     # Índice mestre — entrada principal
├── PROJECT_STRUCTURE.md               # Este arquivo
├── ENGINEERING_OVERVIEW.md            # Visão técnica completa
├── SPRINT_HISTORY.md                  # Histórico consolidado de sprints
├── package.json
├── tsconfig.json
├── drizzle.config.ts
└── .env.example
```

---

## Convenções de Organização

### Regras de Nomenclatura de Arquivos
- Arquivos markdown: `SCREAMING_SNAKE_CASE.md` para docs raiz; `README.md` para docs de pasta
- Arquivos TypeScript de domínio: `kebab-case.aggregate.ts`, `kebab-case.repository.ts`
- Migrações SQL: `NNNN_descricao_curta.sql` onde NNNN é sequencial desde 0033

### Regras de Conteúdo
- Todo diretório de documentação deve ter `README.md`
- ADRs individuais em `governance/decisions/ADR-NNNN-titulo.md`
- Resultados de sprint em `sprints/sprint-X/TECHNICAL_REPORT.md`

### Princípio de Colocação
- **Código**: apenas em `src/`
- **Decisões técnicas**: `governance/decisions/`
- **Diagramas**: `exports/diagrams/`
- **Dados de produção**: nunca no repositório

---

*Atualizar este arquivo sempre que uma nova pasta ou convenção for introduzida.*
