/**
 * M8-UX-GOV-001 / LICIGOV-FAST — ROUTER tRPC (sem DB): escritas governadas (TR/certame, Perfil, orçamento, itens, "usar como padrão",
 * revisão do Edital) SEM `decision` são aceitas e a autoridade gravada é a ELETRÔNICA do usuário autenticado (id, nome, papel, data do
 * servidor; nenhum ato inventado). `decision` completa prevalece; parcial é recusada; RBAC (pisos `govern`=manager, `review`=operator)
 * intacto; evidência jurídica continua exigindo fundamento declarado. O ledger é substituído por um gravador que roda a VALIDAÇÃO REAL do
 * contrato (`validateDecisionRequest`) e captura o pedido — prova o que seria persistido, com `recordedByUserId` + `correlationId`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const tenant = vi.hoisted(() => ({ org: 1, role: "manager" as string }));
const recorded = vi.hoisted(() => ({ requests: [] as Array<Record<string, unknown>> }));

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: tenant.org,
    membership: { id: 1, organizationId: tenant.org, userId: 1, role: tenant.role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
}));
vi.mock("../../db/procurement", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getProcess: vi.fn(async (processId: string, organizationId: number) => (processId === "P1" && organizationId === 1 ? { id: "P1", organizationId: 1 } : null)),
}));
vi.mock("../../services/institutionalTemplates/decisionRecorder", async () => {
  const { validateDecisionRequest } = await import("../../domain/institutionalDecision");
  const { TemplateWorkflowError } = await import("../../services/institutionalTemplates/errors");
  return {
    recordHumanDecision: vi.fn(async (ctx: { organizationId: number; actor: { userId: number }; correlationId: string }, spec: { subjectType: string; subjectId: string; decisionType: string; outcome: string; evidence: string[]; act: { idempotencyKey: string; decision: Record<string, unknown> }; mode: string; expectedRevision?: number }) => {
      const d = spec.act.decision;
      const request = {
        organizationId: ctx.organizationId, subjectType: spec.subjectType, subjectId: spec.subjectId, decisionType: spec.decisionType, outcome: spec.outcome,
        decidedByName: d.decidedByName, decidedByRole: d.decidedByRole, decidedByUserId: d.decidedByUserId ?? null, decidedAt: d.decidedAt,
        basisReference: d.basisReference, reason: d.reason, evidence: spec.evidence, recordedByUserId: ctx.actor.userId,
        expectedRevision: spec.mode === "revision" ? (spec.expectedRevision ?? 0) : 0, idempotencyKey: spec.act.idempotencyKey, correlationId: ctx.correlationId,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const valid = validateDecisionRequest(request as any);
      if (!valid.ok) throw new TemplateWorkflowError("DECISION_REJECTED", valid.code);
      recorded.requests.push(request);
      return { decision: { id: `d${recorded.requests.length}`, revision: (request.expectedRevision as number) + 1, ...request }, replayed: false };
    }),
  };
});

import { institutionalTemplatesRouter } from "../../routers/institutionalTemplatesRouter";
import { configureTemplateWorkflowPorts, resetTemplateWorkflowPorts } from "../../services/institutionalTemplates/portsRegistry";
import { GovernedSourceService } from "../../services/institutionalTemplates/governedSourceService";
import { ELECTRONIC_BASIS } from "../../services/institutionalTemplates/electronicAuthority";
import { makeContext, mockUser } from "../helpers/fixtures";
import { decisionInput, makeTestPorts } from "../helpers/institutionalTemplatesFakes";

const SERVER_DAY = "2026-10-06";   // relógio das ports de teste (2026-10-06T12:00:00.000Z)
const MANIFEST = { id: "m1", stage: "GENERATION", organizationId: 1, aiNarratives: [{ slotKey: "s1", executionId: "e1", outputHash: "h".repeat(64) }] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const as = (role: string, org = 1) => { tenant.role = role; tenant.org = org; return institutionalTemplatesRouter.createCaller({ ...makeContext(mockUser), correlationId: "corr-m8-gov" } as any); };
const trpcErr = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as { code?: string; message?: string } | null;
let seq = 0;
const act = (over: Record<string, unknown> = {}) => ({ confirm: true, idempotencyKey: `idem-m8-${++seq}`, expectedRevision: 0, ...over });
const last = () => recorded.requests[recorded.requests.length - 1];

/** Rotas cuja validação de catálogo não é o assunto aqui: o serviço é observado (o router é a unidade sob teste). */
const captured: Array<{ method: string; input: Record<string, unknown> }> = [];
const SPIED = ["recordProcessFields", "recordCertameConfig", "recordItemsParticipation", "recordOrganizationFields", "recordOrganizationProfile", "recordBudgetBaseDate"] as const;

beforeEach(() => {
  recorded.requests.length = 0; captured.length = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configureTemplateWorkflowPorts(makeTestPorts({ manifests: new Map([["m1", MANIFEST as any]]) }).ports);
  for (const m of SPIED) {
    vi.spyOn(GovernedSourceService.prototype, m).mockImplementation(async (_ctx: unknown, input: unknown) => {
      captured.push({ method: m, input: input as Record<string, unknown> });
      return { decision: { revision: 1 }, replayed: false } as never;
    });
  }
});
afterEach(() => { resetTemplateWorkflowPorts(); vi.restoreAllMocks(); });

const electronic = (action: RegExp) => ({
  decidedByName: "Usuário Teste", decidedByRole: "Gestor do órgão (manager)", decidedByUserId: mockUser.id, decidedAt: SERVER_DAY,
  basisReference: ELECTRONIC_BASIS, reason: expect.stringMatching(action),
});

describe("M8-UX-GOV-001 — escrita governada sem redigitar autoridade", () => {
  it("divulgação do orçamento SEM `decision`: gravada com a autoridade eletrônica do usuário autenticado (ledger: ator, papel, data do servidor, correlation id)", async () => {
    const out = await as("manager").governed.recordBudgetDisclosure({ processId: "P1", disclosure: "sigiloso", ...act() });
    expect(out.decision.revision).toBe(1);
    expect(last()).toMatchObject({
      ...electronic(/^Registro da divulgação do orçamento — registrado eletronicamente/), outcome: "sigiloso",
      recordedByUserId: mockUser.id, correlationId: "corr-m8-gov", organizationId: 1, subjectId: "P1",
    });
    expect(String(last().basisReference)).toMatch(/nenhum ato administrativo informado/);   // nenhum ato fictício
  });

  it("observação opcional vira a justificativa; ato formal COMPLETO prevalece intacto; ato PARCIAL é recusado (nada gravado)", async () => {
    await as("manager").governed.recordBudgetDisclosure({ processId: "P1", disclosure: "publico", note: "Conferido com o setor de compras.", ...act() });
    expect(last()).toMatchObject({ reason: "Conferido com o setor de compras.", basisReference: ELECTRONIC_BASIS });
    await as("manager").governed.recordBudgetDisclosure({ processId: "P1", disclosure: "publico", decision: decisionInput(), ...act() });
    expect(last()).toMatchObject({ decidedByName: "Maria Souza", decidedByRole: "Procuradora-Geral", basisReference: "Portaria 12/2026", decidedAt: "2026-10-06", recordedByUserId: mockUser.id });
    const before = recorded.requests.length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await trpcErr(as("manager").governed.recordBudgetDisclosure({ processId: "P1", disclosure: "publico", decision: { decidedByName: "Ana" } as any, ...act() })))?.code).toBe("BAD_REQUEST");
    expect(recorded.requests.length).toBe(before);
  });

  it("confirmação explícita continua obrigatória e o processo de outro tenant continua indistinguível de inexistente", async () => {
    expect((await trpcErr(as("manager").governed.recordBudgetDisclosure({ processId: "P1", disclosure: "publico", ...act({ confirm: false }) })))?.code).toBe("PRECONDITION_FAILED");
    expect((await trpcErr(as("manager", 2).governed.recordBudgetDisclosure({ processId: "P1", disclosure: "publico", ...act() })))?.code).toBe("NOT_FOUND");
    expect(recorded.requests).toHaveLength(0);
  });

  it("todas as rotas governadas aceitam a escrita SEM `decision` e repassam ao serviço a autoridade eletrônica (rótulo da ação); `note` não vaza ao serviço", async () => {
    const c = as("manager");
    const fields = { catalogVersion: "cat-v1", fields: { x: 1 } };
    await c.governed.recordProcessFields({ processId: "P1", source: "TR", ...fields, ...act() });
    await c.governed.recordCertameConfig({ processId: "P1", source: "CERTAME_CONFIG", ...fields, note: "Decidido na reunião de planejamento.", ...act() });
    await c.governed.recordItemsParticipation({ processId: "P1", catalogVersion: "cat-v1", participation: { default: "AMPLA" }, ...act() });
    await c.governed.recordOrganizationFields({ source: "POLICY", ...fields, ...act() });
    await c.governed.recordLicitacoesProfile({ catalogVersion: "cat-v1", defaults: [], ...act() });
    await c.governed.recordBudgetBaseDate({ processId: "P1", catalogVersion: "cat-v1", baseDate: "2026-09-30", ...act() });
    expect(captured.map((x) => x.method)).toEqual([...SPIED]);
    const labels = [/^Registro de dados do processo/, /^Decidido na reunião de planejamento\.$/, /^Registro do regime de participação dos itens/, /^Registro de dados institucionais do órgão/, /^Registro do Perfil de Licitações do órgão/, /^Registro da data-base do orçamento/];
    captured.forEach((x, i) => {
      expect(x.input.decision, x.method).toEqual(electronic(labels[i]));
      expect(x.input, x.method).not.toHaveProperty("note");
      expect(x.input.confirm, x.method).toBe(true);
    });
    // ato formal completo é repassado sem alteração
    await c.governed.recordCertameConfig({ processId: "P1", source: "CERTAME_CONFIG", ...fields, decision: decisionInput(), ...act() });
    expect(captured[captured.length - 1].input.decision).toEqual(decisionInput());
  });

  it("RBAC intacto: operator/viewer NÃO registram fontes governadas (piso manager), com ou sem `decision`", async () => {
    for (const role of ["operator", "viewer"]) {
      const c = as(role);
      expect((await trpcErr(c.governed.recordBudgetDisclosure({ processId: "P1", disclosure: "publico", ...act() })))?.code, role).toBe("FORBIDDEN");
      expect((await trpcErr(c.governed.recordCertameConfig({ processId: "P1", source: "CERTAME_CONFIG", catalogVersion: "cat-v1", fields: {}, ...act() })))?.code, role).toBe("FORBIDDEN");
      expect((await trpcErr(c.governed.recordLicitacoesProfile({ catalogVersion: "cat-v1", decision: decisionInput(), ...act() })))?.code, role).toBe("FORBIDDEN");
    }
    expect(recorded.requests).toHaveLength(0);
    expect(captured).toHaveLength(0);
  });
});

describe("M8-UX-GOV-001 — revisão do Edital (aceite de narrativa de IA / reconhecimento de desvio) sem redigitar autoridade", () => {
  const ack = (over: Record<string, unknown> = {}) => ({ manifestId: "m1", blockId: "b1", kind: "INCLUDED_BLOCK_REMOVED" as const, confirm: true, idempotencyKey: `idem-ack-${++seq}`, ...over });

  it("reconhecimento de desvio e aceite de narrativa SEM `decision` ⇒ autoridade eletrônica (operator registra; papel do usuário no ledger)", async () => {
    await as("operator").reviews.acknowledgeDeviation(ack());
    expect(last()).toMatchObject({
      decidedByName: "Usuário Teste", decidedByRole: "Operador do órgão (operator)", decidedByUserId: mockUser.id, decidedAt: SERVER_DAY,
      basisReference: ELECTRONIC_BASIS, reason: expect.stringMatching(/^Reconhecimento de desvio estrutural/), recordedByUserId: mockUser.id, outcome: "reconhecido",
    });
    await as("manager").reviews.acceptAiNarrative({ manifestId: "m1", slotKey: "s1", executionId: "e1", outputHash: "h".repeat(64), confirm: true, idempotencyKey: `idem-acc-${++seq}` });
    expect(last()).toMatchObject({ decidedByRole: "Gestor do órgão (manager)", basisReference: ELECTRONIC_BASIS, reason: expect.stringMatching(/^Aceite de narrativa de IA/), outcome: "aceito" });
  });

  it("ato formal completo prevalece; parcial é recusado; viewer continua sem acesso; confirmação obrigatória", async () => {
    await as("operator").reviews.acknowledgeDeviation(ack({ decision: decisionInput() }));
    expect(last()).toMatchObject({ decidedByName: "Maria Souza", basisReference: "Portaria 12/2026" });
    const before = recorded.requests.length;
    expect((await trpcErr(as("operator").reviews.acknowledgeDeviation(ack({ decision: { decidedByName: "Ana" } }) as never)))?.code).toBe("BAD_REQUEST");
    expect((await trpcErr(as("viewer").reviews.acknowledgeDeviation(ack())))?.code).toBe("FORBIDDEN");
    expect((await trpcErr(as("operator").reviews.acknowledgeDeviation(ack({ confirm: false }))))?.code).toBe("PRECONDITION_FAILED");
    expect(recorded.requests.length).toBe(before);
  });
});

describe("evidência jurídica NÃO muda: fundamento institucional declarado continua obrigatório", () => {
  it("recordLegalEvidence sem `decision` é recusado pelo schema (BAD_REQUEST)", async () => {
    const r = await trpcErr(as("owner").governance.recordLegalEvidence({ revisionId: "tr1", expectedVersion: 0, confirm: true, idempotencyKey: "idem-ev-1", evidence: { sourceLogicalVersion: "v", sourceSha256: "a".repeat(64) } } as never));
    expect(r?.code).toBe("BAD_REQUEST");
    expect(r?.message).toMatch(/decision/);
  });
});
