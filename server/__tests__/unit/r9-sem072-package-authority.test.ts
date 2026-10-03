/**
 * R9 / SEM-072 — pacotes (publicação legado / contratação direta) só com o documento AUTORITATIVO por tipo,
 * nomes únicos e determinísticos, extensão = formato real do conteúdo.
 *
 *   A. seleção pura (`selectAuthoritativeDocuments`) para as duas políticas;
 *   B. nomes únicos (`UniqueFileNamer`) e saneamento;
 *   C. formato real (`isPdfBytes` / `buildDocumentFiles`): Markdown ⇒ `.md`; só bytes `%PDF-` ⇒ `.pdf`;
 *   D. planejamento real dos dois pacotes (`planPublicationPackageFiles` / `planDirectContractPackageFiles`) e o ZIP
 *      presencial completo (nomes das entradas lidos do diretório central do ZIP).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db");

import * as db from "../../db";
import {
  DIRECT_CONTRACT_PACKAGE_POLICY, LEGACY_PUBLICATION_POLICY, UniqueFileNamer, buildDocumentFiles, isPdfBytes,
  renderManifestListing, sanitizeFileSegment, selectAuthoritativeDocuments, type PackageCandidate,
} from "../../services/packageAuthority";
import { planPublicationPackageFiles } from "../../services/zipService";
import { generatePresentialPackage, planDirectContractPackageFiles } from "../../services/directContractPackage";
import { convertToPDF } from "../../services/documentConverter";
import type { DirectContractDocument, Document } from "../../../drizzle/schema";
import { readZipEntries } from "../helpers/zipEntries";

const T0 = new Date("2026-09-01T10:00:00Z");
const at = (min: number): Date => new Date(T0.getTime() + min * 60_000);

function cand(id: number, type: string, version: number, status: string, min = id): PackageCandidate {
  return { id, type, version, status, createdAt: at(min) };
}

function legacyDoc(p: Partial<Document> & Pick<Document, "id" | "type" | "version" | "documentStatus">): Document {
  return {
    organizationId: 1, processId: 10, title: null, content: `# ${p.type} v${p.version}`, structuredContent: null,
    sourceType: "ai", s3Key: null, fileUrl: null, currentVersionId: null, createdBy: 1, updatedBy: null,
    approvedBy: null, isLocked: 0, lockedBy: null, lockReason: null, lockExpiresAt: null, metadata: null,
    archivedAt: null, contentHash: null, snapshotFingerprint: null, retentionClass: "operational_3years",
    legalHold: 0, purgeAfter: null, createdAt: at(p.id), updatedAt: at(p.id), ...p,
  };
}

function directDoc(p: Partial<DirectContractDocument> & Pick<DirectContractDocument, "id" | "type" | "status">): DirectContractDocument {
  return {
    directContractId: 7, title: `Doc ${p.id}`, content: `# ${p.type} #${p.id}`, version: 1,
    createdAt: at(p.id), updatedAt: at(p.id), ...p,
  };
}

describe("R9 / SEM-072 — A. seleção do documento autoritativo", () => {
  it("publicação legado: só a maior versão APROVADA por tipo; rascunho posterior e aprovada antiga ficam fora", () => {
    const docs = [
      cand(1, "etp", 1, "approved"), cand(2, "etp", 2, "approved"), cand(3, "etp", 3, "draft"),
      cand(4, "tr", 1, "in_review"), cand(5, "dfd", 1, "archived"), cand(6, "dfd", 2, "rejected"),
      cand(7, "edital", 4, "approved"),
    ];
    const sel = selectAuthoritativeDocuments(docs, LEGACY_PUBLICATION_POLICY);
    expect(sel.official.map(d => d.id).sort()).toEqual([2, 7]);
    expect(sel.draftsWithoutOfficial).toEqual([]); // publicação NUNCA leva rascunho
    const reasons = Object.fromEntries(sel.excluded.map(x => [x.doc.id, x.reason]));
    expect(reasons).toEqual({
      1: "versao_substituida", 3: "rascunho_nao_oficial", 4: "rascunho_nao_oficial",
      5: "status_excluido", 6: "status_excluido",
    });
  });

  it("é determinística (independe da ordem de entrada) e desempata por createdAt e depois id", () => {
    const docs = [cand(10, "etp", 2, "approved", 5), cand(11, "etp", 2, "approved", 9), cand(12, "etp", 2, "approved", 9)];
    const a = selectAuthoritativeDocuments(docs, LEGACY_PUBLICATION_POLICY);
    const b = selectAuthoritativeDocuments([...docs].reverse(), LEGACY_PUBLICATION_POLICY);
    expect(a.official.map(d => d.id)).toEqual([12]); // mesma versão e instante ⇒ maior id
    expect(b.official.map(d => d.id)).toEqual([12]);
    expect(a.excluded.map(x => x.doc.id)).toEqual(b.excluded.map(x => x.doc.id));
  });

  it("contratação direta: final vence rascunho; sem final, só o ÚLTIMO rascunho, separado; arquivado fora", () => {
    const docs = [
      cand(1, "termo_dispensa", 1, "draft"), cand(2, "termo_dispensa", 1, "final"), cand(3, "termo_dispensa", 1, "draft"),
      cand(4, "planilha_cotacao", 1, "draft"), cand(5, "planilha_cotacao", 1, "draft"),
      cand(6, "minuta_contrato", 1, "archived"),
    ];
    const sel = selectAuthoritativeDocuments(docs, DIRECT_CONTRACT_PACKAGE_POLICY);
    expect(sel.official.map(d => d.id)).toEqual([2]); // rascunho mais novo (3) NÃO substitui o final
    expect(sel.draftsWithoutOfficial.map(d => d.id)).toEqual([5]); // só o último rascunho do tipo sem final
    const reasons = Object.fromEntries(sel.excluded.map(x => [x.doc.id, x.reason]));
    expect(reasons).toEqual({ 1: "rascunho_nao_oficial", 3: "rascunho_nao_oficial", 4: "rascunho_nao_oficial", 6: "status_excluido" });
  });

  it("contratação direta: documentos 'outro' de títulos distintos não se substituem", () => {
    const docs: PackageCandidate[] = [
      { ...cand(1, "outro", 1, "final"), title: "Declaração A" },
      { ...cand(2, "outro", 1, "final"), title: "Declaração B" },
      { ...cand(3, "outro", 1, "final"), title: "declaração a " },
    ];
    const sel = selectAuthoritativeDocuments(docs, DIRECT_CONTRACT_PACKAGE_POLICY);
    expect(sel.official.map(d => d.id).sort()).toEqual([2, 3]);
    expect(sel.excluded.map(x => [x.doc.id, x.reason])).toEqual([[1, "versao_substituida"]]);
  });

  it("status desconhecido nunca é tratado como oficial", () => {
    expect(LEGACY_PUBLICATION_POLICY.classify("published")).toBe("excluded");
    expect(DIRECT_CONTRACT_PACKAGE_POLICY.classify("approved")).toBe("excluded");
  });
});

describe("R9 / SEM-072 — B. nomes únicos e determinísticos", () => {
  it("colisão (inclusive só de caixa) ⇒ sufixo _2, _3… na ordem de pedido", () => {
    const n = new UniqueFileNamer();
    expect(n.claim("documentos/01_TERMO_v1.md")).toBe("documentos/01_TERMO_v1.md");
    expect(n.claim("documentos/01_TERMO_v1.md")).toBe("documentos/01_TERMO_v1_2.md");
    expect(n.claim("documentos/01_termo_v1.md")).toBe("documentos/01_termo_v1_3.md");
    expect(n.claim("outra/01_TERMO_v1.md")).toBe("outra/01_TERMO_v1.md");
  });

  it("sanitizeFileSegment remove acentos/símbolos e nunca devolve vazio", () => {
    expect(sanitizeFileSegment("Declaração de Exclusividade (anexo)")).toBe("DECLARACAO_DE_EXCLUSIVIDADE_ANEXO");
    expect(sanitizeFileSegment("***")).toBe("DOCUMENTO");
  });
});

describe("R9 / SEM-072 — C. extensão = formato real", () => {
  const naming = { folder: "d/", baseName: () => "01_X", label: () => "X" };

  it("Markdown sem conversor ⇒ .md com o conteúdo original", async () => {
    const { files } = await buildDocumentFiles(
      [{ ...cand(1, "x", 3, "final"), content: "# Título" }], naming, new UniqueFileNamer(), { unofficial: false },
    );
    expect(files[0].path).toBe("d/01_X_v3.md");
    expect(files[0].data.toString("utf-8")).toBe("# Título");
    expect(files[0].entry.format).toBe("md");
    expect(files[0].entry.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("conversor que devolve bytes não-PDF ou falha ⇒ .md (nunca Markdown com nome .pdf)", async () => {
    const notPdf = await buildDocumentFiles(
      [{ ...cand(1, "x", 1, "approved"), content: "# A" }], naming, new UniqueFileNamer(),
      { unofficial: false, toPdf: async (md) => Buffer.from(md) },
    );
    expect(notPdf.files[0].path).toBe("d/01_X_v1.md");
    expect(notPdf.files[0].entry.note).toMatch(/não produziu PDF/);
    const failing = await buildDocumentFiles(
      [{ ...cand(1, "x", 1, "approved"), content: "# A" }], naming, new UniqueFileNamer(),
      { unofficial: false, toPdf: async () => { throw new Error("boom"); } },
    );
    expect(failing.files[0].path).toBe("d/01_X_v1.md");
  });

  it("conversor real (pdfkit) ⇒ bytes %PDF- ⇒ .pdf", async () => {
    const pdf = await convertToPDF("# ETP\n\nTexto", "etp.pdf");
    expect(isPdfBytes(pdf)).toBe(true);
    expect(isPdfBytes(Buffer.from("# ETP"))).toBe(false);
  });

  it("sem conteúdo / upload ⇒ não materializa arquivo vazio; vira omissão no manifesto", async () => {
    const r = await buildDocumentFiles(
      [{ ...cand(1, "x", 1, "approved"), content: null, isUpload: true }, { ...cand(2, "y", 1, "approved"), content: "  " }],
      naming, new UniqueFileNamer(), { unofficial: false },
    );
    expect(r.files).toEqual([]);
    expect(r.omissions.map(o => o.reason)).toEqual(["arquivo_enviado_nao_incluido", "sem_conteudo"]);
  });
});

describe("R9 / SEM-072 — D. pacotes reais", () => {
  beforeEach(() => vi.clearAllMocks());

  it("publicação legado: um PDF real por tipo aprovado, nomes NN_TIPO_vN.pdf únicos, rascunhos fora", async () => {
    const docs = [
      legacyDoc({ id: 1, type: "etp", version: 1, documentStatus: "approved" }),
      legacyDoc({ id: 2, type: "etp", version: 2, documentStatus: "approved" }),
      legacyDoc({ id: 3, type: "etp", version: 3, documentStatus: "draft" }),
      legacyDoc({ id: 4, type: "dfd", version: 1, documentStatus: "approved" }),
      legacyDoc({ id: 5, type: "tr", version: 1, documentStatus: "draft" }),
      legacyDoc({ id: 6, type: "parecer", version: 2, documentStatus: "approved" }),
      legacyDoc({ id: 7, type: "edital", version: 1, documentStatus: "approved", content: null, sourceType: "upload", s3Key: "k" }),
    ];
    const { files, omissions } = await planPublicationPackageFiles(docs, (md, d) => convertToPDF(md, `${d.type}.pdf`));
    expect(files.map(f => f.path)).toEqual([
      "01_DOCUMENTO_FORMALIZACAO_DEMANDA_v1.pdf", "02_ESTUDO_TECNICO_PRELIMINAR_v2.pdf", "09_PARECER_v2.pdf",
    ]);
    expect(files.every(f => isPdfBytes(f.data))).toBe(true);
    expect(new Set(files.map(f => f.path)).size).toBe(files.length);
    expect(omissions.map(o => `${o.label}|${o.version}|${o.reason}`).sort()).toEqual([
      "Edital de Licitação|1|arquivo_enviado_nao_incluido",
      "Estudo Técnico Preliminar (ETP)|1|versao_substituida",
      "Estudo Técnico Preliminar (ETP)|3|rascunho_nao_oficial",
      "Termo de Referência (TR)|1|rascunho_nao_oficial",
    ].sort());
  });

  it("contratação direta: Markdown ⇒ .md; final em documentos/, rascunho só em rascunhos_NAO_OFICIAIS/", async () => {
    const docs = [
      directDoc({ id: 1, type: "termo_dispensa", status: "draft" }),
      directDoc({ id: 2, type: "termo_dispensa", status: "final" }),
      directDoc({ id: 3, type: "minuta_contrato", status: "draft" }),
      directDoc({ id: 4, type: "minuta_contrato", status: "draft" }),
      directDoc({ id: 5, type: "mapa_comparativo", status: "archived" }),
    ];
    const { files, omissions } = await planDirectContractPackageFiles(docs);
    expect(files.map(f => f.path)).toEqual([
      "documentos/01_TERMO_DISPENSA_v1.md",
      "rascunhos_NAO_OFICIAIS/05_MINUTA_CONTRATO_v1_RASCUNHO.md",
    ]);
    expect(files[0].data.toString("utf-8")).toBe("# termo_dispensa #2");
    expect(files[1].data.toString("utf-8")).toBe("# minuta_contrato #4");
    expect(files.map(f => f.entry.unofficial)).toEqual([false, true]);
    expect(files.some(f => f.path.endsWith(".pdf"))).toBe(false);
    expect(omissions).toHaveLength(3);
  });

  it("ZIP presencial: entradas únicas, nenhum .pdf com Markdown, LEIA-ME lista o conteúdo real", async () => {
    vi.mocked(db.getDirectContractById).mockResolvedValue({
      id: 7, organizationId: 1, processId: null, number: "001", year: 2026, type: "dispensa", legalArticleId: null,
      legalReferenceEntryId: null, legalReferenceSetVersion: null, legalReferenceLocator: null, object: "Objeto",
      justification: "J", value: 100000, executionDeadline: null, supplierName: null, supplierCNPJ: null,
      supplierAddress: null, supplierContact: null, mode: "presencial", platformId: null, status: "draft",
      approvedAt: null, publishedAt: null, ratifiedAt: null, completedAt: null, metadata: null, createdBy: 1,
      approvedBy: null, createdAt: T0, updatedAt: T0, legalArticle: null, platform: null,
    } as never);
    vi.mocked(db.getDirectContractDocuments).mockResolvedValue([
      directDoc({ id: 1, type: "termo_dispensa", status: "final" }),
      directDoc({ id: 2, type: "termo_dispensa", status: "final" }),
      directDoc({ id: 3, type: "planilha_cotacao", status: "draft" }),
    ]);
    vi.mocked(db.listQuotations).mockResolvedValue([]);

    const zip = await generatePresentialPackage({ contractId: 7 });
    const entries = readZipEntries(zip);
    const names = entries.map(e => e.name);
    expect(names.sort()).toEqual([
      "LEIA-ME.txt", "documentos/01_TERMO_DISPENSA_v1.md", "rascunhos_NAO_OFICIAIS/06_PLANILHA_COTACAO_v1_RASCUNHO.md",
    ]);
    expect(new Set(names).size).toBe(names.length);
    const readme = entries.find(e => e.name === "LEIA-ME.txt")?.data.toString("utf-8") ?? "";
    expect(readme).toContain("documentos/01_TERMO_DISPENSA_v1.md");
    expect(readme).toContain("rascunhos_NAO_OFICIAIS/06_PLANILHA_COTACAO_v1_RASCUNHO.md");
    expect(readme).toContain("versão substituída pela vigente"); // o final mais antigo (id 1) listado como fora
    expect(readme).not.toMatch(/TERMO_DISPENSA\.pdf|MINUTA_CONTRATO\.pdf|PLANILHA_COTACAO\.pdf/);
    const termo = entries.find(e => e.name === "documentos/01_TERMO_DISPENSA_v1.md")?.data.toString("utf-8");
    expect(termo).toBe("# termo_dispensa #2"); // o final VIGENTE (mais recente)
  });

  it("manifesto textual lista incluídos (com sha256) e não incluídos com motivo", () => {
    const txt = renderManifestListing(
      [{ path: "documentos/01_A_v1.md", label: "A", format: "md", status: "final", version: 1, sha256: "f".repeat(64), bytes: 3, unofficial: false }],
      [{ label: "B", version: 2, status: "archived", reason: "status_excluido" }],
    );
    expect(txt).toContain("documentos/01_A_v1.md — A · versão 1 · status final · MD · 3 bytes");
    expect(txt).toContain(`sha256: ${"f".repeat(64)}`);
    expect(txt).toContain("B v2 (archived) — status excluído");
  });
});
