/**
 * R2 / LEG-009 — desligamento GOVERNADO do router legado `documents.*` (inventário R2.1, decisão humana de
 * 27/09/2026 = DISABLE, PR próprio) — camada de dados MOCKADA (complementa o smoke MySQL real
 * `r2-leg009-legacy-documents-disabled-mysql-smoke.test.ts`).
 *
 * Procedures cobertas (13; continuam REGISTRADAS e com o MESMO schema de input):
 *   listByProcess, list, save, getByType, generateNext, updateDocument, generateDocument, uploadDocument,
 *   getDownloadUrl, getVersionHistory, restoreVersion, downloadDocx, downloadPdf
 * Alternativa canônica: "o Processo Licitatório canônico (procurementProcess.*) e o Document Engine (documentEngine.*)".
 * FORA do escopo (PR-02 / LEG-008, outro branch): submitForReview, approveDocument, rejectDocument — ficam
 * exatamente como na main.
 *
 * Contrato verificado:
 *  - toda chamada é recusada com FORBIDDEN + token estável LEGACY_ENDPOINT_DISABLED + alternativa canônica;
 *  - ZERO efeito colateral: nenhuma função de db (inclui createActivityLog), storage (storagePut/storageGet),
 *    gemini (generate*), _core/llm (invokeLLM), documentConverter (convertToPDF/convertToDOCX),
 *    institutionalIdentityService ou activityLogService é chamada;
 *  - evento estruturado `legacy_endpoint_disabled` com procedure + surfaceId LEG-009 + tenant/ator/correlationId
 *    do CONTEXTO e SEM o input do cliente;
 *  - owner, operator (membro), viewer e chamador de OUTRO tenant recebem o MESMO erro (anti-enumeração);
 *  - autenticação continua exigida (UNAUTHORIZED antes do handler) e o schema de input continua validando.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const tenant = vi.hoisted(() => ({ role: "operator" as string, org: 1 }));

/**
 * Substitui TODA função exportada do módulo por um spy inerte (retorna undefined). Qualquer chamada vira
 * evidência de efeito colateral / leitura antes da recusa.
 */
const spyAll = vi.hoisted(() => async (importOriginal: () => Promise<Record<string, unknown>>) => {
  const actual = await importOriginal();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(actual)) out[k] = typeof v === "function" ? vi.fn() : v;
  return out;
});

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async (userId: number) => ({
    organizationId: tenant.org,
    membership: {
      id: 1, organizationId: tenant.org, userId, role: tenant.role, invitedBy: null, ativo: true,
      createdAt: new Date(), updatedAt: new Date(),
    },
  })),
}));
vi.mock("../../db", (io) => spyAll(io as never));
vi.mock("../../storage", (io) => spyAll(io as never));
vi.mock("../../services/gemini", (io) => spyAll(io as never));
vi.mock("../../_core/llm", (io) => spyAll(io as never));
vi.mock("../../services/documentConverter", (io) => spyAll(io as never));
vi.mock("../../services/institutionalIdentityService", (io) => spyAll(io as never));
vi.mock("../../services/activityLogService", (io) => spyAll(io as never));

import * as db from "../../db";
import * as storage from "../../storage";
import * as gemini from "../../services/gemini";
import * as llm from "../../_core/llm";
import * as converter from "../../services/documentConverter";
import * as identity from "../../services/institutionalIdentityService";
import * as activityLogService from "../../services/activityLogService";
import { documentsRouter } from "../../routers/documentsRouter";
import { LEGACY_ENDPOINT_DISABLED } from "../../services/legacyEndpointGuard";

const ORG_A = 1;
const ORG_B = 2;
const SENTINEL = "SENTINEL-PAYLOAD-LEG009";
const SENTINEL_ID = 424243;
const ALTERNATIVE =
  "o Processo Licitatório canônico (procurementProcess.*) e o Document Engine (documentEngine.*)";

type Ctx = Parameters<typeof documentsRouter.createCaller>[0];
function ctxFor(userId: number | null, correlationId: string): Ctx {
  return {
    user: userId === null ? null : { id: userId, role: "user", name: `Ator ${userId}`, email: `ator${userId}@teste.local` },
    req: { headers: {}, ip: "127.0.0.1" },
    res: {},
    correlationId,
  } as unknown as Ctx;
}

const b64 = Buffer.from(SENTINEL).toString("base64");

/** As 13 procedures desativadas, cada uma com um input VÁLIDO carregando valores-sentinela. */
const SURFACES: Array<{ procedure: string; call: (ctx: Ctx) => Promise<unknown> }> = [
  { procedure: "listByProcess", call: (c) => documentsRouter.createCaller(c).listByProcess({ processId: SENTINEL_ID }) },
  { procedure: "list", call: (c) => documentsRouter.createCaller(c).list({ processId: SENTINEL_ID }) },
  { procedure: "save", call: (c) => documentsRouter.createCaller(c).save({ processId: SENTINEL_ID, type: "etp", content: SENTINEL }) },
  { procedure: "getByType", call: (c) => documentsRouter.createCaller(c).getByType({ processId: SENTINEL_ID, type: "tr" }) },
  { procedure: "generateNext", call: (c) => documentsRouter.createCaller(c).generateNext({ processId: SENTINEL_ID }) },
  { procedure: "updateDocument", call: (c) => documentsRouter.createCaller(c).updateDocument({ documentId: SENTINEL_ID, content: SENTINEL }) },
  { procedure: "generateDocument", call: (c) => documentsRouter.createCaller(c).generateDocument({ processId: SENTINEL_ID, docType: "etp" }) },
  {
    procedure: "uploadDocument",
    call: (c) => documentsRouter.createCaller(c).uploadDocument({
      processId: SENTINEL_ID, docType: "tr", fileName: `${SENTINEL}.pdf`, fileBase64: b64, mimeType: "application/pdf",
    }),
  },
  { procedure: "getDownloadUrl", call: (c) => documentsRouter.createCaller(c).getDownloadUrl({ documentId: SENTINEL_ID }) },
  { procedure: "getVersionHistory", call: (c) => documentsRouter.createCaller(c).getVersionHistory({ documentId: SENTINEL_ID }) },
  { procedure: "restoreVersion", call: (c) => documentsRouter.createCaller(c).restoreVersion({ documentId: SENTINEL_ID, versionId: SENTINEL_ID + 1 }) },
  { procedure: "downloadDocx", call: (c) => documentsRouter.createCaller(c).downloadDocx({ documentId: SENTINEL_ID }) },
  { procedure: "downloadPdf", call: (c) => documentsRouter.createCaller(c).downloadPdf({ documentId: SENTINEL_ID }) },
];

const SIDE_EFFECT_MODULES: Array<[string, Record<string, unknown>]> = [
  ["db", db], ["storage", storage], ["gemini", gemini], ["llm", llm], ["documentConverter", converter],
  ["institutionalIdentityService", identity], ["activityLogService", activityLogService],
];

/** Lista "modulo.funcao" de toda função mockada que foi chamada. */
function calledFunctions(): string[] {
  const called: string[] = [];
  for (const [name, mod] of SIDE_EFFECT_MODULES) {
    for (const [k, v] of Object.entries(mod)) {
      if (vi.isMockFunction(v) && v.mock.calls.length > 0) called.push(`${name}.${k}`);
    }
  }
  return called;
}

let warnSpy: ReturnType<typeof vi.spyOn>;
function legacyEvents(): Array<{ raw: string; entry: Record<string, unknown> }> {
  return warnSpy.mock.calls
    .map((args) => String(args[0]))
    .filter((raw) => raw.includes("legacy_endpoint_disabled"))
    .map((raw) => ({ raw, entry: JSON.parse(raw) as Record<string, unknown> }));
}

async function errOf(p: Promise<unknown>): Promise<{ code?: string; message?: string }> {
  try { await p; } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message }; }
  return { code: "RESOLVED", message: "" };
}

beforeEach(() => {
  vi.clearAllMocks();
  tenant.role = "operator";
  tenant.org = ORG_A;
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { warnSpy.mockRestore(); });

describe("R2 / LEG-009 — router legado documents.* desativado (dados mockados)", () => {
  it("sanidade: as funções de efeito colateral usadas pelos handlers antigos estão sob spy", () => {
    for (const f of [
      db.getProcessByIdForOrganization, db.getProcessMember, db.getDocumentsByProcessForOrganization,
      db.getDocumentByProcessAndTypeForOrganization, db.getDocumentByIdForOrganization,
      db.getDocumentVersionsForOrganization, db.getProcessItemsForOrganization, db.createDocument,
      db.updateProcessStatusForOrganization, db.createActivityLog,
      storage.storagePut, storage.storageGet,
      gemini.generateDFD, gemini.generateETP, gemini.generateTR, gemini.generateEdital,
      gemini.generateContrato, gemini.generateAta, gemini.generateParecer,
      llm.invokeLLM, converter.convertToPDF, converter.convertToDOCX,
      identity.resolveInstitutionalIdentity, identity.institutionalIdentityFromMetadataOrLive,
    ]) expect(vi.isMockFunction(f)).toBe(true);
  });

  it("cobre exatamente as 13 procedures do escopo LEG-009", () => {
    expect(SURFACES.map((s) => s.procedure).sort()).toEqual([
      "downloadDocx", "downloadPdf", "generateDocument", "generateNext", "getByType", "getDownloadUrl",
      "getVersionHistory", "list", "listByProcess", "restoreVersion", "save", "updateDocument", "uploadDocument",
    ]);
  });

  it.each(SURFACES.map((s) => [s.procedure, s] as const))(
    "documents.%s: FORBIDDEN + LEGACY_ENDPOINT_DISABLED, zero efeito colateral, evento LEG-009 sem payload",
    async (_name, s) => {
      const procedure = `documents.${s.procedure}`;
      const err = await errOf(s.call(ctxFor(10, `corr-${s.procedure}`)));
      expect(err.code).toBe("FORBIDDEN");
      expect(err.message).toContain(LEGACY_ENDPOINT_DISABLED);
      expect(err.message).toContain(ALTERNATIVE);
      // a mensagem não ecoa o input nem identificadores
      expect(err.message).not.toContain(SENTINEL);
      expect(err.message).not.toContain(String(SENTINEL_ID));

      // zero leitura/escrita/IA/S3/conversão/activity log antes da recusa
      expect(calledFunctions()).toEqual([]);
      expect(db.createActivityLog).not.toHaveBeenCalled();
      expect(storage.storagePut).not.toHaveBeenCalled();
      expect(storage.storageGet).not.toHaveBeenCalled();
      expect(converter.convertToPDF).not.toHaveBeenCalled();
      expect(converter.convertToDOCX).not.toHaveBeenCalled();
      expect(llm.invokeLLM).not.toHaveBeenCalled();

      const events = legacyEvents();
      expect(events).toHaveLength(1);
      expect(events[0].entry).toMatchObject({
        level: "warn", service: "legacyEndpointGuard", operation: "legacy_endpoint_disabled",
        procedure, surfaceId: "LEG-009", organizationId: ORG_A, actorUserId: 10,
        correlationId: `corr-${s.procedure}`,
      });
      // sem o input do cliente (nem chaves, nem valores)
      expect(events[0].raw).not.toContain(SENTINEL);
      expect(events[0].raw).not.toContain(String(SENTINEL_ID));
      expect(events[0].raw).not.toContain(b64);
      for (const key of [
        "input", "processId", "documentId", "versionId", "content", "type", "docType", "fileName", "fileBase64",
        "mimeType", "email",
      ]) {
        expect(Object.keys(events[0].entry)).not.toContain(key);
      }
    },
  );

  it.each(SURFACES.map((s) => [s.procedure, s] as const))(
    "documents.%s: owner, operator (membro), viewer e outro tenant recebem o MESMO erro governado",
    async (_name, s) => {
      const actors: Array<{ role: string; org: number; user: number }> = [
        { role: "owner", org: ORG_A, user: 11 },
        { role: "operator", org: ORG_A, user: 12 },
        { role: "viewer", org: ORG_A, user: 13 },
        { role: "owner", org: ORG_B, user: 14 }, // cross-tenant
      ];
      const results: Array<{ code?: string; message?: string }> = [];
      for (const a of actors) {
        tenant.role = a.role; tenant.org = a.org;
        results.push(await errOf(s.call(ctxFor(a.user, "corr-matrix"))));
      }
      expect(results[0].code).toBe("FORBIDDEN");
      expect(results[0].message).toContain(LEGACY_ENDPOINT_DISABLED);
      for (const r of results) expect(r).toEqual(results[0]);

      expect(calledFunctions()).toEqual([]);
      // um evento por chamada; o evento carrega o tenant do CONTEXTO, nunca o do recurso
      const events = legacyEvents();
      expect(events).toHaveLength(4);
      expect(events.map((e) => e.entry.organizationId)).toEqual([ORG_A, ORG_A, ORG_A, ORG_B]);
      expect(events.map((e) => e.entry.actorUserId)).toEqual([11, 12, 13, 14]);
      for (const e of events) expect(e.entry.surfaceId).toBe("LEG-009");
    },
  );

  it("não autenticado: UNAUTHORIZED antes do handler (auth preservada), sem evento e sem efeito", async () => {
    for (const s of SURFACES) {
      expect((await errOf(s.call(ctxFor(null, "corr-anon")))).code, s.procedure).toBe("UNAUTHORIZED");
    }
    expect(calledFunctions()).toEqual([]);
    expect(legacyEvents()).toHaveLength(0);
  });

  it("schemas de input preservados: input inválido ainda é rejeitado pela validação (BAD_REQUEST), sem efeito", async () => {
    const c = ctxFor(10, "corr-schema");
    const r = documentsRouter.createCaller(c);
    const invalid: Array<Promise<unknown>> = [
      r.listByProcess({} as never),
      r.list({ processId: "x" } as never),
      r.save({ processId: 1, type: "invalido", content: "x" } as never),
      r.save({ processId: 1, type: "etp", content: "x".repeat(500_001) }),
      r.getByType({ processId: 1, type: "aditivo" } as never),
      r.generateNext({} as never),
      r.updateDocument({ documentId: 1 } as never),
      r.generateDocument({ processId: 1, docType: "minuta" } as never),
      r.uploadDocument({ processId: 1, docType: "tr", fileName: "../../etc/passwd", fileBase64: "abc", mimeType: "application/pdf" }),
      r.uploadDocument({ processId: 1, docType: "tr", fileName: "a.exe", fileBase64: "abc", mimeType: "application/x-msdownload" } as never),
      r.getDownloadUrl({ documentId: "1" } as never),
      r.getVersionHistory({} as never),
      r.restoreVersion({ documentId: 1 } as never),
      r.downloadDocx({} as never),
      r.downloadPdf({ documentId: null } as never),
    ];
    for (const p of invalid) expect((await errOf(p)).code).toBe("BAD_REQUEST");
    expect(calledFunctions()).toEqual([]);
    expect(legacyEvents()).toHaveLength(0);
  });

  it("contrato estático: o guard LEG-009 é a PRIMEIRA (e única) instrução de cada handler desativado", () => {
    const src = readFileSync(resolve(__dirname, "../../routers/documentsRouter.ts"), "utf8");
    for (const s of SURFACES) {
      const start = src.indexOf(`\n  ${s.procedure}: tenantProcedure`);
      expect(start, s.procedure).toBeGreaterThan(-1);
      const block = src.slice(start, src.indexOf("\n    }),", start));
      const m = block.match(/\.(query|mutation)\(async \(\{ ctx \}\)(?::\s*Promise<\w+>)? => \{/);
      expect(m, s.procedure).not.toBeNull();
      const body = block.slice(block.indexOf(m![0]) + m![0].length);
      const statements = body.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
      expect(statements, s.procedure).toEqual([
        `throwLegacyEndpointDisabled("documents.${s.procedure}", "LEG-009", ctx, LEG009_ALTERNATIVE);`,
      ]);
    }
    expect(src).toContain(`const LEG009_ALTERNATIVE =\n  "${ALTERNATIVE}";`);
  });

  it("contrato estático: o router legado não alcança mais IA, conversão, S3 nem identidade institucional", () => {
    const src = readFileSync(resolve(__dirname, "../../routers/documentsRouter.ts"), "utf8");
    for (const mod of ["services/gemini", "services/documentConverter", "storage", "_core/llm", "services/institutionalIdentityService"]) {
      expect(src, mod).not.toMatch(new RegExp(`from ["'][^"']*${mod.replace("/", "\\/")}["']`));
    }
    // congelamento RC-C0.1A continua honesto: exatamente 2 `docType: z.enum([...])` (generateDocument, uploadDocument)
    expect([...src.matchAll(/docType:\s*z\.enum\(\[([^\]]+)\]\)/g)]).toHaveLength(2);
  });

  it("separação: submitForReview/approveDocument/rejectDocument (PR-02 / LEG-008) NÃO são tocados por LEG-009", () => {
    const src = readFileSync(resolve(__dirname, "../../routers/documentsRouter.ts"), "utf8");
    for (const proc of ["submitForReview", "approveDocument", "rejectDocument"]) {
      const start = src.indexOf(`\n  ${proc}: tenantProcedure`);
      expect(start, proc).toBeGreaterThan(-1);
      const block = src.slice(start, src.indexOf("\n    }),", start));
      expect(block, proc).not.toContain("LEG-009");
      expect(block, proc).not.toContain("LEG009_ALTERNATIVE");
    }
  });

  it("separação: o caminho canônico (documentReviewService) mantém os helpers de db/processes que consome", () => {
    const processesDb = readFileSync(resolve(__dirname, "../../db/processes.ts"), "utf8");
    expect(processesDb).toContain("export async function getDocumentByIdForOrganization");
    expect(processesDb).toContain("export async function updateDocumentStatusForOrganization");
    const reviewService = readFileSync(resolve(__dirname, "../../services/documentReviewService.ts"), "utf8");
    expect(reviewService).not.toMatch(/legacyEndpointGuard|documentsRouter/);
  });
});
