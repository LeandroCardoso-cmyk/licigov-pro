/**
 * Pilot Reset B2/B3 — regra pura do lifecycle (server/domain/processLifecycle.ts).
 */
import { describe, it, expect } from "vitest";
import {
  FORMAL_DOMAINS, WORK_DOMAINS, eligibilityDigest, evaluateEligibility, generationProcessId, lineageIdFor,
  validateLifecycleRequest, type LifecycleSnapshot,
} from "../../domain/processLifecycle";

const zero = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
const snap = (over: Partial<LifecycleSnapshot> = {}): LifecycleSnapshot => ({
  processId: "p1", organizationId: 1, processNumber: "SINT/1", status: "rascunho", currentStage: "DFD", lineageId: null,
  generationNo: 1, lifecycleState: "active", lifecycleRevision: 0, formal: zero(FORMAL_DOMAINS), work: zero(WORK_DOMAINS), ...over,
});

describe("Pilot Reset — elegibilidade e digest (puros)", () => {
  it("rascunho sem trabalho: todas as ações elegíveis", () => {
    for (const a of ["CORRECT_NUMBER", "DISCARD_DRAFT", "RESET_DRAFT", "CANCEL", "ARCHIVE"] as const) {
      expect(evaluateEligibility(snap(), a).eligible, a).toBe(true);
    }
  });

  it("estado de piloto (trabalho): RESET elegível, DISCARD não (RESET_ELIGIBLE / NOT DISCARD_ELIGIBLE)", () => {
    const s = snap({ work: { ...zero(WORK_DOMAINS), generated_documents: 2, price_research: 1, catmat_decisions: 3 } });
    expect(evaluateEligibility(s, "RESET_DRAFT")).toMatchObject({ eligible: true, blockers: [] });
    expect(evaluateEligibility(s, "DISCARD_DRAFT")).toMatchObject({ eligible: false, blockers: ["WORK_STATE_BLOCKS_DISCARD"] });
  });

  it("qualquer estado formal bloqueia reset/descarte/correção, com o código do domínio; arquivar continua possível", () => {
    for (const d of FORMAL_DOMAINS) {
      const s = snap({ formal: { ...zero(FORMAL_DOMAINS), [d]: 1 } });
      for (const a of ["RESET_DRAFT", "DISCARD_DRAFT", "CORRECT_NUMBER"] as const) {
        const e = evaluateEligibility(s, a);
        expect(e.eligible, `${d} ${a}`).toBe(false);
        expect(e.blockers).toContain("OFFICIAL_STATE_BLOCKS_RESET");
      }
      expect(evaluateEligibility(s, "ARCHIVE").eligible).toBe(true);
    }
  });

  it("geração não ativa é imutável: nenhuma ação", () => {
    for (const st of ["superseded", "discarded", "cancelled", "archived"] as const) {
      expect(evaluateEligibility(snap({ lifecycleState: st }), "ARCHIVE")).toMatchObject({ eligible: false, blockers: ["PROCESS_GENERATION_NOT_ACTIVE"] });
    }
  });

  it("digest é determinístico e muda com qualquer contagem, revisão, número ou ação", () => {
    const s = snap();
    expect(eligibilityDigest(s, "RESET_DRAFT")).toBe(eligibilityDigest(snap(), "RESET_DRAFT"));
    for (const changed of [
      snap({ work: { ...zero(WORK_DOMAINS), timeline_after_create: 1 } }), snap({ lifecycleRevision: 1 }), snap({ processNumber: "SINT/2" }),
    ]) expect(eligibilityDigest(changed, "RESET_DRAFT")).not.toBe(eligibilityDigest(s, "RESET_DRAFT"));
    expect(eligibilityDigest(s, "ARCHIVE")).not.toBe(eligibilityDigest(s, "RESET_DRAFT"));
  });

  it("identidades opacas: linhagem e nova geração nunca derivam do número", () => {
    const l = lineageIdFor(1, "p1");
    expect(l).toMatch(/^pln_[0-9a-f]{20}$/);
    expect(generationProcessId(1, l, 2)).not.toBe(generationProcessId(1, l, 3));
    expect(generationProcessId(1, l, 2)).toMatch(/^[0-9a-f]{20}$/);
  });

  it("execução exige revisão, digest do preview, chave e motivo; correção exige o novo número", () => {
    const base = { organizationId: 1, processId: "p1", action: "RESET_DRAFT" as const, expectedRevision: 0, expectedEligibilityDigest: "a".repeat(64), idempotencyKey: "key-00000001", reason: "Motivo suficiente.", actorUserId: 9 };
    expect(validateLifecycleRequest(base)).toEqual({ ok: true });
    expect(validateLifecycleRequest({ ...base, reason: "curto", expectedEligibilityDigest: "x", idempotencyKey: "k" }))
      .toMatchObject({ ok: false, fields: ["expectedEligibilityDigest", "idempotencyKey", "reason"] });
    expect(validateLifecycleRequest({ ...base, action: "CORRECT_NUMBER" })).toMatchObject({ ok: false, fields: ["newProcessNumber"] });
  });
});
