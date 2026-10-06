/**
 * Modelos Institucionais — componentes de UX renderizados no servidor (react-dom/server; env "node", sem jsdom nem
 * dependência nova). Prova o que a pessoa VÊ: estados canônicos, revisão exata, ações por papel, confirmação humana
 * explícita, explicabilidade, ambiguidade bloqueante, importação recusada/válida e ausência de HTML injetado.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

type Mods = {
  RevisionTable: typeof import("./RevisionTable").RevisionTable;
  DecisionForm: typeof import("./DecisionForm").DecisionForm;
  CompositionExplanationPanel: typeof import("./CompositionExplanationPanel").CompositionExplanationPanel;
  ResolutionNotice: typeof import("./ResolutionNotice").ResolutionNotice;
  AstOutline: typeof import("./AstOutline").AstOutline;
  ImportResultPanel: typeof import("./ImportResultPanel").ImportResultPanel;
  RevisionStatusBadge: typeof import("./RevisionStatusBadge").RevisionStatusBadge;
  emptyDecisionForm: typeof import("@/lib/institutionalTemplatesView").emptyDecisionForm;
};
let M: Mods;
const h = (c: unknown, props: object) => renderToStaticMarkup(React.createElement(c as React.ComponentType<never>, props as never));

beforeAll(async () => {
  // O JSX dos componentes usa o runtime clássico sob o esbuild padrão do vitest: expõe `React` só para este arquivo.
  (globalThis as { React?: unknown }).React = React;
  M = {
    ...(await import("./RevisionTable")), ...(await import("./DecisionForm")), ...(await import("./CompositionExplanationPanel")),
    ...(await import("./ResolutionNotice")), ...(await import("./AstOutline")), ...(await import("./ImportResultPanel")),
    ...(await import("./RevisionStatusBadge")), emptyDecisionForm: (await import("@/lib/institutionalTemplatesView")).emptyDecisionForm,
  } as Mods;
});

const HASH = "b".repeat(64);
const FLOORS = { read: "viewer", draft: "operator", approve: "manager", publish: "manager", deprecate: "manager", bind: "manager" };
const rows = [
  { id: "tr1", revision: 1, status: "PUBLISHED" as const, semanticHash: HASH, sourceFormat: "NATIVE", approvalDecisionId: "idc_a", publishDecisionId: "idc_p" },
  { id: "tr2", revision: 2, status: "DRAFT" as const, semanticHash: "c".repeat(64), sourceFormat: "MARKDOWN_IMPORT", approvalDecisionId: null, publishDecisionId: null },
  { id: "tr3", revision: 3, status: "APPROVED" as const, semanticHash: "d".repeat(64), sourceFormat: "DOCX_IMPORT", approvalDecisionId: "idc_b", publishDecisionId: null },
  { id: "tr4", revision: 4, status: "DEPRECATED" as const, semanticHash: "e".repeat(64), sourceFormat: "NATIVE", approvalDecisionId: "idc_c", publishDecisionId: "idc_d" },
];
const noop = () => undefined;
const table = (role: string | null) => h(M.RevisionTable, { revisions: rows, role, floors: FLOORS, onSelect: noop, onLifecycle: noop, onNewRevision: noop });

describe("RevisionTable", () => {
  it("mostra as revisões EXATAS (nº + hash) e os 4 estados canônicos; nunca 'latest'/'última'", () => {
    const html = table("manager");
    for (const label of ["Revisão 1 · bbbbbbbb", "Revisão 2 · cccccccc", "Revisão 3 · dddddddd", "Revisão 4 · eeeeeeee"]) expect(html).toContain(label);
    for (const s of ["Rascunho (DRAFT)", "Aprovada (APPROVED)", "Publicada (PUBLISHED)", "Depreciada (DEPRECATED)"]) expect(html).toContain(s);
    expect(html).not.toMatch(/latest|[úu]ltima|atual\b/i);
    expect(html).toContain("Importada (Markdown)");
    expect(html).toContain("Importada (DOCX)");
  });

  it("oferece UMA ação de ciclo de vida por estado (Aprovar / Publicar / Depreciar) e nenhuma para DEPRECATED", () => {
    const html = table("manager");
    expect((html.match(/>Aprovar</g) ?? []).length).toBe(1);
    expect((html.match(/>Publicar</g) ?? []).length).toBe(1);
    expect((html.match(/>Depreciar</g) ?? []).length).toBe(1);
    expect((html.match(/Nova revisão a partir desta/g) ?? []).length).toBe(4);
  });

  it("papel abaixo do piso: botões de decisão ficam DESABILITADOS com o motivo (affordance; o servidor reautoriza)", () => {
    const html = table("operator");
    const disabled = (html.match(/disabled=""/g) ?? []).length;
    expect(disabled).toBe(3);
    expect(html).toContain('papel mínimo &quot;manager&quot;');
  });

  it("vazio: orienta a criar ou importar", () => {
    expect(h(M.RevisionTable, { revisions: [], role: "viewer", floors: FLOORS, onSelect: noop, onLifecycle: noop, onNewRevision: noop })).toContain("Nenhuma revisão ainda");
  });
});

describe("DecisionForm", () => {
  const base = (action: "APPROVE" | "PUBLISH" | "DEPRECATE", showErrors = false, value = M?.emptyDecisionForm("2026-10-06")) =>
    h(M.DecisionForm, { action, revisionLabel: "Revisão 2 · cccccccc", value, onChange: noop, showErrors });

  it("explica a consequência; aprovar NÃO publica; publicar é decisão distinta", () => {
    expect(base("APPROVE")).toContain("Aprovar NÃO publica");
    expect(base("PUBLISH")).toContain("distinta da aprovação");
    expect(base("DEPRECATE")).toContain("fixada por um vínculo ativo");
    expect(base("APPROVE")).toContain("Revisão 2 · cccccccc");
  });

  it("autoridade DECLARADA (nome, cargo, data, referência, justificativa) e confirmação NÃO pré-marcada", () => {
    const html = base("PUBLISH");
    for (const label of ["Autoridade que decidiu (nome)", "Cargo / função da autoridade", "Data do ato", "Referência do ato", "Justificativa", "Confirmo a PUBLICAÇÃO desta revisão"]) expect(html).toContain(label);
    expect(html).toMatch(/type="checkbox"/);
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
  });

  it("mostra erros acessíveis (role=alert) só após a tentativa de confirmar", () => {
    expect(base("APPROVE", false)).not.toContain('role="alert"');
    const html = base("APPROVE", true);
    expect(html).toContain('role="alert"');
    expect(html).toContain("É necessária a confirmação humana explícita.");
  });
});

describe("CompositionExplanationPanel", () => {
  const explanation = {
    template: { identityId: "ti1", slug: "tr-servicos", documentKind: "tr" },
    revision: { id: "tr1", revision: 2, status: "DRAFT", semanticHash: HASH, hashVersion: "tpl-hash/1", catalogVersion: "cat/1" },
    sourcePins: [{ key: "processo", digest: `srcd:${"f".repeat(60)}` }],
    conditionalDecisions: [{ nodePath: "root[2]", result: true, traceHash: HASH }],
    aiNarratives: [{ slotKey: "justificativa", status: "PLACEHOLDER_ONLY", humanAccepted: null }, { slotKey: "riscos", status: "PRESENT_PENDING_HUMAN_ACCEPTANCE", humanAccepted: false }],
    officialDocRefs: [{ role: "tr", order: 1, documentId: "od1", version: 3, title: "Termo de Referência" }],
    annexes: [{ id: "anexo_i" }],
    manifest: { stage: "GENERATION", persisted: false, id: null, manifestHash: HASH, composedOutputHash: HASH },
    notices: ["Pré-visualização: nenhuma IA foi chamada e nada foi persistido."],
  };

  it("expõe identidade, revisão exata, pins de fonte, decisões condicionais, narrativa de IA, referências e identidade/hash do manifest", () => {
    const html = h(M.CompositionExplanationPanel, { explanation });
    for (const s of ["tr-servicos", "Revisão 2 · bbbbbbbb", "cat/1", "tpl-hash/1", "processo", "root[2]", "incluído", "justificativa", "Apenas marcador (a IA não foi chamada)", "aguardando aceite humano", "Termo de Referência", "Anexo anexo_i", "Não persistido (pré-visualização)", "bbbbbbbbbbbb…", "nenhuma IA foi chamada"]) expect(html, s).toContain(s);
  });

  it("não vaza conteúdo interno: sem instructionsKey, sem AST, sem digest completo", () => {
    const html = h(M.CompositionExplanationPanel, { explanation });
    expect(html).not.toMatch(/instructionsKey|tpl-ast|"root"/);
    expect(html).not.toContain("f".repeat(60));
  });
});

describe("ResolutionNotice", () => {
  it("RESOLVED explicita a revisão exata aplicada; AMBIGUOUS bloqueia e lista os vínculos", () => {
    const ok = h(M.ResolutionNotice, { resolution: { status: "RESOLVED", bindingId: "tb1", identityId: "ti1", revisionId: "tr1", revision: 2, semanticHash: HASH, effectiveFrom: "2026-10-01T00:00:00Z" } });
    expect(ok).toContain("Será aplicada a Revisão 2 (bbbbbbbb)");
    expect(ok).not.toMatch(/latest|[úu]ltima/i);
    const amb = h(M.ResolutionNotice, { resolution: { status: "AMBIGUOUS", bindingIds: ["tb1", "tb2"] } });
    expect(amb).toContain("Vínculo ambíguo — geração bloqueada");
    expect(amb).toContain("tb1, tb2");
  });
});

describe("AstOutline e ImportResultPanel", () => {
  it("o contorno do AST escapa texto (HTML/script nunca é injetado)", () => {
    const html = h(M.AstOutline, { ast: { root: [{ t: "paragraph", inline: [{ t: "text", v: "<script>alert(1)</script>" }] }] } });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("importação recusada: estágio e motivos, 'Nada foi criado'; válida: só DRAFT, 'Importar nunca publica'", () => {
    const bad = h(M.ImportResultPanel, { result: { ok: false, format: "markdown", stage: "parse", issues: [{ code: "IMPORT_HTML_NOT_ALLOWED", path: "blocks[0]", message: "HTML cru não é aceito" }] } });
    expect(bad).toContain("Importação recusada na etapa de leitura do conteúdo. Nada foi criado.");
    expect(bad).toContain("HTML cru não é aceito (IMPORT_HTML_NOT_ALLOWED)");
    const good = h(M.ImportResultPanel, { result: { ok: true, format: "docx", sourceFormat: "DOCX_IMPORT", summary: { nodeCount: 4, nodesByType: {}, variables: ["processo.objeto"] }, warnings: ["aviso x"] } });
    expect(good).toContain("SOMENTE como rascunho (DRAFT)");
    expect(good).toContain("Importar nunca publica");
    expect(good).toContain("processo.objeto");
  });
});

describe("superfície de UX: sem HTML injetado/execução e rotas isoladas do legado", () => {
  const files = [
    "client/src/pages/InstitutionalTemplates.tsx", "client/src/pages/InstitutionalTemplateDetail.tsx",
    ...["RevisionTable", "DecisionForm", "CompositionExplanationPanel", "ResolutionNotice", "AstOutline", "ImportResultPanel", "RevisionStatusBadge"].map((n) => `client/src/components/institutionalTemplates/${n}.tsx`),
  ];
  const read = (rel: string) => readFileSync(path.resolve(rel), "utf8");

  it("nenhum arquivo usa dangerouslySetInnerHTML, eval, new Function ou innerHTML", () => {
    for (const f of files) expect(read(f), f).not.toMatch(/dangerouslySetInnerHTML|\beval\s*\(|new\s+Function\s*\(|\.innerHTML\s*=/);
  });

  it("as páginas chamam SOMENTE o router institutionalTemplates (nunca o `templates` legado)", () => {
    for (const f of files.slice(0, 2)) {
      const src = read(f);
      expect(src, f).toMatch(/trpc\.institutionalTemplates\./);
      expect(src, f).not.toMatch(/trpc\.templates\./);
    }
  });

  it("as rotas novas existem e a rota legado /templates permanece inalterada", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain('path={"/modelos-institucionais"}');
    expect(app).toContain('path={"/modelos-institucionais/:identityId"}');
    expect(app).toContain('<Route path={"/templates"} component={TemplatesRoute} />');
  });

  it("o item de menu só aparece com a flag ligada (requiresInstitutionalTemplates) e o menu legado segue intacto", () => {
    const layout = read("client/src/components/DashboardLayout.tsx");
    expect(layout).toContain('{ icon: LibraryBig, label: "Templates", path: "/templates" }');
    expect(layout).toMatch(/requiresInstitutionalTemplates: true/);
    expect(layout).toMatch(/institutionalTemplatesEnabled/);
  });

  it("a página de detalhe confirma ações institucionais com formulário de decisão e envia confirm: true somente após validar", () => {
    const src = read("client/src/pages/InstitutionalTemplateDetail.tsx");
    expect(src).toMatch(/validateDecisionForm\(form\)/);
    expect(src).toMatch(/if \(!v\.valid\) \{ setShowErrors\(true\); return; \}/);
    expect(src).toMatch(/confirm: true, idempotencyKey: pending\.idempotencyKey/);
  });
});
