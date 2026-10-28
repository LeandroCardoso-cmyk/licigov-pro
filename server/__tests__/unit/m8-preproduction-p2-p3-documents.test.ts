/**
 * Achados P2/P3 da homologação M8 — integridade e apresentação documental (sem DB, sem rede, fixtures sintéticas).
 *  P2.1 — o Anexo I do Edital BLL exibia o id interno e o hash do TR: o texto institucional não carrega identidade técnica; o pin
 *         exato continua no manifesto (officialDocRefs) e uma troca de TR continua detectada (SOURCE_CHANGED official:*).
 *  P2.2 — o TR emitido trazia "Rascunho … não constitui documento aprovado" NO TEXTO: o aviso acompanha o rascunho (resultado
 *         estruturado, tela e exportação de RASCUNHO) e a exportação da versão emitida diz EMITIDO — sem afirmar aprovação/assinatura.
 *  P3.2 — chaves técnicas de fontes/grounding fora do documento; dispositivos legais e "Base legal" preservados.
 *  P3.3 — cabeçalho da versão emitida: "Emissão oficial: 1ª" + revisão técnica (nenhum número persistido muda).
 * Preview (texto composto/markdown) × DOCX × PDF exercitados sobre o MESMO conteúdo; composição determinística.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { composeTemplate } from "../../domain/institutionalTemplates/composer";
import { changedAuthorities } from "../../domain/institutionalTemplates/revalidation";
import type { TemplateAST2 } from "../../domain/institutionalTemplates";
import { BASE_SCENARIO, BLL_MODEL_DIR, bllCatalog, bllComposeRequest, bllTrPin } from "../helpers/institutionalTemplatesBllHarness";
import { describeVariable } from "../../services/institutionalTemplates/editalPreparationService";
import { authorityEntryOf } from "../../domain/institutionalTemplates/editalAuthorityMatrix";
import { buildInstitutionalModel, renderInstitutionalDOCX, renderInstitutionalPDF, type InstitutionalMeta } from "../../services/documentConverter";
import { readZipEntry } from "../helpers/zipText";
import { generateStructuredAuthoring, buildMockProviderAuthoring, missingSourceLabel } from "../../services/authoring/structuredAuthoringService";
import { buildDocumentAuthoringContext } from "../../services/authoring/authoringContext";
import { buildOfficialKnowledgeCorpus } from "../../services/officialCorpus/officialCorpusBuilder";

const ast = JSON.parse(readFileSync(path.join(BLL_MODEL_DIR, "ast.json"), "utf8")) as TemplateAST2;
const AI_SLOTS = ["justificativa-art49-lc123", "justificativa-vedacao-consorcio", "justificativa-vedacao-subcontratacao", "obrigacoes-especificas-contratado", "obrigacoes-especificas-contratante", "finalidades-tratamento-dados"];
const NARR = AI_SLOTS.map((slotKey) => ({ organizationId: 975001, slotKey, executionId: `aiexec_${slotKey}`, text: `Texto proposto para ${slotKey}, sujeito a revisão humana.` }));
const compose = (over: Parameters<typeof bllComposeRequest>[2] = {}) => {
  const r = composeTemplate(bllComposeRequest(ast, BASE_SCENARIO, { aiNarratives: NARR, ...over }));
  if (!r.ok) throw new Error(JSON.stringify(r.issues).slice(0, 600));
  return r.value;
};
const pin = bllTrPin();
const TECHNICAL = [pin.documentId, pin.lineageId, pin.contentHash, pin.contentHash.slice(0, 12)];
const HEX_HASH = /\b[0-9a-f]{12,64}\b/;

const docxText = (buf: Buffer) => (readZipEntry(buf, "word/document.xml") ?? "").replace(/<[^>]+>/g, "");
async function pdfText(buf: Buffer): Promise<string> {
  const { PDFParse } = (await import("pdf-parse")) as unknown as {
    PDFParse: new (o: { data: Uint8Array; verbosity?: number }) => { getText(): Promise<{ text?: string; pages: Array<{ text: string }> }> };
  };
  const res = await new PDFParse({ data: new Uint8Array(buf), verbosity: 0 }).getText();
  return (res.text ?? res.pages.map((p) => p.text).join("\n")).replace(/\s+/g, " ");
}

const EMITTED: InstitutionalMeta = { documentTitle: "Edital", statusLabel: "EMITIDO", isDraft: false, version: 2, emissionNumber: 1, exportedAtLabel: "28/10/2026 10:00" };
const DRAFT: InstitutionalMeta = { documentTitle: "Edital", statusLabel: "RASCUNHO", isDraft: true, version: 1, exportedAtLabel: "28/10/2026 10:00" };

describe("P2.1 — Anexo I do Edital BLL: referência institucional, sem identidade técnica; lineage íntegra", () => {
  const doc = compose();
  const annexLine = doc.content.text.split("\n").find((l) => l.includes("Documento de referência:"));

  it("o Anexo I referencia o TR por nome e tipo documental, sem id/linhagem/hash", () => {
    expect(annexLine).toBe("Documento de referência: Termo de Referência (Termo de Referência — versão oficial emitida no processo).");
    for (const t of TECHNICAL) expect(doc.content.text).not.toContain(t);
    expect(annexLine).not.toMatch(HEX_HASH);
  });

  it("o manifesto (evidência de lineage) mantém o pin EXATO do TR", () => {
    expect(doc.manifest.officialDocRefs).toEqual([expect.objectContaining({ documentId: pin.documentId, lineageId: pin.lineageId, version: pin.version, contentHash: pin.contentHash })]);
  });

  it("outro TR (mesmo título) ⇒ outro manifesto e SOURCE_CHANGED; mesmas fontes ⇒ mesma composição (replay determinístico)", () => {
    const again = compose();
    expect(again.manifest.composedOutputHash).toBe(doc.manifest.composedOutputHash);
    expect(again.manifest.manifestHash).toBe(doc.manifest.manifestHash);
    const otherTr = compose({ officialDocuments: { TR: { ...pin, documentId: "odoc_tr_bll_v3", version: 3, contentHash: "b".repeat(64) } } });
    expect(otherTr.manifest.manifestHash).not.toBe(doc.manifest.manifestHash);
    expect(changedAuthorities(doc.manifest, otherTr.manifest).some((c) => c.startsWith("official:"))).toBe(true);
  });

  it("preview × DOCX × PDF do Edital composto: nenhum identificador técnico; o texto institucional aparece nos três", async () => {
    const model = buildInstitutionalModel(doc.content.text, EMITTED);
    const docx = docxText(await renderInstitutionalDOCX(model));
    const pdf = await pdfText(await renderInstitutionalPDF(model));
    for (const out of [doc.content.text, docx, pdf]) {
      for (const t of TECHNICAL) expect(out).not.toContain(t);
      expect(out).toContain("versão oficial emitida no processo");
    }
    // a referência não é mais apresentada como aviso (blockquote ⇒ "⚠" no DOCX/PDF)
    expect(model.blocks.some((b) => b.kind === "notice" && JSON.stringify(b).includes("Documento de referência"))).toBe(false);
  });
});

describe("P2.2/P3.2 — TR: conteúdo do documento sem aviso de rascunho nem metadado técnico; referências legais preservadas", () => {
  const corpus = buildOfficialKnowledgeCorpus({ correlationId: "m8-p2-corpus" });
  const gen = () => generateStructuredAuthoring({ organizationId: 975002, kind: "tr", object: "Aquisição de cadeiras", correlationId: "m8-p2-tr", actorUserId: 1, corpus, invoke: async () => buildMockProviderAuthoring("tr") });

  it("o texto não diz 'rascunho'/'não constitui documento aprovado' nem expõe grounding; o aviso continua no resultado estruturado", async () => {
    const r = await gen();
    for (const technical of ["Rascunho fundamentado", "não constitui documento aprovado", "Revisão OBRIGATÓRIA", "Estado de fundamentação", "· fundamentada_", "fundamentação pendente", "Fontes do processo utilizadas"]) {
      expect(r.content).not.toContain(technical);
    }
    expect(r.structured.reviewNotice).toMatch(/Revisão OBRIGATÓRIA.*não constitui documento aprovado/);
    expect(["grounded", "partially_grounded", "ungrounded"]).toContain(r.groundingState);
  });

  it("dispositivos do art. 6º, XXIII (alíneas a–j) e a 'Base legal' validada continuam no documento", async () => {
    const r = await gen();
    for (const al of ["a", "b", "c", "d", "e", "h", "i", "j"]) expect(r.content).toContain(`_Art. 6º, XXIII, ${al}`);
    for (const s of r.structured.sections) for (const ref of s.legalReferences) expect(r.content).toContain(`- ${ref.display}`);
  });

  it("regeneração com as mesmas entradas ⇒ mesmo conteúdo (determinístico)", async () => {
    expect((await gen()).content).toBe((await gen()).content);
  });

  it("nenhuma afirmação de aprovação/assinatura/publicação é fabricada no texto", async () => {
    const r = await gen();
    expect(r.content).not.toMatch(/\b(aprovado em|assinado (digitalmente )?por|publicado em)\b/i);
  });
});

describe("P2.2/P3.2 — caminho NÃO fundamentado e com fontes ausentes (ressalvas no texto: linguagem do documento)", () => {
  const sourceContext = buildDocumentAuthoringContext({ organizationId: 975003, processId: "p-ungr", kind: "tr", object: "Computadores", processObject: "Computadores", processNumber: "1/2026", dfd: null, etp: null, approvedItems: [], pendingItemCount: 0 } as never);
  const gen = () => generateStructuredAuthoring({ organizationId: 975003, kind: "tr", object: "Computadores", correlationId: "m8-p2-ungr", sourceContext, invoke: async () => buildMockProviderAuthoring("tr") } as never);

  it("ressalvas honestas permanecem, sem 'rascunho', sem chaves técnicas e sem nota de proveniência", async () => {
    const r = await gen();
    expect(r.groundingState).toBe("ungrounded");
    expect(sourceContext.missing).toEqual(expect.arrayContaining(["dfd", "etp", "itens"]));
    expect(r.content).toContain("## Limitações e ressalvas");
    expect(r.content).toContain("Nenhuma evidência normativa vigente foi recuperada para este documento");
    expect(r.content).toContain("Informações ausentes no processo (marcadas para revisão): Documento de Formalização da Demanda (DFD); Estudo Técnico Preliminar (ETP); Itens da contratação.");
    expect(r.content).not.toMatch(/rascunho/i);
    // chaves técnicas (com sublinhado/sufixo) e a lista crua "dfd, etp, itens" nunca chegam ao texto
    expect(r.content).not.toMatch(/\b(pesquisa_precos|fonte_alterada:\d+|quantidade_prevista)\b/);
    expect(r.content).not.toMatch(/\bdfd, etp\b|:\s*dfd\b/);
    expect(r.content).not.toContain("não pela IA");
  });

  it("DOCX/PDF do mesmo conteúdo: sem 'rascunho' no corpo de versão emitida e sem os marcadores internos do quadro", async () => {
    const r = await gen();
    const model = buildInstitutionalModel(r.content, EMITTED);
    for (const out of [docxText(await renderInstitutionalDOCX(model)), await pdfText(await renderInstitutionalPDF(model))]) {
      expect(out).not.toMatch(/rascunho/i);
      expect(out).not.toContain("licigov:itens-autoritativos");
      expect(out).toContain("Informações ausentes no processo");
    }
  });

  it("rótulo humano para toda chave conhecida; chave desconhecida nunca vaza crua", () => {
    expect(missingSourceLabel("pesquisa_precos")).toBe("Pesquisa de preços");
    expect(missingSourceLabel("fonte_alterada:3")).toBe("pesquisa de preços do item 3 alterada após a decisão");
    expect(missingSourceLabel("quantidade_prevista")).toBe("quantidade prevista dos itens");
    expect(missingSourceLabel("chave_interna_xyz")).toBe("informação do processo");
  });
});

describe("P2.2/P3.3 — exportação: versão EMITIDA × RASCUNHO (preview × DOCX × PDF)", () => {
  const body = "# Termo de Referência — Aquisição\n\n## Definição do objeto\n_Art. 6º, XXIII, a_\n\nAquisição de cadeiras.";

  it("EMITIDO: status EMITIDO, 'Emissão oficial: 1ª' + revisão técnica; sem aviso de rascunho; sem 'APROVADO'", async () => {
    const model = buildInstitutionalModel(body, EMITTED);
    const docx = docxText(await renderInstitutionalDOCX(model));
    const pdf = await pdfText(await renderInstitutionalPDF(model));
    for (const out of [docx, pdf]) {
      expect(out).toContain("EMITIDO");
      expect(out).toMatch(/Emissão oficial:?\s*1ª/);
      expect(out).toMatch(/Revisão técnica:?\s*2/);
      expect(out).not.toMatch(/RASCUNHO|NÃO é uma versão oficial|APROVADO|assinado/i);
      expect(out).toContain("Aquisição de cadeiras.");
    }
  });

  it("RASCUNHO: aviso de revisão obrigatória continua; cabeçalho de versão inalterado ('Versão')", async () => {
    const model = buildInstitutionalModel(body, DRAFT);
    const docx = docxText(await renderInstitutionalDOCX(model));
    const pdf = await pdfText(await renderInstitutionalPDF(model));
    for (const out of [docx, pdf]) {
      expect(out).toContain("RASCUNHO — revisão obrigatória");
      expect(out).toMatch(/Versão:?\s*1/);
      expect(out).not.toContain("Emissão oficial");
    }
  });

  it("o conteúdo renderizado é o persistido (nenhuma reescrita do corpo pela exportação)", () => {
    const model = buildInstitutionalModel(body, EMITTED);
    const text = JSON.stringify(model.blocks);
    expect(text).toContain("Aquisição de cadeiras.");
    expect(text).toContain("Art. 6º, XXIII, a");
  });
});

describe("P3.4 — dotação orçamentária: orientação de apresentação, sem nova autoridade nem valor presumido", () => {
  const def = bllCatalog.vars.find((v) => v.name === "julgamento.dotacaoOrcamentaria")!;
  it("o descritor pergunta pela MESMA dotação da 'Adequação orçamentária' do TR; a autoridade continua a da CertameConfig", () => {
    const d = describeVariable(def);
    expect(d.description).toBe("Dotação orçamentária");
    expect(d.question).toMatch(/mesma indicada na seção "Adequação orçamentária" do TR/);
    expect(d.question).toMatch(/uma única vez/);
    expect(authorityEntryOf(def.name)).toMatchObject({ entry: "CERTAME_CONFIG" });   // nenhuma projeção do TR foi criada
    expect(d).not.toHaveProperty("currentValue");                                     // nada é pré-preenchido/presumido
  });
});
