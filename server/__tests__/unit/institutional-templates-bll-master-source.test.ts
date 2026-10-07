/**
 * Reprodução da compilação do Modelo-Mestre APROVADO (EDITAL_PREGAO_ELETRONICO_BLL v1.0.1-draft) a partir do Markdown congelado.
 *
 * O arquivo-mestre NÃO está no repositório (o congelamento o mantém fora): informe o caminho em `BLL_MASTER_MD_PATH`
 * (e, opcionalmente, o DOCX congelado em `BLL_MASTER_DOCX_PATH`). Sem a variável, a suíte é PULADA — nunca "passa em vazio":
 * o primeiro teste registra, de forma visível, que a prova de proveniência não foi executada.
 *
 *   BLL_MASTER_MD_PATH=/caminho/modelo-mestre-edital-pregao-eletronico-bll-v1.0.1-draft.md pnpm vitest run <este arquivo>
 */
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import type { TemplateAST2 } from "../../domain/institutionalTemplates";
import { composeTemplate } from "../../domain/institutionalTemplates/composer";
import { compileApprovedMaster, compileAndVerifyMaster, evaluateParityGate } from "../../domain/institutionalTemplates/masterCompiler";
import {
  BASE_SCENARIO, BLL_MD_SHA256, BLL_MODEL_DIR, FULL_SCENARIO, bllCatalog, bllComposeRequest, bllMapping,
} from "../helpers/institutionalTemplatesBllHarness";
import { readZipEntry } from "../helpers/zipText";

const MD_PATH = process.env.BLL_MASTER_MD_PATH;
const DOCX_PATH = process.env.BLL_MASTER_DOCX_PATH;
const HAVE_MD = !!MD_PATH && existsSync(MD_PATH);
const committedAst = JSON.parse(readFileSync(path.join(BLL_MODEL_DIR, "ast.json"), "utf8")) as TemplateAST2;
const committedReport = JSON.parse(readFileSync(path.join(BLL_MODEL_DIR, "report.json"), "utf8")) as { astSemanticHash: string };

it("registro de execução: a prova a partir do MD aprovado exige BLL_MASTER_MD_PATH", () => {
  if (!HAVE_MD) console.warn("[BLL] BLL_MASTER_MD_PATH ausente — prova de proveniência do MD aprovado NÃO executada nesta rodada (suíte pulada).");
  expect(typeof HAVE_MD).toBe("boolean");
});

describe.skipIf(!HAVE_MD)("BLL — compilação a partir do Markdown aprovado", () => {
  const md = HAVE_MD ? readFileSync(MD_PATH!, "utf8") : "";
  const compile = (m = md, sha = createHash("sha256").update(m).digest("hex"), auditLiterals = false) =>
    compileApprovedMaster({ markdown: m, expectedSha256: sha, mapping: bllMapping, catalog: bllCatalog, auditLiterals });

  it("APPROVED_MD_HASH: o arquivo recebido tem exatamente o sha256 aprovado (6795b2ab…7904); outro byte ⇒ recusado", () => {
    expect(createHash("sha256").update(readFileSync(MD_PATH!)).digest("hex")).toBe(BLL_MD_SHA256);
    const r = compile(md + " ", BLL_MD_SHA256);
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.issues.map((i) => i.code)).toEqual(["SOURCE_HASH_MISMATCH"]);
  });

  it("PLACEHOLDERS 160/160 · RENDERABLE 157 · CONTROL_ONLY 3 · CONDITIONAL_TYPES 48 · UNMAPPED 0 · SYSTEM_NOTES_RENDERED 0", () => {
    const r = compileAndVerifyMaster({ markdown: md, expectedSha256: BLL_MD_SHA256, mapping: bllMapping, catalog: bllCatalog });
    if (!r.ok) throw new Error(JSON.stringify(r.issues).slice(0, 800));
    const rep = r.value.report;
    expect(rep).toMatchObject({
      mappedInputs: 160, renderCapableInputs: 157, controlInputs: 3, unknownPlaceholders: [], unmappedInputs: [], residualPlaceholders: 0,
      conditionTypesMapped: 48, conditionBlocks: 80, balancedConditions: true, systemNotes: 51, systemNotesRendered: 0,
    });
    expect(rep.conditionTypesUsed).toHaveLength(48);
    expect(rep.conditionTypesUnused).toEqual([]);
    expect(rep.crossReferences.unmappedRemissions).toBe(0);
    expect(rep.noteNonNameForms).toEqual(["{{CONTRATADO_*}}", "{{FORNECEDOR_REGISTRADO_*}}"]);
    expect(evaluateParityGate(rep, bllMapping).pass).toBe(true);
  });

  it("a AST e o hash versionados são exatamente os da compilação do MD aprovado (replay)", () => {
    const r = compile();
    if (!r.ok) throw new Error(JSON.stringify(r.issues).slice(0, 800));
    expect(JSON.stringify(r.value.ast)).toBe(JSON.stringify(committedAst));
    expect(r.value.astSemanticHash).toBe(committedReport.astSemanticHash);
  });

  it("COMPILER_DETERMINISM: compilações repetidas e com chaves do mapeamento reordenadas dão a mesma AST e o mesmo hash", () => {
    const a = compile(); const b = compile();
    if (!a.ok || !b.ok) throw new Error("falhou");
    expect(b.value.astSemanticHash).toBe(a.value.astSemanticHash);
    expect(JSON.stringify(b.value.ast)).toBe(JSON.stringify(a.value.ast));
    const reordered = { ...bllMapping, inputs: Object.fromEntries(Object.entries(bllMapping.inputs).reverse()), conditions: Object.fromEntries(Object.entries(bllMapping.conditions).reverse()) };
    const c = compileApprovedMaster({ markdown: md, expectedSha256: BLL_MD_SHA256, mapping: reordered, catalog: bllCatalog });
    if (!c.ok) throw new Error("falhou");
    expect(c.value.astSemanticHash).toBe(a.value.astSemanticHash);
  });

  it("notas do sistema são só evidência: reescrever TODAS as notas não muda a AST; nenhuma nota executa nada", () => {
    const rewritten = md.replace(/\[SYSTEM NOTE[\s\S]*?\]\s*$/gm, "[SYSTEM NOTE — NÃO EXPORTAR:\nnota reescrita para o teste.]");
    expect(rewritten).not.toBe(md);
    const a = compile(); const b = compile(rewritten);
    if (!a.ok) throw new Error("falhou");
    if (!b.ok) throw new Error(JSON.stringify(b.issues).slice(0, 600));
    // o texto das notas não influencia a AST (os 3 controles aparecem só nas notas e permanecem controlRef, via mapeamento)
    expect(b.value.astSemanticHash).toBe(a.value.astSemanticHash);
    const json = JSON.stringify(a.value.ast);
    for (const phrase of ["MUNICIPAL_REGULATION_SOURCE_NOT_VERIFIED", "HUMAN_DECISION_REQUIRED", "BLL_CONFIGURATION_REQUIRED", "NÃO EXPORTAR", "ANÁLISE CRÍTICA DAS DECLARAÇÕES"]) expect(json).not.toContain(phrase);
  });

  it("FIDELIDADE DA NUMERAÇÃO: com os mesmos blocos ativos, TODO rótulo automático é igual ao literal do mestre; TODA remissão resolve o literal", () => {
    const audit = compile(md, BLL_MD_SHA256, true);
    if (!audit.ok) throw new Error(JSON.stringify(audit.issues).slice(0, 800));
    let numbered = 0; let xrefs = 0;
    for (const [name, scenario] of [["FULL", FULL_SCENARIO], ["FULL_INVERSAO", { ...FULL_SCENARIO, "decisao.inversaoFases": true }]] as const) {
      const r = composeTemplate(bllComposeRequest(audit.value.ast, scenario));
      if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r.issues).slice(0, 600)}`);
      for (const line of r.value.content.text.split("\n")) {
        for (const re of [/^(\d+(?:\.\d+)+)\. ⟦(\d+(?:\.\d+)+)⟧ /, /^([a-z](?:\.\d+)?)\) ⟦([a-z](?:\.\d+)?)⟧ /, /^(\d+)\\\. ⟦(\d+)⟧ /, /^#+ (\d+)\. ⟦(\d+)⟧ /, /^#+ CLÁUSULA ([A-ZÀ-Ý ]+?) — ⟦([A-ZÀ-Ý ]+)⟧ /]) {
          const m = re.exec(line);
          if (m) { numbered += 1; expect(m[1], `${name}: ${line.slice(0, 100)}`).toBe(m[2]); }
        }
        for (const m of line.matchAll(/([^\s"(⟦]+)⟦=([^⟧]+)⟧/g)) { xrefs += 1; expect(m[1].toLowerCase(), `${name}: ${line.slice(0, 100)}`).toBe(m[2].toLowerCase()); }
      }
    }
    expect(numbered).toBeGreaterThanOrEqual(1100);
    expect(xrefs).toBeGreaterThanOrEqual(230);
  });

  it("os cenários-base compõem a partir da AST recompilada e coincidem com a AST versionada", () => {
    const a = compile();
    if (!a.ok) throw new Error("falhou");
    for (const sc of [BASE_SCENARIO, FULL_SCENARIO]) {
      const x = composeTemplate(bllComposeRequest(a.value.ast, sc));
      const y = composeTemplate(bllComposeRequest(committedAst, sc));
      if (!x.ok || !y.ok) throw new Error("falhou");
      expect(x.value.composedOutputHash).toBe(y.value.composedOutputHash);
    }
  });
});

describe.skipIf(!(HAVE_MD && DOCX_PATH && existsSync(DOCX_PATH)))("BLL — achado do DOCX congelado (linhagem)", () => {
  it("o DOCX congelado tem o sha256 do manifesto e o defeito do Anexo II: objeto de matemática em linha e '(R)' sem '$'", () => {
    const buf = readFileSync(DOCX_PATH!);
    expect(createHash("sha256").update(buf).digest("hex")).toBe("5927f257c82599faff208994b02aae8a9b094c491b66b0bc12cdf0f6d8f38fa9");
    const xml = readZipEntry(buf, "word/document.xml") ?? "";
    expect(xml.split("<m:oMath").length - 1).toBe(1);
    const plain = xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "");
    expect(plain).toContain("Preço unitário (R)|Preçototal(R)");
  });
});
