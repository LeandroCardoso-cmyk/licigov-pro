# LiciGov Pro — Instruções para o Agente

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
- **Frontend:** React + TypeScript + Vite + TailwindCSS + wouter
- **Backend:** Node.js + TypeScript + Express + tRPC 11
- **ORM:** Drizzle ORM
- **Banco:** MySQL (Railway)
- **Storage:** AWS S3
- **Infraestrutura:** Railway
- **Testes:** Vitest (obrigatório — migrations, staging e testes são regras fundamentais)
- **IA:** Gemini 2.5 Flash via `@google/generative-ai`
- **Auth:** JWT em cookie HTTP-only via `jose` + bcrypt (email/senha próprio)
- **Package manager:** pnpm

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
│   │   ├── llm.ts       # Abstração LLM → Gemini 2.5 Flash
│   │   └── env.ts       # ENV vars tipadas
│   ├── routers.ts       # AppRouter (15+ sub-routers)
│   ├── db.ts            # Queries Drizzle
│   └── services/        # gemini.ts, RAG, etc.
├── drizzle/
│   ├── schema.ts        # ~20 tabelas MySQL
│   └── migrations/      # migrations obrigatórias
└── shared/              # Tipos e constantes compartilhados
```

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
```env
NODE_ENV=development
PORT=3000
DATABASE_URL=mysql://usuario:senha@host:3306/licigov   # Railway MySQL
JWT_SECRET=string-longa-minimo-32-chars
GEMINI_API_KEY=sua-chave-gemini
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=...
AWS_REGION=...
```

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
- Provedor: Gemini 2.5 Flash via `@google/generative-ai`
- Usar variáveis via `env.ts`, nunca `process.env` direto

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
- Nunca string interpolation — sempre parâmetros Drizzle
- Sempre gerar migration (`drizzle-kit generate`) — nunca só `db:push` em produção
- Numeração de processos: transação atômica (padrão AAAA/NNNN)

### Jamais
- Propor features de ERP, contabilidade, tributação ou RH (fora do escopo)
- Hardcodar chaves de API
- Fazer push direto em produção sem staging
