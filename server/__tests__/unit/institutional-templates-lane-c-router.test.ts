/**
 * Modelos Institucionais — Lane C: ROUTER tRPC (sem DB; tenantService mockado; ports em memória).
 * Cobre: RBAC por papel, tenant do contexto (input com organizationId recusado), isolamento/cross-tenant, flag OFF,
 * ports não configurados, confirmação humana, import só DRAFT, erro estável e fronteira estrutural (sem eval/IA/rede).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const tenant = vi.hoisted(() => ({ org: 1, role: "owner" as string, active: true }));
vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: tenant.org,
    membership: tenant.active ? { id: 1, organizationId: tenant.org, userId: 1, role: tenant.role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() } : null,
  })),
}));

import { institutionalTemplatesRouter } from "../../routers/institutionalTemplatesRouter";
import { configureTemplateWorkflowPorts, resetTemplateWorkflowPorts } from "../../services/institutionalTemplates/portsRegistry";
import { makeContext, mockUser } from "../helpers/fixtures";
import { decisionInput, makeTestPorts, simpleAst, type InMemoryTemplateRepository } from "../helpers/institutionalTemplatesFakes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const caller = () => institutionalTemplatesRouter.createCaller(makeContext(mockUser) as any);
const as = (role: string, org = 1) => { tenant.role = role; tenant.org = org; tenant.active = true; return caller(); };

let repo: InMemoryTemplateRepository;
let flagOn: boolean;

beforeEach(() => {
  const t = makeTestPorts({ flag: () => flagOn });
  flagOn = true; repo = t.repo;
  configureTemplateWorkflowPorts(t.ports);
  tenant.org = 1; tenant.role = "owner"; tenant.active = true;
});
afterEach(() => resetTemplateWorkflowPorts());

const trpcErr = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as { code?: string; message?: string } | null;
const life = (revisionId: string, expectedStatus: "DRAFT" | "APPROVED" | "PUBLISHED", key: string) =>
  ({ revisionId, expectedStatus, confirm: true, idempotencyKey: `idem-key-${key}`, decision: decisionInput() });

async function seedDraft(role = "owner", org = 1) {
  const c = as(role, org);
  const identity = await c.identities.create({ documentKind: "tr", slug: `tr-${org}` });
  const draft = await c.revisions.createDraft({ identityId: identity.id, ast: simpleAst() });
  return { identity, draft };
}

describe("RBAC por ação (piso técnico de papel)", () => {
  it("viewer: lê e pré-visualiza; NÃO cria, edita, importa, aprova, publica, deprecia nem vincula", async () => {
    const { identity, draft } = await seedDraft();
    const v = as("viewer");
    expect(await v.identities.list({})).toHaveLength(1);
    expect((await v.revisions.get({ revisionId: draft.id })).revision.id).toBe(draft.id);
    expect((await v.preview({ revisionId: draft.id, sampleValues: { "processo.objeto": "X" } })).status).toBe("COMPOSED");
    const writes = repo.writes;
    const denied = [
      v.identities.create({ documentKind: "tr", slug: "novo" }),
      v.revisions.createDraft({ identityId: identity.id, ast: simpleAst() }),
      v.revisions.updateDraft({ revisionId: draft.id, ast: simpleAst("Z"), expectedSemanticHash: draft.semanticHash }),
      v.import.validate({ format: "markdown", markdown: "# x" }),
      v.revisions.approve(life(draft.id, "DRAFT", "v1")),
      v.revisions.publish(life(draft.id, "APPROVED", "v2")),
      v.revisions.deprecate(life(draft.id, "PUBLISHED", "v3")),
      v.bindings.set({ documentKind: "tr", scope: {}, identityId: identity.id, pinnedRevisionId: draft.id, effectiveFrom: "2026-10-01T00:00:00Z", confirm: true }),
      v.bindings.deactivate({ bindingId: "x", confirm: true }),
    ];
    for (const p of denied) expect((await trpcErr(p))?.code).toBe("FORBIDDEN");
    expect(repo.writes).toBe(writes);
  });

  it("operator: cria/edita/importa rascunhos; NÃO aprova, publica, deprecia nem vincula", async () => {
    const { identity, draft } = await seedDraft("operator");
    const o = as("operator");
    await o.revisions.updateDraft({ revisionId: draft.id, ast: simpleAst("B"), expectedSemanticHash: draft.semanticHash });
    expect((await o.import.validate({ format: "markdown", markdown: "# x" })).ok).toBe(true);
    for (const p of [
      o.revisions.approve(life(draft.id, "DRAFT", "o1")),
      o.revisions.publish(life(draft.id, "APPROVED", "o2")),
      o.revisions.deprecate(life(draft.id, "PUBLISHED", "o3")),
      o.bindings.set({ documentKind: "tr", scope: {}, identityId: identity.id, pinnedRevisionId: draft.id, effectiveFrom: "2026-10-01T00:00:00Z", confirm: true }),
    ]) expect((await trpcErr(p))?.code).toBe("FORBIDDEN");
  });

  it("manager: aprova, publica, vincula e deprecia (com confirmação humana)", async () => {
    const { identity, draft } = await seedDraft("operator");
    const m = as("manager");
    expect((await m.revisions.approve(life(draft.id, "DRAFT", "m1"))).revision.status).toBe("APPROVED");
    expect((await m.revisions.publish(life(draft.id, "APPROVED", "m2"))).revision.status).toBe("PUBLISHED");
    const b = await m.bindings.set({ documentKind: "tr", scope: { modality: "pregao" }, identityId: identity.id, pinnedRevisionId: draft.id, effectiveFrom: "2026-10-01T00:00:00Z", confirm: true });
    expect(b.pinnedRevisionId).toBe(draft.id);
    await m.bindings.deactivate({ bindingId: b.id, confirm: true });
    expect((await m.revisions.deprecate(life(draft.id, "PUBLISHED", "m3"))).revision.status).toBe("DEPRECATED");
  });

  it("sem membership ativa ⇒ FORBIDDEN (nada alcança o workflow)", async () => {
    tenant.active = false;
    expect((await trpcErr(caller().identities.list({})))?.code).toBe("FORBIDDEN");
  });
});

describe("tenant do contexto autenticado; cross-tenant falha fechado", () => {
  it("input com organizationId é recusado (o tenant nunca vem do cliente)", async () => {
    const c = as("owner");
    const cast = (v: unknown) => v as never;
    expect((await trpcErr(c.identities.list(cast({ organizationId: 999 }))))?.code).toBe("BAD_REQUEST");
    expect((await trpcErr(c.identities.create(cast({ documentKind: "tr", slug: "x", organizationId: 999 }))))?.code).toBe("BAD_REQUEST");
    expect((await trpcErr(c.bindings.list(cast({ organizationId: 999 }))))?.code).toBe("BAD_REQUEST");
  });

  it("o tenant B não vê, lê, pré-visualiza, aprova nem vincula o que é do tenant A (NOT_FOUND idêntico ao inexistente)", async () => {
    const { identity, draft } = await seedDraft("owner", 1);
    const b = as("owner", 2);
    expect(await b.identities.list({})).toEqual([]);
    const errs = [
      await trpcErr(b.identities.get({ identityId: identity.id })),
      await trpcErr(b.revisions.get({ revisionId: draft.id })),
      await trpcErr(b.preview({ revisionId: draft.id, sampleValues: {} })),
      await trpcErr(b.revisions.approve(life(draft.id, "DRAFT", "x1"))),
      await trpcErr(b.revisions.createDraft({ identityId: identity.id, ast: simpleAst() })),
    ];
    for (const e of errs) expect(e?.code).toBe("NOT_FOUND");
    const missing = await trpcErr(b.revisions.get({ revisionId: "inexistente0001" }));
    expect(errs[1]?.message).toBe(missing?.message);
    expect((await repo.getRevision(1, draft.id))!.status).toBe("DRAFT");
  });
});

describe("módulo atrás da flag tenant-scoped (default OFF) e ports", () => {
  it("flag OFF: getCapabilities informa enabled=false SEM lançar; as operações falham fechado (PRECONDITION_FAILED MODULE_DISABLED)", async () => {
    flagOn = false;
    const c = as("owner");
    expect(await c.getCapabilities()).toMatchObject({ enabled: false, portsConfigured: true, flag: "FF_INSTITUTIONAL_TEMPLATES_V1" });
    for (const p of [c.identities.list({}), c.identities.create({ documentKind: "tr", slug: "x" }), c.preview({ revisionId: "r", sampleValues: {} })]) {
      const e = await trpcErr(p);
      expect(e?.code).toBe("PRECONDITION_FAILED");
      expect(e?.message).toContain("MODULE_DISABLED");
    }
    expect(repo.writes).toBe(0);
  });

  it("ports não configurados (integração pendente): capabilities mostra portsConfigured=false; operações falham fechado", async () => {
    resetTemplateWorkflowPorts();
    const c = as("owner");
    expect(await c.getCapabilities()).toMatchObject({ enabled: false, portsConfigured: false });
    const e = await trpcErr(c.identities.list({}));
    expect(e?.code).toBe("PRECONDITION_FAILED");
    expect(e?.message).toContain("PORTS_NOT_CONFIGURED");
  });

  it("capabilities expõe lifecycle canônico (sem IN_REVIEW/RETIRED) e os pisos de papel", async () => {
    const caps = await as("viewer").getCapabilities();
    expect(caps.lifecycle).toEqual(["DRAFT", "APPROVED", "PUBLISHED", "DEPRECATED"]);
    expect(caps.roleFloors).toMatchObject({ read: "viewer", draft: "operator", approve: "manager", publish: "manager", deprecate: "manager", bind: "manager" });
  });
});

describe("lifecycle pela API: confirmação humana, erros estáveis", () => {
  it("sem confirm literal ⇒ PRECONDITION_FAILED CONFIRMATION_REQUIRED e nada muda; aprovar não publica; publicar sem aprovar ⇒ CONFLICT", async () => {
    const { draft } = await seedDraft("operator");
    const m = as("manager");
    const writes = repo.writes;
    const e = await trpcErr(m.revisions.approve({ ...life(draft.id, "DRAFT", "c1"), confirm: false }));
    expect(e?.code).toBe("PRECONDITION_FAILED");
    expect(e?.message).toContain("CONFIRMATION_REQUIRED");
    expect(repo.writes).toBe(writes);
    const skip = await trpcErr(m.revisions.publish(life(draft.id, "DRAFT", "c2")));
    expect(skip?.code).toBe("CONFLICT");
    expect(skip?.message).toContain("TRANSITION_INVALID");
    await m.revisions.approve(life(draft.id, "DRAFT", "c3"));
    expect((await m.revisions.get({ revisionId: draft.id })).revision.status).toBe("APPROVED");
  });

  it("publicada é imutável pela API (REVISION_IMMUTABLE) e nova revisão nasce DRAFT a partir dela", async () => {
    const { identity, draft } = await seedDraft("operator");
    const m = as("manager");
    await m.revisions.approve(life(draft.id, "DRAFT", "i1"));
    await m.revisions.publish(life(draft.id, "APPROVED", "i2"));
    const e = await trpcErr(m.revisions.updateDraft({ revisionId: draft.id, ast: simpleAst("Z"), expectedSemanticHash: draft.semanticHash }));
    expect(e?.code).toBe("CONFLICT");
    expect(e?.message).toContain("REVISION_IMMUTABLE");
    const next = await m.revisions.createDraft({ identityId: identity.id, fromRevisionId: draft.id });
    expect(next).toMatchObject({ status: "DRAFT", revision: 2 });
  });

  it("estrutura inválida ⇒ BAD_REQUEST VALIDATION_FAILED com o motivo; validateAst não persiste", async () => {
    const c = as("operator");
    const identity = await c.identities.create({ documentKind: "tr", slug: "tr-bad" });
    const e = await trpcErr(c.revisions.createDraft({ identityId: identity.id, ast: { schema: "tpl-ast/1", root: [{ t: "paragraph", inline: [{ t: "var", name: "x.y" }] }] } }));
    expect(e?.code).toBe("BAD_REQUEST");
    expect(e?.message).toContain("UNKNOWN_VARIABLE");
    const writes = repo.writes;
    expect((await c.revisions.validateAst({ ast: simpleAst() })).valid).toBe(true);
    expect(repo.writes).toBe(writes);
  });
});

describe("import pela API: só DRAFT", () => {
  it("import.createDraft cria SOMENTE uma revisão DRAFT (MARKDOWN_IMPORT) — nunca publicada; recusa maliciosa não cria nada", async () => {
    const o = as("operator");
    const identity = await o.identities.create({ documentKind: "tr", slug: "tr-imp" });
    const res = await o.import.createDraft({ identityId: identity.id, format: "markdown", markdown: "# Importado\n\nObjeto: {{processo.objeto}}" });
    expect(res.revision).toMatchObject({ status: "DRAFT", sourceFormat: "MARKDOWN_IMPORT" });
    expect(res.revision.approvalDecisionId).toBeUndefined();
    expect(res.revision.publishDecisionId).toBeUndefined();
    expect(repo.decisions.size).toBe(0);
    const revisionsBefore = (await repo.listRevisions(1, identity.id)).length;
    const e = await trpcErr(o.import.createDraft({ identityId: identity.id, format: "markdown", markdown: "<script>alert(1)</script>" }));
    expect(e?.code).toBe("BAD_REQUEST");
    expect(e?.message).toContain("IMPORT_REJECTED");
    expect((await repo.listRevisions(1, identity.id)).length).toBe(revisionsBefore);
  });

  it("import.validate devolve o AST candidato e o resumo, ou os motivos da recusa — sem persistir", async () => {
    const o = as("operator");
    const writes = repo.writes;
    const ok = await o.import.validate({ format: "markdown", markdown: "# T\n\n{{processo.objeto}}" });
    expect(ok.ok).toBe(true);
    const bad = await o.import.validate({ format: "markdown", markdown: "{% x %}" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues[0].code).toBe("IMPORT_MACRO_REJECTED");
    expect(repo.writes).toBe(writes);
  });
});

describe("fronteira estrutural: IA nunca age; nada de eval, rede ou execução", () => {
  const dirs = ["server/services/institutionalTemplates", "server/routers"];
  const files = [
    ...readdirSync(path.resolve("server/services/institutionalTemplates")).map((f) => path.resolve("server/services/institutionalTemplates", f)),
    path.resolve("server/routers/institutionalTemplatesRouter.ts"),
  ];
  void dirs;
  it("o módulo não importa IA/LLM/providers nem faz eval, new Function, fetch, child_process ou require dinâmico", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/aiExecutionEngine|_core\/llm|\/ai\/|invokeLLM|@google\/generative-ai|openai|anthropic/i);
      expect(src, f).not.toMatch(/\beval\s*\(|new\s+Function\s*\(|\bfetch\s*\(|child_process|\brequire\s*\(|vm\.run|node:vm/);
    }
  });

  it("nenhuma ação institucional aceita ator derivado de input: o ator é sempre o usuário autenticado do contexto", () => {
    const src = readFileSync(path.resolve("server/routers/institutionalTemplatesRouter.ts"), "utf8");
    expect(src).toMatch(/actor: \{ kind: "human", userId: ctx\.user\.id \}/);
    expect(src).not.toMatch(/z\.[a-z]+\([^)]*\)\.[^;]*organizationId/);
  });
});
