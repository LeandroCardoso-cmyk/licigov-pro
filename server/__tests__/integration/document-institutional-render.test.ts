/**
 * PR #188 — Acabamento institucional das exportações.
 *
 * Cobre o MODELO intermediário comum (buildInstitutionalModel): interpretação
 * correta de Markdown via `marked` (sem artefatos literais), itálico/negrito,
 * bloco de aviso (blockquote sem `>`), cabeçalho e status; e os renderers DOCX/PDF
 * produzindo binário (pdfkit/docx puros — sem LibreOffice).
 */
import { describe, it, expect } from "vitest";
import {
  buildInstitutionalModel, renderInstitutionalDOCX, renderInstitutionalPDF,
  type InstitutionalMeta, type InlineRun,
} from "../../services/documentConverter";

const META: InstitutionalMeta = {
  organizationName: "Prefeitura Municipal de Moreira Sales",
  documentTitle: "DFD — Documento de Formalização da Demanda",
  processNumber: "100/2026",
  object: "Aquisição de Equipamentos de Informatica",
  statusLabel: "RASCUNHO",
  isDraft: true,
  version: 1,
  exportedAtLabel: "26/07/2026 às 21:45",
};

// Conteúdo com os mesmos marcadores que vazavam na homologação.
const CONTENT = [
  "# DFD — Documento de Formalização da Demanda",
  "_Art. 12, §1º da Lei 14.133/2021 — rascunho estruturado._",
  "",
  "## 1. Identificação",
  "Objeto: **Aquisição** de equipamentos.",
  "",
  "- item um",
  "- item dois",
  "",
  "> Rascunho gerado pelo sistema. Revisão obrigatória.",
].join("\n");

const allText = (runs: InlineRun[]) => runs.map((r) => r.text).join("");

describe("PR #188 · buildInstitutionalModel (sem artefatos Markdown)", () => {
  const model = buildInstitutionalModel(CONTENT, META);

  it("mantém os metadados institucionais", () => {
    expect(model.meta.organizationName).toContain("Moreira Sales");
    expect(model.meta.statusLabel).toBe("RASCUNHO");
    expect(model.meta.version).toBe(1);
    expect(model.meta.exportedAtLabel).toBe("26/07/2026 às 21:45");
  });

  it("renderiza o subtítulo em ITÁLICO, sem o caractere '_'", () => {
    const italicPara = model.blocks.find(
      (b) => b.kind === "paragraph" && b.runs.some((r) => r.italic) && allText(b.runs).includes("Art. 12"),
    );
    expect(italicPara, "parágrafo em itálico do art. 12 não encontrado").toBeTruthy();
    const text = italicPara!.kind === "paragraph" ? allText(italicPara!.runs) : "";
    expect(text).toContain("Art. 12");
    expect(text).not.toContain("_"); // sem marcador literal
  });

  it("transforma blockquote em bloco de AVISO, sem o caractere '>'", () => {
    const notice = model.blocks.find((b) => b.kind === "notice");
    expect(notice).toBeTruthy();
    const text = notice!.kind === "notice" ? allText(notice!.runs) : "";
    expect(text).toContain("Revisão obrigatória");
    expect(text).not.toContain(">");
  });

  it("interpreta **negrito** como run em negrito (sem '**')", () => {
    const para = model.blocks.find((b) => b.kind === "paragraph" && allText(b.kind === "paragraph" ? b.runs : []).includes("Aquisição"));
    const runs = para && para.kind === "paragraph" ? para.runs : [];
    expect(runs.some((r) => r.bold && r.text.includes("Aquisição"))).toBe(true);
    expect(allText(runs)).not.toContain("*");
  });

  it("interpreta headings sem '#' literal", () => {
    const heads = model.blocks.filter((b) => b.kind === "heading");
    expect(heads.length).toBeGreaterThanOrEqual(2);
    for (const h of heads) expect(allText(h.kind === "heading" ? h.runs : [])).not.toContain("#");
  });

  it("interpreta listas sem '-' literal", () => {
    const list = model.blocks.find((b) => b.kind === "list");
    expect(list).toBeTruthy();
    if (list && list.kind === "list") {
      expect(list.items.length).toBe(2);
      expect(allText(list.items[0])).toBe("item um");
    }
  });

  it("renderiza o objeto FIELMENTE (sem correção ortográfica)", () => {
    // "Informatica" sem acento — o exportador não corrige o conteúdo persistido.
    expect(model.meta.object).toBe("Aquisição de Equipamentos de Informatica");
  });
});

describe("PR #188 · renderers institucionais produzem binário (sem LibreOffice)", () => {
  const model = buildInstitutionalModel(CONTENT, META);
  it("DOCX gera Buffer não vazio", async () => {
    const buf = await renderInstitutionalDOCX(model);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(200);
  });
  it("PDF gera Buffer não vazio começando com %PDF", async () => {
    const buf = await renderInstitutionalPDF(model);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
