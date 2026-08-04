/**
 * PR B.2.1 — Guardas arquiteturais da ingestão canônica (varredura de fonte, padrão do projeto).
 *
 * Assegura, sem executar o servidor:
 *  - o router usa tenantProcedure (nunca publicProcedure) e é gated por feature flag em toda rota;
 *  - NÃO estende o legado congelado (não importa processes.parseItemsFile / documentsRouter / gemini);
 *  - NÃO trafega base64/binário pelo tRPC;
 *  - NÃO grava extração diretamente no domínio (só toca import_sessions / import_staging_items);
 *  - o byte-upload é uma rota Express com binário cru + auth + validação server-side;
 *  - a superfície está registrada no appRouter.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const ROUTER = read("server/routers/ingestionRouter.ts");
const UPLOAD = read("server/routes/ingestionUploadRoute.ts");
const UPLOAD_SVC = read("server/services/ingestionUploadService.ts");
const QUEUE = read("server/services/importQueueService.ts");
const APP = read("server/routers.ts");
const INDEX = read("server/_core/index.ts");

describe("ingestionRouter — tenant-safe e gated por feature flag", () => {
  it("usa tenantProcedure e não expõe publicProcedure", () => {
    expect(ROUTER).toContain("tenantProcedure");
    expect(ROUTER).not.toContain("publicProcedure");
  });

  it("toda mutation/query chama assertCanonicalIngestionEnabled (flag fail-closed)", () => {
    const procedures = (ROUTER.match(/tenantProcedure/g) ?? []).length;
    const gates = (ROUTER.match(/assertCanonicalIngestionEnabled/g) ?? []).length;
    // 7 contratos → 7 procedures e ao menos 7 chamadas de guarda de flag.
    expect(procedures).toBeGreaterThanOrEqual(7);
    expect(gates).toBeGreaterThanOrEqual(7);
  });
});

describe("ingestionRouter — não estende o legado congelado", () => {
  it("não importa routers/serviços legados de processo/documento nem o gemini", () => {
    expect(ROUTER).not.toMatch(/processesRouter|parseItemsFile/);
    expect(ROUTER).not.toMatch(/from ["'][^"']*documentsRouter["']/);
    expect(ROUTER).not.toMatch(/services\/gemini/);
  });
});

describe("ingestão — sem base64/binário no tRPC", () => {
  // Mira o USO real (literal 'base64' em Buffer.from / toString), não a palavra em comentários.
  const BASE64_USAGE = /['"]base64['"]|Buffer\.from\([^)]*base64|toString\(\s*['"]base64['"]/;
  it("o router não decodifica base64 nem recebe conteúdo de arquivo por input", () => {
    expect(ROUTER).not.toMatch(BASE64_USAGE);
    expect(ROUTER).not.toMatch(/fileContent\s*:/);
  });
  it("o byte-upload é multipart streaming (busboy) e não decodifica base64", () => {
    expect(UPLOAD).toContain("busboy");
    expect(UPLOAD).toContain("streamFileToStorage");
    expect(UPLOAD).not.toContain("express.raw");
    expect(UPLOAD).not.toMatch(BASE64_USAGE);
  });
  it("streaming: sem materializar o arquivo inteiro (usa pipeline/Transform, não Buffer.concat do corpo)", () => {
    expect(UPLOAD_SVC).toContain("pipeline");
    expect(UPLOAD_SVC).toContain("storagePutStream");
  });
});

describe("fila — sem Buffer no job (recuperável)", () => {
  it("o job da fila NÃO transporta Buffer (apenas storageKey + metadados)", () => {
    // A interface ImportJob não deve declarar um campo buffer.
    expect(QUEUE).not.toMatch(/buffer\s*:\s*Buffer/);
    expect(QUEUE).toContain("storageKey:");
    expect(QUEUE).toContain("correlationId");
  });
  it("expõe recuperação replay-safe após restart", () => {
    expect(QUEUE).toContain("recoverStuckImportSessions");
    expect(QUEUE).toContain("claimSessionForRecovery");
  });
});

describe("ingestão — sem gravação direta no domínio", () => {
  it("router e serviço de upload só tocam tabelas de importação (staging isolado)", () => {
    for (const src of [ROUTER, UPLOAD, UPLOAD_SVC]) {
      // Não pode inserir em tabelas de domínio a partir da ingestão.
      expect(src).not.toMatch(/insert\(\s*(priceResearch|priceResearchItems|intelligentItems|itemTr|catmatItems|generatedDocuments)/);
    }
  });
});

describe("byte-upload — segurança server-side", () => {
  it("autentica como o tRPC (sdk.authenticateRequest + resolveTenantForUser) e valida conteúdo", () => {
    expect(UPLOAD).toContain("authenticateRequest");
    expect(UPLOAD).toContain("resolveTenantForUser");
    expect(UPLOAD).toContain("assertCanonicalIngestionEnabled");
    expect(UPLOAD).toContain("streamFileToStorage");
  });
  it("gera a chave de storage no servidor (nome não controlado pelo cliente)", () => {
    expect(UPLOAD_SVC).toContain("buildIngestionStorageKey");
    expect(UPLOAD_SVC).toContain("sanitizeFileName");
  });
});

describe("registro da superfície", () => {
  it("appRouter registra ingestion: ingestionRouter", () => {
    expect(APP).toContain("ingestion: ingestionRouter");
    expect(APP).toContain('import { ingestionRouter } from "./routers/ingestionRouter"');
  });
  it("a rota de upload é montada no bootstrap Express", () => {
    expect(INDEX).toContain("registerIngestionUploadRoute");
  });
});
