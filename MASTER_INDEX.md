# LiciGov Pro — Master Index

> Versão: 0.22.0 | Branch: claude/rc-5.1 | Atualizado: 2026-07-17

LiciGov Pro é um SaaS brasileiro de gestão de licitações públicas, fundamentado na Lei 14.133/2021 (Nova Lei de Licitações). Oferece fluxo documental completo, multi-tenant com RBAC granular, motor de importação de planilhas e PDFs, e renderização de documentos em HTML/DOCX/PDF.

---

## Navegação Rápida

| Categoria | Arquivo Principal | Descrição |
|-----------|-------------------|-----------|
| **📜 Constituição** | [docs/architecture/PRODUCT_NORTH_STAR.md](docs/architecture/PRODUCT_NORTH_STAR.md) | **Filosofia permanente do produto — fonte oficial da verdade, com precedência sobre docs de visão anteriores** |
| **Arquitetura oficial** | Cognitive Kernel + **Business Domains** + Centro de Operações | A operação ocorre exclusivamente pelos Business Domains (Processo Licitatório, Contratação Direta, Parecer Jurídico, Contratos, Centro de Operações) |
| **Legado (compatibilidade)** | [docs/architecture/LEGACY_INVENTORY.md](docs/architecture/LEGACY_INVENTORY.md) | **Módulos legados permanecem apenas por compatibilidade — fora da navegação oficial (RC-2)** |
| **Document Engine** | [docs/architecture/DOCUMENT_ENGINE_OFFICIAL.md](docs/architecture/DOCUMENT_ENGINE_OFFICIAL.md) | **Pipeline ÚNICO oficial de documentos (DOCX/PDF, versionado) — componente permanente do Kernel (RC-3)** |
| **Infraestrutura do Kernel** | [docs/architecture/KERNEL_INFRASTRUCTURE.md](docs/architecture/KERNEL_INFRASTRUCTURE.md) | **AIExecutionEngine + Provider Adapter + OfficialDocumentLifecycleService + Storage Service + MySQL + S3 + JWT — componentes permanentes com fronteiras OBRIGATÓRIAS aplicadas por testes (RC-3.5 → RC-3.5.2)** |
| **Fronteiras arquiteturais** | [server/kernel/architecture/legacyBoundaries.ts](server/kernel/architecture/legacyBoundaries.ts) | **Ponto ÚNICO de exceções (allowlists de Provider/Document/Legacy/AWS) — toda fronteira validada por `rc352-boundary-enforcement.test.ts` (RC-3.5.2)** |
| **🧠 Fundação Cognitiva** | [docs/architecture/COGNITIVE_ARCHITECTURE.md](docs/architecture/COGNITIVE_ARCHITECTURE.md) | **AIExecutionEngine = ÚNICO ponto de entrada cognitiva (RC-4.1). Cognitive Tasks, Pipeline, Cognitive Response universal, Replay Hash semântico, validação obrigatória. executeAITask aposentado; invokeLLM só no legado; Mock Provider ativo (RC-4.0 → RC-4.1)** |
| Pipeline Cognitivo | [docs/architecture/COGNITIVE_PIPELINE.md](docs/architecture/COGNITIVE_PIPELINE.md) | As etapas observáveis do `executeCognitiveTask` (com raciocínio institucional) |
| Raciocínio Institucional | [docs/architecture/INSTITUTIONAL_REASONING.md](docs/architecture/INSTITUTIONAL_REASONING.md) | **Institutional Reasoning Framework: Reasoning Plan (12 etapas), Institutional Rules, Explainability expandida (RC-4.2)** |
| 🚀 Production Readiness | [docs/architecture/PRODUCTION_READINESS.md](docs/architecture/PRODUCTION_READINESS.md) | **Observabilidade persistente, Health Check institucional, validação de ambiente, Storage/Provider readiness (RC-4.2.1)** |
| 🩺 Production Monitoring | [docs/architecture/PRODUCTION_MONITORING.md](docs/architecture/PRODUCTION_MONITORING.md) | **Monitor Operacional Institucional: Health Engine, Health Score determinístico, endpoint /system/health (RC-4.2.2)** |
| 🏛️ Conhecimento Institucional | [docs/architecture/INSTITUTIONAL_OPERATING_MODEL.md](docs/architecture/INSTITUTIONAL_OPERATING_MODEL.md) | **Institutional Operating Model: ontologia do Departamento de Licitações (papéis, objetos, estados, eventos, dependências, regras) — declarativa e determinística (RC-4.3)** |
| 🔗 Integração de Ontologias | [docs/architecture/ONTOLOGY_INTEGRATION_LAYER.md](docs/architecture/ONTOLOGY_INTEGRATION_LAYER.md) | **Camada semântica que conecta as ontologias operacional e jurídica (Semantic Links, cross references, mapa semântico, consultas) — desacoplada e determinística (RC-4.4.1)** |
| 📚 Fundação de Conhecimento Jurídico | [docs/architecture/LEGAL_KNOWLEDGE_FOUNDATION.md](docs/architecture/LEGAL_KNOWLEDGE_FOUNDATION.md) | **Camada estrutural para qualquer conhecimento jurídico futuro (unidades, referências, versionamento, conflitos, projeção, consultas) — SEM Lei 14.133; multi-tenant, replay-safe (RC-4.5)** |
| 🗂️ Framework de Corpus Institucional | [docs/architecture/INSTITUTIONAL_CORPUS_FRAMEWORK.md](docs/architecture/INSTITUTIONAL_CORPUS_FRAMEWORK.md) | **Organização permanente do conhecimento: Corpus, Coleções, Registry, Hierarquia configurável, integração com a Legal Knowledge Foundation, projeção KG — SEM conteúdo jurídico; multi-tenant, replay-safe, append-only (RC-4.5.1)** |
| 📦 Pacote do Corpus Federal | [docs/architecture/FEDERAL_PROCUREMENT_CORPUS_PACKAGE.md](docs/architecture/FEDERAL_PROCUREMENT_CORPUS_PACKAGE.md) | **Primeiro pacote oficial instalável: Corpus Manifest, Corpus Package (integrity/checksums/lifecycle), 5 coleções federais vazias (Lei 14.133, Decretos, IN SEGES, AGU, TCU), Registry, validação e projeção KG — SEM conteúdo jurídico; multi-tenant, replay-safe (RC-4.6)** |
| ⚖️📐 Fundação Normativa (Lei 14.133) | [docs/architecture/FEDERAL_PROCUREMENT_CORPUS_FOUNDATION.md](docs/architecture/FEDERAL_PROCUREMENT_CORPUS_FOUNDATION.md) | **Estrutura normativa permanente da Lei nº 14.133: hierarquia oficial (Lei→Item), árvore estrutural (nós sem texto), cross references, projeção KG, queries — knowledgeUnitId null; genérica para qualquer norma; multi-tenant, replay-safe (RC-4.6.1)** |
| 🔗⚖️ Knowledge Binding | [docs/architecture/KNOWLEDGE_BINDING_FRAMEWORK.md](docs/architecture/KNOWLEDGE_BINDING_FRAMEWORK.md) | **Liga NormativeNode ↔ LegalKnowledgeUnit: binding (6 tipos), versionamento append-only, registry, resolver, projeção KG, queries, explainability — SEM conteúdo jurídico; multi-tenant, replay-safe, auditável (RC-4.6.2)** |
| 🧩📚 Framework de Conhecimento | [docs/architecture/INSTITUTIONAL_KNOWLEDGE_FRAMEWORK.md](docs/architecture/INSTITUTIONAL_KNOWLEDGE_FRAMEWORK.md) | **Padrão genérico de todo conhecimento institucional: KnowledgeDocument, 20 blocos cognitivos, quality/health, renderer (6 visões), lifecycle, versionamento append-only, registry, projeção KG — última RC de infraestrutura cognitiva; SEM conteúdo jurídico; multi-tenant, replay-safe (RC-4.7)** |
| 🏭📚 Pipeline de Conhecimento | [docs/architecture/INSTITUTIONAL_KNOWLEDGE_PIPELINE.md](docs/architecture/INSTITUTIONAL_KNOWLEDGE_PIPELINE.md) | **Orquestra o ciclo de vida do conhecimento: 16 estágios, quality gates obrigatórios, validation engine, publication engine, change detection (diff/upgrade/rollback), projeção KG — todo corpus nasce por aqui; SEM conteúdo jurídico; replay-safe, approval-aware, governável (RC-4.8)** |
| 📜🏛️ Corpus Oficial (Federal+PR+Moreira Sales) | [docs/architecture/OFFICIAL_KNOWLEDGE_CORPUS.md](docs/architecture/OFFICIAL_KNOWLEDGE_CORPUS.md) | **Primeiro corpus OFICIAL com texto real verbatim (Lei 14.133, Decreto 11.462, IN SEGES 65, LC 123, Manual TCU, TCE-PR, Prejulgado 27, Lei Municipal 769) via pipeline existente; hierarquia Federal→Estado→Município; classificação, resolução por tenant, quality gates (perfil oficial) — SEM RAG/IA/chat; multi-tenant, replay-safe (RC-4.9 / RC-4.9.1)** |
| 🔌🧠 Integração Kernel ↔ Corpus | [docs/architecture/INSTITUTIONAL_KNOWLEDGE_INTEGRATION.md](docs/architecture/INSTITUTIONAL_KNOWLEDGE_INTEGRATION.md) | **Única camada que integra o Kernel Cognitivo ao Official Knowledge Corpus: InstitutionalContextResolver, KnowledgeRetrievalService, ContextPackage (imutável); Orchestrator resolve → AIExecutionEngine consome — baixo acoplamento, isolamento multi-tenant, replay-safe; SEM IA/chat/RAG paralelo (RC-5.0)** |
| ❓ Business Domain "Tirar Dúvidas" | [docs/architecture/BUSINESS_DOMAIN_TIRAR_DUVIDAS.md](docs/architecture/BUSINESS_DOMAIN_TIRAR_DUVIDAS.md) | **Primeira funcionalidade visível: consulta normativa institucional (não é chat). Servidor pergunta → fluxo institucional (ContextPackage → engine) → resposta fundamentada/explicável/auditável; página + menu; multi-tenant, replay-safe; reutiliza integralmente a infra existente (RC-5.1)** |
| 🖥️ Framework de Experiência | [docs/architecture/INSTITUTIONAL_EXPERIENCE_FRAMEWORK.md](docs/architecture/INSTITUTIONAL_EXPERIENCE_FRAMEWORK.md) | **Terceiro pilar: Experience Kernel, Institution Context (imutável), Capability Matrix, Workspace Registry, Navigation Builder, Home Composer, Copilot EntryPoint — navegação/home montadas dinamicamente; SEM UX definitiva/IA; multi-tenant, replay-safe, explicável (RC-X.1)** |
| 🚀 Framework de Bootstrap | [docs/architecture/INSTITUTIONAL_BOOTSTRAP_FRAMEWORK.md](docs/architecture/INSTITUTIONAL_BOOTSTRAP_FRAMEWORK.md) | **Camada de inicialização: Bootstrap Kernel, Pipeline declarativo, Dependency Graph (ordem determinística, sem ciclos), Platform State, Registry, Health, Reload — orquestra os três pilares; SEM regra de negócio/IA; multi-tenant, replay-safe (RC-X.2)** |
| ✅ Validação da Ontologia | [docs/architecture/INSTITUTIONAL_ONTOLOGY_VALIDATION.md](docs/architecture/INSTITUTIONAL_ONTOLOGY_VALIDATION.md) | **Validação exaustiva: 20 cenários representáveis, cobertura 100%, zero ciclos, resiliência (RC-4.3.1)** |
| ⚖️ Ontologia Jurídica | [docs/architecture/INSTITUTIONAL_LEGAL_ONTOLOGY.md](docs/architecture/INSTITUTIONAL_LEGAL_ONTOLOGY.md) | **Estrutura do conhecimento jurídico (tipos normativos, hierarquia, estrutura interna, conceitos, relacionamentos, classificações) — independente de lei específica (RC-4.4)** |
| AIExecutionEngine | [docs/architecture/AI_EXECUTION_ENGINE.md](docs/architecture/AI_EXECUTION_ENGINE.md) | Contrato do cérebro cognitivo (única porta de IA) |
| Arquitetura | [architecture/SYSTEM_ARCHITECTURE.md](architecture/SYSTEM_ARCHITECTURE.md) | Visão completa do sistema |
| Domínio | [architecture/DOMAIN_OVERVIEW.md](architecture/DOMAIN_OVERVIEW.md) | Modelo de domínio DDD |
| Multi-tenant | [architecture/MULTI_TENANT_MODEL.md](architecture/MULTI_TENANT_MODEL.md) | Isolamento e RBAC |
| Motor Documental | [architecture/DOCUMENT_ENGINE.md](architecture/DOCUMENT_ENGINE.md) | Versionamento, workflow, diff |
| Motor de Importação | [architecture/IMPORT_ENGINE.md](architecture/IMPORT_ENGINE.md) | Parsers, staging, canonicalização |
| Governança | [governance/GOVERNANCE.md](governance/GOVERNANCE.md) | Decisões e padrões |
| Engenharia | [governance/ENGINEERING_STANDARDS.md](governance/ENGINEERING_STANDARDS.md) | Padrões técnicos |
| Sprints | [SPRINT_HISTORY.md](SPRINT_HISTORY.md) | Histórico completo |
| Roadmap | [roadmap/PRODUCT_ROADMAP.md](roadmap/PRODUCT_ROADMAP.md) | Plano de produto |
| Changelog | [changelog/CHANGELOG.md](changelog/CHANGELOG.md) | Histórico de mudanças |

---

## Estrutura do Projeto

```
licigov-pro/
├── src/                    # Código-fonte (TypeScript)
│   ├── domain/             # Aggregates, entidades, value objects
│   ├── application/        # Use cases, serviços de aplicação
│   ├── infrastructure/     # DB, filas, storage
│   └── presentation/       # tRPC routers, React pages
├── docs/                   # Documentação técnica e funcional
├── governance/             # Governança arquitetural e de produto
├── architecture/           # Visões arquiteturais detalhadas
├── sprints/                # Histórico e planejamento de sprints
├── prompts/                # Prompts de IA para desenvolvimento
├── releases/               # Estratégia e histórico de releases
├── roadmap/                # Roadmap de produto
├── exports/                # Schemas, diagramas, relatórios exportados
├── backups/                # Políticas de backup e recuperação
└── changelog/              # Log de mudanças
```

---

## Stack Tecnológico

| Camada | Tecnologia | Versão |
|--------|------------|--------|
| API | tRPC | v11 |
| ORM | Drizzle ORM | latest |
| Banco de Dados | MySQL (Railway) — **oficial e único** | 8.x |
| Storage | Amazon S3 (via Storage Service) — **único ponto de acesso** | - |
| IA | Gemini via AIExecutionEngine + Provider Adapter | 2.5 |
| Frontend | React | 19 |
| Backend | Express | 4.x |
| Infraestrutura | Railway | - |
| Testes | Vitest | latest |
| Runtime | Node.js | 20+ |

---

## Domínio de Negócio

### Fundamento Legal
- **Lei 14.133/2021** — Nova Lei de Licitações e Contratos Administrativos
- **Decreto 11.246/2022** — Regulamentação do PNCP
- **Instrução Normativa SEGES/ME 65/2021** — Estudos preliminares
- **Instrução Normativa SEGES/ME 58/2022** — TR e ETP

### Aggregates do Domínio
1. **Organization** — Entidade pública contratante (multi-tenant root)
2. **OrganizationMember** — Usuário com papel na organização
3. **DocumentoLicitatorio** — Documento versionado (TR, ETP, Edital, Contrato)
4. **ImportSession** — Sessão de importação de dados externos
5. **DocumentTemplate** — Templates reutilizáveis
6. **ActivityLog** — Auditoria imutável com snapshots

---

## Estado Atual do Projeto (Sprint 2.8)

### Migrações Executadas
- `0033–0038`: Multi-tenant foundation (Organizations, Members, RBAC, ActivityLogs v2)
- `0039–0042`: Hardening multi-tenant (snapshots imutáveis, Outbox v2, idempotency TTL)
- `0043`: Optimistic locking (version field em processes)
- `0044–0049`: Core documental (DocumentoLicitatorio, workflow, templates, comments)
- `0050–0053`: Hardening documental (PolicyEngine, DiffEngine, RetentionPolicy, IntegrityService)
- `0054–0055`: Import foundation (ImportSession, staging tables)

### Cobertura de Testes
| Sprint | Testes |
|--------|--------|
| Sprint 2 | 55 |
| Sprint 2.5 | 76 |
| Sprint 2.8 | 99 |

---

## Roadmap de Alto Nível

| Fase | Sprint | Foco Principal |
|------|--------|----------------|
| Foundation | 1 – 1.8 | Multi-tenant, RBAC, segurança |
| Core Documental | 2 – 2.5 | Documentos, workflow, políticas |
| Import Engine | 2.8 | Parsers, staging, canonicalização |
| CATMAT Integration | 3 | Catálogo de materiais e serviços |
| AI Enrichment | 4 | Sugestões IA, scoring de conformidade |
| Public Portal | 5 | Portal público PNCP |
| Production Launch | 6 | GA, billing, SLAs |

---

## Links de Referência Externos

- [Lei 14.133/2021 — Planalto](https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm)
- [PNCP — Portal Nacional de Contratações Públicas](https://www.gov.br/pncp)
- [CATMAT — Catálogo de Materiais](https://www.comprasgovernamentais.gov.br/paginas/catmat)
- [tRPC v11 Docs](https://trpc.io)
- [Drizzle ORM Docs](https://orm.drizzle.team)
- [Railway Docs](https://docs.railway.app)

---

## Convenções de Nomenclatura

- **Aggregates**: PascalCase, substantivo no singular (`DocumentoLicitatorio`, `Organization`)
- **Tabelas DB**: snake_case, plural (`documentos_licitatorios`, `organizations`)
- **tRPC routers**: camelCase, hierárquico (`documents.create`, `imports.session.start`)
- **Arquivos de domínio**: `[aggregate].aggregate.ts`, `[aggregate].repository.ts`
- **Migrações**: `NNNN_descricao_snake_case.sql`

---

*Este índice é o ponto de entrada oficial da documentação do LiciGov Pro.*
*Mantenha-o atualizado a cada sprint concluída.*
