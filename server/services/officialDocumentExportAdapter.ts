/**
 * PR B.1 — Adapter COMPARTILHADO de exportação institucional de documentos oficiais.
 *
 * Ponte entre a entidade `OfficialDocument` (produzida por TODOS os Business Domains
 * via `generateOfficialDocument`) e o núcleo comum de exportação
 * (`documentExportService.exportDocument`, entregue na PR B). Mapeia status/tipo/
 * metadados → `InstitutionalMeta` e delega renderização/armazenamento/URL ao núcleo.
 *
 * NÃO é específico de contrato/aditivo/contratação direta/parecer — serve os quatro
 * porque todos persistem em `official_documents`. É uma AÇÃO DE LEITURA: não gera,
 * não versiona, não altera status. Não cria renderer paralelo (fronteira RC-3.5.2
 * preservada: a conversão ocorre no Document Engine, via o núcleo comum).
 */
import { TRPCError } from "@trpc/server";
import { getOfficialDocument } from "./documentEngineService";
import { exportDocument, formatBrazilianDateTime } from "./documentExportService";
import { getOrganizationById } from "../db/organizations";
import { logActivity } from "./activityLogService";
import type { OfficialFormat } from "../domain/officialDocument";

const TYPE_TITLES: Record<string, string> = {
  dfd: "DFD — Documento de Formalização da Demanda",
  etp: "ETP — Estudo Técnico Preliminar",
  tr: "TR — Termo de Referência",
  edital: "Edital",
  justificativa_contratacao: "Justificativa da Contratação",
  justificativa_preco: "Justificativa de Preço",
  ratificacao: "Ratificação",
  aviso: "Aviso",
  extrato_contrato: "Extrato de Contrato",
  parecer_inicial: "Parecer Inicial",
  parecer_final: "Parecer Final",
  despacho: "Despacho",
  contrato: "Contrato",
  aditivo: "Termo Aditivo",
  apostilamento: "Apostilamento",
  rescisao: "Rescisão",
  outro: "Documento",
};
const STATUS_LABELS: Record<string, string> = { gerado: "GERADO", revisado: "REVISADO", emitido: "EMITIDO" };
const STATUS_SLUGS: Record<string, string> = { gerado: "gerado", revisado: "revisado", emitido: "emitido" };

/** Extrai a 1ª string não vazia dentre chaves candidatas dos metadados. */
function metaString(m: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!m) return undefined;
  for (const k of keys) {
    const v = m[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * C.4B.1 — POLICY de exportação oficial DERIVADA NO SERVIDOR pelo businessDomain do próprio documento
 * (nunca controlada pelo cliente). Para o Processo Licitatório, apenas a versão `emitido` (autoridade
 * institucional) pode sair pelo pipeline oficial — um snapshot `gerado` NUNCA é exportável como oficial,
 * mesmo com chamada direta ao endpoint. Domínios ausentes deste mapa preservam o comportamento atual
 * (Contratos/Contratação Direta exportam qualquer versão oficial).
 *
 * V1 — Parecer Jurídico entra no mesmo gate: o boundary institucional é a ASSINATURA humana, então
 * apenas a versão `emitido` (materializada em `signOpinion` com o conteúdo EXATO assinado) pode sair
 * pelo pipeline oficial. Um rascunho `gerado` do parecer NUNCA exporta como oficial, mesmo por chamada
 * direta ao endpoint.
 */
const OFFICIAL_EXPORT_REQUIRED_STATUS: Record<string, string | undefined> = {
  processo_licitatorio: "emitido",
  parecer_juridico: "emitido",
};

export async function exportOfficialDocument(params: {
  organizationId: number;
  userId: number;
  documentId: string;
  format: OfficialFormat;
  /** "inline" para impressão (visualizar no navegador), "attachment" para baixar. */
  disposition?: "attachment" | "inline";
  correlationId?: string;
}): Promise<{ url: string; format: OfficialFormat; fileName: string }> {
  // Fail-closed + tenant-scoped: getOfficialDocument filtra por organização.
  const doc = await getOfficialDocument(params.documentId, params.organizationId);
  if (!doc || !doc.content.trim()) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado ou vazio para exportar." });
  }
  // Gate SERVER-OWNED por domínio (não confia no cliente): status exigido é derivado do documento.
  const requiredStatus = OFFICIAL_EXPORT_REQUIRED_STATUS[doc.businessDomain];
  if (requiredStatus && doc.status !== requiredStatus) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Somente a versão oficial "${requiredStatus}" pode ser exportada como documento oficial (atual: "${doc.status}").`,
    });
  }
  const org = await getOrganizationById(params.organizationId);
  const statusLabel = STATUS_LABELS[doc.status] ?? doc.status.toUpperCase();
  const statusSlug = STATUS_SLUGS[doc.status] ?? doc.status;

  // Número humano do processo/contrato vem dos METADADOS (nunca o `origin`, que é id
  // interno) — assim o nome de download não vaza UUID interno.
  const procRef = metaString(doc.metadata, ["processNumber", "numero", "numeroProcesso", "contractNumber", "numeroContrato"]);
  const object = metaString(doc.metadata, ["object", "objeto"]);
  const refForName = procRef ? procRef.replace(/\//g, "-") : "";
  const downloadBaseName = refForName
    ? `${doc.documentType.toUpperCase()}_${refForName}_${statusSlug}_v${doc.version}`
    : `${doc.documentType.toUpperCase()}_${statusSlug}_v${doc.version}`;

  const exported = await exportDocument({
    organizationId: params.organizationId,
    content: doc.content, // conteúdo persistido, renderizado FIELMENTE
    baseName: `${doc.documentType}_${doc.lineageId}_v${doc.version}`, // chave interna (linhagem, não UUID sensível)
    downloadBaseName,
    format: params.format,
    scope: doc.businessDomain,
    disposition: params.disposition ?? "attachment",
    meta: {
      organizationName: org?.nome || undefined,
      documentTitle: TYPE_TITLES[doc.documentType] ?? doc.title,
      processNumber: procRef,
      object,
      statusLabel,
      isDraft: doc.status !== "emitido", // só "emitido" é versão oficial finalizada
      draftNoticeLabel: statusLabel,
      version: doc.version,
      exportedAtLabel: formatBrazilianDateTime(new Date()),
    },
  });

  // Auditoria (leitura) — sem conteúdo integral; sem nova versão/evento de lifecycle.
  await logActivity({
    organizationId: params.organizationId,
    userId: params.userId,
    action: "exportou documento oficial",
    entityType: "official_document",
    correlationId: params.correlationId,
    details: {
      documentId: doc.id, businessDomain: doc.businessDomain, documentType: doc.documentType,
      version: doc.version, status: doc.status, format: params.format,
    },
  });

  return { url: exported.url, format: params.format, fileName: exported.fileName };
}
