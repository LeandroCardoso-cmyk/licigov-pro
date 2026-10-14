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
  ActionNote: typeof import("./ActionNote").ActionNote;
  CompositionExplanationPanel: typeof import("./CompositionExplanationPanel").CompositionExplanationPanel;
  ResolutionNotice: typeof import("./ResolutionNotice").ResolutionNotice;
  AstOutline: typeof import("./AstOutline").AstOutline;
  ImportResultPanel: typeof import("./ImportResultPanel").ImportResultPanel;
  RevisionStatusBadge: typeof import("./RevisionStatusBadge").RevisionStatusBadge;
  ACTION_COPY: typeof import("@/lib/institutionalTemplatesView").ACTION_COPY;
};
let M: Mods;
const h = (c: unknown, props: object) => renderToStaticMarkup(React.createElement(c as React.ComponentType<never>, props as never));

beforeAll(async () => {
  // O JSX dos componentes usa o runtime clássico sob o esbuild padrão do vitest: expõe `React` só para este arquivo.
  (globalThis as { React?: unknown }).React = React;
  M = {
    ...(await import("./RevisionTable")), ...(await import("./ActionNote")), ...(await import("./CompositionExplanationPanel")),
    ...(await import("./ResolutionNotice")), ...(await import("./AstOutline")), ...(await import("./ImportResultPanel")),
    ...(await import("./RevisionStatusBadge")), ACTION_COPY: (await import("@/lib/institutionalTemplatesView")).ACTION_COPY,
  } as Mods;
});

const HASH = "b".repeat(64);
const FLOORS = { read: "viewer", draft: "operator", approve: "manager", publish: "manager", deprecate: "manager", bind: "manager", available: "manager" };
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

  it("LICIGOV-FAST: UMA ação por estado — 'Disponibilizar para elaboração' (RASCUNHO e APROVADA), 'Depreciar' (PUBLICADA) e nenhuma para DEPRECIADA", () => {
    const html = table("manager");
    expect((html.match(/>Disponibilizar para elaboração</g) ?? []).length).toBe(2);
    expect((html.match(/>Aprovar</g) ?? []).length).toBe(0);          // sem atalhos burocráticos separados na tela
    expect((html.match(/>Publicar</g) ?? []).length).toBe(0);
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

describe("ActionNote (confirmação enxuta — LICIGOV-FAST)", () => {
  const html = (action: "AVAILABLE" | "APPROVE" | "PUBLISH" | "DEPRECATE") => h(M.ActionNote, { consequence: M.ACTION_COPY[action].consequence, note: "", onNote: noop });

  it("explica exatamente o que a ação faz e que o registro é automático; não pede autoridade, cargo, data, ato nem checkbox", () => {
    expect(html("AVAILABLE")).toContain("Não publica nenhum documento oficial");
    expect(html("APPROVE")).toContain("Aprovar NÃO disponibiliza");
    expect(html("DEPRECATE")).toContain("fixada por um vínculo ativo");
    const h1 = html("AVAILABLE");
    expect(h1).toContain("Fica registrado com o seu usuário, papel, data e hora.");
    for (const banned of ["Autoridade", "Cargo", "Data do ato", "Referência do ato", "Confirmo a", 'type="checkbox"']) expect(h1, banned).not.toContain(banned);
  });

  it("a observação é OPCIONAL (recolhida) e o botão que efetiva a ação tem o nome exato da ação — nunca 'Confirmo a APROVAÇÃO' numa operação que não é aprovação", () => {
    expect(html("AVAILABLE")).toContain("Adicionar observação (opcional)");
    for (const a of ["AVAILABLE", "APPROVE", "PUBLISH", "DEPRECATE"] as const) {
      expect(M.ACTION_COPY[a].button).toBe(M.ACTION_COPY[a].title);
      expect(JSON.stringify(M.ACTION_COPY[a])).not.toMatch(/Confirmo a/);
    }
    expect(M.ACTION_COPY.AVAILABLE.button).toBe("Disponibilizar para elaboração");
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
    ...["RevisionTable", "ActionNote", "CompositionExplanationPanel", "ResolutionNotice", "AstOutline", "ImportResultPanel", "RevisionStatusBadge"].map((n) => `client/src/components/institutionalTemplates/${n}.tsx`),
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

  it("a página de detalhe efetiva a ação pelo botão que a nomeia (sem formulário de autoridade) e envia confirm: true com a chave de idempotência da ação", () => {
    const src = read("client/src/pages/InstitutionalTemplateDetail.tsx");
    const lifecycle = src.slice(src.indexOf("const confirmAction"), src.indexOf("// ── novo rascunho"));
    expect(src).not.toMatch(/validateDecisionForm|DecisionForm/);
    expect(lifecycle).not.toMatch(/decidedByName|decidedByRole|basisReference|decision:/);
    expect(src).toMatch(/confirm: true as const, idempotencyKey: pending\.idempotencyKey/);
    expect(src).toMatch(/ACTION_COPY\[pending\.action\]\.button/);
    expect(src).toMatch(/makeAvailable\.mutateAsync/);
  });
});
