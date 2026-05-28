# LiciGov Pro — Histórico de Sprints

> Registro oficial de todas as sprints realizadas no projeto LiciGov Pro.
> Atualizado em: 2026-05-27 | Versão: 2.8-stable

---

## Visão Geral das Sprints

| Sprint | Nome | Migrações | Testes | Status |
|--------|------|-----------|--------|--------|
| 1 | Multi-tenant Foundation | 0033–0038 | — | ✅ Concluída |
| 1.5 | Hardening Multi-tenant | 0039–0042 | — | ✅ Concluída |
| 1.8 | Preparação Core Documental | 0043 | — | ✅ Concluída |
| 2 | Core Documental | 0044–0049 | 55 | ✅ Concluída |
| 2.5 | Hardening Documental | 0050–0053 | 76 | ✅ Concluída |
| 2.8 | Import Foundation Layer | 0054–0055 | 99 | ✅ Concluída |
| 3 | CATMAT Integration | 0056–TBD | — | 🔜 Planejada |

---

## Sprint 1 — Multi-tenant Foundation

**Objetivo:** Estabelecer a fundação multi-tenant do sistema com isolamento completo por organização.

### Entregas Principais
- **Organizations aggregate** — Entidade raiz do multi-tenant
- **OrganizationMembers** — Membros com papéis por organização
- **RBAC completo** — 5 papéis hierárquicos: `viewer`, `operator`, `manager`, `admin`, `owner`
- **Activity logs v2** — Sistema de auditoria com `correlationId` e `requestId`
- **Migrações**: 0033 (organizations), 0034 (members), 0035 (roles), 0036 (activity_logs_v2), 0037 (correlationId index), 0038 (requestId index)

### Impacto Arquitetural
- Todo aggregate do sistema passa a ter `organizationId` obrigatório
- Queries isoladas por tenant em todas as camadas (repository pattern)
- ActivityLog com envelope estruturado para auditoria legal

### Princípios Estabelecidos
- `organizationId` é imutável após criação
- Owner não pode ser removido sem transferência prévia
- Logs de auditoria são append-only

---

## Sprint 1.5 — Hardening Multi-tenant

**Objetivo:** Reforçar segurança e confiabilidade da camada multi-tenant.

### Entregas Principais
- **ActivityLog hardening** — Snapshots imutáveis (before/after state)
- **Outbox envelope v2** — Estrutura enriquecida de eventos de domínio
- **Idempotency TTL index** — Deduplicação de operações com expiração automática
- **Migrações**: 0039 (activity_snapshot), 0040 (outbox_v2), 0041 (idempotency_ttl), 0042 (indexes de performance)

### Impacto Arquitetural
- Eventos de domínio têm garantia de entrega via Outbox pattern
- Operações duplicadas são detectadas e ignoradas dentro da janela TTL
- Auditoria preserva estado completo antes e após cada mutação

---

## Sprint 1.8 — Preparação Core Documental

**Objetivo:** Preparar a infraestrutura necessária para o motor documental.

### Entregas Principais
- **Optimistic locking** — Campo `version` em processos para controle de concorrência
- **Migração**: 0043 (version field em processes)

### Impacto Arquitetural
- Conflitos de edição concorrente detectados no nível da aplicação
- Base para o `ConcurrencyService` implementado na Sprint 2.5

---

## Sprint 2 — Core Documental

**Objetivo:** Implementar o motor documental completo com versionamento, workflow e templates.

### Entregas Principais
- **DocumentoLicitatorio aggregate** — Documento versionado com suporte a drafts e timeline
- **Workflow state machine** — Máquina de estados: `draft → in_review → approved/rejected → archived`
- **DocumentTemplates** — Templates reutilizáveis por tipo de documento
- **Comments com threading** — Sistema de comentários hierárquicos por documento
- **55 testes** cobrindo agregado, workflow, templates e comentários
- **Migrações**: 0044 (documentos_licitatorios), 0045 (document_versions), 0046 (workflow_states), 0047 (document_templates), 0048 (comments), 0049 (comment_threads)

### Tipos de Documento Suportados
- **TR** — Termo de Referência (art. 6º, XXIII, Lei 14.133/2021)
- **ETP** — Estudo Técnico Preliminar (art. 18, Lei 14.133/2021)
- **Edital** — Instrumento convocatório (art. 25, Lei 14.133/2021)
- **Contrato** — Instrumento de contratação (art. 90, Lei 14.133/2021)

### Impacto Arquitetural
- Sistema de versionamento semântico interno (major.minor.patch por documento)
- Timeline imutável de todas as transições de estado
- Arquitetura extensível para novos tipos de documento

---

## Sprint 2.5 — Hardening Documental

**Objetivo:** Adicionar políticas, diff semântico, retenção, integridade e renderização.

### Entregas Principais

#### PolicyEngine
- 14 ações controladas: `edit`, `approve`, `reject`, `submit_review`, `restore_version`,
  `comment`, `archive`, `unlock`, `export`, `delete_draft`, `manage_attachments`,
  `view_history`, `manage_lock`, `verify_integrity`, `purge`
- Avaliação por papel RBAC + estado do workflow

#### DiffEngine Semântico
- `blockDiff` — Diferenças em blocos de conteúdo
- `sectionDiff` — Diferenças em seções nomeadas
- `variableDiff` — Diferenças em variáveis interpoladas

#### RetentionPolicy (7 Classes)
- `legal_permanent` — Documentos com valor probatório permanente
- `legal_7years` — Contratos e termos (prazo prescricional)
- `operational_3years` — Documentos operacionais
- `draft_7days` — Rascunhos não promovidos
- `log_2years` — Logs de auditoria
- `temp_30days` — Arquivos temporários
- `attachment_follows_document` — Anexos seguem retenção do documento pai

#### IntegrityService
- Hash SHA-256 por versão de documento
- `snapshotFingerprint` para validação de integridade de cadeia

#### Outros Serviços
- **AttachmentService** — Gestão de anexos por documento
- **RenderService** — Renderização em HTML, DOCX, PDF
- **ConcurrencyService** — Soft locks (aviso) e hard locks (bloqueio)

- **76 testes**, **Migrações**: 0050–0053

### Impacto Arquitetural
- Conformidade com LGPD (retenção e purge automatizados)
- Renderização server-side para auditoria e exportação
- Locks distribuídos previnem edições conflitantes

---

## Sprint 2.8 — Import Foundation Layer

**Objetivo:** Construir a camada de importação de dados externos com rastreabilidade completa.

### Princípio Fundamental
> **Raw extraction NUNCA persiste diretamente no domínio.**
> O fluxo obrigatório é: `raw extraction → staging → validação → revisão humana → aprovação`

### Entregas Principais

#### ImportSession Aggregate
- 10 status de ciclo de vida: `uploaded → queued → parsing → extracted → normalized → awaiting_review → approved/rejected/failed/archived`
- 4 tipos de importação: `price_research`, `tr_items`, `catmat`, `generic`

#### Parsers
- **CSV Parser** — Detecção automática de delimitador (`,`, `;`, `\t`, `|`)
- **XLSX Parser** — Baseado em SheetJS, suporte a múltiplas planilhas
- **PDF stub** — Interface definida, implementação completa na Sprint 3
- **DOCX stub** — Interface definida, implementação completa na Sprint 3

#### ParserRegistry
- Resolução por MIME type, extensão de arquivo ou hint explícito
- Registro extensível para novos formatos

#### Serviços de Importação
- **FileIngestionService** — Recebimento e validação inicial de arquivos
- **ImportStagingService** — Normalização e staging de dados extraídos
- **ImportQueueService** — Fila de processamento com retry e Dead Letter Queue (DLQ)

#### Canonicalização
- **CanonicalUnits registry** — 25 unidades em PT-BR (kg, l, m², m³, un, cx, etc.)
- **Confidence Infrastructure** — `ConfidenceMetadata`, scores: `high ≥ 0.85`, `medium ≥ 0.60`, `low ≥ 0.35`, `uncertain < 0.35`
- **ExtractionProvenance** — Rastreabilidade por célula, linha, página e planilha de origem

- **99 testes**, **Migrações**: 0054 (import_sessions), 0055 (import_staging)

### Impacto Arquitetural
- Foundation para integração CATMAT (Sprint 3)
- Modelo de confiança permite revisão humana seletiva
- DLQ garante processamento de todos os arquivos enviados

---

## Sprint 3 — CATMAT Integration (Planejamento)

**Objetivo:** Integrar o Catálogo de Materiais e Serviços do Governo Federal com matching automatizado.

### Entregas Planejadas
- Integração com API CATMAT/CATSER (ComprasNet)
- Normalização de itens de TR contra catálogo oficial
- AI-assisted matching para itens sem correspondência exata
- Score de conformidade CATMAT por documento
- Sugestões de código CATMAT durante edição do TR
- Migrações: 0056–TBD

### Critérios de Aceite
- Matching com ≥ 85% de precisão para itens de material padrão
- Tempo de normalização < 5s por documento de até 100 itens
- Auditoria completa de sugestões aceitas/rejeitadas pelo operador

---

## Métricas de Qualidade por Sprint

| Métrica | Sprint 2 | Sprint 2.5 | Sprint 2.8 |
|---------|----------|------------|------------|
| Testes | 55 | 76 | 99 |
| Migrações | 6 | 4 | 2 |
| Cobertura estimada | ~70% | ~75% | ~80% |
| Agregados novos | 2 | 0 | 1 |
| Serviços novos | 3 | 6 | 4 |

---

*Este documento é a fonte única de verdade para o histórico de sprints do LiciGov Pro.*
