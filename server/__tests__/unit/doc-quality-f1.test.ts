/**
 * Qualidade documental F1 — acabamento do Edital (regressões da homologação humana E2 no processo sintético 2167/2026).
 *  A) pontuação do trecho E2 EM LINHA: o ponto da redação e o do modelo se unificam ("…real.." nunca mais);
 *  C) exportação: espaço depois de negrito preservado no PDF; células de tabela do DOCX no corpo do PDF (9 pt) e linha nunca partida.
 * Puro: sem DB, sem rede. Fixture SINTÉTICA (modelo BLL do repositório).
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../domain/canonicalJson";
import { composeTemplate } from "../../domain/institutionalTemplates/composer";
import {
  evaluateSlotResolutions, mergeInlineTerminalPeriod, pendingSlotKeys, pendingSlotMark, planSlotResolution, slotPolicy, slotTextHashCandidates,
  SLOT_RESOLUTION_POLICY_VERSION, type SlotResolutionRecord,
} from "../../domain/institutionalTemplates/slotResolution";
import { buildInstitutionalModel, pdfRunSpacing, renderInstitutionalDOCX, renderInstitutionalPDF, DOCX_TABLE_FONT_HALF_POINTS } from "../../services/documentConverter";
import { BASE_SCENARIO, BLL_MODEL_DIR, BLL_ORG, bllComposeRequest } from "../helpers/institutionalTemplatesBllHarness";
import { readZipEntry } from "../helpers/zipText";

const ast = JSON.parse(readFileSync(path.join(BLL_MODEL_DIR, "ast.json"), "utf8"));
const SUB = "justificativa-vedacao-subcontratacao";
const composed = () => {
  const r = composeTemplate(bllComposeRequest(ast, { ...BASE_SCENARIO, "decisao.consorcio": "veda" }, { aiNarratives: [] }));
  if (!r.ok) throw new Error("compose");
  return r.value;
};

describe("F1-A — pontuação do trecho E2 em linha (camada canônica: planSlotResolution)", () => {
  it("regra pura: unifica só ponto final com ponto do modelo; preserva ?, !, parágrafo próprio e texto sem ponto", () => {
    expect(mergeInlineTerminalPeriod("adequada para uma contratação real.", false, ".")).toBe("adequada para uma contratação real");
    expect(mergeInlineTerminalPeriod("material de expediente etc.", false, ".")).toBe("material de expediente etc");   // + "." do modelo = "etc."
    expect(mergeInlineTerminalPeriod("conforme estudo...", false, ".")).toBe("conforme estudo..");                     // + "." = "..."
    expect(mergeInlineTerminalPeriod("sem ponto", false, ".")).toBe("sem ponto");
    expect(mergeInlineTerminalPeriod("é possível?", false, ".")).toBe("é possível?");
    expect(mergeInlineTerminalPeriod("atenção!", false, ".")).toBe("atenção!");
    expect(mergeInlineTerminalPeriod("Parágrafo próprio.", true, ".")).toBe("Parágrafo próprio.");
    expect(mergeInlineTerminalPeriod("seguido de vírgula.", false, ",")).toBe("seguido de vírgula.");
  });

  it("mínimo de caracteres vale para o texto efetivamente inserido (\"ab.\" em linha ⇒ recusado, nada gravado)", () => {
    const p = planSlotResolution({ content: composed().content.text, slotKey: SUB, resolution: "HUMAN_TEXT", text: "ab.", previous: null });
    expect(p.ok).toBe(false);
  });

  it("regressão 22.4/23.4: redação terminada com ponto ⇒ UM ponto no Edital; sem ponto ⇒ o ponto do modelo; resolução coerente (RESOLVED)", () => {
    const doc = composed();
    const text = doc.content.text;
    const frase = "Justificativa sintética registrada pela equipe, adequada para uma contratação real";
    for (const typed of [`${frase}.`, frase]) {
      const p = planSlotResolution({ content: text, slotKey: SUB, resolution: "HUMAN_TEXT", text: typed, previous: null });
      if (!p.ok) throw new Error(p.reason);
      expect(p.content).toContain(`pelas razões constantes do processo: ${frase}.\n`);
      expect(p.content).not.toContain(`${frase}..`);
      const rec: SlotResolutionRecord = {
        organizationId: BLL_ORG, manifestId: doc.manifest.id, slotKey: SUB, resolution: "HUMAN_TEXT", textHash: p.textHash, prefix: p.prefix, suffix: p.suffix,
        policyVersion: SLOT_RESOLUTION_POLICY_VERSION, decisionRef: "idc_1", revision: 1, resolvedByUserId: 9,
      };
      const c = evaluateSlotResolutions({ organizationId: BLL_ORG, manifestId: doc.manifest.id, composedText: text, issuedContent: p.content, resolutions: [rec] });
      expect(c.find((x) => x.slotKey === SUB)?.state).toBe("RESOLVED");
      // replay idempotente reconhece a MESMA redação informada (com ou sem a unificação)
      expect(slotTextHashCandidates(typed)).toContain(p.textHash);
    }
  });

  it("trechos em parágrafo próprio e DECLARED_NONE não mudam (pontuação da pessoa/política preservada)", () => {
    const text = composed().content.text;
    const k = "obrigacoes-especificas-contratado";
    const own = planSlotResolution({ content: text, slotKey: k, resolution: "HUMAN_TEXT", text: "Entregar os bens no prazo.", previous: null });
    const dn = planSlotResolution({ content: text, slotKey: k, resolution: "DECLARED_NONE", previous: null });
    if (!own.ok || !dn.ok) throw new Error("plan");
    expect(own.text).toBe("Entregar os bens no prazo.");
    expect(dn.text).toBe(slotPolicy(k).declaredNoneText);
    expect(own.textHash).toBe(sha256Hex("Entregar os bens no prazo."));
    expect(pendingSlotKeys(text)).toContain(SUB);
    expect(text).toContain(`${pendingSlotMark(SUB)}.`);   // a causa: o modelo publicado traz o "." depois do trecho (revisão publicada intocada)
  });
});

describe("F1-C — exportação DOCX/PDF pelo pipeline canônico", () => {
  it("PDF: o espaço depois de um trecho em negrito não se perde (\"contratar** no\" ≠ \"contratarno\")", () => {
    const out = pdfRunSpacing([{ text: "c) " }, { text: "impedimento de licitar e contratar", bold: true }, { text: " no âmbito" }]);
    expect(out.map((r) => r.text).join("")).toBe("c) impedimento de licitar e contratar no âmbito");
    expect(out[1].text).toBe("impedimento de licitar e contratar ");
    expect(out[2].text).toBe("no âmbito");
    expect(pdfRunSpacing([{ text: "a" }, { text: "b" }])).toEqual([{ text: "a" }, { text: "b" }]);
    // auditoria (P1): a quebra de linha que encerra aviso/citação NÃO migra (senão o bloco seguinte era desenhado por cima)
    expect(pdfRunSpacing([{ text: "Documento de referência: TR" }, { text: "\n" }])).toEqual([{ text: "Documento de referência: TR" }, { text: "\n" }]);
    // P2: "**a** **b**" — segmento só de espaço vira espaço no fim do anterior, sem segmento vazio
    expect(pdfRunSpacing([{ text: "a", bold: true }, { text: " " }, { text: "b", bold: true }])).toEqual([{ text: "a ", bold: true }, { text: "b", bold: true }]);
    expect(pdfRunSpacing([])).toEqual([{ text: "" }]);
  });

  it("DOCX: células de tabela em 9 pt e linhas que não se partem entre páginas; PDF/DOCX válidos com o mesmo modelo", async () => {
    const model = buildInstitutionalModel("# T\n\n| Item | Código de catalogação | Regime de participação |\n|---|---|---|\n| 1 | Código de catalogação 1 | Regime de participação 1 |\n\nTexto com **negrito** depois.", {
      documentTitle: "Edital — sintético", statusLabel: "EMITIDO", isDraft: false, version: 3, exportedAtLabel: "13/11/2026",
    });
    const xml = readZipEntry(await renderInstitutionalDOCX(model), "word/document.xml") ?? "";
    expect(xml).toContain("<w:cantSplit");
    expect(xml).toContain(`<w:sz w:val="${DOCX_TABLE_FONT_HALF_POINTS}"/>`);
    expect(xml).toContain("Código de catalogação 1");
    expect((await renderInstitutionalPDF(model)).subarray(0, 4).toString()).toBe("%PDF");
  });
});
