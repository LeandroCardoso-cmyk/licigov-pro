/**
 * F2 — composição do Edital COMPLETO (domínio puro): o parágrafo de referência ao TR do Anexo I é substituído pelo TR oficial integral
 * (fixado no M2). Fixture SINTÉTICA (modelo BLL do repositório). Sem DB, sem rede, sem IA.
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { composeTemplate } from "../../domain/institutionalTemplates/composer";
import { consolidateEditalWithTr, embedTrContent, TR_DOC_REF_MARK, type ConsolidationTr } from "../../domain/editalConsolidation";
import { buildInstitutionalModel, renderInstitutionalDOCX, renderInstitutionalPDF } from "../../services/documentConverter";
import { BASE_SCENARIO, BLL_MODEL_DIR, bllComposeRequest } from "../helpers/institutionalTemplatesBllHarness";
import { readZipEntry } from "../helpers/zipText";

const ast = JSON.parse(readFileSync(path.join(BLL_MODEL_DIR, "ast.json"), "utf8"));
const EDITAL = (() => {
  const r = composeTemplate(bllComposeRequest(ast, BASE_SCENARIO, { aiNarratives: [] }));
  if (!r.ok) throw new Error("compose");
  return r.value.content.text;
})();
const RICH_TR = [
  "# TERMO DE REFERÊNCIA",
  "## 1. DO OBJETO",
  "Aquisição sintética de material de expediente para a Secretaria Fictícia de Administração.",
  "## 2. DOS ITENS",
  "| Item | Descrição | Unidade | Quantidade |\n|---|---|---|---|\n| 1 | Papel sulfite A4 75g | resma | 120 |\n| 2 | Caneta esferográfica azul | un | 400 |",
  "## 3. DA EXECUÇÃO E DO RECEBIMENTO",
  "O recebimento provisório ocorrerá em até 5 (cinco) dias úteis; o definitivo, após **conferência técnica** da especificação.",
  "### 3.1. Especificações técnicas",
  "- papel com gramatura de 75 g/m²;\n- caneta com tinta azul à base de óleo.",
  "## 4. DO PAGAMENTO",
  "O pagamento será efetuado em até 30 (trinta) dias após o atesto da nota fiscal — critério de aceitação: ¿acentos e ç preservados?",
].join("\n\n");
const TR: ConsolidationTr = {
  documentId: "trdoc0000000000000001", version: 2, emissionNumber: 1, emittedAtLabel: "10/11/2026 às 14:00",
  contentHash: "a".repeat(64), content: RICH_TR,
};

describe("F2 — Anexo I com o TR oficial integral (domínio)", () => {
  it("[T10] substitui SÓ o parágrafo de referência; Edital antes e depois idênticos; TR inteiro, na ordem, entre Anexo I e Anexo II", () => {
    expect(EDITAL).toContain(TR_DOC_REF_MARK);
    const r = consolidateEditalWithTr(EDITAL, TR);
    if (!r.ok) throw new Error(r.message);
    const c = r.content;
    const refLine = EDITAL.split("\n").find((l) => l.includes(TR_DOC_REF_MARK))!;
    const [before, after] = EDITAL.split(refLine);
    expect(c.startsWith(before)).toBe(true);
    expect(c.endsWith(after)).toBe(true);
    expect(c).not.toContain(TR_DOC_REF_MARK);
    const iAnexoI = c.indexOf("## ANEXO I — TERMO DE REFERÊNCIA");
    const iIdent = c.indexOf("Versão incorporada integralmente a este Edital:");
    const iTrObj = c.indexOf("### 1. DO OBJETO");
    const iTrPay = c.indexOf("### 4. DO PAGAMENTO");
    const iAnexoII = c.indexOf("## ANEXO II");
    expect(iAnexoI).toBeGreaterThan(0);
    expect([iAnexoI, iIdent, iTrObj, iTrPay, iAnexoII].every((x, i, a) => x > 0 && (i === 0 || a[i - 1] < x))).toBe(true);
    for (const t of ["Papel sulfite A4 75g", "| 2 | Caneta esferográfica azul | un | 400 |", "**conferência técnica**", "- papel com gramatura", "¿acentos e ç preservados?"]) expect(c).toContain(t);
    expect(c).toContain(`(SHA-256): ${TR.contentHash}_`);
    expect(c).toContain("1ª emissão oficial, revisão técnica v2, emitida em 10/11/2026 às 14:00");
    for (const a of ["## ANEXO I —", "## ANEXO II —", "## ANEXO III —", "## ANEXO IV —"]) expect(c.split(a).length - 1).toBe(1);   // anexos preservados, sem duplicar
  });

  it("títulos do TR aninhados sob o Anexo I com a hierarquia RELATIVA preservada (F3-D); demais linhas intocadas", () => {
    expect(embedTrContent("# A\r\n\n## B\n\ntexto # não é título\n\n#### C")).toEqual({ title: null, body: "### A\n\n#### B\n\ntexto # não é título\n\n###### C" });
  });

  it("formato anterior ao M8 P2.1 (aviso citando o id do documento) também é reconhecido — e só o do TR fixado", () => {
    const old = `## ANEXO I — TERMO DE REFERÊNCIA\n\n> Documento de referência: Termo de Referência — TR, versão 2 (${TR.documentId}, hash aaaaaaaaaaaa)\n\n## ANEXO II — PROPOSTA`;
    const r = consolidateEditalWithTr(old, TR);
    expect(r.ok && r.content.includes("### 1. DO OBJETO") && !r.content.includes("> Documento de referência")).toBe(true);
    expect(consolidateEditalWithTr(old, { ...TR, documentId: "outrodocumento0000000" }).ok).toBe(false);
  });

  it("[T7] fail-closed: referência ausente, ambígua ou TR vazio ⇒ recusa (nunca anexa \"em algum lugar\")", () => {
    expect(consolidateEditalWithTr("# Edital\n\nsem anexo", TR)).toMatchObject({ ok: false, code: "EDITAL_TR_REFERENCE_NOT_FOUND" });
    const twice = `Documento de referência: TR ${TR_DOC_REF_MARK}.\n\nx\n\nDocumento de referência: TR ${TR_DOC_REF_MARK}.`;
    expect(consolidateEditalWithTr(twice, TR)).toMatchObject({ ok: false, code: "EDITAL_TR_REFERENCE_AMBIGUOUS" });
    expect(consolidateEditalWithTr(EDITAL, { ...TR, content: "  \n " })).toMatchObject({ ok: false, code: "EDITAL_TR_EMPTY" });
  });

  it("[T1][T2][T8] DOCX e PDF pelo pipeline canônico: TR integral no DOCX, PDF válido e maior que o Edital só; conteúdo determinístico", async () => {
    const r = consolidateEditalWithTr(EDITAL, TR);
    if (!r.ok) throw new Error(r.message);
    expect(consolidateEditalWithTr(EDITAL, TR)).toEqual(r);   // mesmas fontes ⇒ mesmo conteúdo
    const meta = { documentTitle: "Edital — completo, com anexos", statusLabel: "EMITIDO", isDraft: false, version: 3, exportedAtLabel: "13/11/2026" };
    const xml = readZipEntry(await renderInstitutionalDOCX(buildInstitutionalModel(r.content, meta)), "word/document.xml") ?? "";
    const plain = xml.replace(/<[^>]+>/g, "");
    for (const t of ["ANEXO I — TERMO DE REFERÊNCIA", "1. DO OBJETO", "Papel sulfite A4 75g", "4. DO PAGAMENTO", "ANEXO II", "ANEXO IV"]) expect(plain).toContain(t);
    expect(plain.indexOf("4. DO PAGAMENTO")).toBeLessThan(plain.indexOf("ANEXO II —"));
    expect(xml.split("<w:tbl>").length - 1).toBeGreaterThan(0);
    const full = await renderInstitutionalPDF(buildInstitutionalModel(r.content, meta));
    const alone = await renderInstitutionalPDF(buildInstitutionalModel(EDITAL, meta));
    expect(full.subarray(0, 4).toString()).toBe("%PDF");
    expect(full.length).toBeGreaterThan(alone.length);
  });
});
