/**
 * P0 piloto — Lógica PURA da importação documental (DFD/ETP/TR) no cliente (testável sem DOM).
 */
import type { IngestionCapabilities } from "./capabilities";

export type DocumentKind = "dfd" | "etp" | "tr";

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = { dfd: "DFD", etp: "ETP", tr: "TR" };

/**
 * Documento só entra por PDF (com texto) ou DOCX — o servidor recusa .doc (Word 97-2003) e OCR não existe
 * nesta versão. Restringe a capacidade real (parserRegistry) a esses formatos, sem ofertar outros.
 */
export function documentImportCapabilities(caps: IngestionCapabilities | undefined): IngestionCapabilities | undefined {
  if (!caps) return undefined;
  const formats = caps.formats
    .filter((f) => f.key === "pdf" || f.key === "docx")
    .map((f) => f.key === "docx"
      ? { ...f, extensions: f.extensions.filter((e) => e !== ".doc"), mimeTypes: f.mimeTypes.filter((m) => m !== "application/msword") }
      : f);
  return { ...caps, formats, supportedFormats: formats.filter((f) => f.supported) };
}

/**
 * Etapa visível (1..4): 1 enviar · 2 revisar · 3 aprovar · 4 promover. Deriva do estado PERSISTIDO
 * (sessão + staging documental), então sobrevive a reload.
 */
export function documentImportStep(p: { sessionStatus: string | null; stagingStatus: string | null; busy: boolean }): 1 | 2 | 3 | 4 {
  if (p.stagingStatus === "approved") return 4;
  if (p.stagingStatus === "promoted") return 4;
  if (p.stagingStatus === "pending_review") return 2;
  return 1;
}

/** Rótulo da origem do rascunho canônico para a UI (importado ≡ gerado a jusante). */
export function draftOriginLabel(origin: string | null | undefined): string | null {
  if (origin === "import") return "importado e revisado";
  if (origin === "manual") return "editado manualmente";
  if (origin === "generated") return "gerado com IA supervisionada";
  return null;
}
