/**
 * M8 — EMENDA P1-C: evidência versionada da análise de declaração do documento.
 *
 *  - os QUATRO parsers registrados devolvem a marca `declarationScan` no caminho de extração de linhas (CSV, XLSX, DOCX,
 *    PDF nativo) — e não no caminho documental;
 *  - a evidência só nasce com a versão vigente E o arquivo lido = checksum da sessão (nunca fabricada);
 *  - `assessProvenanceScan` é fail-closed (ausente, versão antiga, outro arquivo, JSON inválido);
 *  - revalidação: só os avisos de declaração do documento são substituídos; elegibilidade preserva histórico concluído.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, Table, TableRow, TableCell } from "docx";
import { CsvParser } from "../../parsers/csvParser";
import { XlsxParser } from "../../parsers/xlsxParser";
import { DocxParser } from "../../parsers/docxParser";
import { PdfParser } from "../../parsers/pdfParser";
import { parserRegistry } from "../../parsers/parserRegistry";
import type { ParseOptions } from "../../parsers/baseParser";
import {
  assessProvenanceScan, buildProvenanceScanEvidence, DOCUMENT_DECLARES_FICTITIOUS, hasFileCoverageGap,
  PROVENANCE_SCAN_INCOMPLETE_MESSAGE, PROVENANCE_SCAN_REQUIRED_MESSAGE, provenanceScanRequiredMessage,
  DECLARATION_SCAN_PERFORMED, mergeRevalidatedDeclarationWarnings, mostRestrictiveDeclaration, PROVENANCE_SCAN_VERSION,
} from "../../domain/quoteProvenance";
import { assessProvenanceRevalidation } from "../../domain/importReprocess";
import { nativeTextPdf } from "../fixtures/pageLimitPdfFixture";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const opts = (mime: string, over: Partial<ParseOptions> = {}): ParseOptions => ({
  importSessionId: 1, organizationId: 42, sourceFileId: "imports/42/x", sourceFileName: "f", sourceMimeType: mime,
  sourceChecksum: "a".repeat(64), ...over,
});
const textPdf = (lines: string[]) => new Promise<Buffer>((resolve) => {
  const doc = new PDFDocument({ margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  doc.on("end", () => resolve(Buffer.concat(chunks)));
  doc.fontSize(10);
  lines.forEach((l) => doc.text(l));
  doc.end();
});

describe("P1-C — os parsers registrados declaram que a análise rodou", () => {
  it("registro tem exatamente csv/xlsx/pdf/docx (um parser novo precisa declarar a análise para ser promovível)", () => {
    expect(parserRegistry.list().map((p) => p.parserType).sort()).toEqual(["csv", "docx", "pdf", "xlsx"]);
  });

  it("CSV", async () => {
    const r = await new CsvParser().safeParse(Buffer.from("Descrição;Qtd;Unid;Valor\nCaneta;10;UN;1,50\n"), opts("text/csv"));
    expect(r.items.length).toBe(1);
    expect(r.declarationScan).toEqual(DECLARATION_SCAN_PERFORMED);
  });

  it("XLSX", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Descrição", "Qtd", "Unid", "Valor"], ["Caneta", 10, "UN", 1.5]]), "Cotações");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const r = await new XlsxParser().safeParse(buf, opts("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
    expect(r.items.length).toBe(1);
    expect(r.declarationScan).toEqual(DECLARATION_SCAN_PERFORMED);
  });

  it("DOCX", async () => {
    const cell = (t: string) => new TableCell({ children: [new Paragraph(t)] });
    const table = new Table({ rows: [["Descrição", "Qtd", "Unid", "V.Unit"], ["Caneta azul", "10", "UN", "1,50"]].map((r) => new TableRow({ children: r.map(cell) })) });
    const buf = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("Pesquisa de preços"), table] }] }));
    const r = await new DocxParser().safeParse(buf, opts("application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.declarationScan).toEqual(DECLARATION_SCAN_PERFORMED);
  });

  it("PDF nativo (linhas) declara; modo documental não", async () => {
    const buf = await textPdf(["Descrição               Qtd      Unid     V.Unit       Total", "Caneta azul             100      UN       1,50         150,00"]);
    const r = await new PdfParser().safeParse(buf, opts("application/pdf"));
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.declarationScan).toEqual(DECLARATION_SCAN_PERFORMED);
    const doc = await new PdfParser().safeParse(buf, opts("application/pdf", { extractionMode: "document" }));
    expect(doc.declarationScan).toBeUndefined();
  });

  it("falha do parser não declara análise", async () => {
    const r = await new PdfParser().safeParse(Buffer.from("não é pdf"), opts("application/pdf"));
    expect(r.errors.some((e) => e.fatal)).toBe(true);
    expect(r.declarationScan).toBeUndefined();
  });
});

describe("P1-C — evidência só com análise vigente sobre o MESMO arquivo", () => {
  const buf = Buffer.from("conteúdo");
  const base = { sessionChecksum: sha(buf), analyzedChecksum: sha(buf), parserType: "csv", parserVersion: "1.1.0", origin: "extraction" as const };

  it("gera com a versão vigente; veredito dos avisos; checksum normalizado", () => {
    const ev = buildProvenanceScanEvidence({ ...base, sessionChecksum: base.sessionChecksum.toUpperCase(), performed: DECLARATION_SCAN_PERFORMED, warnings: [{ code: DOCUMENT_DECLARES_FICTITIOUS }] });
    expect(ev).toMatchObject({ version: PROVENANCE_SCAN_VERSION, sourceChecksum: sha(buf), declaration: "global", origin: "extraction" });
    expect(buildProvenanceScanEvidence({ ...base, performed: DECLARATION_SCAN_PERFORMED, warnings: [] })!.declaration).toBeNull();
  });

  it("não gera quando há página digitalizada NÃO lida (OCR indisponível, falho, parcial ou limitado)", () => {
    for (const code of ["OCR_REQUIRED", "OCR_REQUIRED_PARTIAL", "OCR_FAILED", "OCR_PAGE_LIMIT", "PAGE_LIMIT"]) {
      expect(buildProvenanceScanEvidence({ ...base, performed: DECLARATION_SCAN_PERFORMED, warnings: [{ code }] })).toBeNull();
    }
    expect(buildProvenanceScanEvidence({ ...base, performed: DECLARATION_SCAN_PERFORMED, warnings: [{ code: "OCR_LOW_CONFIDENCE" }] })).not.toBeNull();
  });

  it("PDF digitalizado sem OCR: o parser roda a análise, mas a cobertura é incompleta ⇒ sem evidência", async () => {
    const buf = await new Promise<Buffer>((resolve) => {
      const doc = new PDFDocument({ margin: 40 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.rect(60, 60, 300, 200).fill("#cccccc");
      doc.end();
    });
    const r = await new PdfParser().safeParse(buf, opts("application/pdf"));
    expect(r.warnings.some((w) => w.code === "OCR_REQUIRED")).toBe(true);
    expect(buildProvenanceScanEvidence({ ...base, sessionChecksum: sha(buf), analyzedChecksum: sha(buf), performed: r.declarationScan, warnings: r.warnings })).toBeNull();
  });

  it("PDF de 501 páginas (declaração fictícia SÓ na 501ª): PAGE_LIMIT, extração parcial preservada, SEM evidência", async () => {
    const buf = await nativeTextPdf(501, 501);
    const r = await new PdfParser().safeParse(buf, opts("application/pdf"));
    expect(r.warnings.map((w) => w.code)).toContain("PAGE_LIMIT");
    expect(r.items.length).toBe(2);                                                     // revisão continua possível
    expect(r.warnings.some((w) => w.code === DOCUMENT_DECLARES_FICTITIOUS)).toBe(false); // a página 501 não foi lida
    expect(buildProvenanceScanEvidence({ ...base, sessionChecksum: sha(buf), analyzedChecksum: sha(buf), performed: r.declarationScan, warnings: r.warnings })).toBeNull();
    expect(hasFileCoverageGap(r.warnings)).toBe(true);
    expect(provenanceScanRequiredMessage(r.warnings)).toBe(PROVENANCE_SCAN_INCOMPLETE_MESSAGE);
  }, 60_000);

  it("PDF no limite (500 páginas, declaração na 500ª): análise completa ⇒ evidência legítima com veredito `global`", async () => {
    const buf = await nativeTextPdf(500, 500);
    const r = await new PdfParser().safeParse(buf, opts("application/pdf"));
    expect(r.warnings.map((w) => w.code)).not.toContain("PAGE_LIMIT");
    expect(r.items.length).toBe(2);
    const ev = buildProvenanceScanEvidence({ ...base, sessionChecksum: sha(buf), analyzedChecksum: sha(buf), performed: r.declarationScan, warnings: r.warnings });
    expect(ev).toMatchObject({ version: PROVENANCE_SCAN_VERSION, declaration: "global" });
    expect(provenanceScanRequiredMessage(r.warnings)).toBe(PROVENANCE_SCAN_REQUIRED_MESSAGE);
  }, 60_000);

  it("não gera: análise não executada, versão diferente, arquivo divergente, sessão sem checksum", () => {
    expect(buildProvenanceScanEvidence({ ...base, performed: undefined, warnings: [] })).toBeNull();
    expect(buildProvenanceScanEvidence({ ...base, performed: { version: PROVENANCE_SCAN_VERSION + 1 }, warnings: [] })).toBeNull();
    expect(buildProvenanceScanEvidence({ ...base, analyzedChecksum: sha(Buffer.from("outro")), performed: DECLARATION_SCAN_PERFORMED, warnings: [] })).toBeNull();
    expect(buildProvenanceScanEvidence({ ...base, sessionChecksum: null, performed: DECLARATION_SCAN_PERFORMED, warnings: [] })).toBeNull();
  });

  it("assessProvenanceScan é fail-closed", () => {
    const ev = buildProvenanceScanEvidence({ ...base, performed: DECLARATION_SCAN_PERFORMED, warnings: [] })!;
    expect(assessProvenanceScan({ provenanceScan: ev }, sha(buf))).toEqual({ ok: true, declaration: null });
    expect(assessProvenanceScan(JSON.stringify({ provenanceScan: ev }), sha(buf)).ok).toBe(true);           // coluna JSON como texto
    expect(assessProvenanceScan(null, sha(buf))).toEqual({ ok: false, reason: "MISSING" });                  // sessão legada
    expect(assessProvenanceScan({ extraction: {} }, sha(buf))).toEqual({ ok: false, reason: "MISSING" });
    expect(assessProvenanceScan("{json inválido", sha(buf))).toEqual({ ok: false, reason: "MISSING" });
    expect(assessProvenanceScan({ provenanceScan: { ...ev, version: 0 } }, sha(buf))).toEqual({ ok: false, reason: "OUTDATED" });
    expect(assessProvenanceScan({ provenanceScan: ev }, "b".repeat(64))).toEqual({ ok: false, reason: "CHECKSUM_MISMATCH" });
    expect(assessProvenanceScan({ provenanceScan: ev }, null)).toEqual({ ok: false, reason: "CHECKSUM_MISMATCH" });
    expect(assessProvenanceScan({ provenanceScan: { ...ev, declaration: "outro" } }, sha(buf))).toEqual({ ok: true, declaration: null });
  });
});

describe("P1-C — revalidação", () => {
  it("UNIÃO: nunca remove uma declaração já registrada; acrescenta só as declarações da nova análise (sem duplicar)", () => {
    const current = [{ code: "OCR_LOW_CONFIDENCE" }, { code: "HEADER_INFERENCE" }, { code: DOCUMENT_DECLARES_FICTITIOUS, field: "ocr" }];
    expect(mergeRevalidatedDeclarationWarnings(current, []).map((w) => w.code)).toEqual(["OCR_LOW_CONFIDENCE", "HEADER_INFERENCE", DOCUMENT_DECLARES_FICTITIOUS]);
    const next = [{ code: DOCUMENT_DECLARES_FICTITIOUS }, { code: DOCUMENT_DECLARES_FICTITIOUS, field: "ocr" }, { code: "MULTIPLE_SHEETS" }];
    expect(mergeRevalidatedDeclarationWarnings(current, next).map((w) => `${w.code}|${w.field ?? ""}`))
      .toEqual(["OCR_LOW_CONFIDENCE|", "HEADER_INFERENCE|", `${DOCUMENT_DECLARES_FICTITIOUS}|ocr`, `${DOCUMENT_DECLARES_FICTITIOUS}|`]);
    expect(mergeRevalidatedDeclarationWarnings(null, []).length).toBe(0);
    expect(mostRestrictiveDeclaration(null, "suspected")).toBe("suspected");
    expect(mostRestrictiveDeclaration("suspected", "global", null)).toBe("global");
    expect(mostRestrictiveDeclaration(null, undefined)).toBeNull();
  });

  const facts = {
    importType: "price_research", status: "approved", promotionStatus: "none", hasPromotionLedger: false,
    stage: "approved", updatedAt: new Date(), now: new Date(), checksum: "a".repeat(64), scanCurrent: false,
  };
  it("elegível em revisão ou aprovada (revisões preservadas); recusada se promovida/reextraindo/sem checksum/vigente/outro tipo", () => {
    expect(assessProvenanceRevalidation(facts).eligible).toBe(true);
    expect(assessProvenanceRevalidation({ ...facts, status: "awaiting_review" }).eligible).toBe(true);
    expect(assessProvenanceRevalidation({ ...facts, promotionStatus: "promoted" }).blockers).toContain("PROMOTED");
    expect(assessProvenanceRevalidation({ ...facts, hasPromotionLedger: true }).blockers).toContain("PROMOTED");
    expect(assessProvenanceRevalidation({ ...facts, stage: "reprocessing" }).blockers).toContain("REPROCESS_IN_PROGRESS");
    expect(assessProvenanceRevalidation({ ...facts, checksum: null }).blockers).toContain("NO_CHECKSUM");
    expect(assessProvenanceRevalidation({ ...facts, scanCurrent: true }).blockers).toContain("ALREADY_CURRENT");
    expect(assessProvenanceRevalidation({ ...facts, importType: "tr_items" }).blockers).toContain("NOT_PRICE_RESEARCH");
    expect(assessProvenanceRevalidation({ ...facts, status: "failed" }).blockers).toContain("NOT_REVIEWABLE");
    // Lacuna do próprio arquivo (limite de páginas): reanalisar não conclui ⇒ revalidação recusada (sem trabalho inútil).
    expect(assessProvenanceRevalidation({ ...facts, fileCoverageGap: true }).blockers).toContain("COVERAGE_INCOMPLETE");
    expect(hasFileCoverageGap([{ code: "OCR_REQUIRED_PARTIAL" }])).toBe(false); // OCR pode passar a estar disponível
  });
});

describe("P1-C — guarda estática da promoção", () => {
  const src = readFileSync(resolve(__dirname, "../../services/importPromotionService.ts"), "utf8");
  it("a evidência é conferida SOB o lock da sessão e ANTES de qualquer escrita (ledger/pesquisa/cotações)", () => {
    const body = src.slice(src.indexOf("export async function promoteApprovedSessionToDomain"), src.indexOf("// ─── Helpers"));
    const lock = body.indexOf('.for("update")');
    const check = body.indexOf("requireProvenanceScan(session)");
    const firstWrite = body.indexOf("tx.insert(");
    expect(lock).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(lock);
    expect(firstWrite).toBeGreaterThan(check);
  });
  it("a prévia também exige a evidência (mesma orientação antes da confirmação)", () => {
    const preview = src.slice(src.indexOf("export async function previewSessionPromotion"));
    expect(preview).toContain("requireProvenanceScan(session)");
  });
});
