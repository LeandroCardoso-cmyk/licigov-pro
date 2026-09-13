/**
 * PHASE A3 — Testes do runner de homologação (guarda staging-only, logger sanitizado, agregador,
 * avaliação de proveniência). Unit/puro, sem DB e sem execução LIVE — o `main()` do script NUNCA
 * roda em import (guarda `invokedDirectly`). Cobre §13 do handoff A3.
 */
import { describe, it, expect } from "vitest";
import type { CognitiveProvenanceRecord } from "../../db/cognitiveProvenance";
import {
  isHomologAllowed,
  buildHomologLogLine,
  aggregateOk,
  evaluateProvenance,
  evaluateCatmatResult,
  HOMOLOG_TENANT_ID,
  HOMOLOG_ACTOR_USER_ID,
  EXPECTED_MODEL,
  type HomologEnvelope,
} from "../../../scripts/a3-homologation";
import type { CatmatMatch } from "../../services/catmatMatcher";

// Proveniência canônica de sucesso (CATMAT: not_applicable + evidenceFingerprint null).
function provRec(over: Partial<CognitiveProvenanceRecord> = {}): CognitiveProvenanceRecord {
  return {
    organizationId: HOMOLOG_TENANT_ID,
    correlationId: "a3-homolog-catmat-r1",
    task: "CATMAT_MATCHING",
    executionMode: "cognitive",
    executionStatus: "completed",
    provider: "gemini",
    model: EXPECTED_MODEL,
    actorUserId: String(HOMOLOG_ACTOR_USER_ID),
    approvalState: "generated",
    isReplay: 0,
    groundingState: "not_applicable",
    evidenceFingerprint: null,
    ...over,
  } as unknown as CognitiveProvenanceRecord;
}

const catmatExp = { tenantId: HOMOLOG_TENANT_ID, actorUserId: HOMOLOG_ACTOR_USER_ID, task: "CATMAT_MATCHING", correlationId: "a3-homolog-catmat-r1", grounding: "not_applicable_strict" as const };

describe("A3 homologation — guarda staging-only", () => {
  it("permite APENAS staging + flag explícita", () => {
    expect(isHomologAllowed("staging", "1")).toBe(true);
  });
  it("rejeita produção mesmo com a flag (sem override)", () => {
    expect(isHomologAllowed("production", "1")).toBe(false);
  });
  it("rejeita development e ausência de flag", () => {
    expect(isHomologAllowed("development", "1")).toBe(false);
    expect(isHomologAllowed("staging", undefined)).toBe(false);
    expect(isHomologAllowed("staging", "0")).toBe(false);
    expect(isHomologAllowed("staging", "true")).toBe(false);
  });
});

describe("A3 homologation — logger sanitizado", () => {
  it("emite o prefixo e os campos da allowlist", () => {
    const line = buildHomologLogLine({ ok: true, runId: "r1", flow: "catmat", task: "CATMAT_MATCHING", provider: "gemini", model: EXPECTED_MODEL, tenantId: HOMOLOG_TENANT_ID, correlationId: "c1" });
    expect(line.startsWith("[A3-LIVE-HOMOLOG] ")).toBe(true);
    expect(line).toContain("\"provider\":\"gemini\"");
    expect(line).toContain(EXPECTED_MODEL);
  });
  it("NUNCA inclui segredos passados fora da allowlist", () => {
    const dirty = { ok: true, runId: "r1", flow: "catmat", apiKey: "AIzaSECRET", databaseUrl: "mysql://u:p@h/db", password: "hunter2" } as unknown as HomologEnvelope;
    const line = buildHomologLogLine(dirty);
    expect(line).not.toContain("AIzaSECRET");
    expect(line).not.toContain("mysql://");
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("apiKey");
  });
});

describe("A3 homologation — agregador (só ok com os 4 fluxos)", () => {
  it("ok apenas quando há 4 fluxos e todos passam", () => {
    expect(aggregateOk([{ ok: true }, { ok: true }, { ok: true }, { ok: true }])).toBe(true);
  });
  it("falha com menos de 4 ou qualquer fluxo reprovado", () => {
    expect(aggregateOk([{ ok: true }, { ok: true }, { ok: true }])).toBe(false);
    expect(aggregateOk([{ ok: true }, { ok: false }, { ok: true }, { ok: true }])).toBe(false);
    expect(aggregateOk([])).toBe(false);
  });
});

describe("A3 homologation — avaliação de proveniência (fail-closed)", () => {
  it("aprova proveniência CATMAT canônica (not_applicable + sem evidência)", () => {
    expect(evaluateProvenance(provRec(), catmatExp).ok).toBe(true);
  });
  it("proveniência ausente → provenance_not_found", () => {
    const r = evaluateProvenance(null, catmatExp);
    expect(r.ok).toBe(false);
    expect(r.problems).toContain("provenance_not_found");
  });
  it("modelo não pinado → model_not_pinned", () => {
    expect(evaluateProvenance(provRec({ model: "gemini-2.5-flash" }), catmatExp).problems).toContain("model_not_pinned");
  });
  it("grounding falso (grounded) é reprovado", () => {
    expect(evaluateProvenance(provRec({ groundingState: "grounded" }), catmatExp).problems).toContain("false_grounding");
  });
  it("evidenceFingerprint inesperado é reprovado", () => {
    expect(evaluateProvenance(provRec({ evidenceFingerprint: "abc" }), catmatExp).problems).toContain("unexpected_evidence_fingerprint");
  });
  it("provider não-gemini, replay inesperado e approval != generated são reprovados", () => {
    const r = evaluateProvenance(provRec({ provider: "openai", isReplay: 1, approvalState: "approved" }), catmatExp);
    expect(r.problems).toEqual(expect.arrayContaining(["provider_not_gemini", "unexpected_replay", "approval_not_generated"]));
  });
  it("tasks com grounding declarado sem evidência real → ungrounded/completed_degraded é HONESTO (aprova)", () => {
    const rec = provRec({ task: "PROCUREMENT_REASONING", correlationId: "a3-homolog-suggestion-r1", groundingState: "ungrounded", executionStatus: "completed_degraded" });
    const r = evaluateProvenance(rec, { tenantId: HOMOLOG_TENANT_ID, actorUserId: HOMOLOG_ACTOR_USER_ID, task: "PROCUREMENT_REASONING", correlationId: "a3-homolog-suggestion-r1", grounding: "not_grounded" });
    expect(r.ok).toBe(true);
  });
  it("execução failed é reprovada", () => {
    expect(evaluateProvenance(provRec({ executionStatus: "failed" }), catmatExp).problems).toContain("execution_status_failed");
  });
});

describe("A3 homologation — avaliação do resultado CATMAT (§35)", () => {
  const mk = (n: number): CatmatMatch[] =>
    Array.from({ length: n }, (_, i) => ({ code: `10000${i}`, description: `cand ${i}`, confidence: 60, reasoning: "x", requiresHumanValidation: true as const }));
  it("aprova 1..3 candidatos, todos requiresHumanValidation", () => {
    expect(evaluateCatmatResult(mk(3)).ok).toBe(true);
    expect(evaluateCatmatResult(mk(1)).ok).toBe(true);
  });
  it("reprova zero candidatos e mais de 3", () => {
    expect(evaluateCatmatResult(mk(0)).problems).toContain("no_candidates");
    expect(evaluateCatmatResult(mk(4)).problems).toContain("too_many_candidates");
  });
  it("reprova candidato sem a marca de validação humana", () => {
    const bad = [{ code: "1", description: "d", confidence: 50, reasoning: "r", requiresHumanValidation: false }] as unknown as CatmatMatch[];
    expect(evaluateCatmatResult(bad).problems).toContain("missing_human_validation_flag");
  });
});
