/**
 * Smoke MySQL REAL — concorrência e rollback do versionamento de documentos (PR D / DATA-012).
 *
 * Só roda com DATABASE_URL (CI com MySQL efêmero); pulado localmente. Exercita o REPOSITÓRIO real
 * (transação + SELECT … FOR UPDATE), provando:
 *  - duas criações CONCORRENTES de versão não geram versionNumber duplicado (mutex FOR UPDATE);
 *  - rollback de falha intermediária não deixa registro parcial;
 *  - restoreToVersion mantém o ponteiro currentVersionId consistente com o histórico.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { and, eq } from "drizzle-orm";
import { runMigrations, ensureSchema } from "../../bootstrap";
import { getDb } from "../../db/connection";
import { createVersion, restoreToVersion } from "../../services/documentVersionService";
import { documents, documentVersions } from "../../../drizzle/schema";
import type { TrpcAuditCtx } from "../../services/activityLogService";

const DB = process.env.DATABASE_URL;
const ORG = 930500;

const ctx: TrpcAuditCtx = {
  user: { id: 7, name: "Smoke", email: "smoke@x.test" },
  orgMembership: { role: "operator" },
  organizationId: ORG,
  orgName: "Org Smoke",
  correlationId: "smoke-corr",
  requestId: "smoke-req",
} as unknown as TrpcAuditCtx;

describe.skipIf(!DB)("Versionamento — concorrência e rollback (MySQL real)", () => {
  let conn: mysql.Connection;
  let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await ensureSchema(conn);
    const maybe = await getDb();
    if (!maybe) throw new Error("getDb() retornou null com DATABASE_URL definido");
    db = maybe;
  });

  afterAll(async () => {
    if (conn) await conn.end();
  });

  async function newDocument(): Promise<number> {
    const [ins] = await db.insert(documents).values({ organizationId: ORG, processId: 1, type: "dfd" }).$returningId();
    return ins.id;
  }

  async function versionsOf(documentId: number) {
    return db.select().from(documentVersions).where(eq(documentVersions.documentId, documentId));
  }

  it("duas criações CONCORRENTES não geram versionNumber duplicado", async () => {
    const documentId = await newDocument();
    const results = await Promise.all([
      createVersion({ documentId, organizationId: ORG, contentSnapshot: "a", correlationId: "c1" }, ctx),
      createVersion({ documentId, organizationId: ORG, contentSnapshot: "b", correlationId: "c2" }, ctx),
    ]);
    const numbers = results.map((r) => r.versionNumber).sort();
    expect(numbers).toEqual([1, 2]);                 // serializado pelo FOR UPDATE
    const rows = await versionsOf(documentId);
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((r) => r.versionNumber)).size).toBe(2); // sem duplicata
  });

  it("rollback de falha intermediária não deixa registro parcial", async () => {
    const documentId = await newDocument();
    const before = (await versionsOf(documentId)).length;
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(documentVersions).values({
          organizationId: ORG, documentId, versionNumber: 1,
          contentSnapshot: "parcial", sourceContext: "manual",
          actorSnapshot: { userId: 7 } as unknown as Record<string, unknown>, createdBy: 7,
        });
        throw new Error("falha intermediária proposital");
      }),
    ).rejects.toThrow("falha intermediária");
    const after = (await versionsOf(documentId)).length;
    expect(after).toBe(before); // nada persistido (transação revertida)
  });

  it("restoreToVersion mantém o ponteiro currentVersionId consistente com o histórico", async () => {
    const documentId = await newDocument();
    await createVersion({ documentId, organizationId: ORG, contentSnapshot: "v1", correlationId: "c1" }, ctx);
    await createVersion({ documentId, organizationId: ORG, contentSnapshot: "v2", correlationId: "c2" }, ctx);

    const restored = await restoreToVersion(documentId, 1, ctx);

    // nova versão (a 3ª) criada a partir do snapshot da v1
    const rows = (await versionsOf(documentId)).sort((a, b) => a.versionNumber - b.versionNumber);
    expect(rows.length).toBe(3);
    const newest = rows[rows.length - 1];
    expect(newest.versionNumber).toBe(3);
    expect(newest.sourceContext).toBe("restore");
    // ponteiro do documento aponta EXATAMENTE para a nova versão + version incrementada
    expect(restored.currentVersionId).toBe(newest.id);
    const [docRow] = await db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.organizationId, ORG)));
    expect(docRow.currentVersionId).toBe(newest.id);
  });
});
