/**
 * Modelos Institucionais — Lane C: peças de suporte (flag, ids, catálogo de decisões, matriz de papéis, fronteira de escopo).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const flags = vi.hoisted(() => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock("../../services/featureFlagService", () => flags);

import { FF_INSTITUTIONAL_TEMPLATES_V1, platformTemplatesFlagPort, randomIds, systemClock } from "../../services/institutionalTemplates/portsRegistry";
import { TEMPLATE_ACTION_MIN_ROLE, assertHumanActor } from "../../services/institutionalTemplates/authority";
import { TEMPLATE_ID_RE } from "../../domain/institutionalTemplates";
import { DECISION_OUTCOMES, DECISION_SUBJECT_TYPES, decisionId, planDecision, validateDecisionRequest, type DecisionRequest } from "../../domain/institutionalDecision";

describe("flag tenant-scoped (default OFF, sem rollout percentual próprio)", () => {
  it("usa o mecanismo existente da plataforma com o nome no padrão FF_*; OFF por padrão; consulta por organização", async () => {
    expect(FF_INSTITUTIONAL_TEMPLATES_V1).toBe("FF_INSTITUTIONAL_TEMPLATES_V1");
    expect(await platformTemplatesFlagPort().isEnabled(5)).toBe(false);
    expect(flags.isFeatureEnabled).toHaveBeenCalledWith("FF_INSTITUTIONAL_TEMPLATES_V1", 5);
    flags.isFeatureEnabled.mockResolvedValueOnce(true);
    expect(await platformTemplatesFlagPort().isEnabled(6)).toBe(true);
    expect(flags.isFeatureEnabled).toHaveBeenLastCalledWith("FF_INSTITUTIONAL_TEMPLATES_V1", 6);
  });

  it("o módulo não cria um segundo sistema de flags (sem tabela, sem percentual próprio)", () => {
    const src = readFileSync(path.resolve("server/services/institutionalTemplates/portsRegistry.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/percentage|Math\.random|tenant_feature_flags|featureFlags\b/);
  });
});

describe("ids e relógio", () => {
  it("ids novos cabem em varchar(24) e respeitam o contrato de id do domínio; são distintos", () => {
    const ids = new Set(Array.from({ length: 200 }, () => randomIds.newId("tr")));
    expect(ids.size).toBe(200);
    for (const id of ids) { expect(id.length).toBeLessThanOrEqual(24); expect(TEMPLATE_ID_RE.test(id)).toBe(true); expect(id.startsWith("tr")).toBe(true); }
    expect(randomIds.newId("ti")).toMatch(/^ti[0-9a-f]{20}$/);
    expect(systemClock.now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("decisões institucionais de modelo reutilizam o ledger existente (catálogo estendido, sem ledger paralelo)", () => {
  const base: DecisionRequest = {
    organizationId: 9, subjectType: "institutional_template.approval", subjectId: "tr0001", decisionType: "template_approval", outcome: "aprovado",
    decidedByName: "Maria Souza", decidedByRole: "Procuradora", decidedByUserId: null, decidedAt: "2026-10-06", basisReference: "Portaria 1/2026",
    reason: "Conferido pela assessoria.", evidence: [], recordedByUserId: 10, expectedRevision: 0, idempotencyKey: "idem-key-1", correlationId: "c",
  };

  it("aprovação, publicação e depreciação são tipos e resultados DISTINTOS e explícitos (sem resultado padrão)", () => {
    expect(DECISION_OUTCOMES.template_approval).toEqual(["aprovado"]);
    expect(DECISION_OUTCOMES.template_publication).toEqual(["publicado"]);
    expect(DECISION_OUTCOMES.template_deprecation).toEqual(["depreciado"]);
    expect(DECISION_SUBJECT_TYPES).toEqual(expect.arrayContaining(["direct_procurement.ratification", "institutional_template.approval", "institutional_template.publication", "institutional_template.deprecation"]));
    expect(validateDecisionRequest(base)).toEqual({ ok: true });
    expect(validateDecisionRequest({ ...base, outcome: "publicado" })).toMatchObject({ ok: false, code: "DECISION_OUTCOME_INVALID" });
    expect(validateDecisionRequest({ ...base, outcome: "" })).toMatchObject({ ok: false });
  });

  it("ids determinísticos por (organização, tipo, revisão do modelo): aprovação e publicação da mesma revisão têm ids diferentes", () => {
    const a = decisionId(9, "institutional_template.approval", "tr0001", 1);
    const p = decisionId(9, "institutional_template.publication", "tr0001", 1);
    expect(a).not.toBe(p);
    expect(a).toBe(decisionId(9, "institutional_template.approval", "tr0001", 1));
    expect(decisionId(10, "institutional_template.approval", "tr0001", 1)).not.toBe(a);
  });

  it("a decisão planejada registra autoridade declarada e NUNCA a marca como validada (política pendente); replay idempotente", () => {
    const plan = planDecision(base, { byIdempotencyKey: null, current: null });
    expect(plan.kind).toBe("insert");
    if (plan.kind !== "insert") return;
    expect(plan.decision).toMatchObject({ authorityValidation: "NOT_VALIDATED_POLICY_PENDING", decidedByName: "Maria Souza", recordedByUserId: 10, revision: 1 });
    expect(planDecision(base, { byIdempotencyKey: plan.decision, current: plan.decision }).kind).toBe("replay");
    expect(planDecision({ ...base, reason: "Outra justificativa totalmente diferente." }, { byIdempotencyKey: plan.decision, current: plan.decision }).kind).toBe("conflict");
  });
});

describe("matriz de papéis e autoridade humana", () => {
  it("pisos congelados: leitura/prévia=viewer, rascunho/importação=operator, aprovar/publicar/depreciar/vincular=manager", () => {
    expect(TEMPLATE_ACTION_MIN_ROLE).toEqual({
      read: "viewer", preview: "viewer", draft: "operator", import: "operator", approve: "manager", publish: "manager", deprecate: "manager", bind: "manager",
      // integração A+B+C: revisão humana do documento composto e geração por modelo (piso de edição, não competência jurídica)
      review: "operator", generate: "operator",
      // atos do órgão sobre fontes governadas e evidência de aprovação jurídica (piso técnico, não competência jurídica)
      govern: "manager",
    });
    expect(Object.isFrozen(TEMPLATE_ACTION_MIN_ROLE)).toBe(true);
  });

  it("assertHumanActor aceita apenas {kind:'human', userId inteiro > 0}", () => {
    expect(() => assertHumanActor({ kind: "human", userId: 3 })).not.toThrow();
    for (const bad of [null, undefined, {}, { kind: "ai", userId: 3 }, { kind: "system", userId: 1 }, { kind: "human", userId: 0 }, { kind: "human", userId: -1 }, { kind: "human", userId: 1.5 }, { kind: "human", userId: "3" }]) {
      expect(() => assertHumanActor(bad as never), JSON.stringify(bad)).toThrow(/HUMAN_ACTION_REQUIRED/);
    }
  });
});

describe("escopo negativo da lane (sem schema, migration, FK nem Document Engine)", () => {
  const read = (rel: string) => readFileSync(path.resolve(rel), "utf8");
  it("o módulo não toca drizzle/schema nem usa SQL/DDL/FK", () => {
    for (const f of ["portsRegistry", "workflowService", "importPipeline", "authority", "explainability", "astSummary", "ports", "errors"]) {
      const src = read(`server/services/institutionalTemplates/${f}.ts`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/drizzle-orm|mysqlTable|FOREIGN KEY|CREATE TABLE|ALTER TABLE|getDb\(|documentEngineService|officialDocumentLifecycleService/);
    }
  });
  it("não há publicação externa (PNCP/BLL/Diário/Portal) no módulo", () => {
    for (const f of ["workflowService", "importPipeline", "portsRegistry"]) {
      expect(read(`server/services/institutionalTemplates/${f}.ts`)).not.toMatch(/pncp|\bBLL\b|diario oficial|portal de transpar/i);
    }
  });
});
