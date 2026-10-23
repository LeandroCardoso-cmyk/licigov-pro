/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Executor de homologação × INGESTÃO CANÔNICA (PR-04 / SEM-005) — o cliente HTTP REAL do executor (`homologSession`,
 * `uploadIngestionFile`, `runCanonicalPriceResearch`) contra a MESMA pilha do servidor: Express + rota de upload multipart
 * + tRPC, login com cookie, MySQL real e flag REAL por tenant. Storage em memória (só bytes; nunca S3).
 * Órgãos sintéticos 997741 (A, `FF_CANONICAL_INGESTION` LIGADA) e 997742 (B, desligada). Nunca a org 1.
 *
 *  [C1] modo pela capability oficial: A ⇒ canonical; B ⇒ legacy.
 *  [C2] A: duas sessões canônicas (fornecedor A, depois B) ⇒ cotações SOMADAS por item (2), proveniência fictícia declarada,
 *       duas pesquisas; aprovação da sessão pelo autor e promoção pelo segundo manager.
 *  [C3] A: colagem legada recusada pelo CUTOVER (`LEGACY_PRICE_IMPORT_DISABLED`), sem gravação.
 *  [C4] isolamento: o usuário do órgão B não envia arquivo para a sessão do órgão A (recusa, sessão intacta).
 *  [C5] B (flag desligada): recusa por ambiguidade do CONTEÚDO (não pelo cutover); substituição sem confirmação ⇒ CONFLICT.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG_A = 997741;
const ORG_B = 997742;
const RUN = Date.now().toString(36);
const PASSWORD = `Homolog-${RUN}-Senha!`;

const mem = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../../storage", async (orig) => {
  const actual = await orig<typeof import("../../storage")>();
  return {
    ...actual,
    storagePut: async (key: string, data: string | Buffer) => { mem.set(key, Buffer.from(data)); return { key, url: "" }; },
    storagePutStream: async (key: string, body: NodeJS.ReadableStream) => {
      const chunks: Buffer[] = [];
      for await (const c of body as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
      mem.set(key, Buffer.concat(chunks));
      return { key };
    },
    storageGetBytes: async (key: string) => { const b = mem.get(key); if (!b) throw new Error(`storage vazio: ${key}`); return b; },
    storageDelete: async (key: string) => ({ key, deleted: mem.delete(key) }),
    storageExists: async (key: string) => mem.has(key),
  };
});

import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { runMigrations } from "../../bootstrap";
import { appRouter } from "../../routers";
import { createContext } from "../../_core/context";
import { correlationMiddleware } from "../../middleware/correlationMiddleware";
import { registerIngestionUploadRoute } from "../../routes/ingestionUploadRoute";
import { hashPassword } from "../../services/passwordSecurity";
import { invalidateFlagCache } from "../../services/featureFlagService";
import { CANONICAL_INGESTION_FLAG } from "../../services/ingestionUploadService";
import {
  homologSession, priceImportMode, priceResearchCsv, runCanonicalPriceResearch, trpcCode, uploadIngestionFile,
} from "../../../scripts/homologation-e2e";

let conn: mysql.Connection;
let server: Server;
let BASE = "";
let seq = 0;
const U: Record<string, { id: number; email: string }> = {};
const key = (p: string) => `hm-${p}-${RUN}-${++seq}`;
const ITEMS = [
  { description: `Papel sulfite A4 75g ${RUN}`, planned: 120, unit: "resma", price: "25,50" },
  { description: `Caneta esferográfica azul ${RUN}`, planned: 400, unit: "un", price: "1,75" },
];
const rows = (supplier: string) => ITEMS.map((r) => ({ ...r, supplier }));

// Login UMA vez por usuário (o servidor limita tentativas de login por origem — guarda real, não contornada).
const sessions = new Map<string, ReturnType<typeof homologSession>>();
async function session(who: keyof typeof U, org: number) {
  let s = sessions.get(who);
  if (!s) {
    s = homologSession(BASE);
    s.state.orgId = org;
    await s.api.auth.login.mutate({ email: U[who].email, password: PASSWORD });
    sessions.set(who, s);
  }
  s.state.orgId = org;
  return s;
}
async function newProcess(s: ReturnType<typeof homologSession>, tag: string): Promise<string> {
  return (await s.api.procurementProcess.createProcess.mutate({
    processNumber: `HM-${RUN}-${tag}`, object: `Material de expediente (homologação ${RUN})`, startOption: "iniciar_pesquisa", modality: "pregao",
  } as any)).process.id;
}
async function err(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try { await p; } catch (e) { return { code: trpcCode(e), message: e instanceof Error ? e.message : String(e) }; }
  throw new Error("esperava recusa");
}
async function cleanup() {
  const tables: Array<[string, string]> = [
    ["import_promotions", "organizationId"], ["import_item_corrections", "organizationId"], ["import_staging_items", "organizationId"],
    ["import_sessions", "organizationId"], ["price_research_items", "organization_id"], ["price_research", "organization_id"],
    ["item_catmat_matches", "organization_id"], ["item_risks", "organization_id"], ["item_recommendations", "organization_id"],
    ["intelligent_item_identity_aliases", "organization_id"], ["intelligent_items", "organization_id"], ["process_timeline", "organization_id"],
    ["procurement_processes", "organization_id"], ["idempotency_keys", "organizationId"], ["activity_logs", "organizationId"],
    ["tenant_feature_flags", "organizationId"], ["organization_members", "organizationId"],
  ];
  for (const org of [ORG_A, ORG_B]) for (const [t, col] of tables) await conn.query(`DELETE FROM \`${t}\` WHERE \`${col}\` = ?`, [org]).catch(() => {});
}

describe.skipIf(!DB)("executor de homologação × ingestão canônica (HTTP real, MySQL real, flag real)", { timeout: 180_000 }, () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
    for (const [id, slug] of [[ORG_A, `hm-a-${RUN}`], [ORG_B, `hm-b-${RUN}`]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE slug = VALUES(slug), ativo = 1", [id, `Prefeitura Sintética ${id}`, slug]);
    }
    const hash = await hashPassword(PASSWORD);
    for (const [tag, org, role] of [["authorA", ORG_A, "manager"], ["managerA", ORG_A, "manager"], ["authorB", ORG_B, "manager"]] as const) {
      const email = `hm-${tag}-${RUN}@teste.local`;
      const [u] = await conn.execute<mysql.ResultSetHeader>(
        "INSERT INTO users (openId, name, email, role, passwordHash, tokenVersion) VALUES (?, ?, ?, 'user', ?, 0)", [`hm-${tag}-${RUN}`, `Homolog ${tag}`, email, hash]);
      U[tag] = { id: u.insertId, email };
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u.insertId, role]);
    }
    await conn.execute("INSERT INTO tenant_feature_flags (organizationId, flagName, enabled, percentage) VALUES (?, ?, 1, 100)", [ORG_A, CANONICAL_INGESTION_FLAG]);
    invalidateFlagCache();

    const app = express();
    app.use(express.json({ limit: "10mb" }));
    app.use(correlationMiddleware);
    registerIngestionUploadRoute(app);
    app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));
    server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 180_000);

  afterAll(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    if (!conn) return;
    await cleanup().catch(() => {});
    const ids = Object.values(U).map((u) => u.id);
    if (ids.length) await conn.execute(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids).catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
    invalidateFlagCache();
    await conn.end();
  });

  let pidA = "";

  it("[C1] modo pela capability oficial do tenant: A canonical, B legacy", async () => {
    const a = await session("authorA", ORG_A);
    const b = await session("authorB", ORG_B);
    expect(priceImportMode(await a.api.ingestion.getCapabilities.query())).toBe("canonical");
    expect(priceImportMode(await b.api.ingestion.getCapabilities.query())).toBe("legacy");
    expect(() => priceImportMode({ enabled: true, supportedFormats: [{ key: "csv", supported: false }] })).toThrow(/CSV/);
  });

  it("[C2] duas sessões canônicas pelo HTTP real ⇒ cotações somadas, proveniência fictícia, aprovação × promoção por usuários distintos", async () => {
    const author = await session("authorA", ORG_A);
    const manager = await session("managerA", ORG_A);
    pidA = await newProcess(author, "A");
    const s1 = await runCanonicalPriceResearch({ baseUrl: BASE, author, manager: manager.api, processId: pidA,
      csv: priceResearchCsv(rows("Fornecedor Fictício A")), fileName: `hm-${RUN}-a.csv`, key, timeoutMs: 60_000 });
    const s2 = await runCanonicalPriceResearch({ baseUrl: BASE, author, manager: manager.api, processId: pidA,
      csv: priceResearchCsv(rows("Fornecedor Fictício B")), fileName: `hm-${RUN}-b.csv`, key, timeoutMs: 60_000 });
    expect(s1.sessionId).not.toBe(s2.sessionId);
    expect([s1.groups, s1.quotes, s2.groups, s2.quotes]).toEqual([2, 2, 2, 2]);

    const items = (await author.api.procurementProcess.listItems.query({ processId: pidA })).items;
    expect(items).toHaveLength(2);
    for (const it of items) {
      expect(it.quoteCount, it.description).toBe(2);
      expect(it.fictitiousQuoteCount, it.description).toBe(2);
      expect(it.suppliers.map((s: any) => s.name).sort()).toEqual(["Fornecedor Fictício A", "Fornecedor Fictício B"]);
    }
    const [research] = await conn.execute<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM price_research WHERE organization_id=? AND process_id=?", [ORG_A, pidA]);
    expect(Number((research[0] as any).n)).toBe(2);
    const [prov] = await conn.execute<mysql.RowDataPacket[]>("SELECT DISTINCT provenance_kind k FROM price_research_items WHERE organization_id=? AND process_id=?", [ORG_A, pidA]);
    expect((prov as any[]).map((r) => r.k)).toEqual(["ficticia"]);
    const [promos] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT DISTINCT a.userId u FROM activity_logs a WHERE a.organizationId=? AND a.action='import_session_approved'", [ORG_A]);
    expect((promos as any[]).map((r) => r.u)).toEqual([U.authorA.id]);
  });

  it("[C3] flag ligada: colagem legada recusada pelo cutover, sem gravação", async () => {
    const author = await session("authorA", ORG_A);
    const before = (await author.api.procurementProcess.listItems.query({ processId: pidA })).items.map((i: any) => [i.id, i.quoteCount]);
    const e = await err(author.api.procurementProcess.importPriceResearch.mutate({ processId: pidA, source: "colar", text: "Fornecedor Fictício Alfa — R$ 3.900,00" }));
    expect(e.code).toBe("PRECONDITION_FAILED");
    expect(e.message).toMatch(/^LEGACY_PRICE_IMPORT_DISABLED:/);
    expect((await author.api.procurementProcess.listItems.query({ processId: pidA })).items.map((i: any) => [i.id, i.quoteCount])).toEqual(before);
  });

  it("[C4] isolamento: usuário de outro órgão não envia arquivo para a sessão do órgão A", async () => {
    const author = await session("authorA", ORG_A);
    const bytes = new TextEncoder().encode(priceResearchCsv(rows("Fornecedor Fictício Z")));
    const { createHash } = await import("node:crypto");
    const created = await author.api.ingestion.createSession.mutate({
      importType: "price_research", sourceFileName: `hm-${RUN}-z.csv`, sourceMimeType: "text/csv", sourceSize: bytes.length,
      checksum: createHash("sha256").update(bytes).digest("hex"), idempotencyKey: key("iso"), procurementProcessId: pidA, importPurpose: "price_research",
    });
    const intruder = await session("authorB", ORG_B);
    await expect(uploadIngestionFile(BASE, intruder.state, created.uploadPath, { bytes, name: "x.csv", mime: "text/csv" })).rejects.toThrow(/HTTP (403|404|412)/);
    intruder.state.orgId = ORG_A; // forjar o cabeçalho não dá acesso a órgão sem associação
    await expect(uploadIngestionFile(BASE, intruder.state, created.uploadPath, { bytes, name: "x.csv", mime: "text/csv" })).rejects.toThrow(/HTTP 403/);
    const [s] = await conn.execute<mysql.RowDataPacket[]>("SELECT status, stage FROM import_sessions WHERE id=?", [created.sessionId]);
    expect((s[0] as any).stage).not.toBe("file_stored");
  });

  it("[C5] flag desligada: ambiguidade do conteúdo (não cutover); substituição sem confirmação ⇒ CONFLICT, originais intactas", async () => {
    const b = await session("authorB", ORG_B);
    const pid = await newProcess(b, "B");
    const amb = await err(b.api.procurementProcess.importPriceResearch.mutate({ processId: pid, source: "colar", text: "Fornecedor Fictício Alfa — R$ 3.900,00" }));
    expect(amb.code).toBe("PRECONDITION_FAILED");
    expect(amb.message).toMatch(/ambígua/);
    expect(amb.message).not.toMatch(/LEGACY_PRICE_IMPORT_DISABLED/);
    const line = (s: string) => ITEMS.map((r) => `${r.description};${r.planned};${r.unit};R$ ${r.price};${s}`).join("\n");
    await b.api.procurementProcess.importPriceResearch.mutate({ processId: pid, source: "colar", text: line("Fornecedor Fictício A") });
    const rep = await err(b.api.procurementProcess.importPriceResearch.mutate({ processId: pid, source: "colar", text: line("Fornecedor Fictício C") }));
    expect(rep.code).toBe("CONFLICT");
    expect(rep.message).toMatch(/^QUOTE_REPLACEMENT_CONFIRMATION_REQUIRED:/);
    for (const it of (await b.api.procurementProcess.listItems.query({ processId: pid })).items) {
      expect(it.suppliers.map((s: any) => s.name)).toEqual(["Fornecedor Fictício A"]);
    }
  });
});
