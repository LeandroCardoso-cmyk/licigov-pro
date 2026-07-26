/**
 * PR B — Núcleo COMUM de exportação de documentos (DOCX/PDF).
 *
 * Pipeline transversal e MÓDULO-AGNÓSTICO: dado um conteúdo (Markdown/representação
 * intermediária) + um nome-base + um formato, produz o artefato binário e o
 * armazena no Storage Service (S3), retornando uma URL de download assinada.
 *
 * NÃO conhece Processo Licitatório, Contratos, Aditivos, Contratação Direta ou
 * Parecer Jurídico — cada módulo é um ADAPTER que fornece {content, baseName,
 * header}. Reutiliza o conversor oficial (`documentConverter`) e o Storage Service
 * (ponto único de S3). Não cria store paralelo nem toca em regras de domínio.
 *
 * Reuso previsto (adapters na próxima PR): Contratos, Aditivos, Contratação Direta,
 * Parecer Jurídico — todos passam o conteúdo já renderizado do seu documento.
 */
// Fronteira RC-3.5.2: o DocumentConverter só é acionado pelo Document Engine.
// O pipeline comum de exportação usa a primitiva `renderContent` do Engine.
import { renderContent } from "./documentEngineService";
import { assertStorageUsable, storagePut, storageSignedUrl } from "../storage";

export type ExportFormat = "docx" | "pdf";

/** Cabeçalho institucional opcional (aplicado pelo conversor). Genérico. */
export interface ExportHeader {
  organizationName?: string;
  address?: string;
  cnpj?: string;
  phone?: string;
  email?: string;
  website?: string;
}

export interface ExportDocumentParams {
  /** Tenant dono do artefato (isolamento de chave no storage). */
  organizationId: number;
  /** Conteúdo do documento (Markdown/representação intermediária). */
  content: string;
  /** Nome-base do arquivo (sem extensão) — será sanitizado. */
  baseName: string;
  format: ExportFormat;
  /** Prefixo lógico da chave (ex.: "processo", "contrato") — apenas organização. */
  scope?: string;
  header?: ExportHeader;
  /** Validade da URL assinada (s). Padrão 1h. */
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
 * Sanitiza o nome-base: converte separadores de caminho e caracteres inseguros em
 * "_" (previne path traversal SEM descartar partes legítimas do nome, ex.: o número
 * do processo "100/2026" → "100_2026"), neutraliza sequências de ponto e limita o
 * comprimento.
 */
export function sanitizeExportBaseName(baseName: string): string {
  const cleaned = baseName
    .replace(/[^a-zA-Z0-9_\-. ]/g, "_") // "/", "\", etc. → "_"
    .replace(/\.{2,}/g, "_")
    .replace(/^\.+/, "")
    .trim();
  const safe = cleaned.slice(0, 120).trim();
  return safe.length > 0 ? safe : "documento";
}

/**
 * Renderiza o conteúdo para DOCX/PDF, grava no Storage Service e devolve a URL
 * assinada de download. Núcleo comum — sem dependência de módulo específico.
 */
export async function exportDocument(params: ExportDocumentParams): Promise<ExportedDocument> {
  assertStorageUsable();

  const safeBase = sanitizeExportBaseName(params.baseName);
  const ext = params.format;
  const fileName = `${safeBase}.${ext}`;

  // Conversão via o Document Engine (fronteira RC-3.5.2); storage/URL aqui.
  const buffer = await renderContent({
    content: params.content,
    fileName,
    format: params.format,
    header: params.header,
  });

  const scope = (params.scope ?? "export").replace(/[^a-z0-9_-]/gi, "");
  // Chave por tenant (isolamento) — o timestamp evita colisão entre exportações.
  const key = `exports/${scope}/${params.organizationId}/${Date.now()}_${safeBase}.${ext}`;
  await storagePut(key, buffer, MIME[params.format]);
  const { url } = await storageSignedUrl(key, params.expiresInSeconds ?? 3600);

  return { key, url, format: params.format, mimeType: MIME[params.format], fileName };
}
