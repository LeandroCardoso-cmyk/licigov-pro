/**
 * Modelos Institucionais — Lane C: IMPORTAÇÃO SEGURA (Markdown/DOCX → candidato → validação → AST candidato → DRAFT).
 * Prova: import só chega a DRAFT; conteúdo malicioso/ativo é recusado; nada é executado; a whitelist T1 é a autoridade.
 */
import { describe, it, expect } from "vitest";
import { Document, ImageRun, Packer, Paragraph, HeadingLevel, Table, TableCell, TableRow, TextRun } from "docx";
import { IMPORT_LIMITS, runImportPipeline, docxIntakeIssues } from "../../services/institutionalTemplates/importPipeline";
import { InstitutionalTemplatesWorkflow } from "../../services/institutionalTemplates/workflowService";
import { makeTestPorts, TEST_CATALOG } from "../helpers/institutionalTemplatesFakes";

const md = (markdown: string) => runImportPipeline({ format: "markdown", markdown }, TEST_CATALOG);
const codes = (r: Awaited<ReturnType<typeof md>>) => (r.ok ? [] : r.issues.map((i) => i.code));

describe("Import Markdown → AST candidato", () => {
  it("converte títulos, parágrafos, listas, tabelas e {{variáveis}} em AST canônico válido (MARKDOWN_IMPORT)", async () => {
    const r = await md([
      "# Termo de Referência", "", "Objeto: **{{processo.objeto}}** e *{{processo.modalidade}}*.", "",
      "1. Primeiro", "2. Segundo", "", "- a", "- b", "", "| Campo | Valor |", "|---|---|", "| Objeto | {{processo.objeto}} |",
    ].join("\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sourceFormat).toBe("MARKDOWN_IMPORT");
    expect(r.ast.schema).toBe("tpl-ast/1");
    expect(r.summary.nodesByType).toMatchObject({ heading: 1, paragraph: expect.any(Number), list: 2, table: 1 });
    expect(r.summary.variables).toEqual(["processo.modalidade", "processo.objeto"]);
  });

  it("variável fora do catálogo bloqueia (estágio de validação)", async () => {
    const r = await md("Valor: {{foo.bar}}");
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.stage).toBe("validation"); expect(r.issues[0].code).toBe("UNKNOWN_VARIABLE"); }
  });

  it("recusa conteúdo malicioso/ativo: HTML cru, script, imagem, URL perigosa, macros e placeholders não-simples", async () => {
    const cases: Array<[string, string, string]> = [
      ["<script>alert(1)</script>", "html bloco", "IMPORT_HTML_NOT_ALLOWED"],
      ["texto <b onclick=x>negrito</b>", "html inline", "IMPORT_HTML_NOT_ALLOWED"],
      ["<iframe src='http://x'></iframe>", "iframe", "IMPORT_HTML_NOT_ALLOWED"],
      ["![logo](http://exemplo.com/a.png)", "imagem", "IMPORT_IMAGE_NOT_ALLOWED"],
      ["![x](data:image/png;base64,AAAA)", "imagem data", "IMPORT_IMAGE_NOT_ALLOWED"],
      ["[clique](javascript:alert(1))", "link javascript", "IMPORT_UNSAFE_URL"],
      ["[arquivo](file:///etc/passwd)", "link file", "IMPORT_UNSAFE_URL"],
      ["[d](data:text/html;base64,AAAA)", "link data", "IMPORT_UNSAFE_URL"],
      ["{% if x %}a{% endif %}", "tag de template", "IMPORT_MACRO_REJECTED"],
      ["valor ${process.env.SECRET}", "interpolação JS", "IMPORT_MACRO_REJECTED"],
      ["{{#each itens}}x{{/each}}", "bloco handlebars", "IMPORT_MACRO_REJECTED"],
      ["{{ 7*7 }}", "expressão", "IMPORT_MACRO_REJECTED"],
      ["{{ processo.objeto | upper }}", "filtro", "IMPORT_MACRO_REJECTED"],
      ["{{> partial }}", "include", "IMPORT_MACRO_REJECTED"],
      ["{{{raw}}}", "triple stash", "IMPORT_MACRO_REJECTED"],
      ["{{processo.objeto", "sem fechamento", "IMPORT_MACRO_REJECTED"],
      ["<% eval(x) %>", "ejs", "IMPORT_MACRO_REJECTED"],
    ];
    for (const [input, label, code] of cases) {
      const r = await md(input);
      expect(r.ok, label).toBe(false);
      expect(codes(r), label).toContain(code);
    }
  });

  it("macro dentro de bloco de código também é recusada; código legítimo vira texto literal (nunca executado)", async () => {
    expect(codes(await md("```\n{% include 'x' %}\n```"))).toContain("IMPORT_MACRO_REJECTED");
    const r = await md("```\nSELECT * FROM x; fetch('http://a')\n```");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.stringify(r.ast)).toContain("SELECT * FROM x");
      expect(r.warnings.join(" ")).toMatch(/texto literal/);
      expect(r.summary.nodesByType).not.toHaveProperty("aiSlot");
    }
  });

  it("links http(s)/mailto viram texto com a URL literal (sem buscar nada); títulos > 4 são reduzidos com aviso", async () => {
    const r = await md("###### Sexto\n\nVeja [o site](https://exemplo.gov.br/x).");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.stringify(r.ast)).toContain("(https://exemplo.gov.br/x)");
      expect(r.warnings.join(" ")).toMatch(/reduzido para 4/);
    }
  });

  it("recusa vazio e acima do limite", async () => {
    expect(codes(await md("   \n  "))).toContain("IMPORT_EMPTY");
    expect(codes(await md("a".repeat(IMPORT_LIMITS.maxMarkdownChars + 1)))).toContain("IMPORT_TOO_LARGE");
  });

  it("o AST candidato nunca contém nós de execução: só heading/paragraph/list/table (aiSlot/conditional/docRef não nascem de import)", async () => {
    const r = await md("# T\n\npar {{processo.objeto}}\n\n- i");
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.summary.nodesByType).sort()).toEqual(["heading", "list", "paragraph"]);
  });
});

async function docxBuffer(children: ConstructorParameters<typeof Document>[0]["sections"][number]["children"]): Promise<Buffer> {
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

describe("Import DOCX (mammoth) → AST candidato", () => {
  it("converte título, parágrafo com placeholder e tabela em AST válido (DOCX_IMPORT)", async () => {
    const buffer = await docxBuffer([
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Termo de Referência")] }),
      new Paragraph({ children: [new TextRun("Objeto: "), new TextRun({ text: "{{processo.objeto}}", bold: true })] }),
      new Table({ rows: [
        new TableRow({ children: [new TableCell({ children: [new Paragraph("Campo")] }), new TableCell({ children: [new Paragraph("Valor")] })] }),
        new TableRow({ children: [new TableCell({ children: [new Paragraph("Objeto")] }), new TableCell({ children: [new Paragraph("{{processo.objeto}}")] })] }),
      ] }),
    ]);
    const r = await runImportPipeline({ format: "docx", docx: buffer, filename: "tr.docx" }, TEST_CATALOG);
    expect(r.ok, JSON.stringify(r.ok ? [] : r.issues)).toBe(true);
    if (!r.ok) return;
    expect(r.sourceFormat).toBe("DOCX_IMPORT");
    expect(r.summary.nodesByType).toMatchObject({ heading: 1, table: 1 });
    expect(r.summary.variables).toEqual(["processo.objeto"]);
  });

  it("variável desconhecida e macro no DOCX são recusadas", async () => {
    const unknown = await runImportPipeline({ format: "docx", docx: await docxBuffer([new Paragraph("{{nao.existe}}")]) }, TEST_CATALOG);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.issues[0].code).toBe("UNKNOWN_VARIABLE");
    const macro = await runImportPipeline({ format: "docx", docx: await docxBuffer([new Paragraph("{% include 'x' %}")]) }, TEST_CATALOG);
    expect(macro.ok).toBe(false);
    if (!macro.ok) expect(macro.issues[0].code).toBe("IMPORT_MACRO_REJECTED");
  });

  it("recusa DOCX com imagem embutida (sem buscar nada)", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
    const buffer = await docxBuffer([new Paragraph({ children: [new ImageRun({ type: "png", data: png, transformation: { width: 10, height: 10 } })] })]);
    const r = await runImportPipeline({ format: "docx", docx: buffer }, TEST_CATALOG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.code)).toContain("IMPORT_IMAGE_NOT_ALLOWED");
  });

  it("intake: recusa não-ZIP, vazio, grande demais, extensão com macro e conteúdo ativo/embutido (vbaProject, OLE, ActiveX)", async () => {
    const good = await docxBuffer([new Paragraph("ok")]);
    expect(docxIntakeIssues(good, "a.docx")).toEqual([]);
    expect(docxIntakeIssues(Buffer.from("não sou zip"), "a.docx")[0].code).toBe("IMPORT_DOCX_INVALID");
    expect(docxIntakeIssues(Buffer.alloc(0))[0].code).toBe("IMPORT_EMPTY");
    expect(docxIntakeIssues(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(IMPORT_LIMITS.maxDocxBytes)]))[0].code).toBe("IMPORT_TOO_LARGE");
    for (const name of ["m.docm", "m.dotm", "m.xlsm"]) expect(docxIntakeIssues(good, name)[0].code).toBe("IMPORT_DOCX_ACTIVE_CONTENT");
    for (const marker of ["word/vbaProject.bin", "word/embeddings/oleObject1.bin", "word/activeX/activeX1.xml"]) {
      const tainted = Buffer.concat([good, Buffer.from(marker)]);
      expect(docxIntakeIssues(tainted, "a.docx").map((i) => i.code), marker).toContain("IMPORT_DOCX_ACTIVE_CONTENT");
      const r = await runImportPipeline({ format: "docx", docx: tainted, filename: "a.docx" }, TEST_CATALOG);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.stage).toBe("intake");
    }
  });

  it("arquivo corrompido que parece ZIP ⇒ IMPORT_DOCX_INVALID (sem exceção)", async () => {
    const r = await runImportPipeline({ format: "docx", docx: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("lixo lixo lixo")]) }, TEST_CATALOG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].code).toBe("IMPORT_DOCX_INVALID");
  });
});

describe("Import → SOMENTE DRAFT (nunca PUBLISHED)", () => {
  it("a revisão criada a partir de import nasce DRAFT com sourceFormat de import e hash calculado; recusa não cria nada", async () => {
    const t = makeTestPorts();
    const wf = new InstitutionalTemplatesWorkflow(t.ports);
    const ctx = { organizationId: 7, actor: { kind: "human" as const, userId: 3 }, correlationId: "c" };
    const identity = await wf.createIdentity(ctx, { documentKind: "tr", slug: "importado" });
    const ok = await md("# Modelo importado\n\nObjeto: {{processo.objeto}}");
    if (!ok.ok) throw new Error("import deveria ser válido");
    const draft = await wf.createDraft(ctx, { identityId: identity.id, ast: ok.ast, sourceFormat: ok.sourceFormat });
    expect(draft).toMatchObject({ status: "DRAFT", sourceFormat: "MARKDOWN_IMPORT", revision: 1 });
    expect(draft.approvalDecisionId).toBeUndefined();
    expect(draft.publishDecisionId).toBeUndefined();
    expect(t.repo.decisions.size).toBe(0);
    const writes = t.repo.writes;
    const bad = await md("<script>x</script>");
    expect(bad.ok).toBe(false);
    expect(t.repo.writes).toBe(writes);
  });
});
