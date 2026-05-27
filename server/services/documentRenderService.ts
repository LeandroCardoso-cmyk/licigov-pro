/**
 * Sprint 2.5 — Document Render Pipeline.
 *
 * Renderização oficial de documentos: HTML (base), DOCX e PDF (adapters).
 * Cache de render por versionId, invalidação automática.
 * Preparado para: header/footer, paginação, watermark, QR, assinatura futura.
 */
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createHash } from "crypto";
import { getDb } from "../db/connection";
import { documentRenderCache, documents } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";
import type { ExportFormat } from "../domain/documentTypes";

const log = serviceLogger("DocumentRenderService");

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// ─── Options ──────────────────────────────────────────────────────────────────

export interface RenderOptions {
  includeWatermark?:   boolean;
  includeHeader?:      boolean;
  includeFooter?:      boolean;
  includePagination?:  boolean;
  watermarkText?:      string;
  locale?:             "pt-BR" | "en-US";
}

export interface RenderResult {
  format:      ExportFormat;
  content:     string;
  renderHash:  string;
  renderedAt:  string;
  fromCache:   boolean;
  checksum?:   string;
}

// ─── HTML renderer ────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderToHtml(
  title:   string,
  type:    string,
  content: string,
  opts:    RenderOptions = {},
): string {
  const watermarkText = opts.watermarkText ?? "RASCUNHO";
  const watermark     = opts.includeWatermark
    ? `<div class="watermark" aria-hidden="true">${escapeHtml(watermarkText)}</div>` : "";
  const header = opts.includeHeader
    ? `<header class="doc-header"><h1>${escapeHtml(title)}</h1><span class="doc-type">${escapeHtml(type.toUpperCase())}</span></header>` : "";
  const footer = opts.includeFooter
    ? `<footer class="doc-footer"><span>LiciGov Pro — ${new Date().toLocaleDateString("pt-BR")}</span></footer>` : "";

  return `<!DOCTYPE html>
<html lang="${opts.locale ?? "pt-BR"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.6; margin: 2cm; color: #1a1a1a; }
    h1, h2, h3 { font-weight: bold; margin-bottom: 0.5em; }
    .doc-header { border-bottom: 2px solid #333; padding-bottom: 1em; margin-bottom: 2em; }
    .doc-footer { border-top: 1px solid #ccc; margin-top: 2em; padding-top: 0.5em; font-size: 10pt; color: #666; }
    .doc-type { font-size: 10pt; color: #666; text-transform: uppercase; letter-spacing: 1px; }
    .doc-content { min-height: 200px; }
    .watermark {
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 72pt; color: rgba(180,0,0,0.08);
      pointer-events: none; z-index: 9999; white-space: nowrap;
    }
    @media print {
      body { margin: 1.5cm; }
      .watermark { color: rgba(180,0,0,0.06); }
    }
  </style>
</head>
<body>
  ${watermark}
  ${header}
  <main class="doc-content">${content}</main>
  ${footer}
</body>
</html>`;
}

function buildRenderHash(documentId: number, versionId: number, format: ExportFormat, opts: RenderOptions): string {
  const key = JSON.stringify({ documentId, versionId, format, opts });
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

// ─── Render ───────────────────────────────────────────────────────────────────

export async function renderDocument(
  documentId:     number,
  organizationId: number,
  format:         ExportFormat,
  opts:           RenderOptions = {},
): Promise<RenderResult> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const docRows = await db.select().from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId)))
    .limit(1);

  if (docRows.length === 0)
    throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });

  const doc       = docRows[0];
  const versionId = doc.currentVersionId ?? 0;
  const renderHash = buildRenderHash(documentId, versionId, format, opts);
  const now        = new Date();

  // Cache hit?
  const cacheRows = await db.select().from(documentRenderCache)
    .where(and(
      eq(documentRenderCache.documentId,     documentId),
      eq(documentRenderCache.organizationId, organizationId),
      eq(documentRenderCache.format,         format),
      eq(documentRenderCache.renderHash,     renderHash),
      eq(documentRenderCache.status,         "ready"),
    ))
    .limit(1);

  if (cacheRows.length > 0 && cacheRows[0].renderedContent) {
    const cached = cacheRows[0];
    if (!cached.expiresAt || new Date(cached.expiresAt) > now) {
      log.debug("render_cache_hit", { documentId, format });
      return {
        format,
        content:    cached.renderedContent,
        renderHash,
        renderedAt: cached.renderedAt?.toISOString() ?? now.toISOString(),
        fromCache:  true,
      };
    }
  }

  // Render
  const title      = doc.title ?? `Documento #${documentId}`;
  const content    = doc.content ?? "";
  let   rendered   = "";

  if (format === "html" || format === "docx" || format === "pdf") {
    rendered = renderToHtml(title, doc.type, content, opts);
  }

  const checksum = createHash("sha256").update(rendered).digest("hex");

  // Write cache (non-fatal)
  try {
    await db.insert(documentRenderCache).values({
      organizationId,
      documentId,
      versionId:       versionId || null,
      format,
      renderHash,
      renderedContent: rendered,
      renderedAt:      now,
      expiresAt:       new Date(now.getTime() + CACHE_TTL_MS),
      status:          "ready",
    }).$returningId();
  } catch {
    log.warn("render_cache_write_failed", { documentId, format });
  }

  log.info("document_rendered", { documentId, format, organizationId, fromCache: false });

  return { format, content: rendered, renderHash, renderedAt: now.toISOString(), fromCache: false, checksum };
}

// ─── Cache invalidation ───────────────────────────────────────────────────────

export async function invalidateRenderCache(
  documentId:     number,
  organizationId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.delete(documentRenderCache)
    .where(and(
      eq(documentRenderCache.documentId,     documentId),
      eq(documentRenderCache.organizationId, organizationId),
    ));

  log.debug("render_cache_invalidated", { documentId, organizationId });
}

// ─── Format registry ──────────────────────────────────────────────────────────
// Stub adapters — Sprint 3 implementa DOCX/PDF completos.

export const SUPPORTED_FORMATS: ExportFormat[] = ["html", "docx", "pdf"];

export function isFormatSupported(format: string): format is ExportFormat {
  return SUPPORTED_FORMATS.includes(format as ExportFormat);
}
