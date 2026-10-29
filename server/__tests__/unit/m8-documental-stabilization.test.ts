/**
 * Estabilização documental pós-M8 (homologação final): contagem honesta de cotações, aviso de valores demonstrativos (fonte única
 * para prévia e arquivo), rodapé paginado com identificação de rascunho em TODAS as páginas (DOCX e PDF) e a rota legada
 * `documentEngine.download` usando o renderizador institucional canônico. Valores, bloqueios e permissões inalterados.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { inflateRawSync } from "zlib";
import { PDFParse } from "pdf-parse";
import {
  computeItemEstimates, quoteCountText, renderAuthoritativeItemsBlock, AUTHORITATIVE_ITEMS_BEGIN,
  type AuthoritativeItemInput,
} from "../../domain/authoritativeItems";
import { demonstrativePriceNotice, demonstrativePricesAllowed, __setHomologationConfigForTests } from "../../services/priceGovernanceService";
import { buildInstitutionalModel, renderInstitutionalDOCX, renderInstitutionalPDF, type InstitutionalMeta } from "../../services/documentConverter";

const item = (o: Partial<AuthoritativeItemInput> & { id: string }): AuthoritativeItemInput => ({
  description: `Item ${o.id}`, quantity: 10, unit: "un", averagePriceCents: 1000, quoteCount: 3,
  confirmedCatalogCode: null, suggestedCatalogCode: null, ...o,
});
const block = (items: AuthoritativeItemInput[]) => renderAuthoritativeItemsBlock(computeItemEstimates(items, { preserveOrder: true }), { quantitySource: "canonical_planned" });

describe("Correção 3 — contagem de cotações (nunca chamar fonte fictícia de 'válida')", () => {
  it("só fontes legítimas: texto histórico byte-idêntico", () => {
    expect(quoteCountText(5)).toBe("5 cotação(ões) válida(s)");
    expect(block([item({ id: "a", quoteCount: 2 }), item({ id: "b", quoteCount: 3 })])).toContain("- Baseado em 5 cotação(ões) válida(s) em 2 item(ns) da contratação.");
  });
  it("fictícias: 'registradas' + natureza explícita; aviso [REVISAR] e cálculo preservados", () => {
    const md = block([item({ id: "a", quoteCount: 3, fictitiousQuoteCount: 3, averagePriceCents: 0, priceBlockedReason: "FICTITIOUS_SOURCE" })]);
    expect(md).toContain("- Baseado em 3 cotação(ões) registrada(s), das quais 3 de fonte fictícia/sintética (demonstrativa) em 1 item(ns) da contratação.");
    expect(md).not.toMatch(/cotação\(ões\) válida\(s\)/);
    expect(md).toContain("[REVISAR: 3 cotação(ões) de fonte fictícia/sintética — valor demonstrativo, não constitui pesquisa de preços válida.]");
    expect(md).toContain("[REVISAR: preço suspenso — cotação fictícia não constitui pesquisa de preços oficial]");
  });
  it("mistas (legítimas + fictícias + suspeitas): contagem por natureza; total em centavos inalterado", () => {
    const items = [item({ id: "a", quoteCount: 2 }), item({ id: "b", quoteCount: 3, fictitiousQuoteCount: 1, suspectedQuoteCount: 1 })];
    const est = computeItemEstimates(items, { preserveOrder: true });
    expect(est.globalTotalCents).toBe(20000);
    expect(block(items)).toContain("- Baseado em 5 cotação(ões) registrada(s), das quais 1 de fonte fictícia/sintética (demonstrativa) e 1 possivelmente demonstrativa(s) em 2 item(ns) da contratação.");
  });
  it("só suspeitas e ausência de preço", () => {
    expect(quoteCountText(2, 0, 2)).toBe("2 cotação(ões) registrada(s), das quais 2 possivelmente demonstrativa(s)");
    const md = block([item({ id: "a", quoteCount: 0, averagePriceCents: 0 })]);
    expect(md).toContain("- Baseado em 0 cotação(ões) válida(s) em 1 item(ns) da contratação.");
    expect(md).toContain("[REVISAR: sem preço]");
  });
  it("o prompt da autoria usa a mesma contagem (nada de 'válidas' para fictícias)", () => {
    const src = readFileSync(path.resolve("server/services/authoring/authoringContext.ts"), "utf8");
    expect(src).toContain("${quoteCountText(r.quoteCount, r.fictitiousQuoteCount, r.suspectedQuoteCount)}");
    expect(src).not.toMatch(/\$\{r\.quoteCount\} cotação\(ões\) válida\(s\)/);
  });
});

describe("Correção 1 — aviso de valores demonstrativos (fonte única; só rotula)", () => {
  afterEach(() => __setHomologationConfigForTests(null));
  it("sem cotação fictícia ⇒ nenhum aviso; item rejeitado não conta", () => {
    expect(demonstrativePriceNotice([])).toBeNull();
    expect(demonstrativePriceNotice([{ status: "aprovado", fictitiousQuoteCount: 0 }, { status: "rejeitado", fictitiousQuoteCount: 4 }])).toBeNull();
  });
  it("com cotação fictícia ⇒ aviso explícito com contagens", () => {
    const n = demonstrativePriceNotice([{ status: "aprovado", fictitiousQuoteCount: 3 }, { status: "pendente", fictitiousQuoteCount: 1 }, { status: "aprovado", fictitiousQuoteCount: 0 }]);
    expect(n).toBe("VALORES DEMONSTRATIVOS — 2 item(ns) deste processo com 4 cotação(ões) de fonte fictícia/sintética (homologação). Valores de referência baseados nelas são demonstrativos e não constituem pesquisa de preços oficial.");
  });
  it("exceção AUSENTE: continua fail-closed (nenhuma organização recebe valores demonstrativos), o aviso independe dela", async () => {
    __setHomologationConfigForTests({ allowedOrgIds: [] });
    expect(await demonstrativePricesAllowed(2)).toBe(false);
    expect(await demonstrativePricesAllowed(1)).toBe(false);
    expect(demonstrativePriceNotice([{ status: "aprovado", fictitiousQuoteCount: 1 }])).toMatch(/^VALORES DEMONSTRATIVOS/);
  });
  it("router: a MESMA função alimenta a prévia (reviewableDraft.priceNotice) e o cabeçalho do arquivo do rascunho (meta.notices)", () => {
    const src = readFileSync(path.resolve("server/routers/procurementProcessRouter.ts"), "utf8");
    expect(src).toContain("priceNotice: demonstrativePriceNotice(await listIntelligentItems(input.processId, orgId)),");
    expect(src).toMatch(/notices: input\.kind === "dfd" \? \[\] : \[demonstrativePriceNotice\(await listIntelligentItems\(input\.processId, orgId\)\)\]/);
    for (const f of ["EditalWorkspace", "TRWorkspace", "ETPWorkspace"]) {
      expect(readFileSync(path.resolve(`client/src/components/procurement/${f}.tsx`), "utf8")).toContain("<DemonstrativePriceNotice notice={reviewable.data?.draft?.priceNotice} />");
    }
  });
});

// ─── Correção 2 — rodapé paginado e identificação de rascunho em todas as páginas ─────────────────────────────────────────
const META: InstitutionalMeta = {
  organizationName: "Prefeitura Sintética — Homologação", documentTitle: "Edital", processNumber: "9992/2026", object: "Objeto sintético",
  statusLabel: "RASCUNHO", isDraft: true, version: 1, exportedAtLabel: "29/10/2026 às 10:00",
};
const LONG = [
  "# Edital",
  ...Array.from({ length: 60 }, (_, i) => `## ${i + 1}. Seção\n\nTexto da seção ${i + 1} com conteúdo suficiente para ocupar espaço na página e forçar várias páginas no documento exportado.`),
  "",
  "| Item | Descrição | Valor (R$) |",
  "|---:|---|---:|",
  "| 1 | Caneta azul | 1,75 |",
  "| 2 | Papel A4 | 25,50 |",
  "",
  AUTHORITATIVE_ITEMS_BEGIN,
  "## ANEXO I — TERMO DE REFERÊNCIA",
  "Documento de referência: TR — objeto (Termo de Referência — versão oficial emitida no processo).",
].join("\n");

async function pdfPages(buf: Buffer): Promise<string[]> {
  const p = new PDFParse({ data: new Uint8Array(buf), verbosity: 0 });
  try { return (await p.getText()).pages.map((x: { text: string }) => x.text); } finally { await p.destroy?.(); }
}
/** Leitor mínimo de ZIP (diretório central) — só para inspecionar o XML do DOCX no teste. */
function unzip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = buf.readUInt32LE(eocd + 16); const n = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nl);
    const dataStart = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    out[name] = (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
    p += 46 + nl + el + cl;
  }
  return out;
}

describe("Correção 2 — PDF: paginação e RASCUNHO em todas as páginas; emitido sem marca de rascunho", () => {
  it("multipágina: 'Página i de N' + identificação de rascunho em CADA página; tabela e Anexo I preservados; aviso no cabeçalho", async () => {
    const pages = await pdfPages(await renderInstitutionalPDF(buildInstitutionalModel(LONG, { ...META, notices: ["VALORES DEMONSTRATIVOS — teste"] })));
    expect(pages.length).toBeGreaterThan(2);
    pages.forEach((t, i) => {
      expect(t).toContain(`Página ${i + 1} de ${pages.length}`);
      expect(t).toContain("RASCUNHO — não é versão oficial");
      expect(t).toContain("Processo 9992/2026");
    });
    const all = pages.join("\n");
    expect(all).toContain("VALORES DEMONSTRATIVOS — teste");
    expect(all).toContain("Caneta azul"); expect(all).toContain("25,50");
    expect(all).toContain("ANEXO I — TERMO DE REFERÊNCIA");
    expect(all).not.toContain("licigov:");
  }, 30_000);
  it("uma página: 'Página 1 de 1'", async () => {
    const pages = await pdfPages(await renderInstitutionalPDF(buildInstitutionalModel("# Curto\n\nTexto.", META)));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("Página 1 de 1");
  });
  it("emitido: paginado, SEM 'RASCUNHO' em lugar algum (nem cabeçalho, nem rodapé)", async () => {
    const pages = await pdfPages(await renderInstitutionalPDF(buildInstitutionalModel(LONG, { ...META, statusLabel: "EMITIDO", isDraft: false, emissionNumber: 1, version: 2 })));
    pages.forEach((t, i) => expect(t).toContain(`Página ${i + 1} de ${pages.length}`));
    expect(pages.join("\n")).not.toMatch(/RASCUNHO|não é versão oficial/);
  }, 30_000);
});

describe("Correção 2 — DOCX: rodapé com campos de página e identificação de rascunho", () => {
  it("rascunho: rodapé com PAGE/NUMPAGES e 'RASCUNHO'; tabela, aviso e Anexo I no corpo; sem marcador interno", async () => {
    const files = unzip(await renderInstitutionalDOCX(buildInstitutionalModel(LONG, { ...META, notices: ["VALORES DEMONSTRATIVOS — teste"] })));
    const footer = Object.entries(files).find(([k]) => /^word\/footer\d*\.xml$/.test(k))?.[1] ?? "";
    expect(footer).toMatch(/PAGE/); expect(footer).toMatch(/NUMPAGES/);
    expect(footer).toContain("RASCUNHO — não é versão oficial");
    const body = files["word/document.xml"];
    expect(body).toContain("VALORES DEMONSTRATIVOS — teste");
    expect(body).toContain("<w:tbl>");
    expect(body).toContain("ANEXO I — TERMO DE REFERÊNCIA");
    expect(body).not.toContain("licigov:");
    expect(body).toMatch(/<w:footerReference/);
  });
  it("emitido: rodapé paginado sem 'RASCUNHO'", async () => {
    const files = unzip(await renderInstitutionalDOCX(buildInstitutionalModel(LONG, { ...META, statusLabel: "EMITIDO", isDraft: false, emissionNumber: 1, version: 2 })));
    const footer = Object.entries(files).find(([k]) => /^word\/footer\d*\.xml$/.test(k))?.[1] ?? "";
    expect(footer).toMatch(/NUMPAGES/);
    expect(Object.values(files).join("\n")).not.toMatch(/RASCUNHO/);
  });
});

describe("Rota legada documentEngine.download — renderizador institucional canônico (contrato e permissões inalterados)", () => {
  const src = readFileSync(path.resolve("server/services/documentEngineService.ts"), "utf8");
  const fn = src.slice(src.indexOf("export async function renderOfficialDocument"), src.indexOf("export async function renderContent"));
  it("usa renderInstitutionalContent (tabelas preservadas, marcadores fora) e não mais os conversores linha a linha", () => {
    expect(fn).toContain("renderInstitutionalContent({");
    expect(fn).not.toMatch(/convertTo(DOCX|PDF)\(doc\.content/);
    expect(fn).toContain('isDraft: doc.status !== "emitido"');
    expect(fn).toContain("storeRenderedArtifact({"); // ledger de artefatos inalterado
  });
});
