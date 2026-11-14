/**
 * SECURITY-02 — Guard CENTRAL de autoridade institucional (fonte autoritativa: `organization_members`).
 *
 * Reutiliza o padrão do NEW-007 (`legalOpinionAuthorityService`: membership REAL ativa, nunca a projeção
 * sintética do admin de plataforma) como contrato único para todos os atos institucionais:
 *  - consulta SEMPRE a membership persistida do ator no órgão (nunca `ctx.orgMembership`, nunca `actorRole`
 *    informado pelo chamador);
 *  - fail-closed: ausente, inativa, de outro órgão, papel insuficiente, registro inválido ou FALHA de consulta ⇒
 *    FORBIDDEN `INSTITUTIONAL_AUTHORITY_REQUIRED`, ANTES de qualquer escrita institucional;
 *  - toda recusa gera UM log estruturado (sem PII: ids, operação, papel exigido, motivo, correlationId);
 *  - `executor` (transação) ⇒ releitura com `FOR SHARE`: a membership fica travada até o commit do ato, então
 *    um rebaixamento/remoção concorrente não confirma entre a checagem e a escrita (TOCTOU).
 * Sem cache: cada ato relê a fonte.
 */
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { organizationMembers, type OrgRole } from "../../drizzle/schema";
import type { getDb } from "../db/connection";
import { getMembership } from "./tenantService";
import { serviceLogger } from "./observabilityService";
import {
  evaluateInstitutionalAuthority,
  institutionalAuthorityRequiredMessage,
  type InstitutionalAuthority,
  type InstitutionalAuthorityDenial,
  type PersistedMembership,
} from "../domain/institutionalAuthority";

export { INSTITUTIONAL_AUTHORITY_REQUIRED, type InstitutionalAuthority } from "../domain/institutionalAuthority";

const log = serviceLogger("institutionalAuthority");

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
/** Conexão ou transação Drizzle (mesmo formato de `ProcurementExecutor`). */
export type AuthorityExecutor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface InstitutionalAuthorityRequest {
  userId: number;
  organizationId: number;
  minRole: OrgRole;
  /** Nome estável do ato (ex.: "procurement.document.promote") — só para a trilha de recusa. */
  operation: string;
  correlationId?: string | null;
  /** Transação do ato: relê a membership com FOR SHARE (trava até o commit). */
  executor?: AuthorityExecutor;
}

async function readMembership(req: InstitutionalAuthorityRequest): Promise<PersistedMembership | null> {
  if (!req.executor) return getMembership(req.userId, req.organizationId);
  const rows = await req.executor
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.userId, req.userId), eq(organizationMembers.organizationId, req.organizationId)))
    .limit(1)
    .for("share");
  return rows[0] ?? null;
}

function deny(req: InstitutionalAuthorityRequest, reason: InstitutionalAuthorityDenial): never {
  log.warn("institutional_authority_denied", {
    operation: req.operation, organizationId: req.organizationId, actorUserId: req.userId,
    requiredRole: req.minRole, reason, correlationId: req.correlationId ?? undefined,
  });
  throw new TRPCError({ code: "FORBIDDEN", message: institutionalAuthorityRequiredMessage(req.minRole) });
}

/**
 * Exige autoridade institucional REAL do ator no órgão. Retorna a autoridade comprovada (papel PERSISTIDO),
 * que é o único papel que um ato/ledger institucional pode registrar.
 */
export async function requireInstitutionalAuthority(req: InstitutionalAuthorityRequest): Promise<InstitutionalAuthority> {
  if (!Number.isSafeInteger(req.userId) || req.userId <= 0 || !Number.isSafeInteger(req.organizationId) || req.organizationId <= 0) {
    deny(req, "membership_invalid");
  }
  let membership: PersistedMembership | null;
  try {
    membership = await readMembership(req);
  } catch {
    deny(req, "authority_lookup_failed");
  }
  const reason = evaluateInstitutionalAuthority(membership, req);
  if (reason) deny(req, reason);
  return { userId: req.userId, organizationId: req.organizationId, role: membership!.role, membershipId: membership!.id };
}
