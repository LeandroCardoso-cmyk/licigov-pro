/**
 * NEW-007 — Atribuição do Procurador ao Workspace de Parecer (persistência atômica).
 *
 * REUSA o modelo de atribuição que já existe no domínio Parecer Jurídico — a coluna
 * `legal_opinion_workspaces.assigned_lawyer` (atribuição corrente) + o registro auditável em
 * `lawyer_assignments` (quem, quando, correlationId). Nenhuma tabela/coluna nova.
 *
 * Antes, o recebimento gravava o workspace por UPSERT (`ON DUPLICATE KEY UPDATE assigned_lawyer = …`):
 * dois recebimentos concorrentes por atores diferentes sobrescreviam SILENCIOSAMENTE o procurador.
 * Aqui a atribuição é um CLAIM numa transação: INSERT-only do workspace (a PK determinística
 * hash(org, requestId) serializa a criação) + `SELECT … FOR UPDATE` + UPDATE condicional
 * `assigned_lawyer IS NULL`. O modelo não tem regra de reatribuição: um workspace já atribuído a
 * OUTRO ator nunca é tomado (o serviço responde CONFLICT) — e nada é escrito nesse caminho.
 *
 * Arquivo separado de `db/legalOpinionWorkspace.ts` de propósito (sem acoplamento textual com outras
 * mudanças em andamento naquele repositório). Multi-tenant por organization_id. Sem DB ⇒ null (degrada).
 */

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "./connection";
import { toDbDatetime } from "./institutionalConsultations";
import { legalOpinionWorkspacesTable, lawyerAssignmentsTable } from "../../drizzle/schema";
import type { LegalOpinionWorkspace } from "../domain/legalOpinionWorkspace";
import type { LawyerAssignment } from "../domain/lawyerAssignment";

const toDb = (iso: string): string => toDbDatetime(iso) ?? iso;

/** ER_DUP_ENTRY (1062) do MySQL/MariaDB, inclusive encapsulado pelo driver/drizzle (`cause`). */
function isDuplicateEntry(err: unknown): boolean {
  let x: unknown = err;
  for (let i = 0; i < 4 && x && typeof x === "object"; i++) {
    const e = x as { code?: string; errno?: number; cause?: unknown };
    if (e.code === "ER_DUP_ENTRY" || e.errno === 1062) return true;
    x = e.cause;
  }
  return false;
}

export type LegalOpinionWorkspaceClaim =
  /** Este ator passou a ser o procurador designado (workspace criado agora ou antes sem procurador). */
  | { readonly status: "claimed"; readonly created: boolean }
  /** O workspace já estava atribuído a ESTE ator (retry): nada foi escrito. */
  | { readonly status: "already_assigned_to_actor" }
  /** O workspace já está atribuído a OUTRO ator: nada foi escrito. */
  | { readonly status: "assigned_to_other" };

/**
 * Atribui atomicamente o workspace `candidate` (id determinístico) ao procurador `lawyerId`.
 * `candidate` já vem com `assignedLawyer = lawyerId`; `assignment` é o registro auditável.
 */
export async function claimLegalOpinionWorkspaceForLawyer(
  candidate: LegalOpinionWorkspace,
  lawyerId: number,
  assignment: LawyerAssignment,
): Promise<LegalOpinionWorkspaceClaim | null> {
  const db = await getDb();
  if (!db) return null;
  // Deadlock (1213) entre claims concorrentes do MESMO workspace: o InnoDB desfaz uma das transações
  // inteira (nada gravado); repetir é seguro porque o claim é idempotente por (workspace, ator).
  for (let attempt = 1; ; attempt++) {
    try {
      return await claimOnce(db, candidate, lawyerId, assignment);
    } catch (err) {
      if (attempt >= 3 || !isDeadlock(err)) throw err;
    }
  }
}

function isDeadlock(err: unknown): boolean {
  let x: unknown = err;
  for (let i = 0; i < 4 && x && typeof x === "object"; i++) {
    const e = x as { code?: string; errno?: number; cause?: unknown };
    if (e.code === "ER_LOCK_DEADLOCK" || e.errno === 1213) return true;
    x = e.cause;
  }
  return false;
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function claimOnce(
  db: Db,
  candidate: LegalOpinionWorkspace,
  lawyerId: number,
  assignment: LawyerAssignment,
): Promise<LegalOpinionWorkspaceClaim> {
  return db.transaction(async (tx): Promise<LegalOpinionWorkspaceClaim> => {
    let created = false;
    try {
      // INSERT-only (nunca upsert): se o workspace já existe, a PK recusa e nada é sobrescrito.
      await tx.insert(legalOpinionWorkspacesTable).values({
        id: candidate.id, organizationId: candidate.organizationId, requestId: candidate.requestId,
        sourceDomain: candidate.sourceDomain, referenceProcessId: candidate.referenceProcessId,
        requestType: candidate.requestType, currentStage: candidate.currentStage, status: candidate.status,
        assignedLawyer: lawyerId, responsibleSector: candidate.responsibleSector, priority: candidate.priority,
        correlationId: candidate.correlationId, createdAt: toDb(candidate.createdAt), updatedAt: toDb(candidate.updatedAt),
      });
      created = true;
    } catch (err) {
      if (!isDuplicateEntry(err)) throw err;
    }

    if (!created) {
      const rows = await tx.select({ assignedLawyer: legalOpinionWorkspacesTable.assignedLawyer })
        .from(legalOpinionWorkspacesTable)
        .where(and(eq(legalOpinionWorkspacesTable.id, candidate.id), eq(legalOpinionWorkspacesTable.organizationId, candidate.organizationId)))
        .for("update");
      // PK existe mas em OUTRO tenant (colisão de hash impossível na prática) ⇒ trata como alheio, sem escrita.
      if (rows.length === 0) return { status: "assigned_to_other" };
      const current = rows[0].assignedLawyer ?? null;
      if (current === lawyerId) return { status: "already_assigned_to_actor" };
      if (current !== null) return { status: "assigned_to_other" };
      await tx.update(legalOpinionWorkspacesTable)
        .set({ assignedLawyer: lawyerId, updatedAt: toDb(candidate.updatedAt) })
        .where(and(
          eq(legalOpinionWorkspacesTable.id, candidate.id),
          eq(legalOpinionWorkspacesTable.organizationId, candidate.organizationId),
          isNull(legalOpinionWorkspacesTable.assignedLawyer),
        ));
    }

    // Registro auditável da distribuição (id = hash(org, workspace, lawyer) — idempotente por natureza).
    await tx.insert(lawyerAssignmentsTable).values({
      id: assignment.id, organizationId: assignment.organizationId, workspaceId: assignment.workspaceId,
      requestId: assignment.requestId, lawyerId, sector: assignment.sector, priority: assignment.priority,
      correlationId: assignment.correlationId, assignedAt: toDb(assignment.assignedAt),
    }).onDuplicateKeyUpdate({ set: { lawyerId } });
    return { status: "claimed", created };
  });
}

/** O registro de atribuição (lawyer_assignments) deste procurador NESTE workspace, no tenant. */
export async function getLawyerAssignmentForWorkspace(
  workspaceId: string, orgId: number, lawyerId: number,
): Promise<{ id: string; lawyerId: number; assignedAt: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ id: lawyerAssignmentsTable.id, lawyerId: lawyerAssignmentsTable.lawyerId, assignedAt: lawyerAssignmentsTable.assignedAt })
    .from(lawyerAssignmentsTable)
    .where(and(
      eq(lawyerAssignmentsTable.workspaceId, workspaceId),
      eq(lawyerAssignmentsTable.organizationId, orgId),
      eq(lawyerAssignmentsTable.lawyerId, lawyerId),
    ))
    .limit(1);
  if (rows.length === 0 || rows[0].lawyerId === null) return null;
  return { id: rows[0].id, lawyerId: rows[0].lawyerId, assignedAt: rows[0].assignedAt };
}
