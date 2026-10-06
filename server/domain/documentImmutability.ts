/**
 * SEM-078 — conteúdo de `documents` APROVADO é imutável: qualquer mutação in-place (edição, publicação de rascunho,
 * restauração de versão) manteria o selo "approved" sobre texto que ninguém aprovou. A correção é uma NOVA versão pelo
 * fluxo canônico (que volta a exigir revisão/aprovação), nunca reescrever a linha aprovada.
 *
 * Usado por `documentService.updateDocumento`, `documentDraftService.publishDraft` e `documentVersionService.restoreToVersion`
 * (sem caller de router hoje — LEG-009 desligou o router legado; este guard impede que um caller futuro recrie o defeito).
 */
import { TRPCError } from "@trpc/server";

export const DOCUMENT_APPROVED_IMMUTABLE = "DOCUMENT_APPROVED_IMMUTABLE";

export function assertDocumentContentMutable(
  doc: { id: number; documentStatus?: string | null },
  operation: string,
): void {
  if (doc.documentStatus === "approved") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Documento aprovado não pode ser alterado no lugar (${operation}); gere uma nova versão pelo fluxo canônico (${DOCUMENT_APPROVED_IMMUTABLE}).`,
    });
  }
}
