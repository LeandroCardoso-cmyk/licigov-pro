# LiciGov Pro — Instruções para o Agente

> 📜 **Constituição do Produto:** [`docs/architecture/PRODUCT_NORTH_STAR.md`](docs/architecture/PRODUCT_NORTH_STAR.md)
> é a filosofia permanente do LiciGov Pro e a **fonte oficial da verdade**, com precedência
> sobre qualquer documento de visão anterior. Toda implementação futura deve respeitá-la
> (missão, posicionamento não-ERP, IA supervisionada, Regra de Ouro, princípios arquiteturais).

## O que é este projeto
Plataforma SaaS especializada em automação documental, apoio operacional e inteligência aplicada
para departamentos de licitações e jurídico-administrativo de órgãos públicos.

**Definição oficial:** "Camada inteligente operacional do departamento de licitações."

Fluxo principal de documentos: **DFD → ETP → TR → Edital**

## O que o LiciGov Pro É
- Sistema satélite especializado
- Plataforma de engenharia documental
- Plataforma de apoio técnico-jurídico
- Sistema operacional do departamento de licitações
- Copiloto inteligente para elaboração documental

## O que o LiciGov Pro NÃO É (nunca propor features dessas categorias)
- ERP municipal
- Sistema contábil ou financeiro
- Sistema tributário, de RH ou patrimonial
- Portal completo de compras
- Plataforma completa de pregão eletrônico

## Stack
- **Frontend:** React 19 + TypeScript + Vite 7 + TailwindCSS 4 + wouter (roteamento) + TanStack Query + Radix UI / shadcn + TipTap (editor) + Recharts
- **Backend:** Node.js + TypeScript + Express 4 + tRPC 11 (com superjson)
- **ORM:** Drizzle ORM
- **Banco:** MySQL (via `mysql2`)
- **Storage:** AWS S3 (`@aws-sdk/client-s3`)
- **Infraestrutura:** Railway
- **Testes:** Vitest (obrigatório — migrations, staging e testes são regras fundamentais)
- **IA:** multi-provider via `server/_core/llm.ts` — default Gemini 2.5 Flash (`@google/generative-ai`); Claude e OpenAI preparados (ver `docs/architecture/AI_PROVIDER_CONFIG.md`)
- **Auth:** JWT em cookie HTTP-only via `jose` + bcrypt (email/senha próprio)
- **E-mail transacional:** Brevo (convites e recuperação de senha) — provider `console`/`fake` em dev
- **Billing:** Stripe (`billingRouter`)
- **Config:** leitura de env centralizada em `server/config/*` (nunca `process.env` direto)
- **Package manager:** pnpm (`pnpm@10.4.1`)
- **Runtime dev:** `tsx watch`; build de produção com `vite build` + `esbuild`

## Estrutura de pastas
```
licigov-pro/
├── client/src/
│   ├── _core/hooks/     # useAuth
│   ├── lib/trpc.ts      # Client tRPC
│   └── pages/           # Rotas (wouter)
├── server/
│   ├── _core/
│   │   ├── index.ts     # Entry point Express
│   │   ├── trpc.ts      # Procedures: publicProcedure / protectedProcedure / adminProcedure
│   │   ├── context.ts   # createContext (auth)
│   │   ├── sdk.ts       # JWT (jose) — auth próprio email/senha
│   │   ├── llm.ts       # Abstração LLM multi-provider
│   │   ├── ai/          # Providers de IA (gemini, mock, adapter, policy)
│   │   └── env.ts       # @deprecated — re-exporta server/config (compat)
│   ├── config/          # Leitura/validação de env (fonte única: env.ts, ai.ts, aws.ts, auth.ts, email.ts…)
│   ├── routers.ts       # AppRouter (60+ sub-routers)
│   ├── routers/         # Um arquivo por sub-router (authRouter, billingRouter, contractsRouter…)
│   ├── bootstrap.ts     # Bootstrap institucional / admin inicial
│   ├── db/              # Camada de dados Drizzle
│   ├── domain/          # Regras de negócio
│   ├── kernel/          # Núcleo institucional
│   ├── middleware/      # Middlewares Express
│   ├── parsers/         # Parsing de documentos
│   ├── providers/       # Integrações externas
│   ├── rag/             # RAG sobre Lei 14.133/2021
│   ├── services/        # email/ (Brevo), invitations, exports, etc.
│   ├── storage.ts       # Upload/download S3
│   └── __tests__/       # Testes Vitest (unit + integration)
├── drizzle/
│   ├── schema.ts        # ~297 tabelas MySQL
│   └── migrations/      # migrations obrigatórias
├── shared/              # Tipos e constantes compartilhados
├── docs/architecture/   # Documentação arquitetural (PRODUCT_NORTH_STAR, AI_PROVIDER_CONFIG…)
├── scripts/             # schema-audit.ts, ai-models.ts
└── .githooks/           # pre-commit (grafo Graphify), ativado pelo script `prepare`
```

## Como rodar (comandos)
Requer **pnpm** e um MySQL acessível via `DATABASE_URL`.

```bash
pnpm install            # instala deps + configura git hooks (script `prepare`)
cp .env.example .env    # preencher DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD, GEMINI_API_KEY…

# Desenvolvimento (tsx watch, APP_ENV=development)
pnpm dev
pnpm dev:staging        # APP_ENV=staging

# Qualidade
pnpm check              # tsc --noEmit (type-check)
pnpm lint               # eslint . --max-warnings 0
pnpm format             # prettier --write .

# Testes (Vitest)
pnpm test               # vitest run (suíte completa)
pnpm test:smoke:security # smoke de isolamento multi-tenant / RBAC

# Banco (Drizzle Kit)
pnpm db:generate        # gerar migration a partir do schema (obrigatório ao mudar schema)
pnpm db:migrate         # aplicar migrations
pnpm db:push            # push direto — SÓ em dev/local, NUNCA em produção
pnpm db:audit           # auditoria de schema

# Build / produção
pnpm build              # vite build + esbuild do server → dist/
pnpm start              # node dist/index.js
pnpm start:staging      # APP_ENV=staging

# Utilitários
pnpm ai:models          # inspeciona modelos de IA disponíveis
```

**Ambiente:** `APP_ENV` (development | staging | production) tem **precedência sobre `NODE_ENV`**.
**CI (GitHub Actions):** `ci.yml`, `schema-audit.yml`, `db-backup.yml`, `ai-models.yml`.
**Git hooks:** `.githooks/pre-commit` mantém o grafo Graphify sincronizado (não bloqueia o commit se ausente).

## Módulos oficiais (arquitetura funcional)
| Módulo | Descrição | Status |
|---|---|---|
| **Licitações** | DFD → ETP → TR → Edital | Em desenvolvimento — core do MVP |
| **Contratação Direta** | Dispensa, Inexigibilidade, Credenciamento | Roadmap |
| **Parecer Jurídico** | Parecer inicial, adjudicação, favorável/desfavorável | Roadmap |
| **Contratos e Aditivos** | Geração contratual, aditivos, reaproveitamento processual | Roadmap |
| **Gestão** | Calendário, protocolos, andamento, indicadores, produtividade | Implementado |
| **Documentos** | Upload, versionamento, histórico, rastreabilidade | Parcial |
| **IA** | Geração contextual, validação, revisão, apoio jurídico-operacional | Em desenvolvimento |
| **Administração** | Usuários, permissões, auditoria, logs, configurações | Parcial |

## Módulo Gestão — o que já existe
- Kanban com 7 colunas e drag & drop
- Lista com busca em tempo real
- Calendário com tarefas por dia (grid mensal, navegação, legenda)
- Dashboard analítico: 4 KPIs + 4 gráficos
- Modal de detalhes integrado
- Comentários e anexos (backend completo, limite 10MB, upload S3)
- 7 status: Pendente, Em Andamento, Pausada, Atrasada, Aguardando Informação, Concluída, Cancelada
- 4 prioridades: Baixa, Média, Alta, Urgente (cores diferenciadas)
- Indicadores visuais de prazo (4 cores: verde >7d, amarelo 3-7d, laranja 1-3d, vermelho vencido)
- Relatório PDF/Markdown e Excel com formatação
- Vinculação com processos licitatórios

## Variáveis de ambiente necessárias
> Referência completa e comentada em [`.env.example`](.env.example). Leitura sempre via `server/config/*`.

```env
# Servidor — APP_ENV tem precedência sobre NODE_ENV
NODE_ENV=development
APP_ENV=development           # development | staging | production
PORT=3000

# Banco (MySQL ou compatível)
DATABASE_URL=mysql://usuario:senha@host:3306/licigov

# Auth / sessão
JWT_SECRET=string-longa-minimo-32-chars
SESSION_TTL_HOURS=24          # 1..720 (default 24)
ALLOW_PUBLIC_REGISTRATION=false  # fail-closed; NUNCA true em produção
ADMIN_PASSWORD=senha-forte    # obrigatória em staging/produção (mín. 8 chars)
# ADMIN_EMAIL=admin@seu-orgao.gov.br
# ADMIN_NAME=Administrador

# IA — default Gemini; multi-provider (ver docs/architecture/AI_PROVIDER_CONFIG.md)
GEMINI_API_KEY=sua-chave-gemini
# AI_PROVIDER=gemini           # gemini | claude | openai (default: gemini)
# AI_MODEL=gemini-2.5-flash
# ANTHROPIC_API_KEY=           # Claude (contrato preparado)
# OPENAI_API_KEY=              # OpenAI (contrato preparado)

# E-mail transacional (Brevo) — convites e recuperação de senha
# EMAIL_PROVIDER=console       # brevo | console | fake (default: console em dev, brevo em staging/prod)
# EMAIL_ENABLED=false
# BREVO_API_KEY=               # obrigatórias em staging/produção (fail-closed)
# BREVO_SENDER_EMAIL=
# BREVO_SENDER_NAME=LiciGov Pro
# APP_BASE_URL=http://localhost:3000

# AWS S3 — obrigatório em produção
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_REGION=us-east-1
AWS_S3_BUCKET=
```

> **Legado Manus:** variáveis `OAUTH_SERVER_URL`, `VITE_APP_ID`, `OWNER_OPEN_ID`, `BUILT_IN_FORGE_API_*`
> não são mais usadas após a Fase 2 do plano de recuperação (ver skill `manus-migration`).

## Integrações externas planejadas
- **CATMAT/CATSER:** `https://dadosabertos.compras.gov.br` — API pública, sem autenticação
  - CATMAT: `GET /modulo-material/4_consultarItemMaterial?descricaoItem=X`
  - CATSER: `GET /modulo-servico/6_consultarItemServico?descricaoItem=X`
- **RAG sobre Lei 14.133/2021:** base de conhecimento em `server/services/`

## Documentos que o sistema gera
- **DFD** — Documento de Formalização da Demanda (art. 12, § 1º)
- **ETP** — Estudo Técnico Preliminar (art. 18)
- **TR** — Termo de Referência (art. 6º, XXIII)
- **Edital** — Modalidade, Formato (Presencial/Eletrônico), Critério de Julgamento, Regime de Contratação
- **Parecer** — Inicial, adjudicação, favorável/desfavorável
- **Contrato** — Geração contratual com reaproveitamento de dados processuais
- **Aditivo** — Prorrogação, acréscimo, reequilíbrio

## Princípio central da IA
> "O diferencial do sistema NÃO é apenas gerar texto com IA.
> O diferencial é estruturar tecnicamente a contratação pública com inteligência operacional,
> padronização e segurança jurídica."

Toda saída de IA deve ser: **editável, revisável e validada por humano.**

## Regras do agente

### Regras fundamentais (não negociáveis)
- TypeScript strict em todos os arquivos novos
- Migrations obrigatórias para toda mudança de schema (nunca db:push em produção)
- Staging obrigatório antes de produção
- Testes Vitest obrigatórios para lógica de negócio nova
- Rastreabilidade obrigatória (logs, auditoria, versionamento)

### Ao trabalhar em `server/_core/llm.ts`
- Manter a mesma assinatura de `invokeLLM(params: InvokeParams): Promise<InvokeResult>`
- Multi-provider: default Gemini 2.5 Flash (`@google/generative-ai`); Claude/OpenAI selecionáveis via `AI_PROVIDER`
- Ler configuração via `server/config/*` (nunca `process.env` direto — `server/_core/env.ts` é re-export deprecado)

### Ao trabalhar em autenticação
- `signSession` e `verifySession` com `jose` já existem — reutilizar
- Auth próprio: email + senha com bcrypt (já implementado)
- Sessão via cookie HTTP-only com JWT

### Ao trabalhar com storage (S3)
- Uploads sempre via AWS S3 — nunca base64 em banco
- Organizar chaves S3 por: `{modulo}/{processoId}/{timestamp}-{filename}`

### Ao gerar documentos com IA
- Sempre passar por `server/_core/llm.ts` (nunca chamar Gemini diretamente nos routers)
- Incluir artigo relevante da Lei 14.133/2021 no prompt
- Retornar JSON estruturado validado com Zod
- Sempre incluir aviso de revisão obrigatória ao usuário

### Ao mexer no banco (Drizzle)
- Schema em `drizzle/schema.ts`; camada de acesso em `server/db/`
- Nunca string interpolation — sempre parâmetros Drizzle
- Sempre gerar migration (`pnpm db:generate`) e aplicar com `pnpm db:migrate` — nunca só `db:push` em produção
- Numeração de processos: transação atômica (padrão AAAA/NNNN)

### Jamais
- Propor features de ERP, contabilidade, tributação ou RH (fora do escopo)
- Hardcodar chaves de API
- Fazer push direto em produção sem staging
