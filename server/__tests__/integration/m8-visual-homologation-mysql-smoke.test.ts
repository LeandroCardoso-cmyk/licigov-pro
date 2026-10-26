/**
 * M8 (homologação visual) — leituras novas contra MySQL REAL (CI): histórico de sessões de ingestão por processo, versões
 * oficiais em lote e nomes de autoria por organização.
 *
 * Cobre: só o que está registrado (envio/aprovação/promoção), ordenação mais recente primeiro, paginação (limit/offset +
 * hasMore), isolamento por processo e por tenant (NOT_FOUND para processo alheio), nome resolvido só para membro DA
 * organização, versão oficial máxima por (processo, tipo) sem vazar entre tenants. Nada é gravado pelas leituras.
 *
 * Só roda com DATABASE_URL (serviço MySQL efêmero do CI); pulado localmente.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { getDb } from "../../db/connection";
import {
  activityLogs, importSessions, officialDocumentPromotionsTable, organizationMembers, procurementProcessesTable, users,
} from "../../../drizzle/schema";
import { runMigrations } from "../../bootstrap";
import { listProcessImportSessionHistory } from "../../services/fileIngestionService";
import { listLatestOfficialVersions } from "../../db/officialDocumentPromotions";
import { getOrganizationMemberNames } from "../../db/organizations";

const DB = process.env.DATABASE_URL;
const ORG_A = 997801;
const ORG_B = 997802;
const U_AUTHOR = 997811;   // membro de A
const U_MANAGER = 997812;  // membro de A
const U_OUTSIDER = 997813; // membro SÓ de B

describe.skipIf(!DB)("M8 — histórico de ingestão e versões oficiais — MySQL real", () => {
  let conn: mysql.Connection;
  const sessionIds: number[] = [];

  const cleanup = async () => {
    await conn.query("DELETE FROM `activity_logs` WHERE organizationId IN (?, ?)", [ORG_A, ORG_B]);
    await conn.query("DELETE FROM `import_sessions` WHERE organizationId IN (?, ?)", [ORG_A, ORG_B]);
    await conn.query("DELETE FROM `official_document_promotions` WHERE organization_id IN (?, ?)", [ORG_A, ORG_B]);
    await conn.query("DELETE FROM `procurement_processes` WHERE organization_id IN (?, ?)", [ORG_A, ORG_B]);
    await conn.query("DELETE FROM `organization_members` WHERE organizationId IN (?, ?)", [ORG_A, ORG_B]);
    await conn.query("DELETE FROM `users` WHERE id IN (?, ?, ?)", [U_AUTHOR, U_MANAGER, U_OUTSIDER]);
  };

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    const db = await getDb();
    if (!db) throw new Error("DB indisponível");
    await cleanup();
    await db.insert(users).values([
      { id: U_AUTHOR, openId: "m8-author", name: "Autora Sintética" },
      { id: U_MANAGER, openId: "m8-manager", name: "Gestor Sintético" },
      { id: U_OUTSIDER, openId: "m8-outsider", name: "Pessoa de Outro Órgão" },
    ]);
    await db.insert(organizationMembers).values([
      { organizationId: ORG_A, userId: U_AUTHOR, role: "operator" },
      { organizationId: ORG_A, userId: U_MANAGER, role: "manager", ativo: false }, // ex-membro: nome histórico ainda resolvido
      { organizationId: ORG_B, userId: U_OUTSIDER, role: "manager" },
    ]);
    await db.insert(procurementProcessesTable).values([
      { id: "M8-PA", organizationId: ORG_A, processNumber: "0001/2026" },
      { id: "M8-PB", organizationId: ORG_A, processNumber: "0002/2026", lifecycleState: "archived" },
      { id: "M8-PC", organizationId: ORG_B, processNumber: "0003/2026" },
    ]);
    const base = { organizationId: ORG_A, sourceMimeType: "text/csv", sourceSize: 2048, importType: "price_research", procurementProcessId: "M8-PA" };
    // 1) promovida (aprovada + promovida); 2) rejeitada; 3) aguardando revisão — inserção em ordem ⇒ ids crescentes.
    for (const [i, extra] of [
      [1, { status: "approved" as const, promotedAt: new Date("2026-10-23T20:47:00Z"), promotedByUserId: U_MANAGER, promotionRef: "RESEARCH000000000001", promotionStatus: "promoted" }],
      [2, { status: "rejected" as const }],
      [3, { status: "awaiting_review" as const }],
    ] as const) {
      const [r] = await db.insert(importSessions).values({
        ...base, uploadedBy: U_AUTHOR, sourceFileId: `imports/m8/${i}.csv`, sourceFileName: `cotacoes-${i}.csv`,
        checksum: String(i).repeat(64), ...extra,
      }).$returningId();
      sessionIds.push(r.id);
    }
    // Sessão de OUTRO processo e de OUTRO tenant (não podem aparecer).
    await db.insert(importSessions).values([
      { ...base, procurementProcessId: "M8-PB", uploadedBy: U_AUTHOR, sourceFileId: "imports/m8/pb.csv", sourceFileName: "pb.csv", checksum: "b".repeat(64), status: "approved" },
      { ...base, organizationId: ORG_B, procurementProcessId: "M8-PC", uploadedBy: U_OUTSIDER, sourceFileId: "imports/m8/pc.csv", sourceFileName: "pc.csv", checksum: "c".repeat(64), status: "approved" },
    ]);
    // Aprovação registrada na trilha de auditoria (como o router grava) — só a sessão 1.
    await db.insert(activityLogs).values({
      organizationId: ORG_A, userId: U_AUTHOR, action: "import_session_approved", entityType: "import_session", entityId: sessionIds[0],
    });
    // Ledger de emissões: TR v1 e v2 de A/PA; ETP v1 de A/PA; TR v7 de B/PC (não pode vazar).
    const promo = (org: number, processId: string, kind: string, version: number) => ({
      organizationId: org, processId, officialDocumentId: `OD-${org}-${kind}-${version}`, lineageId: `LN-${org}-${kind}`,
      documentKind: kind, version, contentHash: "h".repeat(64), actorUserId: U_MANAGER, idempotencyKey: `m8-${org}-${processId}-${kind}-${version}`,
    });
    await db.insert(officialDocumentPromotionsTable).values([
      promo(ORG_A, "M8-PA", "tr", 1), promo(ORG_A, "M8-PA", "tr", 2), promo(ORG_A, "M8-PA", "etp", 1), promo(ORG_B, "M8-PC", "tr", 7),
    ]);
  }, 300_000);

  afterAll(async () => {
    await cleanup().catch(() => {});
    await conn?.end();
  });

  it("lista as sessões do processo (todas, não só a retomável), mais recentes primeiro, com o que está registrado", async () => {
    const { sessions, hasMore } = await listProcessImportSessionHistory(ORG_A, "M8-PA", { limit: 10, offset: 0 });
    expect(hasMore).toBe(false);
    expect(sessions.map((s) => s.id)).toEqual([...sessionIds].reverse());
    const promoted = sessions.find((s) => s.id === sessionIds[0])!;
    expect(promoted).toMatchObject({
      status: "approved", sourceFileName: "cotacoes-1.csv", checksumPrefix: "111111111111",
      uploadedBy: { userId: U_AUTHOR, name: "Autora Sintética" },
      approval: { userId: U_AUTHOR, name: "Autora Sintética" },
      promotion: { userId: U_MANAGER, name: "Gestor Sintético", researchId: "RESEARCH000000000001" },
    });
    // Sem registro ⇒ null (nunca fabricado).
    const rejected = sessions.find((s) => s.id === sessionIds[1])!;
    expect(rejected.approval).toBeNull();
    expect(rejected.promotion).toBeNull();
    // Não expõe a chave de armazenamento.
    expect(JSON.stringify(sessions)).not.toContain("imports/m8/");
  });

  it("paginação limit/offset com hasMore", async () => {
    const p1 = await listProcessImportSessionHistory(ORG_A, "M8-PA", { limit: 2, offset: 0 });
    expect(p1.sessions.map((s) => s.id)).toEqual([sessionIds[2], sessionIds[1]]);
    expect(p1.hasMore).toBe(true);
    const p2 = await listProcessImportSessionHistory(ORG_A, "M8-PA", { limit: 2, offset: 2 });
    expect(p2.sessions.map((s) => s.id)).toEqual([sessionIds[0]]);
    expect(p2.hasMore).toBe(false);
  });

  it("isolamento: outro processo do mesmo tenant não mistura; processo arquivado mantém histórico; processo alheio ⇒ NOT_FOUND", async () => {
    const pb = await listProcessImportSessionHistory(ORG_A, "M8-PB", { limit: 10, offset: 0 });
    expect(pb.sessions.map((s) => s.sourceFileName)).toEqual(["pb.csv"]);
    await expect(listProcessImportSessionHistory(ORG_A, "M8-PC", { limit: 10, offset: 0 })).rejects.toBeInstanceOf(TRPCError);
    await expect(listProcessImportSessionHistory(ORG_B, "M8-PA", { limit: 10, offset: 0 })).rejects.toBeInstanceOf(TRPCError);
    await expect(listProcessImportSessionHistory(ORG_A, "NAO-EXISTE", { limit: 10, offset: 0 })).rejects.toBeInstanceOf(TRPCError);
  });

  it("nomes de autoria só para membros (ativos ou não) DESTA organização", async () => {
    const names = await getOrganizationMemberNames(ORG_A, [U_AUTHOR, U_MANAGER, U_OUTSIDER, 0, -1]);
    expect(names.get(U_AUTHOR)).toBe("Autora Sintética");
    expect(names.get(U_MANAGER)).toBe("Gestor Sintético");
    expect(names.has(U_OUTSIDER)).toBe(false);
  });

  it("versões oficiais em lote: máxima por (processo, tipo), sem vazar entre tenants", async () => {
    const a = await listLatestOfficialVersions(ORG_A, ["M8-PA", "M8-PB", "M8-PC"]);
    expect(a.get("M8-PA")).toEqual({ tr: 2, etp: 1 });
    expect(a.has("M8-PB")).toBe(false);
    expect(a.has("M8-PC")).toBe(false);
    const b = await listLatestOfficialVersions(ORG_B, ["M8-PA", "M8-PC"]);
    expect(b.get("M8-PC")).toEqual({ tr: 7 });
    expect(b.has("M8-PA")).toBe(false);
    expect((await listLatestOfficialVersions(ORG_A, [])).size).toBe(0);
  });
});
