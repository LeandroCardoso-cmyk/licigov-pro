/**
 * F3.1 — paginação do bloco de ASSINATURAS (homologação F3, processo sintético 2167/2026: "a preencher — a preencher" + "CONTRATADO"
 * isolados numa página quase vazia antes do Anexo V). O encerramento de cada parte — fórmula, local/data, signatários e legendas — é
 * mantido numa mesma página nos DOCX e PDF (critério estrutural `markClosingBlocks`); nada é removido nem reordenado.
 * Fixtures SINTÉTICAS; sem DB, sem rede, sem IA. A conferência VISUAL do DOCX usa o LibreOffice quando instalado (`soffice`).
 */
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { composeTemplate } from "../../domain/institutionalTemplates/composer";
import {
  buildInstitutionalModel, CLOSING_BLOCK_MAX_PARAGRAPHS, markClosingBlocks, renderInstitutionalDOCX, renderInstitutionalPDF,
  type DocBlock, type InstitutionalMeta,
} from "../../services/documentConverter";
import { BASE_SCENARIO, BLL_MODEL_DIR, bllComposeRequest } from "../helpers/institutionalTemplatesBllHarness";
import { readZipEntry } from "../helpers/zipText";

const META: InstitutionalMeta = {
  documentTitle: "Edital — completo, com anexos", processNumber: "9999/2026", statusLabel: "EMITIDO", isDraft: false, version: 3, exportedAtLabel: "13/11/2026",
};
const CLOSING = ["E, por estarem de acordo, as partes assinam o presente instrumento.", "Município Sintético, 05/11/2026.",
  "a preencher — a preencher", "CONTRATANTE", "a preencher — a preencher", "CONTRATADO"];
const WITNESSES = ["TESTEMUNHAS:", "Testemunha Sintética Um — CPF a preencher", "Testemunha Sintética Dois — CPF a preencher"];

/** Minuta sintética com `k` cláusulas antes do encerramento — `k` desloca o bloco de assinaturas ao longo da página. */
const minuta = (k: number, closing: readonly string[] = CLOSING, annexV = true): string => [
  "## ANEXO IV — MINUTA DE CONTRATO", "",
  ...Array.from({ length: k }, (_, i) => `${i + 1}.1. Cláusula sintética de homologação número ${i + 1}, redigida apenas para ocupar espaço e posicionar o bloco de assinaturas próximo ao fim da página.\n`),
  "### CLÁUSULA VIGÉSIMA PRIMEIRA — DO FORO", "",
  "21.1. Fica eleito o foro da Comarca Sintética para dirimir as questões decorrentes deste contrato que não possam ser resolvidas na esfera administrativa.", "",
  ...closing.flatMap((l) => [l, ""]),
  ...(annexV ? ["## ANEXO V — MINUTA DE ATA DE REGISTRO DE PREÇOS", "", "Texto sintético do Anexo V, cláusula única."] : []),
].join("\n");

interface PdfLine { readonly text: string; readonly y: number }
/** Texto POSICIONADO de cada página (pdfjs via pdf-parse): `y` = linha de base a partir da borda inferior (pt). */
async function pdfLines(buf: Buffer): Promise<PdfLine[][]> {
  const { PDFParse } = (await import("pdf-parse")) as unknown as {
    PDFParse: new (o: { data: Uint8Array; verbosity?: number }) => {
      load(): Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: string; transform?: number[] }> }> }> }>;
      destroy?(): Promise<void>;
    };
  };
  const parser = new PDFParse({ data: new Uint8Array(buf), verbosity: 0 });
  const doc = await parser.load();
  const pages: PdfLine[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const items = (await (await doc.getPage(n)).getTextContent()).items;
    const byY = new Map<number, string>();
    for (const it of items) {
      if (typeof it.str !== "string" || !it.transform) continue;
      const y = Math.round(it.transform[5]);
      byY.set(y, (byY.get(y) ?? "") + it.str);
    }
    pages.push([...byY.entries()].sort((a, b) => b[0] - a[0]).map(([y, text]) => ({ y, text: text.trim() })).filter((l) => l.text));
  }
  await parser.destroy?.();
  return pages;
}
const isFooter = (l: PdfLine): boolean => /Página \d+ de \d+/.test(l.text) || /^Edital — completo/.test(l.text);
const body = (page: PdfLine[]): PdfLine[] => page.filter((l) => !isFooter(l));
const pageOf = (pages: PdfLine[][], s: string): number[] => pages.flatMap((p, i) => (body(p).some((l) => l.text.includes(s)) ? [i] : []));
/** Linha que É a linha do encerramento (igual, ou começa pelo prefixo longo): "CONTRATANTE" no meio de uma cláusula não conta. */
const isLine = (t: string, s: string): boolean => t === s || (s.length >= 30 && t.startsWith(s));
const linePages = (pages: PdfLine[][], s: string): number[] => pages.flatMap((p, i) => (body(p).some((l) => isLine(l.text, s)) ? [i] : []));

/** Encerramento coeso: todas as linhas na MESMA página, na ordem; Anexo V abre página própria sem resíduo de assinatura. */
function expectCohesive(pages: PdfLine[][], closing: readonly string[], label: string): void {
  const where = closing.map((l) => linePages(pages, l));
  for (const [i, w] of where.entries()) expect(w.length, `${label}: "${closing[i]}" ausente`).toBeGreaterThan(0);
  const sigPage = where[where.length - 1].at(-1)!;   // página da última legenda
  for (const [i, l] of closing.entries()) expect(where[i], `${label}: "${l}" fora da página das assinaturas`).toContain(sigPage);
  const lines = body(pages[sigPage]).map((x) => x.text);
  let at = -1;
  for (const l of closing) {   // ordem preservada
    const i = lines.findIndex((t, j) => j > at && isLine(t, l));
    expect(i, `${label}: ordem de "${l}"`).toBeGreaterThan(at);
    at = i;
  }
}

describe("F3.1 — marcação estrutural do encerramento (modelo intermediário, puro)", () => {
  const p = (text: string): DocBlock => ({ kind: "paragraph", runs: [{ text }] });
  const h = (level: 1 | 2 | 3 | 4, text: string): DocBlock => ({ kind: "heading", level, runs: [{ text }] });
  const kept = (bs: DocBlock[]) => bs.map((b) => (b.kind === "paragraph" && b.keepWithNext ? 1 : 0));
  const long = "Parágrafo longo de cláusula contratual sintética, com redação extensa suficiente para ultrapassar o limite de um encerramento curto de assinatura.";

  it("[T8] marca só os parágrafos CURTOS finais antes de título nível ≤ 2 ou do fim; o último do grupo não é marcado; texto e ordem intactos", () => {
    const input = [h(2, "ANEXO IV — MINUTA"), p(long), p("Local, data."), p("Nome — Cargo"), p("CONTRATANTE"), h(2, "ANEXO V — ATA"), p(long), p("Fulano — Cargo"), p("CONTRATADO")];
    const snapshot = JSON.stringify(input);
    const out = markClosingBlocks(input);
    expect(kept(out)).toEqual([0, 0, 1, 1, 0, 0, 0, 1, 0]);
    expect(JSON.stringify(input)).toBe(snapshot);   // puro: a entrada não muda
    const text = (bs: DocBlock[]) => bs.map((b) => (b.kind === "paragraph" || b.kind === "heading" ? b.runs.map((r) => r.text).join("") : "")).join("|");
    expect(text(out)).toBe(text(input));
  });

  it("sem falso positivo: parágrafo curto isolado, curtos antes de subtítulo (### …) e parágrafos longos não são agrupados", () => {
    expect(kept(markClosingBlocks([p(long), p("CONTRATADO")]))).toEqual([0, 0]);
    expect(kept(markClosingBlocks([p("Curto um."), p("Curto dois."), h(3, "1.2. Subseção"), p(long)]))).toEqual([0, 0, 0, 0]);
    expect(kept(markClosingBlocks([p(long), p(long)]))).toEqual([0, 0]);
    expect(kept(markClosingBlocks([p("a"), { kind: "table", header: [[{ text: "x" }]], rows: [] }, p("b")]))).toEqual([0, 0, 0]);
  });

  it(`grupo limitado a ${CLOSING_BLOCK_MAX_PARAGRAPHS} parágrafos (os finais): sem vazio grande, sem laço de paginação`, () => {
    const many = Array.from({ length: 30 }, (_, i) => p(`Linha curta ${i + 1}.`));
    const k = kept(markClosingBlocks(many));
    expect(k.filter(Boolean)).toHaveLength(CLOSING_BLOCK_MAX_PARAGRAPHS - 1);
    expect(k.slice(-CLOSING_BLOCK_MAX_PARAGRAPHS)).toEqual([...Array(CLOSING_BLOCK_MAX_PARAGRAPHS - 1).fill(1), 0]);
  });
});

describe("F3.1 — PDF: bloco de assinaturas nunca fragmentado", () => {
  it("[T1][T3][T5] em todas as posições do fim da página: encerramento inteiro numa página, dentro da margem, Anexo V em página própria", async () => {
    for (let k = 12; k <= 26; k++) {
      const pages = await pdfLines(await renderInstitutionalPDF(buildInstitutionalModel(minuta(k), META)));
      expectCohesive(pages, CLOSING, `k=${k}`);
      for (const [i, pg] of pages.entries()) {
        for (const l of body(pg)) expect(l.y, `k=${k} p${i + 1}: "${l.text}" abaixo da margem inferior`).toBeGreaterThanOrEqual(56);
        expect(body(pg).length, `k=${k} p${i + 1} só com rodapé`).toBeGreaterThan(0);
      }
      const v = pageOf(pages, "ANEXO V — MINUTA DE ATA");
      expect(v).toHaveLength(1);
      expect(body(pages[v[0]])[0].text, `k=${k}`).toContain("ANEXO V");
      expect(body(pages[v[0]]).map((l) => l.text).join(" "), `k=${k}`).not.toMatch(/CONTRATADO|a preencher/);
      expect(pageOf(pages, "Texto sintético do Anexo V")).toEqual(v);
    }
  }, 60_000);

  it("[T2] contratante, contratado e testemunhas: ordem e agrupamento preservados", async () => {
    const closing = [...CLOSING, ...WITNESSES];
    for (let k = 12; k <= 26; k++) {
      expectCohesive(await pdfLines(await renderInstitutionalPDF(buildInstitutionalModel(minuta(k, closing), META))), closing, `k=${k}`);
    }
  }, 60_000);

  it("[T6] minuta curta: nenhuma página nova (mesma contagem do layout sem a coesão)", async () => {
    const model = buildInstitutionalModel(minuta(3), META);
    const plain = { ...model, blocks: model.blocks.map((b) => (b.kind === "paragraph" ? { kind: "paragraph" as const, runs: b.runs } : b)) };
    const withCohesion = await pdfLines(await renderInstitutionalPDF(model));
    expect(withCohesion.length).toBe((await pdfLines(await renderInstitutionalPDF(plain))).length);
    expectCohesive(withCohesion, CLOSING, "curta");
  });

  it("[T7] documento extenso, várias posições: no máximo +1 página por coesão, nunca página vazia; termina (sem laço)", async () => {
    for (const k of [40, 55, 63, 64, 65, 66, 67, 80]) {
      const model = buildInstitutionalModel(minuta(k, [...CLOSING, ...WITNESSES], false), META);
      const plain = { ...model, blocks: model.blocks.map((b) => (b.kind === "paragraph" ? { kind: "paragraph" as const, runs: b.runs } : b)) };
      const pages = await pdfLines(await renderInstitutionalPDF(model));
      expect(pages.length, `k=${k}`).toBeLessThanOrEqual((await pdfLines(await renderInstitutionalPDF(plain))).length + 1);
      expectCohesive(pages, [...CLOSING, ...WITNESSES], `k=${k}`);
      for (const pg of pages) expect(body(pg).length).toBeGreaterThan(0);
    }
  }, 60_000);

  it("[T10] Edital BLL completo (SRP ⇒ Anexo V): encerramento do Anexo IV coeso e Anexo V intacto, em página própria", async () => {
    const ast = JSON.parse(readFileSync(path.join(BLL_MODEL_DIR, "ast.json"), "utf8"));
    const r = composeTemplate(bllComposeRequest(ast, { ...BASE_SCENARIO, "controle.utilizaSrp": true }, { aiNarratives: [] }));
    if (!r.ok) throw new Error("compose");
    const edital = r.value.content.text;
    const iIV = edital.indexOf("## ANEXO IV");
    const iV = edital.indexOf("## ANEXO V");
    expect(iIV).toBeGreaterThan(0);
    expect(iV).toBeGreaterThan(iIV);
    const closing = edital.slice(iIV, iV).trim().split(/\n\s*\n/).slice(-6).map((s) => s.trim());
    expect(closing[0]).toContain("por estarem de acordo");
    for (let extra = 0; extra <= 24; extra++) {   // desloca o fim do Anexo IV ao longo de uma página inteira
      // parágrafos de 2 linhas (~33 pt): 0..24 varre mais que a altura útil de uma página
      const filler = Array.from({ length: extra }, (_, i) => `Parágrafo sintético de deslocamento ${i + 1}, com redação longa o bastante para ocupar duas linhas do corpo do documento exportado em PDF.`).join("\n\n");
      const iBody = edital.indexOf("\n\n", iIV) + 2;   // logo após o título do Anexo IV (que sempre abre página nova)
      const content = `${edital.slice(0, iBody)}${filler}\n\n${edital.slice(iBody)}`;
      const pages = await pdfLines(await renderInstitutionalPDF(buildInstitutionalModel(content, META)));
      expectCohesive(pages, closing.map((c) => c.slice(0, 40)), `extra=${extra}`);
      const v = pageOf(pages, "ANEXO V —");
      expect(body(pages[v[0]])[0].text).toContain("ANEXO V —");
    }
  }, 60_000);
});

describe("F3.1 — auditoria (P1): título imediatamente antes do grupo nunca fica órfão no pé da página (PDF)", () => {
  const filler = (k: number) => Array.from({ length: k }, (_, i) => `${i + 1}. Parágrafo sintético com redação longa o bastante para ocupar duas linhas do corpo do documento exportado em PDF.`).join("\n\n");
  const samePage = (pages: PdfLine[][], heading: string, first: string, label: string) => {
    const h = linePages(pages, heading);
    const f = linePages(pages, first);
    expect(h, `${label}: "${heading}"`).toHaveLength(1);
    expect(f, `${label}: "${first}" na página do título`).toEqual(h);
  };

  it("seção \"DOS ANEXOS\" (linhas curtas + local/data + signatário) logo após o título", async () => {
    const section = ["## 34. DOS ANEXOS", "34.1. Integram este Edital, para todos os fins e efeitos:", "a) Anexo I — Termo de Referência;",
      "b) Anexo II — Modelo de Proposta;", "c) Anexo III — Modelo de Declarações;", "d) Anexo IV — Minuta de Contrato;",
      "Município Sintético, 05/11/2026.", "Pregoeira Sintética", "Agente de Contratação"].join("\n\n");
    for (let k = 10; k <= 30; k++) {
      const pages = await pdfLines(await renderInstitutionalPDF(buildInstitutionalModel(`${filler(k)}\n\n${section}\n\n## ANEXO I — TERMO DE REFERÊNCIA\n\nTexto.`, META)));
      samePage(pages, "34. DOS ANEXOS", "34.1. Integram este Edital, para todos os fins e efeitos:", `k=${k}`);
      for (const pg of pages) expect(body(pg).length, `k=${k}`).toBeGreaterThan(0);
    }
  }, 60_000);

  it("bloco \"Assinatura\" do Parecer assinado (signatureBlocks): título junto de \"Responsável\"", async () => {
    const meta: InstitutionalMeta = { ...META, documentTitle: "Parecer Jurídico", signature: { signed: true, signerName: "Procuradora Sintética", signerRole: "Procuradora", methodLabel: "Manual", signedAtLabel: "05/11/2026 às 10:00" } };
    for (let k = 10; k <= 45; k++) {
      const pages = await pdfLines(await renderInstitutionalPDF(buildInstitutionalModel(filler(k), meta)));
      samePage(pages, "Assinatura", "Responsável: Procuradora Sintética", `k=${k}`);
    }
  }, 60_000);
});

describe("F3.1 — DOCX: bloco de assinaturas indivisível", () => {
  it("[T4] encerramento numa tabela SEM bordas de uma célula com a linha \"não quebrar entre páginas\"; texto e ordem preservados", async () => {
    const xml = readZipEntry(await renderInstitutionalDOCX(buildInstitutionalModel(minuta(18, [...CLOSING, ...WITNESSES]), META)), "word/document.xml") ?? "";
    const iTbl = xml.lastIndexOf("<w:tbl>", xml.indexOf(CLOSING[0]));
    const tbl = xml.slice(iTbl, xml.indexOf("</w:tbl>", iTbl));
    expect(tbl).toContain("<w:cantSplit/>");
    expect(tbl).toMatch(/<w:tblBorders>.*w:val="none".*<\/w:tblBorders>/s);
    const plain = tbl.replace(/<[^>]+>/g, "|");
    let at = -1;
    for (const l of [...CLOSING, ...WITNESSES]) { const i = plain.indexOf(l, at + 1); expect(i, l).toBeGreaterThan(at); at = i; }
    expect(tbl).not.toContain("21.1. Fica eleito o foro");   // a cláusula longa anterior fica fora do bloco
    const after = xml.slice(xml.indexOf("</w:tbl>", iTbl));
    expect(after.slice(0, after.indexOf("ANEXO V"))).toContain("<w:pageBreakBefore/>");   // Anexo V segue em página nova
  });

  const soffice = (() => { try { execFileSync("soffice", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();
  it.skipIf(!soffice)("[T4] renderização real (LibreOffice): nenhuma linha de assinatura isolada em nenhuma posição", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "f31-"));
    try {
      const ks = [16, 17, 18, 19, 20, 21];
      for (const k of ks) writeFileSync(path.join(dir, `k${k}.docx`), await renderInstitutionalDOCX(buildInstitutionalModel(minuta(k), META)));
      execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, ...ks.map((k) => path.join(dir, `k${k}.docx`))], { stdio: "ignore", timeout: 120_000 });
      for (const k of ks) {
        const pages = await pdfLines(readFileSync(path.join(dir, `k${k}.pdf`)));
        const sigPages = new Set(CLOSING.flatMap((l) => linePages(pages, l)));
        expect(sigPages.size, `DOCX k=${k}: assinaturas em ${sigPages.size} páginas`).toBe(1);
        const v = pageOf(pages, "ANEXO V");
        expect(v[0], `DOCX k=${k}`).toBeGreaterThan([...sigPages][0]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
