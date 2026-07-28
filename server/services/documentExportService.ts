/**
 * PR B/#188 — Núcleo COMUM de exportação de documentos (DOCX/PDF).
 *
 * Pipeline transversal e MÓDULO-AGNÓSTICO: dado um conteúdo (Markdown) + metadados
 * institucionais + formato, produz o artefato binário com ACABAMENTO INSTITUCIONAL
 * (cabeçalho, status, versão, data; sem artefatos Markdown) e o armazena no Storage
 * Service (S3), retornando uma URL de download assinada — com **nome de download
 * legível separado da chave interna técnica**.
 *
 * NÃO conhece Processo/Contrato/Parecer — cada módulo é um ADAPTER que fornece
 * `{content, baseName, meta}`. Reutiliza o Document Engine (renderização, fronteira
 * RC-3.5.2) e o Storage Service (ponto único de S3). Sem store paralelo.
 */
import { renderContent, renderInstitutionalContent, type InstitutionalMeta } from "./documentEngineService";
import { assertStorageUsable, storagePut, storageSignedUrl } from "../storage";

export type ExportFormat = "docx" | "pdf";

/** Cabeçalho institucional opcional (aplicado pelo conversor legado). Genérico. */
export interface ExportHeader {
  organizationName?: string;
  address?: string;
  cnpj?: string;
  phone?: string;
  email?: string;
  website?: string;
}

export interface ExportDocumentParams {
  organizationId: number;
  /** Conteúdo do documento (Markdown/representação intermediária). */
  content: string;
  /** Nome-base para a CHAVE INTERNA do storage (sanitizado). */
  baseName: string;
  format: ExportFormat;
  /** Prefixo lógico da chave (ex.: "processo") — apenas organização. */
  scope?: string;
  /** Metadados institucionais → renderização com cabeçalho/status/versão/data. */
  meta?: InstitutionalMeta;
  /** Nome de download APRESENTADO ao usuário (determinístico). Default: baseName. */
  downloadBaseName?: string;
  /** Cabeçalho legado (usado apenas quando `meta` ausente). */
  header?: ExportHeader;
  expiresInSeconds?: number;
}

export interface ExportedDocument {
  key: string;
  url: string;
  format: ExportFormat;
  mimeType: string;
  fileName: string;
}

const MIME: Record<ExportFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

/**
 * Sanitiza um nome-base: converte separadores de caminho e caracteres inseguros em
 * "_" (previne path traversal SEM descartar partes legítimas do nome, ex.: o número
 * do processo "100/2026" → "100_2026"), neutraliza sequências de ponto e limita o
 * comprimento.
 */
/**
 * Formata um instante UTC no padrão institucional brasileiro
 * ("26/07/2026 às 21:45"), convertendo APENAS na apresentação (timezone
 * America/Sao_Paulo). Não altera o armazenamento interno (UTC).
 */
export function formatBrazilianDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} às ${get("hour")}:${get("minute")}`;
}

export function sanitizeExportBaseName(baseName: string): string {
  const cleaned = baseName
    .replace(/[^a-zA-Z0-9_\-. ]/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/^\.+/, "")
    .trim();
  const safe = cleaned.slice(0, 120).trim();
  return safe.length > 0 ? safe : "documento";
}

/**
 * Renderiza o conteúdo para DOCX/PDF (institucional quando `meta` presente), grava
 * no Storage Service e devolve a URL assinada com nome de download legível.
 * Núcleo comum — sem dependência de módulo específico.
 */
export async function exportDocument(params: ExportDocumentParams): Promise<ExportedDocument> {
  assertStorageUsable();

  const ext = params.format;
  const safeInternal = sanitizeExportBaseName(params.baseName);
  // Nome de download legível e DETERMINÍSTICO (sem timestamp/ids internos).
  const downloadFileName = `${sanitizeExportBaseName(params.downloadBaseName ?? params.baseName)}.${ext}`;

  const buffer = params.meta
    ? await renderInstitutionalContent({ content: params.content, meta: params.meta, format: params.format })
    : await renderContent({ content: params.content, fileName: downloadFileName, format: params.format, header: params.header });

  const scope = (params.scope ?? "export").replace(/[^a-z0-9_-]/gi, "");
  // Chave INTERNA por tenant (timestamp evita colisão/sobrescrita entre exportações).
  const key = `exports/${scope}/${params.organizationId}/${Date.now()}_${safeInternal}.${ext}`;
  await storagePut(key, buffer, MIME[params.format]);
  // URL assinada com o nome de download apresentado ao usuário (Content-Disposition).
  const { url } = await storageSignedUrl(key, params.expiresInSeconds ?? 3600, downloadFileName);

  return { key, url, format: params.format, mimeType: MIME[params.format], fileName: downloadFileName };
}
