import {
  AlignmentType,
  BorderStyle,
  CheckBox,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import fs from "fs";
import path from "path";

// ─── helpers ────────────────────────────────────────────────────────────────

function h1(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } });
}

function h2(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 320, after: 160 } });
}

function h3(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 240, after: 120 } });
}

function p(text: string) {
  return new Paragraph({ children: [new TextRun({ text })], spacing: { after: 120 } });
}

function bold(text: string) {
  return new Paragraph({ children: [new TextRun({ text, bold: true })], spacing: { after: 120 } });
}

function labeled(label: string, value: string) {
  return new Paragraph({
    children: [
      new TextRun({ text: label + ": ", bold: true }),
      new TextRun({ text: value }),
    ],
    spacing: { after: 100 },
  });
}

function code(text: string) {
  return new Paragraph({
    children: [new TextRun({ text, font: "Courier New", size: 18 })],
    shading: { type: ShadingType.SOLID, color: "F3F4F6" },
    spacing: { after: 80, before: 80 },
    indent: { left: 360 },
  });
}

function codeBlock(lines: string[]) {
  return lines.map(line =>
    new Paragraph({
      children: [new TextRun({ text: line || " ", font: "Courier New", size: 18 })],
      shading: { type: ShadingType.SOLID, color: "F3F4F6" },
      spacing: { after: 0, before: 0 },
      indent: { left: 360, right: 360 },
    })
  );
}

function bullet(text: string, level = 0) {
  return new Paragraph({
    text,
    bullet: { level },
    spacing: { after: 80 },
  });
}

function numbered(text: string, level = 0) {
  return new Paragraph({
    text,
    numbering: { reference: "numbered-list", level },
    spacing: { after: 80 },
  });
}

function separator() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } },
    spacing: { before: 200, after: 200 },
  });
}

function checkItem(text: string) {
  return new Paragraph({
    children: [
      new CheckBox(),
      new TextRun({ text: "  " + text }),
    ],
    spacing: { after: 80 },
  });
}

function table2col(rows: [string, string][], headers: [string, string]) {
  const headerRow = new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: headers[0], bold: true })] })],
        shading: { type: ShadingType.SOLID, color: "E5E7EB" },
        width: { size: 30, type: WidthType.PERCENTAGE },
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: headers[1], bold: true })] })],
        shading: { type: ShadingType.SOLID, color: "E5E7EB" },
        width: { size: 70, type: WidthType.PERCENTAGE },
      }),
    ],
  });

  const dataRows = rows.map(
    ([col1, col2]) =>
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: col1, font: "Courier New", size: 18 })] })],
            width: { size: 30, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ text: col2 })],
            width: { size: 70, type: WidthType.PERCENTAGE },
          }),
        ],
      })
  );

  return new Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } });
}

function table3col(rows: [string, string, string][], headers: [string, string, string]) {
  const headerRow = new TableRow({
    children: headers.map(h =>
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
        shading: { type: ShadingType.SOLID, color: "E5E7EB" },
      })
    ),
  });

  const dataRows = rows.map(
    ([c1, c2, c3]) =>
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c1, bold: true })] })] }),
          new TableCell({ children: [new Paragraph({ text: c2 })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c3, font: "Courier New", size: 18 })] })] }),
        ],
      })
  );

  return new Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } });
}

// ─── document sections ───────────────────────────────────────────────────────

const stackRows: [string, string][] = [
  ["Frontend", "React 19 + Vite 7 + TailwindCSS 4 + wouter"],
  ["Backend", "Node.js + Express 4 + tRPC 11"],
  ["ORM", "Drizzle ORM 0.44"],
  ["Banco", "MySQL / TiDB (dialeto MySQL)"],
  ["IA", "Gemini 2.5 Flash (via Manus Forge — a substituir)"],
  ["Auth", "JWT em cookie (via Manus OAuth — a substituir)"],
  ["Package manager", "pnpm 10.4"],
];

const dbRows: [string, string, string][] = [
  ["Docker local", "Ilimitado", "docker run -p 3306:3306 -e MYSQL_ROOT_PASSWORD=senha mysql:8"],
  ["PlanetScale", "5 GB", "Criar DB, copiar connection string MySQL"],
  ["Railway", "$5 crédito/mês", "Provisionar MySQL, pegar DATABASE_URL"],
  ["TiDB Cloud", "5 GB serverless", "Compatível MySQL 100%"],
];

const summaryRows: [string, string, string][] = [
  ["1", "Remover vite-plugin-manus-runtime", "vite.config.ts"],
  ["2", "Implementar auth email/senha", "server/routers/auth.ts, server/_core/sdk.ts"],
  ["3", "Trocar LLM Forge → Gemini SDK", "server/_core/llm.ts"],
  ["4", "Criar .env.example", ".env.example (novo)"],
  ["5", "Provisionar banco MySQL", "Infra / Docker"],
];

const doc = new Document({
  numbering: {
    config: [
      {
        reference: "numbered-list",
        levels: [
          {
            level: 0,
            format: "decimal",
            text: "%1.",
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 360, hanging: 260 } } },
          },
        ],
      },
    ],
  },
  sections: [
    {
      children: [
        // ── Título ──────────────────────────────────────────────────────────
        new Paragraph({
          children: [new TextRun({ text: "Plano de Recuperação — LiciGov Pro", bold: true, size: 52 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        }),
        new Paragraph({
          children: [new TextRun({ text: "Documento gerado automaticamente a partir da análise do repositório.", italics: true, color: "6B7280" })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 600 },
        }),

        // ── Visão Geral ──────────────────────────────────────────────────────
        h1("1. Visão Geral do Sistema"),
        p("LiciGov Pro é um SaaS para geração automatizada de documentos de licitação pública conforme a Lei 14.133/2021, com fluxo: DFD → ETP → TR → Edital."),

        h2("Stack Tecnológica"),
        table2col(stackRows, ["Camada", "Tecnologia"]),
        p(""),

        // ── Estrutura de Pastas ──────────────────────────────────────────────
        h2("Estrutura de Pastas"),
        ...codeBlock([
          "licigov-pro/",
          "├── client/src/           # Frontend React",
          "│   ├── _core/hooks/      # useAuth",
          "│   ├── lib/trpc.ts       # Client tRPC",
          "│   └── pages/            # Rotas",
          "├── server/",
          "│   ├── _core/",
          "│   │   ├── index.ts      # Entry point Express",
          "│   │   ├── trpc.ts       # Procedures (public/protected/admin)",
          "│   │   ├── context.ts    # createContext (auth)",
          "│   │   ├── sdk.ts        # JWT + OAuth Manus",
          "│   │   ├── oauth.ts      # /api/oauth/callback",
          "│   │   ├── vite.ts       # Serve frontend",
          "│   │   ├── llm.ts        # Abstração LLM → Forge API",
          "│   │   └── env.ts        # ENV vars",
          "│   ├── routers.ts        # AppRouter (15+ sub-routers)",
          "│   ├── db.ts             # Queries Drizzle",
          "│   └── services/         # gemini.ts, RAG, etc.",
          "├── drizzle/",
          "│   ├── schema.ts         # ~20 tabelas",
          "│   └── migrations/       # SQL migrations",
          "└── shared/               # Tipos e constantes",
        ]),
        p(""),

        separator(),

        // ── Problemas ────────────────────────────────────────────────────────
        h1("2. Problemas Identificados"),

        h2("CRÍTICO 1 — Plugin Manus no Vite"),
        labeled("Arquivo", "vite.config.ts:10"),
        p("Plugin proprietário da Manus. Quebra o build fora da plataforma."),
        bold("Código problemático:"),
        ...codeBlock([
          `import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";`,
          `const plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime()];`,
        ]),
        bold("Fix: remover vitePluginManusRuntime() dos plugins do Vite."),
        p(""),

        h2("CRÍTICO 2 — Auth via OAuth Manus"),
        labeled("Arquivo", "server/_core/sdk.ts"),
        p("Todo login depende de endpoints OAUTH_SERVER_URL da Manus (/webdev.v1.WebDevAuthPublicService/...). Sem acesso à Manus, nenhum usuário consegue fazer login."),
        p("A boa notícia: a infraestrutura de JWT (signSession, verifySession com jose) já está implementada e independente. Só o provedor de identidade é Manus."),
        bold("Fix: implementar auth próprio com email + senha (bcrypt já está no projeto)."),
        p(""),

        h2("CRÍTICO 3 — LLM via Forge Manus"),
        labeled("Arquivo", "server/_core/llm.ts"),
        p("Todas as chamadas de IA passam pela Forge API da Manus (BUILT_IN_FORGE_API_URL + BUILT_IN_FORGE_API_KEY)."),
        bold("Fix: trocar para Gemini direto via @google/generative-ai (SDK já instalada no package.json)."),
        p(""),

        h2("MÉDIO 4 — Sem .env.example no repo"),
        p("Não há .env.example. Sem essa referência, é fácil esquecer variáveis obrigatórias e receber erros opacos na inicialização."),
        p(""),

        separator(),

        // ── Como Rodar ───────────────────────────────────────────────────────
        h1("3. Como Rodar Localmente"),

        h2("Pré-requisitos"),
        bullet("Node.js 20+"),
        bullet("pnpm 10.4+ → npm install -g pnpm@10.4.1"),
        bullet("MySQL acessível (ver opções abaixo)"),
        p(""),

        h2("Passo 1 — Instalar dependências"),
        ...codeBlock(["cd licigov-pro", "pnpm install"]),
        p(""),

        h2("Passo 2 — Criar o arquivo .env na raiz"),
        ...codeBlock([
          "# Servidor",
          "NODE_ENV=development",
          "PORT=3000",
          "",
          "# Banco (MySQL ou compatível)",
          "DATABASE_URL=mysql://root:senha@localhost:3306/licigov",
          "",
          "# JWT — qualquer string longa e aleatória",
          "JWT_SECRET=sua-chave-secreta-super-longa-minimo-32-chars",
          "",
          "# IA — Google Gemini direto (após o fix abaixo)",
          "GEMINI_API_KEY=sua-chave-gemini",
          "",
          "# --- Manus (preencher só se ainda tiver acesso) ---",
          "# VITE_APP_ID=seu-app-id",
          "# OAUTH_SERVER_URL=https://oauth.manus.computer",
          "# OWNER_OPEN_ID=seu-open-id",
          "# BUILT_IN_FORGE_API_KEY=sua-forge-key",
          "# BUILT_IN_FORGE_API_URL=https://forge.manus.computer",
        ]),
        p(""),

        h2("Passo 3 — Criar banco e rodar migrações"),
        ...codeBlock(["pnpm db:push", "# Equivale a: drizzle-kit generate && drizzle-kit migrate"]),
        p(""),

        h2("Passo 4 — Rodar em desenvolvimento"),
        ...codeBlock([
          "pnpm dev",
          "# → Express na porta 3000",
          "# → tRPC em /api/trpc",
          "# → Vite middleware servindo o frontend com HMR",
        ]),
        p(""),

        h2("Passo 5 — Build de produção"),
        ...codeBlock([
          "# 1. Build do frontend → dist/public/",
          "pnpm vite build",
          "",
          "# 2. Build do servidor → dist/index.js",
          "esbuild server/_core/index.ts \\",
          "  --platform=node --packages=external \\",
          "  --bundle --format=esm --outdir=dist",
          "",
          "# 3. Iniciar",
          "NODE_ENV=production node dist/index.js",
        ]),
        p(""),

        separator(),

        // ── Banco ─────────────────────────────────────────────────────────────
        h1("4. Opções de Banco de Dados Gratuitas"),
        new Table({
          rows: [
            new TableRow({
              children: ["Serviço", "Free Tier", "Como usar"].map(h =>
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
                  shading: { type: ShadingType.SOLID, color: "E5E7EB" },
                })
              ),
            }),
            ...dbRows.map(([c1, c2, c3]) =>
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c1, bold: true })] })] }),
                  new TableCell({ children: [new Paragraph({ text: c2 })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c3, font: "Courier New", size: 18 })] })] }),
                ],
              })
            ),
          ],
          width: { size: 100, type: WidthType.PERCENTAGE },
        }),
        p(""),

        separator(),

        // ── Plano de Fixes ───────────────────────────────────────────────────
        h1("5. Plano de Fixes (Fases)"),

        h2("Fase 1 — Fazer o projeto ligar (urgente)"),
        h3("Fix 1.1 — Remover plugin Manus do Vite"),
        p("Arquivo: vite.config.ts"),
        ...codeBlock([
          "// ANTES",
          `import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";`,
          `const plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime()];`,
          "",
          "// DEPOIS",
          "const plugins = [react(), tailwindcss()];",
        ]),
        p(""),

        h2("Fase 2 — Autenticação própria"),
        h3("Fix 2.1 — Novo router de auth (email + senha)"),
        p("Criar/atualizar procedures tRPC em server/routers/auth.ts:"),
        bullet("auth.register → valida email/senha, faz hash com bcrypt, insere na tabela users, gera JWT com sdk.signSession(), seta cookie"),
        bullet("auth.login → busca user por email, bcrypt.compare, gera JWT, seta cookie"),
        bullet("auth.logout → limpa cookie"),
        bullet("auth.me → lê cookie, verifica JWT, retorna user (já existe parcialmente)"),
        p(""),

        h3("Fix 2.2 — Simplificar authenticateRequest no SDK"),
        p("Arquivo: server/_core/sdk.ts"),
        p("Remover a chamada de fallback para getUserInfoWithJwt (endpoint Manus). Manter apenas: verificar cookie JWT local → buscar user no DB."),
        p(""),

        h2("Fase 3 — Substituir LLM (Forge → Gemini direto)"),
        h3("Fix 3.1 — Trocar implementação em server/_core/llm.ts"),
        ...codeBlock([
          `import { GoogleGenerativeAI } from "@google/generative-ai";`,
          "",
          "const genAI = new GoogleGenerativeAI(ENV.geminiApiKey);",
          "",
          "export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {",
          `  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });`,
          "  // mapear params.messages → formato Gemini",
          "  // retornar no formato InvokeResult esperado",
          "}",
        ]),
        p("A interface InvokeParams / InvokeResult já está definida em llm.ts — o objetivo é manter a mesma assinatura para não quebrar os serviços que chamam invokeLLM(...)."),
        p(""),

        h2("Fase 4 — Criar .env.example"),
        p("Documentar todas as variáveis com comentários, valores de exemplo e indicação de quais são obrigatórias vs opcionais."),
        p(""),

        separator(),

        // ── Fluxos ───────────────────────────────────────────────────────────
        h1("6. Fluxos do Sistema"),

        h2("Fluxo de Autenticação (após os fixes)"),
        ...codeBlock([
          "Usuário → POST /api/trpc/auth.login",
          "         → bcrypt.compare(senha, hash)",
          "         → sdk.signSession({ openId: user.id, ... })  ← JWT local",
          "         → res.cookie('session', token)",
          "         → redirect /dashboard",
          "",
          "Cada request → createContext() → sdk.verifySession(cookie)",
          "             → db.getUserByOpenId(openId)",
          "             → ctx.user populado",
          "             → protectedProcedure funciona",
        ]),
        p(""),

        h2("Fluxo tRPC (já funciona, não muda)"),
        ...codeBlock([
          "Frontend: trpc.processes.list.useQuery()",
          "  → HTTP GET /api/trpc/processes.list",
          "  → createExpressMiddleware (Express)",
          "  → createContext (auth)",
          "  → protectedProcedure.query(...)",
          "  → Drizzle → MySQL",
          "  → superjson response",
        ]),
        p("O endpoint /api/trpc já está corretamente configurado em server/_core/index.ts. O client em client/src/lib/trpc.ts aponta para AppRouter via import de tipo — funciona sem nenhuma alteração."),
        p(""),

        separator(),

        // ── Checklist ────────────────────────────────────────────────────────
        h1("7. Checklist de Verificação"),
        checkItem("pnpm install sem erros"),
        checkItem(".env criado com DATABASE_URL e JWT_SECRET"),
        checkItem("pnpm db:push cria as tabelas no banco"),
        checkItem("pnpm dev inicia sem erros no terminal"),
        checkItem("GET http://localhost:3000 retorna o frontend React"),
        checkItem("POST http://localhost:3000/api/trpc/auth.login retorna resposta tRPC"),
        checkItem("Login com email/senha funciona e seta cookie"),
        checkItem("/dashboard acessível após login"),
        checkItem("Geração de documento (ETP) chama Gemini e retorna texto"),
        p(""),

        separator(),

        // ── Resumo ───────────────────────────────────────────────────────────
        h1("8. Resumo Executivo"),
        new Table({
          rows: [
            new TableRow({
              children: ["Prioridade", "Ação", "Arquivo Principal"].map(h =>
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
                  shading: { type: ShadingType.SOLID, color: "E5E7EB" },
                })
              ),
            }),
            ...summaryRows.map(([c1, c2, c3]) =>
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c1, bold: true })] })] }),
                  new TableCell({ children: [new Paragraph({ text: c2 })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c3, font: "Courier New", size: 18 })] })] }),
                ],
              })
            ),
          ],
          width: { size: 100, type: WidthType.PERCENTAGE },
        }),
        p(""),
      ],
    },
  ],
});

// ─── salvar arquivo ──────────────────────────────────────────────────────────

const outputPath = path.resolve(process.cwd(), "plano-recuperacao-licigov-pro.docx");

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(outputPath, buffer);
  console.log(`✓ Documento gerado: ${outputPath}`);
});
