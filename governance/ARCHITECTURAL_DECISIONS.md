# LiciGov Pro — Decisões Arquiteturais

> Registro de todas as decisões arquiteturais significativas do projeto.
> Atualizado em: 2026-05-27

---

## ADR-001: MySQL como banco de dados principal

**Status**: Aceita

**Contexto**:
Necessidade de escolher entre MySQL e PostgreSQL como banco relacional principal para o LiciGov Pro.

**Decisão**: MySQL 8.x

**Alternativas Consideradas**:
- PostgreSQL 16: Melhor suporte a JSONB, array types, full-text search avançado
- SQLite: Descartado por ser inadequado para multi-tenant em produção

**Justificativa**:
- Railway oferece MySQL managed com latência mais baixa na região SA (South America)
- MySQL 8 tem suporte nativo a JSON bem maduro para nossos use cases
- Time tem maior familiaridade com MySQL; reduz risco operacional
- Drizzle ORM tem excelente suporte a MySQL (dialeto específico)
- FULLTEXT search do MySQL atende necessidades de busca de documentos

**Consequências**:
- Positivas: menor latência, menor risco operacional, custo menor no Railway
- Negativas: sem JSONB nativo (usamos JSON), sem CTE recursiva simples, sem window functions tão maduras

---

## ADR-002: tRPC v11 como camada de API

**Status**: Aceita

**Contexto**:
Escolha do mecanismo de comunicação entre frontend React e backend Node.js.

**Decisão**: tRPC v11

**Alternativas Consideradas**:
- REST com OpenAPI/Swagger
- GraphQL (Apollo ou Pothos)
- gRPC (descartado por ser inadequado para browser)

**Justificativa**:
- Type-safety end-to-end sem geração de código — tipos inferidos automaticamente
- Developer Experience superior: nenhuma desincronização entre cliente e servidor
- Integração nativa com React Query (TanStack) para cache e estado
- Menor boilerplate que GraphQL para o nosso caso de uso
- v11 tem melhor suporte a streaming e middlewares

**Consequências**:
- Positivas: zero codegen, refactoring seguro, DX excelente
- Negativas: não é uma API pública consumível por terceiros facilmente; necessário exportar REST em futuro para integração PNCP

---

## ADR-003: Drizzle ORM como mapeador objeto-relacional

**Status**: Aceita

**Contexto**:
Escolha do ORM para acesso ao banco de dados.

**Decisão**: Drizzle ORM

**Alternativas Consideradas**:
- Prisma: Mais popular, schema declarativo
- TypeORM: Mais maduro, decorator-based
- Kysely: Query builder tipado, sem ORM

**Justificativa**:
- Type-safety superior ao Prisma (tipos gerados são mais precisos)
- Migrations explícitas em SQL — maior controle e auditabilidade
- Performance: sem overhead de abstração pesada
- Drizzle Studio para inspeção do banco durante desenvolvimento
- Dialeto MySQL específico com suporte a JSON e FULLTEXT

**Consequências**:
- Positivas: migrations auditáveis, types precisos, performance
- Negativas: menos recursos que Prisma (sem auto-populate relations complexas), documentação menos madura

---

## ADR-004: Outbox Pattern para eventos de domínio

**Status**: Aceita

**Contexto**:
Necessidade de garantir consistência entre mutações no banco de dados e emissão de eventos de domínio.

**Decisão**: Outbox Pattern com tabela `outbox_events` no MySQL

**Alternativas Consideradas**:
- Emissão de eventos diretamente (fire-and-forget)
- Message broker externo (RabbitMQ, Kafka)
- Transactional outbox com Redis Streams

**Justificativa**:
- Eventos escritos na mesma transação que a mutação — garantia de consistência
- Sem dependência de infraestrutura externa na Sprint 1/2
- Worker simples de polling que processa o Outbox
- Envelope v2 (Sprint 1.5) tem schema rico para correlação e debugging

**Consequências**:
- Positivas: consistência garantida, sem perda de eventos, depuração simples
- Negativas: latência de processamento (polling interval), necessita cleanup periódico de eventos processados

---

## ADR-005: Staging Obrigatório para Importações

**Status**: Aceita

**Contexto**:
Decisão sobre como dados externos (planilhas, PDFs) são persistidos no domínio.

**Decisão**: Raw extraction NUNCA persiste diretamente no domínio. Fluxo obrigatório: staging → validação → revisão humana → aprovação.

**Alternativas Consideradas**:
- Importação direta ao domínio com validações robustas
- Staging apenas para confiança baixa

**Justificativa**:
- Lei 14.133/2021 exige documentação da origem dos dados em pesquisas de preço
- Dados externos têm qualidade variável; revisão humana é necessária
- ExtractionProvenance garante rastreabilidade completa por célula/linha
- Reversibilidade total: staging rejeitado não impacta domínio
- Base para AI-assisted review (Sprint 4)

**Consequências**:
- Positivas: conformidade legal, rastreabilidade, qualidade de dados
- Negativas: fluxo mais longo para o usuário, mais tabelas no banco

---

## ADR-006: Optimistic Locking com campo `version`

**Status**: Aceita

**Contexto**:
Controle de concorrência em entidades mutáveis sem bloquear o banco de dados.

**Decisão**: Campo `version` (integer) em aggregates que sofrem edições concorrentes.

**Alternativas Consideradas**:
- Pessimistic locking (SELECT FOR UPDATE)
- Last-write-wins (sem controle de concorrência)
- Event sourcing puro

**Justificativa**:
- Pessimistic locking seria inadequado para documentos com edições longas
- Last-write-wins causaria perda de dados silenciosa
- Optimistic locking detecta conflitos sem degradar performance
- Complementa o ConcurrencyService (soft/hard locks) para UX adequada

**Consequências**:
- Positivas: performance, sem deadlocks, detecção de conflitos
- Negativas: necessita retry logic no cliente; mais complexidade no handler

---

## ADR-007: 7 Classes de Retenção Documental como Value Object

**Status**: Aceita

**Contexto**:
Modelagem da política de retenção documental para conformidade com Lei 14.133/2021 e LGPD.

**Decisão**: `RetentionClass` como value object do domínio com 7 classes predefinidas.

**Alternativas Consideradas**:
- Configuração externa (YAML/JSON)
- Tabela de políticas no banco
- Hardcoded por tipo de documento

**Justificativa**:
- Retenção é regra de negócio/legal, não configuração — pertence ao domínio
- Value object garante validação em compile time (TypeScript)
- 7 classes cobrem todos os requisitos legais identificados
- Extensível: novas classes podem ser adicionadas como value objects

**Consequências**:
- Positivas: type-safety, conformidade por design, auditável
- Negativas: mudanças requerem deploy (não configurável dinamicamente)

---

## ADR-008: React 19 + Vite como frontend

**Status**: Aceita

**Contexto**:
Escolha do framework e build tool para o frontend SPA.

**Decisão**: React 19 com Vite

**Alternativas Consideradas**:
- Next.js 15 com App Router
- SvelteKit
- Vue 3 com Nuxt

**Justificativa**:
- React 19 traz Concurrent Features e melhorias de performance
- Vite oferece HMR instantâneo, muito mais rápido que Webpack
- SPA é adequado para o perfil de uso (usuários autenticados, não necessita SEO)
- Next.js seria mais complexo sem benefício real (sem necessidade de SSR/SEO)
- tRPC tem integração de primeira classe com React

**Consequências**:
- Positivas: DX excelente, build rápido, integração perfeita com tRPC
- Negativas: sem SSR (não é problema para app autenticado), bundle inicial maior

---

*Para governança: [governance/GOVERNANCE.md](./GOVERNANCE.md)*
*Para padrões de engenharia: [governance/ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md)*
