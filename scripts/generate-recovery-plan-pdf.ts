import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";

const OUTPUT = path.resolve(process.cwd(), "plano-recuperacao-licigov-pro.pdf");

const doc = new PDFDocument({ margin: 60, size: "A4", bufferPages: true });
const stream = fs.createWriteStream(OUTPUT);
doc.pipe(stream);

// ─── cores e medidas ────────────────────────────────────────────────────────
const C = {
  title: "#111827",
  h1: "#1D4ED8",
  h2: "#1E40AF",
  h3: "#374151",
  body: "#111827",
  muted: "#6B7280",
  code_bg: "#F3F4F6",
  code_text: "#1F2937",
  accent: "#DC2626",
  border: "#E5E7EB",
  table_head: "#DBEAFE",
};

const PAGE_W = doc.page.width - 120; // largura útil

// ─── helpers ────────────────────────────────────────────────────────────────

function ensureSpace(needed: number) {
  if (doc.y + needed > doc.page.height - 80) doc.addPage();
}

function h1(text: string) {
  ensureSpace(50);
  doc.moveDown(0.6);
  doc
    .fontSize(18)
    .fillColor(C.h1)
    .font("Helvetica-Bold")
    .text(text, { paragraphGap: 4 });
  doc
    .moveTo(60, doc.y + 2)
    .lineTo(60 + PAGE_W, doc.y + 2)
    .strokeColor(C.h1)
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.4);
}

function h2(text: string) {
  ensureSpace(36);
  doc.moveDown(0.5);
  doc.fontSize(13).fillColor(C.h2).font("Helvetica-Bold").text(text, { paragraphGap: 2 });
  doc.moveDown(0.2);
}

function h3(text: string) {
  ensureSpace(28);
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor(C.h3).font("Helvetica-Bold").text(text, { paragraphGap: 2 });
  doc.moveDown(0.1);
}

function p(text: string) {
  doc.fontSize(10).fillColor(C.body).font("Helvetica").text(text, { lineGap: 2, paragraphGap: 4 });
}

function label(key: string, value: string) {
  doc.fontSize(10).fillColor(C.body).font("Helvetica").text("", { continued: false });
  doc
    .fontSize(10)
    .font("Helvetica-Bold")
    .fillColor(C.body)
    .text(key + ": ", { continued: true })
    .font("Helvetica-Oblique")
    .fillColor(C.muted)
    .text(value, { continued: false, lineGap: 2 });
}

function codeBlock(lines: string[]) {
  const lineH = 13;
  const padV = 6;
  const padH = 10;
  const height = lines.length * lineH + padV * 2;
  ensureSpace(height + 8);
  doc
    .rect(60, doc.y, PAGE_W, height)
    .fillColor(C.code_bg)
    .fill();
  const startY = doc.y + padV;
  lines.forEach((line, i) => {
    doc
      .fontSize(8.5)
      .font("Courier")
      .fillColor(C.code_text)
      .text(line || " ", 60 + padH, startY + i * lineH, { lineBreak: false });
  });
  doc.y = startY + lines.length * lineH + padV;
  doc.moveDown(0.4);
}

function bullet(text: string) {
  doc
    .fontSize(10)
    .fillColor(C.body)
    .font("Helvetica")
    .text("• " + text, { indent: 12, lineGap: 2, paragraphGap: 3 });
}

function checkItem(text: string) {
  doc
    .fontSize(10)
    .fillColor(C.body)
    .font("Helvetica")
    .text("☐ " + text, { indent: 12, lineGap: 2, paragraphGap: 3 });
}

function sep() {
  doc.moveDown(0.4);
  doc
    .moveTo(60, doc.y)
    .lineTo(60 + PAGE_W, doc.y)
    .strokeColor(C.border)
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.4);
}

function table2(headers: [string, string], rows: [string, string][]) {
  const col1W = PAGE_W * 0.35;
  const col2W = PAGE_W * 0.65;
  const rowH = 18;
  const padH = 6;
  ensureSpace((rows.length + 1) * rowH + 12);

  // header
  doc.rect(60, doc.y, col1W, rowH).fillColor(C.table_head).fill();
  doc.rect(60 + col1W, doc.y, col2W, rowH).fillColor(C.table_head).fill();
  doc
    .fontSize(9)
    .font("Helvetica-Bold")
    .fillColor(C.h2)
    .text(headers[0], 60 + padH, doc.y + 4, { width: col1W - padH * 2, lineBreak: false });
  doc
    .text(headers[1], 60 + col1W + padH, doc.y, { width: col2W - padH * 2, lineBreak: false });
  doc.y += rowH;

  rows.forEach(([c1, c2], i) => {
    const bg = i % 2 === 0 ? "#FFFFFF" : "#F9FAFB";
    doc.rect(60, doc.y, PAGE_W, rowH).fillColor(bg).fill();
    doc
      .rect(60, doc.y, PAGE_W, rowH)
      .strokeColor(C.border)
      .lineWidth(0.3)
      .stroke();
    doc
      .fontSize(9)
      .font("Courier")
      .fillColor(C.code_text)
      .text(c1, 60 + padH, doc.y + 4, { width: col1W - padH * 2, lineBreak: false });
    doc
      .font("Helvetica")
      .fillColor(C.body)
      .text(c2, 60 + col1W + padH, doc.y + 4, { width: col2W - padH * 2, lineBreak: false });
    doc.y += rowH;
  });
  doc.moveDown(0.5);
}

function table3(headers: [string, string, string], rows: [string, string, string][]) {
  const c1W = PAGE_W * 0.12;
  const c2W = PAGE_W * 0.42;
  const c3W = PAGE_W * 0.46;
  const rowH = 20;
  const padH = 5;
  ensureSpace((rows.length + 1) * rowH + 12);

  doc.rect(60, doc.y, PAGE_W, rowH).fillColor(C.table_head).fill();
  [headers[0], headers[1], headers[2]].forEach((h, i) => {
    const x = 60 + [0, c1W, c1W + c2W][i]!;
    const w = [c1W, c2W, c3W][i]!;
    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor(C.h2)
      .text(h, x + padH, doc.y + 4, { width: w - padH * 2, lineBreak: false });
  });
  doc.y += rowH;

  rows.forEach(([c1, c2, c3], i) => {
    const bg = i % 2 === 0 ? "#FFFFFF" : "#F9FAFB";
    doc.rect(60, doc.y, PAGE_W, rowH).fillColor(bg).fill();
    doc.rect(60, doc.y, PAGE_W, rowH).strokeColor(C.border).lineWidth(0.3).stroke();
    doc
      .fontSize(9).font("Helvetica-Bold").fillColor(C.h1)
      .text(c1, 60 + padH, doc.y + 5, { width: c1W - padH * 2, lineBreak: false });
    doc
      .font("Helvetica").fillColor(C.body)
      .text(c2, 60 + c1W + padH, doc.y + 5, { width: c2W - padH * 2, lineBreak: false });
    doc
      .font("Courier").fillColor(C.muted)
      .text(c3, 60 + c1W + c2W + padH, doc.y + 5, { width: c3W - padH * 2, lineBreak: false });
    doc.y += rowH;
  });
  doc.moveDown(0.5);
}

// ─── capa ─────────────────────────────────────────────────────────────────────
doc.rect(0, 0, doc.page.width, 180).fillColor("#1D4ED8").fill();
doc
  .fontSize(28)
  .font("Helvetica-Bold")
  .fillColor("#FFFFFF")
  .text("Plano de Recuperação", 60, 50, { align: "center", width: PAGE_W });
doc
  .fontSize(20)
  .font("Helvetica")
  .fillColor("#BFDBFE")
  .text("LiciGov Pro", 60, 90, { align: "center", width: PAGE_W });
doc
  .fontSize(10)
  .font("Helvetica")
  .fillColor("#93C5FD")
  .text("Análise técnica e guia de recuperação independente da plataforma Manus", 60, 120, {
    align: "center",
    width: PAGE_W,
  });
doc.y = 200;

// ─── 1. Visão Geral ──────────────────────────────────────────────────────────
h1("1. Visão Geral do Sistema");
p(
  "LiciGov Pro é um SaaS para geração automatizada de documentos de licitação pública " +
    "conforme a Lei 14.133/2021, com fluxo: DFD → ETP → TR → Edital."
);
doc.moveDown(0.3);

h2("Stack Tecnológica");
table2(["Camada", "Tecnologia"], [
  ["Frontend", "React 19 + Vite 7 + TailwindCSS 4 + wouter"],
  ["Backend", "Node.js + Express 4 + tRPC 11"],
  ["ORM", "Drizzle ORM 0.44"],
  ["Banco", "MySQL / TiDB (dialeto MySQL)"],
  ["IA", "Gemini 2.5 Flash (via Manus Forge — a substituir)"],
  ["Auth", "JWT em cookie (via Manus OAuth — a substituir)"],
  ["Package manager", "pnpm 10.4"],
]);

h2("Estrutura de Pastas");
codeBlock([
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
  "│   │   ├── llm.ts        # Abstração LLM → Forge API",
  "│   │   └── env.ts        # ENV vars",
  "│   ├── routers.ts        # AppRouter (15+ sub-routers)",
  "│   └── services/         # gemini.ts, RAG, etc.",
  "├── drizzle/schema.ts     # ~20 tabelas MySQL",
  "└── shared/               # Tipos e constantes",
]);

sep();

// ─── 2. Problemas ─────────────────────────────────────────────────────────────
h1("2. Problemas Identificados");

h2("CRÍTICO 1 — Plugin Manus no Vite");
label("Arquivo", "vite.config.ts:10");
p("Plugin proprietário da Manus. Quebra o build completamente fora da plataforma.");
codeBlock([
  `// PROBLEMA`,
  `import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";`,
  `const plugins = [react(), tailwindcss(), vitePluginManusRuntime()];`,
  ``,
  `// FIX`,
  `const plugins = [react(), tailwindcss()];`,
]);

h2("CRÍTICO 2 — Auth via OAuth Manus");
label("Arquivo", "server/_core/sdk.ts");
p(
  "Todo login depende dos endpoints OAUTH_SERVER_URL da Manus. " +
    "Sem acesso à Manus, nenhum usuário consegue fazer login. " +
    "A boa notícia: JWT (signSession/verifySession com jose) já está implementado — só o provedor é Manus."
);
p("Fix: implementar auth próprio com email + senha (bcrypt já está no package.json).");

h2("CRÍTICO 3 — LLM via Forge Manus");
label("Arquivo", "server/_core/llm.ts");
p(
  "Todas as chamadas de IA passam pela Forge API da Manus. " +
    "Fix: trocar para Gemini direto via @google/generative-ai (SDK já instalada)."
);

h2("MÉDIO 4 — Sem .env.example no repo");
p("Sem arquivo de referência de variáveis de ambiente, erros opacos na inicialização.");

sep();

// ─── 3. Como Rodar ────────────────────────────────────────────────────────────
h1("3. Como Rodar Localmente");

h2("Pré-requisitos");
bullet("Node.js 20+");
bullet("pnpm 10.4+ → npm install -g pnpm@10.4.1");
bullet("MySQL acessível (ver seção 4)");
doc.moveDown(0.3);

h3("Passo 1 — Instalar dependências");
codeBlock(["cd licigov-pro", "pnpm install"]);

h3("Passo 2 — Criar o arquivo .env na raiz");
codeBlock([
  "# Servidor",
  "NODE_ENV=development",
  "PORT=3000",
  "",
  "# Banco (MySQL ou compatível)",
  "DATABASE_URL=mysql://root:senha@localhost:3306/licigov",
  "",
  "# JWT — string longa e aleatória (mín. 32 chars)",
  "JWT_SECRET=sua-chave-secreta-super-longa-aqui",
  "",
  "# IA — Google Gemini direto",
  "GEMINI_API_KEY=sua-chave-gemini",
]);

h3("Passo 3 — Criar banco e rodar migrações");
codeBlock(["pnpm db:push", "# Equivale a: drizzle-kit generate && drizzle-kit migrate"]);

h3("Passo 4 — Rodar em desenvolvimento");
codeBlock([
  "pnpm dev",
  "# → Express na porta 3000",
  "# → tRPC em /api/trpc",
  "# → Vite middleware com HMR",
]);

h3("Passo 5 — Build de produção");
codeBlock([
  "pnpm vite build                         # → dist/public/",
  "esbuild server/_core/index.ts \\",
  "  --platform=node --packages=external \\",
  "  --bundle --format=esm --outdir=dist   # → dist/index.js",
  "NODE_ENV=production node dist/index.js",
]);

sep();

// ─── 4. Banco ─────────────────────────────────────────────────────────────────
h1("4. Opções de Banco de Dados Gratuitas");
table3(["", "Serviço", "Como usar"], [
  ["Docker", "Ilimitado local", "docker run -p 3306:3306 -e MYSQL_ROOT_PASSWORD=senha mysql:8"],
  ["PlanetScale", "5 GB free tier", "Criar DB, copiar connection string MySQL"],
  ["Railway", "$5 crédito/mês", "Provisionar MySQL, pegar DATABASE_URL"],
  ["TiDB Cloud", "5 GB serverless", "Compatível MySQL 100%, free tier"],
]);

sep();

// ─── 5. Plano de Fixes ────────────────────────────────────────────────────────
h1("5. Plano de Fixes por Fase");

h2("Fase 1 — Fazer o projeto ligar (urgente)");
h3("Fix 1.1 — Remover plugin Manus do Vite  [vite.config.ts]");
codeBlock([
  `// Remover import e uso de vitePluginManusRuntime`,
  `const plugins = [react(), tailwindcss()];`,
]);

h2("Fase 2 — Autenticação própria");
h3("Fix 2.1 — Novo router de auth  [server/routers/auth.ts]");
bullet("auth.register → bcrypt.hash, insere user, gera JWT, seta cookie");
bullet("auth.login → bcrypt.compare, gera JWT, seta cookie");
bullet("auth.logout → limpa cookie");
bullet("auth.me → verifica JWT, retorna user (já existe parcialmente)");
doc.moveDown(0.3);
h3("Fix 2.2 — Simplificar authenticateRequest  [server/_core/sdk.ts]");
p("Remover fallback para getUserInfoWithJwt (endpoint Manus). Manter apenas: verificar cookie JWT → buscar user no DB.");

h2("Fase 3 — Substituir LLM  [server/_core/llm.ts]");
codeBlock([
  `import { GoogleGenerativeAI } from "@google/generative-ai";`,
  ``,
  `const genAI = new GoogleGenerativeAI(ENV.geminiApiKey);`,
  ``,
  `export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {`,
  `  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });`,
  `  // manter mesma assinatura InvokeParams/InvokeResult`,
  `}`,
]);

h2("Fase 4 — Criar .env.example");
p("Documentar todas as variáveis com comentários e indicação de obrigatório vs opcional.");

sep();

// ─── 6. Fluxos ───────────────────────────────────────────────────────────────
h1("6. Fluxos do Sistema");

h2("Fluxo de Autenticação (após os fixes)");
codeBlock([
  "Usuário → POST /api/trpc/auth.login",
  "         → bcrypt.compare(senha, hash)",
  "         → sdk.signSession({ openId: user.id })  ← JWT local",
  "         → res.cookie('session', token)",
  "         → redirect /dashboard",
  "",
  "Cada request → createContext() → sdk.verifySession(cookie)",
  "             → db.getUserByOpenId(openId) → ctx.user populado",
  "             → protectedProcedure funciona normalmente",
]);

h2("Fluxo tRPC (já funciona, não muda)");
codeBlock([
  "Frontend: trpc.processes.list.useQuery()",
  "  → HTTP GET /api/trpc/processes.list",
  "  → createExpressMiddleware",
  "  → createContext (auth via cookie)",
  "  → protectedProcedure.query(...)",
  "  → Drizzle → MySQL → superjson response",
]);
p(
  "O endpoint /api/trpc está corretamente configurado em server/_core/index.ts. " +
    "O client em client/src/lib/trpc.ts aponta para AppRouter via import de tipo — não precisa de alteração."
);

sep();

// ─── 7. Checklist ─────────────────────────────────────────────────────────────
h1("7. Checklist de Verificação");
[
  "pnpm install sem erros",
  ".env criado com DATABASE_URL e JWT_SECRET",
  "pnpm db:push cria as tabelas no banco",
  "pnpm dev inicia sem erros no terminal",
  "GET http://localhost:3000 retorna o frontend React",
  "POST http://localhost:3000/api/trpc/auth.login retorna resposta tRPC",
  "Login com email/senha funciona e seta cookie",
  "/dashboard acessível após login",
  "Geração de documento (ETP) chama Gemini e retorna texto",
].forEach(checkItem);

sep();

// ─── 8. Resumo ───────────────────────────────────────────────────────────────
h1("8. Resumo Executivo");
table3(["#", "Ação", "Arquivo Principal"], [
  ["1", "Remover vite-plugin-manus-runtime", "vite.config.ts"],
  ["2", "Implementar auth email/senha", "server/routers/auth.ts, server/_core/sdk.ts"],
  ["3", "Trocar LLM Forge → Gemini SDK", "server/_core/llm.ts"],
  ["4", "Criar .env.example", ".env.example (novo)"],
  ["5", "Provisionar banco MySQL", "Infra / Docker"],
]);

// ─── numeração de páginas ─────────────────────────────────────────────────────
const totalPages = (doc.bufferedPageRange().count);
for (let i = 0; i < totalPages; i++) {
  doc.switchToPage(i);
  doc
    .fontSize(8)
    .font("Helvetica")
    .fillColor(C.muted)
    .text(`${i + 1} / ${totalPages}`, 60, doc.page.height - 40, {
      align: "right",
      width: PAGE_W,
    });
}

doc.end();

stream.on("finish", () => {
  console.log(`✓ PDF gerado: ${OUTPUT}`);
});
