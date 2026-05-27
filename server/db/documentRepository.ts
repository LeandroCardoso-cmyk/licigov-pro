/**
 * Sprint 2 — Document Repository.
 * Estende BaseTenantRepository para operações tenant-safe de documentos.
 */
import { eq, and, isNull, desc } from "drizzle-orm";
import { getDb } from "./connection";
import { documents } from "../../drizzle/schema";
import { BaseTenantRepository } from "./baseTenantRepository";
import { buildPaginatedResult, normalizePagination, calculateOffset } from "./queryStrategy";
import type { PaginatedResult } from "./queryStrategy";

type DocumentRow = typeof documents.$inferSelect;

export class DocumentRepository extends BaseTenantRepository<DocumentRow> {
  protected readonly entityName = "Document";

  async safeFindById(id: number, organizationId: number): Promise<DocumentRow | null> {
    this.requireOrganizationId(organizationId);
    const db = await getDb();
    if (!db) return null;

    const rows = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (rows.length === 0) return null;
    this.assertOwnership(rows[0].organizationId, organizationId);
    return rows[0];
  }

  async safeFindMany(organizationId: number): Promise<DocumentRow[]> {
    this.requireOrganizationId(organizationId);
    const db = await getDb();
    if (!db) return [];

    return db
      .select()
      .from(documents)
      .where(and(
        eq(documents.organizationId, organizationId),
        isNull(documents.archivedAt),
      ))
      .orderBy(desc(documents.updatedAt));
  }

  async safePaginate(
    organizationId: number,
    page:           number,
    pageSize:       number,
  ): Promise<PaginatedResult<DocumentRow>> {
    this.requireOrganizationId(organizationId);
    const db = await getDb();
    const params = normalizePagination({ page, pageSize });

    if (!db) return buildPaginatedResult([], 0, params);

    const offset = calculateOffset(params);
    const [rows, countRows] = await Promise.all([
      db.select()
        .from(documents)
        .where(and(eq(documents.organizationId, organizationId), isNull(documents.archivedAt)))
        .orderBy(desc(documents.updatedAt))
        .limit(params.pageSize)
        .offset(offset),
      db.select()
        .from(documents)
        .where(and(eq(documents.organizationId, organizationId), isNull(documents.archivedAt))),
    ]);

    return buildPaginatedResult(rows, countRows.length, params);
  }

  async findByProcess(processId: number, organizationId: number): Promise<DocumentRow[]> {
    this.requireOrganizationId(organizationId);
    const db = await getDb();
    if (!db) return [];

    return db
      .select()
      .from(documents)
      .where(and(
        eq(documents.processId,      processId),
        eq(documents.organizationId, organizationId),
        isNull(documents.archivedAt),
      ));
  }
}

/** Singleton para uso em serviços */
export const documentRepository = new DocumentRepository();
