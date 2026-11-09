/**
 * P0 (auditoria pré-emissão H5) — vínculo entre a AUTORIDADE DECLARADA e quem REGISTRA o ato institucional.
 *
 * Antes: `decision.decidedByUserId` vinha do cliente e era gravado sem conferência (router → serviço → ledger). Um Gestor podia atribuir uma decisão
 * à conta de OUTRA pessoa (do mesmo ou de outro órgão) sem a participação dela. Agora a regra ÚNICA `decidedByMatchesRecorder` (domínio do ledger,
 * aplicada em `validateDecisionRequest` — por onde passam TODOS os escritores — e reutilizada por `bindAuthorityToExecutor`) só aceita:
 * `decidedByUserId` ausente/`null` (autoridade NOMEADA no ato, possivelmente externa; INV-13) ou igual ao usuário autenticado.
 *
 * Router REAL + serviços REAIS + ledger em memória (mesmo harness do piloto do Edital); o banco real é coberto pelos smokes MySQL existentes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const tenant = vi.hoisted(() => ({ org: 1, role: "owner" as string, realMember: true }));
vi.mock("../../services/tenantService", () => ({
  getMembership: vi.fn(async (userId: number, organizationId: number) => (tenant.realMember ? { id: 1, organizationId, userId, role: tenant.role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() } : null)),
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: tenant.org,
    membership: { id: 1, organizationId: tenant.org, userId: 1, role: tenant.role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
}));

import { institutionalTemplatesRouter } from "../../routers/institutionalTemplatesRouter";
import { BASELINE_CAPABILITIES_D4BB209 } from "../../domain/institutionalTemplates/governance/capabilities";
import { SCOPE_DIMENSIONS } from "../../domain/institutionalTemplates/governance/scopeDimensions";
import { previewComposeOutcome } from "../../services/institutionalTemplates/adapters/previewAdapter";
import { buildPilotAst, buildPilotCatalog, buildPilotInventory, PILOT_SOURCE_LOGICAL_VERSION, pilotSourceSha256 } from "../../services/institutionalTemplates/pilot/editalPilotFixture";
import { configureTemplateWorkflowPorts, resetTemplateWorkflowPorts } from "../../services/institutionalTemplates/portsRegistry";
import { recordHumanDecision } from "../../services/institutionalTemplates/decisionRecorder";
import { bindAuthorityToExecutor } from "../../domain/institutionalTemplates/candidateExecution";
import {
  DECISION_AUTHORITY_NOT_ACTOR, DECISION_MESSAGES, decidedByMatchesRecorder, decisionRequestHash, planDecision, validateDecisionRequest, type DecisionRequest,
} from "../../domain/institutionalDecision";
import { makeContext, mockUser } from "../helpers/fixtures";
import { decisionInput, makeTestPorts, type InMemoryTemplateRepository } from "../helpers/institutionalTemplatesFakes";
import type { InMemoryGovernance } from "../helpers/institutionalTemplatesGovernanceFakes";

const ME = mockUser.id;          // usuário autenticado do contexto
const OTHER = ME + 41;
const CROSS_TENANT_CODE = "NOT_FOUND";   // revisão de outro órgão é indistinguível de inexistente           // outra conta do sistema (mesmo órgão ou de outro órgão: o servidor não precisa — nem deve — distinguir)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const as = (role: string, org = 1) => { tenant.role = role; tenant.org = org; return institutionalTemplatesRouter.createCaller(makeContext(mockUser) as any); };
const trpcErr = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as { code?: string; message?: string } | null;

let repo: InMemoryTemplateRepository;
let gov: InMemoryGovernance;
const ast = buildPilotAst();
const sha = pilotSourceSha256(ast);
const FULL = { modality: "pregao", form: "eletronica", platform: "bll", regime: "empreitada-preco-unitario", criterion: "menor-preco" };

beforeEach(() => {
  const t = makeTestPorts({ flag: () => true, catalog: buildPilotCatalog(), composer: previewComposeOutcome, capabilities: { ...BASELINE_CAPABILITIES_D4BB209, scopeDimensions: SCOPE_DIMENSIONS } });
  repo = t.repo; gov = t.governance;
  configureTemplateWorkflowPorts(t.ports);
  tenant.org = 1; tenant.role = "owner"; tenant.realMember = true;
});
afterEach(() => resetTemplateWorkflowPorts());

let n = 0;
const k = (p: string) => `${p}-p0-key-${++n}`;
const register = (decision: Record<string, unknown> | undefined, key = k("reg")) => ({
  target: { kind: "NEW_IDENTITY" as const, documentKind: "edital" as const, slug: `edital-p0-${key.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`.slice(0, 60) }, templateKey: "EDITAL_PREGAO_ELETRONICO_BLL",
  displayName: "Edital — Pregão Eletrônico — BLL", declaredScope: FULL, source: { kind: "AST" as const, ast }, sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: sha,
  inventory: buildPilotInventory(ast), confirm: true, idempotencyKey: key, ...(decision ? { decision } : {}),
});
const evidence = (revisionId: string, decision: Record<string, unknown>, key = k("ev")) =>
  ({ revisionId, expectedVersion: 0, confirm: true, idempotencyKey: key, decision, evidence: { sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: sha } });
const writes = () => repo.writes + gov.writes + repo.decisions.size;

describe("1/7 — fluxos legítimos continuam funcionando", () => {
  it("decisão própria: eletrônica (sem `decision`), ato formal com o próprio id e autoridade NOMEADA externa (`null`)", async () => {
    const electronic = await as("owner").registration.register(register(undefined));
    expect(electronic.revision.status).toBe("DRAFT");
    const own = await as("owner").registration.register(register(decisionInput({ decidedByUserId: ME })));
    expect(own.revision.id).toBeTruthy();
    const ev = await as("manager").governance.recordLegalEvidence(evidence(own.revision.id, decisionInput({ decidedByUserId: null })));
    expect(ev.evidence).toMatchObject({ version: 1 });
    const recorded = [...repo.decisions.values()];
    expect(recorded.length).toBeGreaterThanOrEqual(3);
    for (const d of recorded) {
      expect(d.recordedByUserId).toBe(ME);                                           // quem registra = sempre o autenticado
      expect(d.decidedByUserId === null || d.decidedByUserId === ME).toBe(true);     // nunca outra conta
    }
    expect(recorded.some((d) => d.decidedByUserId === null && d.decidedByName === "Maria Souza")).toBe(true);   // autoridade nomeada (INV-13)
  });
});

describe("2/3 — atribuir a decisão à conta de OUTRA pessoa é recusado em TODOS os caminhos (fail-closed, nada gravado)", () => {
  it("registro de modelo, evidência jurídica e aprovação com `decidedByUserId` de outra conta ⇒ BAD_REQUEST (DECISION_AUTHORITY_NOT_ACTOR)", async () => {
    const seeded = await as("owner").registration.register(register(undefined));
    const before = writes();
    for (const id of [OTHER, ME + 1, 999_999]) {
      const r1 = await trpcErr(as("owner").registration.register(register(decisionInput({ decidedByUserId: id }))));
      expect(r1?.code, `registro ${id}`).toBe("BAD_REQUEST");
      expect(r1?.message).toMatch(new RegExp(DECISION_AUTHORITY_NOT_ACTOR));
      const r2 = await trpcErr(as("manager").governance.recordLegalEvidence(evidence(seeded.revision.id, decisionInput({ decidedByUserId: id }))));
      expect(r2?.code, `evidência ${id}`).toBe("BAD_REQUEST");
      expect(r2?.message).toMatch(new RegExp(DECISION_AUTHORITY_NOT_ACTOR));
      const r3 = await trpcErr(as("owner").revisions.approve({ revisionId: seeded.revision.id, expectedStatus: "DRAFT", confirm: true, idempotencyKey: k("ap"), decision: decisionInput({ decidedByUserId: id }) }));
      expect(r3?.code, `aprovação ${id}`).toBe("BAD_REQUEST");
      expect(r3?.message).toMatch(new RegExp(DECISION_AUTHORITY_NOT_ACTOR));
    }
    expect(writes()).toBe(before);
  });

  it("o gravador governado (fontes do processo/órgão) recusa com DECISION_REJECTED — a validação roda antes da transação (decisionRecorder.ts)", async () => {
    const ctx = { organizationId: 1, actor: { kind: "human" as const, userId: ME }, correlationId: "corr-p0" };
    const spec = { subjectType: "procurement.source_fields", subjectId: "P1", decisionType: "source_fields_declared", outcome: "declarado", mode: "revision" as const, expectedRevision: 0, evidence: [] as string[] };
    await expect(recordHumanDecision(ctx as never, { ...spec, act: { confirm: true, idempotencyKey: "idem-p0-rec-1", decision: decisionInput({ decidedByUserId: OTHER }) } } as never))
      .rejects.toMatchObject({ code: "DECISION_REJECTED" });
  });
});

describe("4/5 — membership e papel continuam soberanos (a regra nova não substitui o RBAC)", () => {
  it("sem membership real ⇒ FORBIDDEN mesmo com a própria identidade; papel insuficiente ⇒ FORBIDDEN; outro órgão ⇒ recurso inexistente", async () => {
    const seeded = await as("owner").registration.register(register(undefined));
    const before = writes();
    tenant.realMember = false;
    expect((await trpcErr(as("manager").governance.recordLegalEvidence(evidence(seeded.revision.id, decisionInput({ decidedByUserId: ME })))))?.code).toBe("FORBIDDEN");
    tenant.realMember = true;
    expect((await trpcErr(as("operator").governance.recordLegalEvidence(evidence(seeded.revision.id, decisionInput({ decidedByUserId: ME })))))?.code).toBe("FORBIDDEN");
    expect((await trpcErr(as("viewer").registration.register(register(decisionInput({ decidedByUserId: ME })))))?.code).toBe("FORBIDDEN");
    const cross = await trpcErr(as("manager", 2).governance.recordLegalEvidence(evidence(seeded.revision.id, decisionInput({ decidedByUserId: ME }))));
    expect(cross?.code).toBe(CROSS_TENANT_CODE);                                     // escopo do tenant, não a regra nova
    expect(cross?.message ?? "").not.toMatch(new RegExp(DECISION_AUTHORITY_NOT_ACTOR));
    expect(writes()).toBe(before);
  });
});

describe("6 — dados de autoridade inconsistentes", () => {
  it("ato parcial, id não inteiro/negativo ou campos extras ⇒ BAD_REQUEST pelo schema; nada gravado", async () => {
    const before = writes();
    for (const bad of [{ decidedByName: "Ana" }, decisionInput({ decidedByUserId: 1.5 }), decisionInput({ decidedByUserId: -3 }), decisionInput({ decidedByUserId: "1" }), decisionInput({ onBehalfOf: OTHER })]) {
      expect((await trpcErr(as("owner").registration.register(register(bad as Record<string, unknown>))))?.code).toBe("BAD_REQUEST");
    }
    expect(writes()).toBe(before);
  });
});

describe("8 — replay e idempotência preservados", () => {
  it("mesma chave + mesmo pedido legítimo ⇒ a MESMA decisão, sem nova escrita; a recusa não reserva a chave nem avança a revisão (CAS)", async () => {
    const seeded = await as("owner").registration.register(register(undefined));
    const key = k("same");
    const a = await as("manager").governance.recordLegalEvidence(evidence(seeded.revision.id, decisionInput({ decidedByUserId: ME }), key));
    const size = repo.decisions.size;
    const b = await as("manager").governance.recordLegalEvidence(evidence(seeded.revision.id, decisionInput({ decidedByUserId: ME }), key));
    expect(b.evidence).toMatchObject({ version: a.evidence.version });
    expect(repo.decisions.size).toBe(size);
    const key2 = k("refused");
    const next = { ...evidence(seeded.revision.id, decisionInput({ decidedByUserId: OTHER }), key2), expectedVersion: 1 };
    expect((await trpcErr(as("manager").governance.recordLegalEvidence(next)))?.code).toBe("BAD_REQUEST");
    expect(repo.decisions.size).toBe(size);
    const ok = await as("manager").governance.recordLegalEvidence({ ...next, decision: decisionInput({ decidedByUserId: null }) });   // mesma chave, agora legítima
    expect(ok.evidence).toMatchObject({ version: 2 });
  });
});

describe("domínio — regra única, mensagem e compatibilidade com o histórico", () => {
  const base: DecisionRequest = {
    organizationId: 9, subjectType: "institutional_template.approval", subjectId: "tr0001", decisionType: "template_approval", outcome: "aprovado",
    decidedByName: "Maria Souza", decidedByRole: "Procuradora", decidedByUserId: null, decidedAt: "2026-10-06", basisReference: "Portaria 1/2026",
    reason: "Conferido pela assessoria.", evidence: [], recordedByUserId: 10, expectedRevision: 0, idempotencyKey: "idem-key-1", correlationId: "c",
  };
  it("tabela-verdade de decidedByMatchesRecorder e validateDecisionRequest", () => {
    expect([decidedByMatchesRecorder(undefined, 10), decidedByMatchesRecorder(null, 10), decidedByMatchesRecorder(10, 10), decidedByMatchesRecorder(11, 10)]).toEqual([true, true, true, false]);
    expect(validateDecisionRequest(base)).toEqual({ ok: true });
    expect(validateDecisionRequest({ ...base, decidedByUserId: 10 })).toEqual({ ok: true });
    expect(validateDecisionRequest({ ...base, decidedByUserId: 11 })).toEqual({ ok: false, code: DECISION_AUTHORITY_NOT_ACTOR, fields: ["decidedByUserId"] });
    expect(DECISION_MESSAGES[DECISION_AUTHORITY_NOT_ACTOR]).toMatch(/próprio nome|autoridade identificada/);
    // ato incompleto continua com o código anterior (ordem preservada)
    expect(validateDecisionRequest({ ...base, decidedByUserId: 11, reason: "" })).toMatchObject({ ok: false, code: "DECISION_FIELDS_REQUIRED" });
  });
  it("9 — histórico intacto: hash de referência idêntico ao da base (8a7239a); registro HISTÓRICO divergente continua lido e reconhecido pelo planejador", () => {
    // Valor calculado com o `decisionRequestHash` de origin/staging 8a7239a (antes do P0) para este mesmo pedido: o formato idc-req-v1 não mudou.
    expect(decisionRequestHash(base)).toBe("e3b465a0b536de8aadb5178d36aa7d43539ce37c9ed47b0dd7661c6bf62cb219");
    const plan = planDecision(base, { byIdempotencyKey: null, current: null });
    expect(plan.kind).toBe("insert");
    if (plan.kind !== "insert") return;
    expect(planDecision(base, { byIdempotencyKey: plan.decision, current: plan.decision }).kind).toBe("replay");
    // Registro gravado ANTES do P0 com decidedBy ≠ recordedBy (hipotético): nada o revalida nem o altera — o planejador (puro) ainda o reconhece
    // como a mesma decisão; só um NOVO pedido igual é recusado na validação de entrada (que roda antes do plano), sem escrita.
    const legacyReq = { ...base, decidedByUserId: 11, idempotencyKey: "idem-legacy-1" };
    const legacyPlan = planDecision(legacyReq, { byIdempotencyKey: null, current: null });
    expect(legacyPlan.kind).toBe("insert");
    if (legacyPlan.kind !== "insert") return;
    expect(legacyPlan.decision.decidedByUserId).toBe(11);
    expect(planDecision(legacyReq, { byIdempotencyKey: legacyPlan.decision, current: legacyPlan.decision }).kind).toBe("replay");
    expect(validateDecisionRequest(legacyReq)).toMatchObject({ ok: false, code: DECISION_AUTHORITY_NOT_ACTOR });
  });
  it("bindAuthorityToExecutor (CLI do candidato) usa a MESMA regra: própria ⇒ amarrada; divergente ⇒ recusa; ausente ⇒ amarrada ao executor", () => {
    const auth = { decidedByName: "A", decidedByRole: "R", decidedAt: "2026-10-06", basisReference: "B", reason: "motivo do registro" };
    expect(bindAuthorityToExecutor(auth, 10).decidedByUserId).toBe(10);
    expect(bindAuthorityToExecutor({ ...auth, decidedByUserId: 10 }, 10).decidedByUserId).toBe(10);
    expect(() => bindAuthorityToExecutor({ ...auth, decidedByUserId: 99 }, 10)).toThrow(/difere do usuário autenticado/);
    expect(() => bindAuthorityToExecutor({ ...auth, decidedByUserId: "10" }, 10)).toThrow(/difere do usuário autenticado/);
  });
});
