/**
 * HD-26 — relações com tabelas PRODUTIVAS EXISTENTES (`generated_documents`, `official_documents`,
 * `institutional_decisions`): SEM FK e SEM DDL nos pais. A referência é validada FAIL-CLOSED, na MESMA transação da escrita
 * da relação (por isso todas as funções exigem `TemplatesTx`), por `id` E tenant simultaneamente, com lock compartilhado
 * (`FOR SHARE`: o pai não some nem muda entre a validação e o commit).
 *
 * O tenant vem SEMPRE do contexto institucional autoritativo (`organizationId` do chamador) — nunca de input do cliente — e
 * a consulta nunca é feita só por `id`. Uma referência que existe em OUTRO tenant é indistinguível de inexistente.
 */
import { and, eq } from "drizzle-orm";
import { createHash } from "crypto";
import { generatedDocumentsTable, institutionalDecisionsTable, officialDocumentsTable } from "../../../drizzle/schema";
import { TemplatePersistenceError } from "./errors";
import type { TemplatesTx } from "./executor";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const notFound = (what: string): TemplatePersistenceError =>
  new TemplatePersistenceError("REFERENCE_NOT_FOUND", `${what} inexistente neste tenant`);

/** `generated_documents` (rascunho/composição) existe no tenant. */
export async function assertGeneratedDocumentInTenant(tx: TemplatesTx, organizationId: number, generatedDocumentId: string): Promise<void> {
  const rows = await tx.select({ id: generatedDocumentsTable.id }).from(generatedDocumentsTable)
    .where(and(eq(generatedDocumentsTable.id, generatedDocumentId), eq(generatedDocumentsTable.organizationId, organizationId)))
    .limit(1).for("share");
  if (rows.length !== 1 || rows[0].id !== generatedDocumentId) throw notFound("documento gerado");
}

/** `institutional_decisions` (decisão de aprovação/publicação) existe no tenant. */
export async function assertDecisionInTenant(tx: TemplatesTx, organizationId: number, decisionId: string): Promise<void> {
  const rows = await tx.select({ id: institutionalDecisionsTable.id }).from(institutionalDecisionsTable)
    .where(and(eq(institutionalDecisionsTable.id, decisionId), eq(institutionalDecisionsTable.organizationId, organizationId)))
    .limit(1).for("share");
  if (rows.length !== 1 || rows[0].id !== decisionId) throw notFound("decisão institucional");
}

export interface OfficialDocumentPin {
  readonly documentId: string;
  readonly lineageId: string;
  readonly version: number;
  readonly contentHash: string;
}

async function lockOfficialDocument(tx: TemplatesTx, organizationId: number, documentId: string) {
  const rows = await tx.select({
    id: officialDocumentsTable.id, lineageId: officialDocumentsTable.lineageId,
    version: officialDocumentsTable.version, content: officialDocumentsTable.content,
  }).from(officialDocumentsTable)
    .where(and(eq(officialDocumentsTable.id, documentId), eq(officialDocumentsTable.tenantId, organizationId)))
    .limit(1).for("share");
  if (rows.length !== 1 || rows[0].id !== documentId) throw notFound("documento oficial");
  return rows[0];
}

/** `official_documents` existe no tenant (ex.: versão emitida a que o manifest de emissão pertence). */
export async function assertOfficialDocumentInTenant(tx: TemplatesTx, organizationId: number, documentId: string): Promise<void> {
  await lockOfficialDocument(tx, organizationId, documentId);
}

/** O conteúdo persistido da versão oficial tem exatamente o hash informado (sha256 do `content`). */
export async function assertOfficialDocumentContentHash(
  tx: TemplatesTx, organizationId: number, documentId: string, contentHash: string,
): Promise<void> {
  const row = await lockOfficialDocument(tx, organizationId, documentId);
  if (sha256(row.content ?? "") !== contentHash) {
    throw new TemplatePersistenceError("REFERENCE_PIN_MISMATCH", "o hash do conteúdo informado não corresponde ao conteúdo oficial persistido");
  }
}

/** PIN EXATO: documento + linhagem + versão + hash do conteúdo — qualquer divergência recusa (nunca "latest"). */
export async function assertOfficialDocumentPin(tx: TemplatesTx, organizationId: number, pin: OfficialDocumentPin): Promise<void> {
  const row = await lockOfficialDocument(tx, organizationId, pin.documentId);
  const matches = row.lineageId === pin.lineageId && row.version === pin.version && sha256(row.content ?? "") === pin.contentHash;
  if (!matches) {
    throw new TemplatePersistenceError("REFERENCE_PIN_MISMATCH", "a referência oficial não corresponde ao pin exato (linhagem, versão e hash do conteúdo)");
  }
}
