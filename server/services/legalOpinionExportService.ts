/**
 * PR B.1 — FAÇADE de exportação de parecer jurídico (entidade legada `legal_opinions`).
 *
 * Antes: renderizador ad-hoc (docx/pdfkit direto), duplicando a renderização e
 * contornando a fronteira RC-3.5.2. Agora: monta o conteúdo (Markdown) + metadados
 * institucionais e DELEGA a renderização ao Document Engine comum
 * (`renderInstitutionalContent`), que é o único a acionar o DocumentConverter.
 *
 * Contrato público PRESERVADO: as duas funções continuam recebendo o mesmo
 * `LegalOpinion`/`DocumentSettings` e retornando `Buffer` — o router e o cliente
 * (base64 → download) permanecem inalterados. Sem renderer paralelo; sem mudança de
 * status/versão (exportação é leitura).
 *
 * Compat: a entrada em `LEGACY_EXPORTERS` (legacyBoundaries.ts) é mantida por ora —
 * inofensiva, pois esta façade não aciona mais o DocumentConverter diretamente
 * (a conversão ocorre no Document Engine). Classificação LEGACY preservada no
 * histórico da entidade `legal_opinions`.
 */
import { renderInstitutionalContent, type InstitutionalMeta } from "./documentEngineService";
import { formatBrazilianDateTime } from "./documentExportService";

interface LegalOpinion {
  id: number;
  title: string;
  legalQuestion: string;
  context: string | null;
  opinion: string | null;
  conclusion: string | null;
  createdAt: Date;
  /** Status persistido (draft|in_review|approved|archived). Opcional por compat. */
  status?: string | null;
}

interface DocumentSettings {
  organizationName: string | null;
  organizationAddress: string | null;
  organizationCnpj: string | null;
  organizationPhone: string | null;
  organizationEmail: string | null;
  organizationWebsite: string | null;
  logoUrl: string | null;
}

const STATUS_MAP: Record<string, { label: string; isDraft: boolean }> = {
  draft: { label: "RASCUNHO", isDraft: true },
  in_review: { label: "EM REVISÃO", isDraft: true },
  approved: { label: "APROVADO", isDraft: false },
  archived: { label: "ARQUIVADO", isDraft: false },
};

/** Monta o conteúdo Markdown do parecer a partir das seções persistidas. */
function buildContent(op: LegalOpinion, signatureBlock?: string): string {
  const parts: string[] = [
    "## Questão Jurídica",
    op.legalQuestion || "—",
  ];
  if (op.context) parts.push("", "## Contexto", op.context);
  parts.push("", "## Parecer", op.opinion || "Parecer não gerado ainda.");
  parts.push("", "## Conclusão", op.conclusion || "Conclusão não disponível.");
  if (signatureBlock) parts.push("", "## Assinatura", signatureBlock);
  return parts.join("\n");
}

/** Metadados institucionais do parecer (status real; versão sintetizada = 1). */
function buildMeta(op: LegalOpinion, settings: DocumentSettings): InstitutionalMeta {
  const s = STATUS_MAP[op.status ?? "draft"] ?? STATUS_MAP.draft;
  return {
    organizationName: settings.organizationName || undefined,
    documentTitle: `Parecer Jurídico — ${op.title}`,
    // `legal_opinions` não tem número de processo fiel nem versão próprios → omitidos.
    statusLabel: s.label,
    isDraft: s.isDraft,
    draftNoticeLabel: s.label,
    version: 1,
    exportedAtLabel: formatBrazilianDateTime(new Date()),
  };
}

/** Gera o PDF do parecer via o Document Engine comum (institucional). */
export async function exportLegalOpinionToPDF(
  legalOpinion: LegalOpinion,
  settings: DocumentSettings,
  signatureBlock?: string
): Promise<Buffer> {
  return renderInstitutionalContent({
    content: buildContent(legalOpinion, signatureBlock),
    meta: buildMeta(legalOpinion, settings),
    format: "pdf",
  });
}

/** Gera o DOCX do parecer via o Document Engine comum (institucional). */
export async function exportLegalOpinionToDOCX(
  legalOpinion: LegalOpinion,
  settings: DocumentSettings,
  signatureBlock?: string
): Promise<Buffer> {
  return renderInstitutionalContent({
    content: buildContent(legalOpinion, signatureBlock),
    meta: buildMeta(legalOpinion, settings),
    format: "docx",
  });
}
