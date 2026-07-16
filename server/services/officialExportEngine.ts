/**
 * RC-3.5 — Classificação: **INTERNO** (renderizador estruturado).
 *
 * Motor de exportação estruturado (sections → DOCX/PDF) usado exclusivamente pelo
 * exportRouter (`exports`) para Termos de Referência. NÃO é o pipeline oficial de
 * documentos (esse é o Document Engine + documentConverter). Permanece como
 * componente interno de compatibilidade — não removido.
 *
 * Sprint 3.2 — Official Export Engine.
 *
 * Real DOCX and PDF generation for Termos de Referencia (TR).
 * Uses `docx` library for DOCX and `pdfkit` for PDF.
 *
 * PRINCIPIOS:
 *   - Replay-safe: same request => same contentHash (excluding timestamps).
 *   - A4 format, PT-BR headers.
 *   - Multi-tenant: organizationId obrigatorio.
 *
 * Embasamento: formalidade documental (Lei 14.133/2021, art. 18).
 */

import { createHash } from "crypto";
import {
  Document,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  PageBreak,
  AlignmentType,
  HeadingLevel,
  WidthType,
  BorderStyle,
  Packer,
} from "docx";
import PDFDocument from "pdfkit";
import type { TRSection, TRClause } from "../domain/trComposition";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExportMetadata {
  processNumber: string;
  year:          number;
  orgName:       string;
  [key: string]: unknown;
}

export interface ExportRequest {
  id:              string;
  organizationId:  number;
  processId:       number;
  format:          "docx" | "pdf";
  sections:        TRSection[];
  metadata:        ExportMetadata;
  watermark:       string | null;
  templateId:      string | null;
  correlationId:   string;
}

export interface ExportResult {
  id:           string;
  format:       "docx" | "pdf";
  buffer:       Buffer;
  filename:     string;
  contentHash:  string;
  pageCount:    number;
  generatedAt:  string;
  durationMs:   number;
}

export interface ExportAuditEntry {
  exportId:       string;
  organizationId: number;
  processId:      number;
  format:         "docx" | "pdf";
  actor:          string;
  contentHash:    string;
  generatedAt:    string;
}

// ─── Hash computation ────────────────────────────────────────────────────────

export function computeExportHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// ─── Audit entry builder ─────────────────────────────────────────────────────

export function buildExportAuditEntry(
  result: ExportResult,
  actor:  string,
  request: ExportRequest,
): ExportAuditEntry {
  return {
    exportId:       result.id,
    organizationId: request.organizationId,
    processId:      request.processId,
    format:         result.format,
    actor,
    contentHash:    result.contentHash,
    generatedAt:    result.generatedAt,
  };
}

// ─── Section rendering helpers ───────────────────────────────────────────────

function sectionToText(section: TRSection): string {
  const lines: string[] = [];
  lines.push(`${section.order}. ${section.title}`);
  for (const clause of section.clauses) {
    lines.push(clause.content);
    if (clause.legalBasis) {
      lines.push(`Base legal: ${clause.legalBasis}`);
    }
  }
  return lines.join("\n");
}

// ─── DOCX generation ─────────────────────────────────────────────────────────

export async function generateDocx(request: ExportRequest): Promise<ExportResult> {
  const startMs = Date.now();

  const children: Paragraph[] = [];

  // Title
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: "TERMO DE REFERENCIA",
          bold: true,
          size: 28,
          font: "Arial",
        }),
      ],
    }),
  );

  // Subtitle with process info
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [
        new TextRun({
          text: `Processo n. ${request.metadata.processNumber}/${request.metadata.year}`,
          size: 22,
          font: "Arial",
        }),
      ],
    }),
  );

  // Organization name
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [
        new TextRun({
          text: request.metadata.orgName,
          bold: true,
          size: 24,
          font: "Arial",
        }),
      ],
    }),
  );

  // Sections
  for (const section of request.sections) {
    children.push(
      new Paragraph({
        spacing: { before: 300, after: 200 },
        children: [
          new TextRun({
            text: `${section.order}. ${section.title}`,
            bold: true,
            size: 24,
            font: "Arial",
          }),
        ],
      }),
    );

    for (const clause of section.clauses) {
      children.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({
              text: clause.content,
              size: 22,
              font: "Arial",
            }),
          ],
        }),
      );

      if (clause.legalBasis) {
        children.push(
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({
                text: `Base legal: ${clause.legalBasis}`,
                italics: true,
                size: 20,
                font: "Arial",
              }),
            ],
          }),
        );
      }
    }
  }

  const headerChildren: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({
          text: request.metadata.orgName,
          size: 16,
          font: "Arial",
        }),
      ],
    }),
  ];

  if (request.watermark) {
    headerChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: request.watermark,
            size: 16,
            font: "Arial",
            color: "CCCCCC",
          }),
        ],
      }),
    );
  }

  const doc = new Document({
    sections: [
      {
        headers: {
          default: new Header({ children: headerChildren }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `Termo de Referencia - ${request.metadata.processNumber}/${request.metadata.year}`,
                    size: 16,
                    font: "Arial",
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const buffer = Buffer.from(await Packer.toBuffer(doc));
  const contentHash = computeExportHash(buffer);
  const durationMs = Date.now() - startMs;

  return {
    id: request.id,
    format: "docx",
    buffer,
    filename: `TR_${request.metadata.processNumber}_${request.metadata.year}.docx`,
    contentHash,
    pageCount: Math.max(1, Math.ceil(children.length / 30)),
    generatedAt: new Date().toISOString(),
    durationMs,
  };
}

// ─── PDF generation ──────────────────────────────────────────────────────────

export async function generatePdf(request: ExportRequest): Promise<ExportResult> {
  const startMs = Date.now();

  return new Promise<ExportResult>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
        info: {
          Title: `Termo de Referencia - ${request.metadata.processNumber}/${request.metadata.year}`,
          Author: request.metadata.orgName,
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const contentHash = computeExportHash(buffer);
        const durationMs = Date.now() - startMs;

        resolve({
          id: request.id,
          format: "pdf",
          buffer,
          filename: `TR_${request.metadata.processNumber}_${request.metadata.year}.pdf`,
          contentHash,
          pageCount: (doc as unknown as { _pageBuffer?: unknown[] })._pageBuffer?.length ?? 1,
          generatedAt: new Date().toISOString(),
          durationMs,
        });
      });
      doc.on("error", reject);

      // Watermark
      if (request.watermark) {
        doc.save();
        doc.fontSize(40).fillColor("#EEEEEE").opacity(0.3);
        doc.text(request.watermark, 100, 400, { align: "center" });
        doc.restore();
        doc.opacity(1);
      }

      // Title
      doc.fontSize(16).font("Helvetica-Bold");
      doc.text("TERMO DE REFERENCIA", { align: "center" });
      doc.moveDown(0.5);

      // Process number
      doc.fontSize(12).font("Helvetica");
      doc.text(
        `Processo n. ${request.metadata.processNumber}/${request.metadata.year}`,
        { align: "center" },
      );
      doc.moveDown(0.3);

      // Org name
      doc.fontSize(13).font("Helvetica-Bold");
      doc.text(request.metadata.orgName, { align: "center" });
      doc.moveDown(1);

      // Sections
      for (const section of request.sections) {
        doc.fontSize(13).font("Helvetica-Bold");
        doc.text(`${section.order}. ${section.title}`);
        doc.moveDown(0.5);

        for (const clause of section.clauses) {
          doc.fontSize(11).font("Helvetica");
          doc.text(clause.content, { align: "justify" });
          doc.moveDown(0.3);

          if (clause.legalBasis) {
            doc.fontSize(10).font("Helvetica-Oblique");
            doc.text(`Base legal: ${clause.legalBasis}`);
            doc.moveDown(0.2);
          }
        }

        doc.moveDown(0.5);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ─── Render sections (format-agnostic) ───────────────────────────────────────

export function renderSections(
  sections: TRSection[],
  _format:  "docx" | "pdf",
): string {
  return sections.map(sectionToText).join("\n\n");
}
