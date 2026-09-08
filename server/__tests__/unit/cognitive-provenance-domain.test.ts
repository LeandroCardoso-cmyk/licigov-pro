/**
 * V1 PRE-PILOT CLOSURE — Fase A1 — testes do DOMÍNIO PURO de proveniência cognitiva.
 *
 * Cobre (sem DB): fingerprint de INPUT (canonicalização/ordem irrelevante), fingerprint de
 * EVIDÊNCIA (REGRA CONGELADA: order-independent, sensível a locator/conteúdo, estável a blockId),
 * fingerprint de OUTPUT (imutável), estado de GROUNDING honesto, estado DEGRADADO, classificação
 * de FALHA + sanitização, e determinismo do id/versões.
 */

import { describe, it, expect } from "vitest";
import {
  computeInputFingerprint, computeOutputFingerprint, computeEvidenceFingerprint,
  deriveGroundingState, deriveExecutionState, classifyFailure, sanitizeFailureMessage,
  provenanceId, evidenceRef,
  type SemanticCognitiveInput, type EvidenceRef,
} from "../../domain/cognitiveProvenance";

const baseInput: SemanticCognitiveInput = {
  tenantId: 7, task: "GENERATE_DOCUMENT", businessDomain: "processo_licitatorio",
  processId: "p1", query: "Elaborar ETP", documentRefs: ["d1", "d2"], lawRefs: ["lei 14.133 art. 18"],
};

describe("A1 · Cognitive Provenance — domínio puro", () => {
  // ── Input fingerprint ──────────────────────────────────────────────────────
  describe("computeInputFingerprint", () => {
    it("é determinístico (mesmo insumo → mesmo hash) e 64 hex", () => {
      const a = computeInputFingerprint(baseInput);
      const b = computeInputFingerprint({ ...baseInput });
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it("a ORDEM incidental das referências NÃO altera o fingerprint", () => {
      const a = computeInputFingerprint({ ...baseInput, documentRefs: ["d1", "d2"], lawRefs: ["x", "y"] });
      const b = computeInputFingerprint({ ...baseInput, documentRefs: ["d2", "d1"], lawRefs: ["y", "x"] });
      expect(a).toBe(b);
    });

    it("query/processo/tenant diferentes → fingerprint diferente", () => {
      expect(computeInputFingerprint(baseInput)).not.toBe(computeInputFingerprint({ ...baseInput, query: "Outro" }));
      expect(computeInputFingerprint(baseInput)).not.toBe(computeInputFingerprint({ ...baseInput, tenantId: 8 }));
      expect(computeInputFingerprint(baseInput)).not.toBe(computeInputFingerprint({ ...baseInput, processId: "p2" }));
    });

    it("NÃO depende de correlationId/tempo (não são parâmetros do tipo) — refs vazias vs ausentes iguais", () => {
      const a = computeInputFingerprint({ tenantId: 1, task: "T", query: "q" });
      const b = computeInputFingerprint({ tenantId: 1, task: "T", query: "q", documentRefs: [], lawRefs: [] });
      expect(a).toBe(b);
    });
  });

  // ── Output fingerprint ─────────────────────────────────────────────────────
  describe("computeOutputFingerprint", () => {
    it("determinístico e sensível ao conteúdo", () => {
      expect(computeOutputFingerprint("abc")).toBe(computeOutputFingerprint("abc"));
      expect(computeOutputFingerprint("abc")).not.toBe(computeOutputFingerprint("abd"));
      expect(computeOutputFingerprint("")).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ── Evidence fingerprint (REGRA CONGELADA) ─────────────────────────────────
  describe("computeEvidenceFingerprint (REGRA CONGELADA)", () => {
    const e1 = evidenceRef("lei_14133", "art. 18", "texto do art. 18");
    const e2 = evidenceRef("lei_14133", "art. 6, XXIII", "texto do art. 6");

    it("a ORDEM de recuperação é IRRELEVANTE (mesmo conjunto em ordem diferente → mesmo fingerprint)", () => {
      expect(computeEvidenceFingerprint([e1, e2])).toBe(computeEvidenceFingerprint([e2, e1]));
    });

    it("LOCATOR diferente → fingerprint DIFERENTE", () => {
      const a = computeEvidenceFingerprint([evidenceRef("lei_14133", "art. 18", "T")]);
      const b = computeEvidenceFingerprint([evidenceRef("lei_14133", "art. 19", "T")]);
      expect(a).not.toBe(b);
    });

    it("CONTEÚDO diferente (mesmo locator/fonte) → fingerprint DIFERENTE", () => {
      const a = computeEvidenceFingerprint([evidenceRef("lei_14133", "art. 18", "conteudo A")]);
      const b = computeEvidenceFingerprint([evidenceRef("lei_14133", "art. 18", "conteudo B")]);
      expect(a).not.toBe(b);
    });

    it("NÃO depende de blockId/posição: refs com o MESMO (fonte+locator+conteúdo) → MESMO fingerprint", () => {
      // Duas recuperações que diferem apenas por metadados de posição (não modelados) permanecem estáveis.
      const fromRetrievalA: EvidenceRef[] = [
        { sourceId: "lei_14133", locator: "art. 18", contentHash: evidenceRef("x", "y", "conteudo").contentHash },
      ];
      const fromRetrievalB: EvidenceRef[] = [
        { sourceId: "lei_14133", locator: "art. 18", contentHash: evidenceRef("z", "w", "conteudo").contentHash },
      ];
      expect(computeEvidenceFingerprint(fromRetrievalA)).toBe(computeEvidenceFingerprint(fromRetrievalB));
    });

    it("conjunto VAZIO → sentinela determinística, distinta de qualquer conjunto real", () => {
      const empty = computeEvidenceFingerprint([]);
      expect(empty).toMatch(/^[0-9a-f]{64}$/);
      expect(empty).not.toBe(computeEvidenceFingerprint([e1]));
      expect(empty).toBe(computeEvidenceFingerprint([]));
    });

    it("duplicatas exatas colapsam (dedupe) — não inflam o fingerprint", () => {
      expect(computeEvidenceFingerprint([e1, e1])).toBe(computeEvidenceFingerprint([e1]));
    });
  });

  // ── Grounding state (honesto) ──────────────────────────────────────────────
  describe("deriveGroundingState (honesto)", () => {
    it("sem grounding e sem RAG → not_applicable (task determinística)", () => {
      expect(deriveGroundingState({ usesGrounding: false, usesRAG: false, evidenceCount: 0, evidenceComplete: false })).toBe("not_applicable");
    });
    it("grounding exigido mas SEM evidência real → ungrounded (referências no prompt NÃO bastam)", () => {
      expect(deriveGroundingState({ usesGrounding: true, usesRAG: false, evidenceCount: 0, evidenceComplete: false })).toBe("ungrounded");
    });
    it("evidência real completa → grounded; incompleta → partially_grounded", () => {
      expect(deriveGroundingState({ usesGrounding: true, usesRAG: true, evidenceCount: 3, evidenceComplete: true })).toBe("grounded");
      expect(deriveGroundingState({ usesGrounding: true, usesRAG: true, evidenceCount: 1, evidenceComplete: false })).toBe("partially_grounded");
    });
  });

  // ── Estado degradado (explícito) ───────────────────────────────────────────
  describe("deriveExecutionState (degradação explícita)", () => {
    it("finishReason=max_tokens → completed_degraded/partial_output", () => {
      const s = deriveExecutionState({ finishReason: "max_tokens", usesGrounding: false, usesRAG: false, evidenceCount: 0, evidenceComplete: false });
      expect(s.status).toBe("completed_degraded");
      expect(s.degradationReason).toBe("partial_output");
    });
    it("grounding exigido sem evidência → completed_degraded/grounding_unavailable (não fundamentado)", () => {
      const s = deriveExecutionState({ finishReason: "stop", usesGrounding: true, usesRAG: false, evidenceCount: 0, evidenceComplete: false });
      expect(s.status).toBe("completed_degraded");
      expect(s.degradationReason).toBe("grounding_unavailable");
      expect(s.groundingState).toBe("ungrounded");
    });
    it("evidência incompleta → completed_degraded/evidence_insufficient", () => {
      const s = deriveExecutionState({ finishReason: "stop", usesGrounding: true, usesRAG: false, evidenceCount: 1, evidenceComplete: false });
      expect(s.status).toBe("completed_degraded");
      expect(s.degradationReason).toBe("evidence_insufficient");
    });
    it("task sem grounding e resposta plena → completed/sem motivo", () => {
      const s = deriveExecutionState({ finishReason: "stop", usesGrounding: false, usesRAG: false, evidenceCount: 0, evidenceComplete: false });
      expect(s.status).toBe("completed");
      expect(s.degradationReason).toBeNull();
      expect(s.groundingState).toBe("not_applicable");
    });
  });

  // ── Classificação de falha + sanitização ───────────────────────────────────
  describe("classifyFailure (governável) + sanitização", () => {
    it("classifica timeout/auth/unavailable/grounding/invalid/policy em conjunto pequeno", () => {
      expect(classifyFailure(new Error("Request timeout after 30s")).failureClass).toBe("provider_timeout");
      expect(classifyFailure(new Error("401 invalid api key")).failureClass).toBe("provider_auth_error");
      expect(classifyFailure(new Error("ECONNREFUSED upstream unavailable")).failureClass).toBe("provider_unavailable");
      expect(classifyFailure(new Error("grounding corpus missing")).failureClass).toBe("grounding_unavailable");
      expect(classifyFailure(new Error("STRUCTURED_OUTPUT_INVALID: schema")).failureClass).toBe("invalid_input");
      expect(classifyFailure(new Error("Domínio X não autorizado")).failureClass).toBe("policy_rejected");
      expect(classifyFailure(new Error("something odd")).failureClass).toBe("internal_failure");
    });
    it("sanitiza segredos/URLs de conexão/tokens longos e limita o tamanho", () => {
      const raw = "connect mysql://root:senha123@db.internal:3306/licigov failed api_key=SUPERSECRETVALUE1234567890ABC";
      const m = sanitizeFailureMessage(raw);
      expect(m).not.toContain("mysql://");
      expect(m).not.toContain("senha123");
      expect(m).not.toContain("SUPERSECRETVALUE1234567890ABC");
      expect(m).toContain("[redacted");
      expect(m.length).toBeLessThanOrEqual(301);
    });
  });

  // ── Determinismo do id / versões ───────────────────────────────────────────
  describe("provenanceId", () => {
    it("determinístico e distingue original de replay", () => {
      const orig = provenanceId({ organizationId: 1, executionId: "exec1", replayHash: "rh", isReplay: false });
      const orig2 = provenanceId({ organizationId: 1, executionId: "exec1", replayHash: "rh", isReplay: false });
      const replay = provenanceId({ organizationId: 1, executionId: "exec1", replayHash: "rh", isReplay: true });
      expect(orig).toBe(orig2);
      expect(orig).not.toBe(replay);
      expect(orig).toMatch(/^[0-9a-f]{24}$/);
    });
    it("tenant diferente → id diferente (isolamento)", () => {
      const a = provenanceId({ organizationId: 1, executionId: "e", replayHash: "r", isReplay: false });
      const b = provenanceId({ organizationId: 2, executionId: "e", replayHash: "r", isReplay: false });
      expect(a).not.toBe(b);
    });
  });
});
