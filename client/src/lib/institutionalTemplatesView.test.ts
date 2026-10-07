/**
 * Modelos Institucionais — view-model da UX (puro; sem DOM). Prova as regras de apresentação: lifecycle canônico (sem
 * RETIRED/IN_REVIEW), APPROVED ≠ PUBLISHED, revisão EXATA (nunca "latest"), habilitação por papel só como affordance,
 * confirmação humana explícita, resolução/ambiguidade e contorno do AST sem execução.
 */
import { describe, it, expect } from "vitest";
import {
  ACTION_COPY, AST_SNIPPETS, STATUS_EXPLANATION, STATUS_LABEL, STATUS_ORDER, appendSnippet, describeResolutionView, emptyDecisionForm,
  formatIssues, hasRoleAtLeast, makeIdempotencyKey, nextLifecycleAction, outlineOf, revisionLabel, sampleValuesFromText, scopeLabel,
  validateDecisionForm, type ResolutionView,
} from "./institutionalTemplatesView";

const FLOORS = { read: "viewer", draft: "operator", approve: "manager", publish: "manager", deprecate: "manager", bind: "manager" };
const HASH = "a".repeat(64);

describe("lifecycle canônico", () => {
  it("só DRAFT · APPROVED · PUBLISHED · DEPRECATED (sem IN_REVIEW, sem RETIRED)", () => {
    expect([...STATUS_ORDER]).toEqual(["DRAFT", "APPROVED", "PUBLISHED", "DEPRECATED"]);
    expect(Object.keys(STATUS_LABEL).sort()).toEqual([...STATUS_ORDER].sort());
    expect(JSON.stringify(STATUS_LABEL)).not.toMatch(/RETIRED|IN_REVIEW/);
  });

  it("deixa explícito que aprovar NÃO publica e que publicada é imutável / depreciada só serve a replay", () => {
    expect(STATUS_EXPLANATION.APPROVED).toMatch(/NÃO publicada/);
    expect(ACTION_COPY.APPROVE.consequence).toMatch(/Aprovar NÃO publica/);
    expect(ACTION_COPY.PUBLISH.consequence).toMatch(/distinta da aprovação/);
    expect(STATUS_EXPLANATION.PUBLISHED).toMatch(/imutável/);
    expect(STATUS_EXPLANATION.DEPRECATED).toMatch(/reproduzir documentos já gerados/);
  });

  it("a revisão é sempre a EXATA (número + hash); nenhum rótulo usa 'latest'/'última' como autoridade", () => {
    expect(revisionLabel({ revision: 3, semanticHash: HASH })).toBe("Revisão 3 · aaaaaaaa");
    const all = JSON.stringify([STATUS_LABEL, STATUS_EXPLANATION, ACTION_COPY]);
    expect(all).not.toMatch(/latest|[úu]ltima/i);
  });
});

describe("ação de ciclo de vida (affordance; o servidor reautoriza)", () => {
  it("uma única ação por estado, sem atalhos: DRAFT→Aprovar, APPROVED→Publicar, PUBLISHED→Depreciar, DEPRECATED→nenhuma", () => {
    expect(nextLifecycleAction("DRAFT", "manager", FLOORS)).toMatchObject({ action: "APPROVE", label: "Aprovar", enabled: true });
    expect(nextLifecycleAction("APPROVED", "manager", FLOORS)).toMatchObject({ action: "PUBLISH", label: "Publicar", enabled: true });
    expect(nextLifecycleAction("PUBLISHED", "manager", FLOORS)).toMatchObject({ action: "DEPRECATE", label: "Depreciar", enabled: true });
    expect(nextLifecycleAction("DEPRECATED", "owner", FLOORS)).toBeNull();
  });

  it("papel abaixo do piso desabilita a ação e explica o motivo; sem papel ⇒ desabilitado", () => {
    for (const role of ["viewer", "operator", null]) {
      const a = nextLifecycleAction("DRAFT", role, FLOORS)!;
      expect(a.enabled).toBe(false);
      expect(a.disabledReason).toMatch(/papel mínimo "manager"/);
    }
    expect(hasRoleAtLeast("admin", "manager")).toBe(true);
    expect(hasRoleAtLeast("operator", "manager")).toBe(false);
    expect(hasRoleAtLeast("owner", undefined)).toBe(false);
    expect(hasRoleAtLeast("desconhecido", "viewer")).toBe(false);
  });
});

describe("formulário da decisão: autoridade declarada + confirmação explícita", () => {
  const valid = { decidedByName: "Maria Souza", decidedByRole: "Procuradora-Geral", decidedAt: "2026-10-06", basisReference: "Portaria 12/2026", reason: "Conferido pela assessoria.", confirmed: true };

  it("começa SEM confirmação marcada e inválido (nada pré-aceito)", () => {
    const f = emptyDecisionForm("2026-10-06");
    expect(f.confirmed).toBe(false);
    const v = validateDecisionForm(f);
    expect(v.valid).toBe(false);
    expect(Object.keys(v.errors).sort()).toEqual(["basisReference", "confirmed", "decidedByName", "decidedByRole", "reason"]);
  });

  it("válido só com todos os campos do ato, justificativa ≥ 10 e confirmação", () => {
    expect(validateDecisionForm(valid).valid).toBe(true);
    expect(validateDecisionForm({ ...valid, confirmed: false }).errors.confirmed).toBeTruthy();
    expect(validateDecisionForm({ ...valid, reason: "curto" }).errors.reason).toBeTruthy();
    expect(validateDecisionForm({ ...valid, decidedAt: "06/10/2026" }).errors.decidedAt).toBeTruthy();
    expect(validateDecisionForm({ ...valid, decidedByName: "   " }).errors.decidedByName).toBeTruthy();
  });

  it("chave de idempotência por ação (UUID injetável)", () => {
    expect(makeIdempotencyKey(() => "abc")).toBe("tpl-abc");
    expect(makeIdempotencyKey()).toMatch(/^tpl-[0-9a-f-]{36}$/);
    expect(makeIdempotencyKey().length).toBeGreaterThanOrEqual(8);
  });
});

describe("binding / resolução: revisão exata explícita; ambiguidade bloqueia", () => {
  const resolved: ResolutionView = { status: "RESOLVED", bindingId: "tb1", identityId: "ti1", revisionId: "tr1", revision: 2, semanticHash: HASH, effectiveFrom: "2026-10-01T00:00:00Z" };

  it("RESOLVED mostra QUAL revisão exata será aplicada e que revisões novas não a substituem", () => {
    const d = describeResolutionView(resolved);
    expect(d.tone).toBe("success");
    expect(d.title).toBe("Será aplicada a Revisão 2 (aaaaaaaa)");
    expect(d.detail).toMatch(/não substituem esta automaticamente/);
  });

  it("AMBIGUOUS e INVALID bloqueiam a geração (tom de perigo) e o sistema não escolhe por você", () => {
    const amb = describeResolutionView({ status: "AMBIGUOUS", bindingIds: ["tb1", "tb2"] });
    expect(amb.tone).toBe("danger");
    expect(amb.title).toMatch(/bloqueada/);
    expect(amb.detail).toMatch(/não escolhe por você/);
    const inv = describeResolutionView({ status: "INVALID", issues: [{ code: "BINDING_REVISION_NOT_PINNED", path: "p", message: "binding sem revisão exata" }] });
    expect(inv.tone).toBe("danger");
    expect(inv.detail).toContain("binding sem revisão exata");
    expect(describeResolutionView({ status: "NOT_BOUND" }).tone).toBe("neutral");
  });

  it("rótulos de escopo e de issues", () => {
    expect(scopeLabel({})).toMatch(/escopo não declarado/);
    expect(scopeLabel({ modality: "pregao", criterion: "menor preço" })).toBe("modalidade: pregao · critério: menor preço");
    expect(formatIssues([{ code: "UNKNOWN_VARIABLE", path: "root[0]", message: "fora do catálogo" }])).toEqual(["root[0]: fora do catálogo (UNKNOWN_VARIABLE)"]);
  });
});

describe("contorno do AST e edição assistida (sem execução)", () => {
  const ast = { schema: "tpl-ast/1", root: [
    { t: "heading", level: 1, text: [{ t: "text", v: "Título" }] },
    { t: "paragraph", inline: [{ t: "text", v: "Objeto " }, { t: "var", name: "processo.objeto" }] },
    { t: "section", key: "objeto", children: [{ t: "aiSlot", slotKey: "s1", maxTokens: 10, instructionsKey: "k" }] },
    { t: "conditional", when: { op: "present", var: "x" }, then: [{ t: "paragraph", inline: [] }] },
  ] };

  it("lista os tipos de nó da whitelist com profundidade; variável aparece como {{nome}} e slot de IA é rotulado como explícito", () => {
    const o = outlineOf(ast);
    expect(o.map((i) => i.kind)).toEqual(["Título", "Parágrafo", "Seção", "Slot de IA", "Condicional", "Parágrafo"]);
    expect(o[1].label).toBe("Objeto {{processo.objeto}}");
    expect(o[3]).toMatchObject({ depth: 1 });
    expect(o[3].label).toMatch(/sempre revisada por pessoa/);
  });

  it("nó fora da whitelist é mostrado como 'Desconhecido' (texto), nunca interpretado; entrada inválida ⇒ vazio", () => {
    expect(outlineOf({ root: [{ t: "script", code: "alert(1)" }] })[0]).toMatchObject({ kind: "Desconhecido", label: "script" });
    expect(outlineOf(null)).toEqual([]);
    expect(outlineOf({ root: "x" })).toEqual([]);
  });

  it("appendSnippet acrescenta só nós da whitelist com chaves únicas; JSON inválido ou snippet desconhecido não alteram o texto", () => {
    expect(Object.keys(AST_SNIPPETS)).toEqual(["heading", "paragraph", "section", "aiSlot"]);
    const base = JSON.stringify({ schema: "tpl-ast/1", root: [] });
    const once = appendSnippet(base, "aiSlot");
    const twice = appendSnippet(once, "aiSlot");
    const keys = (JSON.parse(twice) as { root: { slotKey: string }[] }).root.map((n) => n.slotKey);
    expect(new Set(keys).size).toBe(2);
    expect(appendSnippet("{não é json", "heading")).toBe("{não é json");
    expect(appendSnippet(base, "inexistente")).toBe(base);
    for (const k of Object.keys(AST_SNIPPETS)) expect(["heading", "paragraph", "section", "aiSlot"]).toContain((AST_SNIPPETS[k].node as { t: string }).t);
  });

  it("valores de exemplo da prévia: nome=valor por linha, com erro explícito por linha inválida", () => {
    expect(sampleValuesFromText("processo.objeto=Limpeza\n\nparametros.valorEstimado = 1000")).toEqual({ values: { "processo.objeto": "Limpeza", "parametros.valorEstimado": "1000" }, errors: [] });
    expect(sampleValuesFromText("sem-igual").errors).toEqual(["Linha 1: use o formato nome=valor."]);
  });
});
