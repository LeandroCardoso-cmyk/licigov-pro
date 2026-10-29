/**
 * Decisão do Owner (PR #334) — todo documento do Processo Licitatório que não é a versão emitida (ledger de emissões) sai como
 * "MINUTA — NÃO EMITIDA OFICIALMENTE", qualquer que seja o status interno (rascunho/em_revisao/aprovado/rejeitado): na 1ª página
 * (com a situação interna preservada no cabeçalho) e no rodapé de TODAS as páginas. A versão emitida sai sem marca de minuta.
 *
 * Caminho real: procurementProcess.exportDocument → documentExportService → renderizador institucional; só o S3 é simulado
 * (os bytes gravados são inspecionados).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { inflateRawSync } from "zlib";
import { PDFParse } from "pdf-parse";

// Tenant SINTÉTICO explicitamente identificado (a organização 1 é Moreira Sales — nunca usada como sintética).
const { SYNTHETIC_ORG } = vi.hoisted(() => ({ SYNTHETIC_ORG: 9901 }));
const stored: Buffer[] = [];
vi.mock("../../storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../storage")>()),
  assertStorageUsable: vi.fn(),
  storagePut: vi.fn(async (_key: string, buf: Buffer) => { stored.push(buf); return { key: _key }; }),
  storageSignedUrl: vi.fn(async (key: string) => ({ key, url: "https://s3/signed" })),
}));
vi.mock("../../db/procurement");
vi.mock("../../db/organizations", () => ({ getOrganizationById: vi.fn().mockResolvedValue({ id: SYNTHETIC_ORG, nome: "Prefeitura Sintética de Teste (tenant 9901)" }) }));
vi.mock("../../db/officialDocumentPromotions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/officialDocumentPromotions")>()),
  getLatestOfficialPromotion: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../services/officialDocumentExportAdapter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/officialDocumentExportAdapter")>()),
  exportOfficialDocument: vi.fn().mockResolvedValue({ url: "https://s3/official", format: "pdf", fileName: "TR_emitido.pdf", artifactHash: "a", artifactId: null, artifactReused: false }),
}));
vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn().mockResolvedValue({
    organizationId: SYNTHETIC_ORG,
    membership: { id: 1, organizationId: SYNTHETIC_ORG, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  }),
  getMembership: vi.fn().mockResolvedValue({ id: 1, organizationId: SYNTHETIC_ORG, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() }),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));
// Render OFICIAL real (documentEngineService.renderOfficialDocument): só a leitura do documento e o ciclo de vida (S3/ledger) são simulados.
const officialStored: Buffer[] = [];
vi.mock("../../db/officialDocuments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/officialDocuments")>()),
  getOfficialDocument: vi.fn(),
}));
vi.mock("../../services/officialDocumentLifecycleService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/officialDocumentLifecycleService")>()),
  storeRenderedArtifact: vi.fn(async ({ buffer }: { buffer: Buffer }) => { officialStored.push(buffer); return { url: "https://s3/official" }; }),
}));
vi.mock("../../_core/sdk", () => ({ sdk: { signSession: vi.fn().mockResolvedValue("t"), authenticateRequest: vi.fn().mockResolvedValue(null) } }));

import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import * as procDb from "../../db/procurement";
import { getLatestOfficialPromotion } from "../../db/officialDocumentPromotions";
import { exportOfficialDocument } from "../../services/officialDocumentExportAdapter";
import { draftContentHash } from "../../domain/generatedDocument";
import { buildInstitutionalModel, renderInstitutionalDOCX, renderInstitutionalPDF } from "../../services/documentConverter";
import { makeContext, mockUser } from "../helpers/fixtures";
import { getOfficialDocument } from "../../db/officialDocuments";
import { renderOfficialDocument } from "../../services/documentEngineService";
import { UNISSUED_DRAFT_MARKING } from "@shared/documentMarkers";

const PID = "proc-sint";
// Conteúdo longo ⇒ PDF com várias páginas.
const LONG = ["# Termo de Referência — Teste sintético", ...Array.from({ length: 60 }, (_, i) =>
  `## ${i + 1}. Seção\nParágrafo sintético ${i + 1} com texto suficiente para ocupar espaço na página e forçar a paginação do documento exportado.`)].join("\n\n");

const STATUSES = [["rascunho", "RASCUNHO"], ["em_revisao", "EM REVISÃO"], ["aprovado", "APROVADO"], ["rejeitado", "REJEITADO"]] as const;
const norm = (t: string) => t.replace(/\s+/g, " ");

async function pdfPages(buf: Buffer): Promise<string[]> {
  const p = new PDFParse({ data: new Uint8Array(buf), verbosity: 0 });
  try { return (await p.getText()).pages.map((x: { text: string }) => norm(x.text)); } finally { await p.destroy?.(); }
}
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
const xmlText = (xml: string) => norm(xml.replace(/<[^>]+>/g, ""));

async function exportVia(status: string, format: "docx" | "pdf"): Promise<Buffer> {
  vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue({ id: "d1", kind: "tr", title: "TR", content: LONG, status, updatedAt: "2026-10-29T00:00:00.000Z" } as never);
  stored.length = 0;
  await procurementProcessRouter.createCaller(makeContext(mockUser)).exportDocument({ processId: PID, kind: "tr", format });
  expect(stored).toHaveLength(1);
  return stored[0];
}

describe("PR #334 — MINUTA — NÃO EMITIDA OFICIALMENTE em todo arquivo não emitido", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(procDb.getProcess).mockResolvedValue({ id: PID, organizationId: SYNTHETIC_ORG, processNumber: "9901/2026", object: "Objeto sintético" } as never);
    vi.mocked(procDb.recordProcessEvent).mockResolvedValue(undefined as never);
    vi.mocked(procDb.listIntelligentItems).mockResolvedValue([] as never);
    vi.mocked(getLatestOfficialPromotion).mockResolvedValue(null);
  });

  for (const [status, label] of STATUSES) {
    it(`${status}: PDF multipágina — marca na 1ª página com a situação interna e no rodapé de CADA página`, async () => {
      const pages = await pdfPages(await exportVia(status, "pdf"));
      expect(pages.length).toBeGreaterThan(1);
      expect(pages[0]).toContain(`Status: ${label}`);                                         // situação interna preservada
      expect(pages[0]).toContain(`${UNISSUED_DRAFT_MARKING} — situação interna: ${label}`);   // 1ª página
      pages.forEach((t, i) => {
        expect(t).toContain(`${UNISSUED_DRAFT_MARKING} · TR — Termo de Referência`);         // rodapé de todas as páginas
        expect(t).toContain(`Página ${i + 1} de ${pages.length}`);
      });
    }, 30_000);

    it(`${status}: DOCX — marca no corpo (1ª página) e no rodapé padrão (todas as páginas)`, async () => {
      const files = unzip(await exportVia(status, "docx"));
      const body = xmlText(files["word/document.xml"]);
      expect(body).toContain(`Status: ${label}`);
      expect(body).toContain(`${UNISSUED_DRAFT_MARKING} — situação interna: ${label}`);
      expect(body.indexOf(UNISSUED_DRAFT_MARKING)).toBeLessThan(body.indexOf("Parágrafo sintético 1 "));   // antes do conteúdo
      const footers = Object.entries(files).filter(([k]) => /^word\/footer\d*\.xml$/.test(k));
      expect(footers).toHaveLength(1);
      expect(xmlText(footers[0][1])).toContain(UNISSUED_DRAFT_MARKING);
      expect(files["word/document.xml"]).toMatch(/<w:footerReference w:type="default"/);
    });
  }

  it("só leitura: exportar não chama nenhuma escrita da camada de dados (rascunho, hash e lineage intactos)", async () => {
    await exportVia("aprovado", "pdf");
    const writes = Object.entries(procDb).filter(([name, fn]) => /^(save|update|upsert|insert|create|delete|promote|set)/.test(name) && vi.isMockFunction(fn));
    expect(writes.length).toBeGreaterThan(0);
    for (const [name, fn] of writes) expect(fn, name).not.toHaveBeenCalled();
    expect(procDb.recordProcessEvent).toHaveBeenCalledTimes(1);   // só o evento de auditoria da exportação
  });

  it("emitida e ALTERADA depois (hash diferente no ledger) ⇒ sai como MINUTA, nunca pelo adaptador oficial", async () => {
    vi.mocked(getLatestOfficialPromotion).mockResolvedValue({ officialDocumentId: "odoc_tr", lineageId: "l", version: 2, contentHash: draftContentHash(`${LONG}\nversão emitida anterior`), actorUserId: 2, createdAt: "2026-10-29 10:00:00" } as never);
    const pages = await pdfPages(await exportVia("aprovado", "pdf"));
    expect(exportOfficialDocument).not.toHaveBeenCalled();
    expect(pages[0]).toContain(`${UNISSUED_DRAFT_MARKING} — situação interna: APROVADO`);
    pages.forEach((t) => expect(t).toContain(UNISSUED_DRAFT_MARKING));
  }, 30_000);

  it("título e número de processo LONGOS: a marca abre o rodapé e nunca é cortada pela reticência", async () => {
    vi.mocked(procDb.getProcess).mockResolvedValue({ id: PID, organizationId: SYNTHETIC_ORG, processNumber: "9".repeat(200), object: "Objeto sintético" } as never);
    const pages = await pdfPages(await exportVia("em_revisao", "pdf"));
    pages.forEach((t, i) => {
      expect(t).toContain(`${UNISSUED_DRAFT_MARKING} · TR`);
      expect(t).toContain(`Página ${i + 1} de ${pages.length}`);
    });
  }, 30_000);

  it("versão emitida idêntica (ledger) ⇒ sai pelo adaptador oficial, sem passar pelo caminho da minuta", async () => {
    vi.mocked(getLatestOfficialPromotion).mockResolvedValue({ officialDocumentId: "odoc_tr", lineageId: "l", version: 2, contentHash: draftContentHash(LONG), actorUserId: 2, createdAt: "2026-10-29 10:00:00" } as never);
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue({ id: "d1", kind: "tr", title: "TR", content: LONG, status: "aprovado", updatedAt: "2026-10-29T00:00:00.000Z" } as never);
    stored.length = 0;
    await procurementProcessRouter.createCaller(makeContext(mockUser)).exportDocument({ processId: PID, kind: "tr", format: "pdf" });
    expect(exportOfficialDocument).toHaveBeenCalledTimes(1);
    expect(stored).toHaveLength(0);
  });
});

describe("PR #334 — documento emitido pelo render OFICIAL real (Document Engine) segue sem marca de minuta", () => {
  const official = (status: string) => ({
    id: "odoc_tr", organizationId: SYNTHETIC_ORG, businessDomain: "processo_licitatorio", documentType: "tr", origin: PID, title: "TR — Termo de Referência",
    content: LONG, status, version: 2, replayHash: "h", template: "t", author: "1", createdAt: "2026-10-29 10:00:00",
  });
  for (const format of ["pdf", "docx"] as const) {
    it(`status emitido (${format}): sem MINUTA/RASCUNHO; snapshot técnico 'gerado' continua com o aviso próprio (inalterado)`, async () => {
      officialStored.length = 0;
      vi.mocked(getOfficialDocument).mockResolvedValueOnce(official("emitido") as never);
      await renderOfficialDocument({ organizationId: SYNTHETIC_ORG, documentId: "odoc_tr", format, actorUserId: 1 });
      const emitted = format === "pdf" ? (await pdfPages(officialStored[0])).join(" ") : Object.values(unzip(officialStored[0])).join("\n");
      if (format === "pdf") expect((await pdfPages(officialStored[0])).length).toBeGreaterThan(1);
      expect(emitted).not.toMatch(/MINUTA|RASCUNHO|NÃO EMITIDA|não é versão oficial/);
      vi.mocked(getOfficialDocument).mockResolvedValueOnce(official("gerado") as never);
      await renderOfficialDocument({ organizationId: SYNTHETIC_ORG, documentId: "odoc_tr", format, actorUserId: 1 });
      const generated = format === "pdf" ? (await pdfPages(officialStored[1])).join(" ") : Object.values(unzip(officialStored[1])).join("\n");
      expect(generated).toContain("GERADO — não é versão oficial");          // outro domínio/caminho: comportamento anterior
      expect(generated).not.toContain(UNISSUED_DRAFT_MARKING);
    }, 30_000);
  }
});

describe("PR #334 — renderizador com meta de emitido montada à mão", () => {
  const EMITTED = { documentTitle: "TR — Termo de Referência", processNumber: "9901/2026", statusLabel: "EMITIDO", isDraft: false, emissionNumber: 1, version: 2, exportedAtLabel: "29/10/2026 10:00" };
  it("PDF multipágina: paginado e sem MINUTA/RASCUNHO em nenhuma página", async () => {
    const pages = await pdfPages(await renderInstitutionalPDF(buildInstitutionalModel(LONG, EMITTED)));
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((t, i) => expect(t).toContain(`Página ${i + 1} de ${pages.length}`));
    expect(pages.join(" ")).not.toMatch(/MINUTA|RASCUNHO|NÃO EMITIDA/);
  }, 30_000);
  it("DOCX: rodapé paginado sem marca de minuta", async () => {
    const files = unzip(await renderInstitutionalDOCX(buildInstitutionalModel(LONG, EMITTED)));
    expect(Object.values(files).join("\n")).not.toMatch(/MINUTA|RASCUNHO|NÃO EMITIDA/);
  });
  it("mesmo com draftMarking presente, isDraft=false nunca imprime a marca", async () => {
    const pages = await pdfPages(await renderInstitutionalPDF(buildInstitutionalModel("# Curto\n\nTexto.", { ...EMITTED, draftMarking: UNISSUED_DRAFT_MARKING })));
    expect(pages.join(" ")).not.toContain(UNISSUED_DRAFT_MARKING);
  });
});
