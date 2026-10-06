/**
 * R7 / PR-16 (SEM-020) — evidência documental REAL do checklist da Contratação Direta (regra pura).
 *
 *  - "Anexar" = upload feito pelo SERVIDOR para o S3, com chave `contratacao_direta/{workspaceId}/{ts}-{arquivo}`,
 *    SHA-256, tamanho e MIME. O cliente NUNCA informa a referência (a antiga `s3://anexo` era fictícia).
 *  - "Validar" exige essa evidência (referência emitida pelo servidor para ESTE workspace + hash).
 *  - "Pendenciar" muda só o status; a evidência anexada permanece rastreável.
 */
export type RequiredDocumentStatus = "pendente" | "anexado" | "validado";

export const REQUIRED_DOCUMENT_UPLOAD_REQUIRED = "REQUIRED_DOCUMENT_UPLOAD_REQUIRED";
export const REQUIRED_DOCUMENT_ATTACHMENT_REQUIRED = "REQUIRED_DOCUMENT_ATTACHMENT_REQUIRED";

export const REQUIRED_DOCUMENT_KEY_PREFIX = "contratacao_direta";

export function requiredDocumentStorageKey(workspaceId: string, safeFileName: string, now: number): string {
  return `${REQUIRED_DOCUMENT_KEY_PREFIX}/${workspaceId}/${now}-${safeFileName}`;
}

/** A referência foi emitida pelo servidor para ESTE workspace (nunca `s3://anexo` nem chave de outro workspace). */
export function isServerIssuedReference(reference: string, workspaceId: string): boolean {
  const prefix = `${REQUIRED_DOCUMENT_KEY_PREFIX}/${workspaceId}/`;
  return reference.startsWith(prefix) && reference.length > prefix.length && !reference.includes("..");
}

export interface RequiredDocumentEvidence {
  readonly status: string;
  readonly documentReference: string;
  readonly contentHash: string;
}

export function hasRealEvidence(doc: RequiredDocumentEvidence, workspaceId: string): boolean {
  return /^[0-9a-f]{64}$/.test(doc.contentHash) && isServerIssuedReference(doc.documentReference, workspaceId);
}

export type StatusChangeDecision =
  | { ok: true; next: "pendente" | "validado" }
  | { ok: false; code: typeof REQUIRED_DOCUMENT_UPLOAD_REQUIRED | typeof REQUIRED_DOCUMENT_ATTACHMENT_REQUIRED };

/** Mudança de status pelo checklist (sem upload): "anexado" só via upload; "validado" só com evidência real. */
export function planRequiredDocumentStatusChange(doc: RequiredDocumentEvidence, workspaceId: string, next: RequiredDocumentStatus): StatusChangeDecision {
  if (next === "anexado") return { ok: false, code: REQUIRED_DOCUMENT_UPLOAD_REQUIRED };
  if (next === "validado" && !hasRealEvidence(doc, workspaceId)) return { ok: false, code: REQUIRED_DOCUMENT_ATTACHMENT_REQUIRED };
  return { ok: true, next };
}

export const REQUIRED_DOCUMENT_MESSAGES = {
  [REQUIRED_DOCUMENT_UPLOAD_REQUIRED]: "Para anexar, envie o arquivo — a referência é gerada pelo servidor após o upload; nada foi gravado.",
  [REQUIRED_DOCUMENT_ATTACHMENT_REQUIRED]: "Só é possível validar um documento com arquivo anexado (upload real com hash); nada foi gravado.",
} as const;

/**
 * NEW-029 — gate de PUBLICAÇÃO da Contratação Direta: o checklist configurado precisa existir e todo documento
 * OBRIGATÓRIO precisa estar "validado" COM evidência real (upload do servidor + hash). "anexado" não basta; linha
 * legada `s3://anexo` (sem hash) não conta como validada (regularização = HD-08). O `pending` deixa de ser só
 * informativo.
 */
export const CHECKLIST_NOT_CONFIGURED = "CHECKLIST_NOT_CONFIGURED";
export const CHECKLIST_PENDING = "CHECKLIST_PENDING";

export type ChecklistPublicationGate =
  | { ok: true }
  | { ok: false; code: typeof CHECKLIST_NOT_CONFIGURED }
  | { ok: false; code: typeof CHECKLIST_PENDING; pending: string[] };

export function checklistPublicationGate(
  docs: ReadonlyArray<RequiredDocumentEvidence & { readonly name: string; readonly required: boolean | number }>,
  workspaceId: string,
): ChecklistPublicationGate {
  if (docs.length === 0) return { ok: false, code: CHECKLIST_NOT_CONFIGURED };
  const pending = docs
    .filter((d) => Boolean(d.required))
    .filter((d) => !(d.status === "validado" && hasRealEvidence(d, workspaceId)))
    .map((d) => d.name);
  return pending.length ? { ok: false, code: CHECKLIST_PENDING, pending } : { ok: true };
}
