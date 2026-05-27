/**
 * Sprint 2 — Document Template Service.
 *
 * Templates estruturados com variáveis e placeholders.
 * Multi-tenant: templates globais (orgId=null) + templates da organização.
 */
import { eq, and, or, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { documentTemplates } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";
import { nextVersion } from "../domain/locking";
import type {
  DocumentTypeValue,
  StructuredDocumentContent,
  DocumentVariable,
} from "../domain/documentTypes";
import type { TrpcAuditCtx } from "./activityLogService";

const log = serviceLogger("DocumentTemplateService");

// ─── Create ───────────────────────────────────────────────────────────────────

export interface CreateTemplateParams {
  name:               string;
  description?:       string | null;
  documentType:       DocumentTypeValue;
  content?:           string;
  structuredContent?: StructuredDocumentContent | null;
  variables?:         DocumentVariable[] | null;
  isDefault?:         number;
}

export async function createTemplate(
  params: CreateTemplateParams,
  ctx:    TrpcAuditCtx,
): Promise<typeof documentTemplates.$inferSelect> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const orgId = ctx.organizationId;

  const [inserted] = await db.insert(documentTemplates).values({
    userId:           ctx.user.id,
    organizationId:   orgId ?? null,
    name:             params.name,
    description:      params.description    ?? null,
    type:             params.documentType,
    content:          params.content        ?? "",
    structuredContent: params.structuredContent ?? null,
    variables:        params.variables      ?? null,
    isDefault:        params.isDefault      ?? 0,
    version:          1,
  }).$returningId();

  log.info("template_created", { templateId: inserted.id, type: params.documentType, orgId });

  const created = await db
    .select()
    .from(documentTemplates)
    .where(eq(documentTemplates.id, inserted.id))
    .limit(1);

  return created[0];
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Lista templates disponíveis para uma organização e tipo de documento.
 * Inclui templates globais (orgId=null) + templates da organização.
 */
export async function listTemplates(
  documentType:   DocumentTypeValue,
  organizationId: number,
): Promise<(typeof documentTemplates.$inferSelect)[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(documentTemplates)
    .where(and(
      eq(documentTemplates.type, documentType as "etp" | "tr" | "dfd" | "edital" | "contrato" | "ata" | "parecer" | "aditivo" | "minuta"),
      or(
        isNull(documentTemplates.organizationId),
        eq(documentTemplates.organizationId, organizationId),
      ),
    ));
}

export async function getTemplate(
  templateId:     number,
  organizationId: number,
): Promise<typeof documentTemplates.$inferSelect | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(documentTemplates)
    .where(eq(documentTemplates.id, templateId))
    .limit(1);

  if (rows.length === 0) return null;

  const t = rows[0];
  // Templates globais (orgId=null) são acessíveis por todos
  if (t.organizationId !== null && t.organizationId !== organizationId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Template pertence a outra organização." });
  }

  return t;
}

// ─── Apply ────────────────────────────────────────────────────────────────────

/**
 * Instancia um template substituindo variáveis pelos valores fornecidos.
 * Retorna o conteúdo instanciado (text + structured).
 */
export async function applyTemplate(
  templateId:     number,
  variables:      Record<string, string>,
  organizationId: number,
): Promise<{ content: string; structuredContent: StructuredDocumentContent | null }> {
  const template = await getTemplate(templateId, organizationId);
  if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "Template não encontrado." });

  // Substitui placeholders {{variavel}} no conteúdo markdown
  let content = template.content;
  for (const [key, value] of Object.entries(variables)) {
    content = content.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g"), value);
  }

  // Aplica variáveis ao structuredContent se existir
  let structuredContent: StructuredDocumentContent | null = null;
  if (template.structuredContent) {
    const sc = template.structuredContent as StructuredDocumentContent;
    const instantiatedVars = (sc.variables ?? []).map((v: DocumentVariable) => ({
      ...v,
      value: variables[v.key] ?? v.value,
    }));
    structuredContent = { ...sc, variables: instantiatedVars };
  }

  log.debug("template_applied", { templateId, variableCount: Object.keys(variables).length });

  return { content, structuredContent };
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateTemplate(
  templateId:  number,
  params:      Partial<CreateTemplateParams>,
  ctx:         TrpcAuditCtx,
): Promise<typeof documentTemplates.$inferSelect> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const orgId = ctx.organizationId;
  const template = await getTemplate(templateId, orgId ?? 0);
  if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "Template não encontrado." });

  await db.update(documentTemplates).set({
    ...(params.name              !== undefined ? { name:              params.name              } : {}),
    ...(params.description       !== undefined ? { description:       params.description       } : {}),
    ...(params.content           !== undefined ? { content:           params.content           } : {}),
    ...(params.structuredContent !== undefined ? { structuredContent: params.structuredContent } : {}),
    ...(params.variables         !== undefined ? { variables:         params.variables         } : {}),
    version: nextVersion(template.version),
  }).where(eq(documentTemplates.id, templateId));

  const updated = await db
    .select()
    .from(documentTemplates)
    .where(eq(documentTemplates.id, templateId))
    .limit(1);

  return updated[0];
}
