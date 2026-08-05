/**
 * PR B.2.2 — Testes puros da máquina de fases (derivePhase) e vocabulário institucional.
 */
import { describe, it, expect } from "vitest";
import { derivePhase, PHASE_META, INSTITUTIONAL_COPY, type IngestionPhase } from "./status";

describe("derivePhase", () => {
  it("mapeia estados de processamento para 'processing'", () => {
    for (const s of ["parsing", "extracted", "normalized"] as const) {
      expect(derivePhase({ status: s })).toBe("processing");
    }
  });
  it("uploaded/queued/approved/rejected/archived mapeiam diretamente", () => {
    expect(derivePhase({ status: "uploaded" })).toBe("uploaded");
    expect(derivePhase({ status: "queued" })).toBe("queued");
    expect(derivePhase({ status: "approved" })).toBe("approved");
    expect(derivePhase({ status: "rejected" })).toBe("rejected");
    expect(derivePhase({ status: "archived" })).toBe("archived");
  });
  it("awaiting_review deriva partially/reviewed a partir do staging", () => {
    expect(derivePhase({ status: "awaiting_review", total: 0, pending: 0 })).toBe("awaiting_review");
    expect(derivePhase({ status: "awaiting_review", total: 5, pending: 3 })).toBe("partially_reviewed");
    expect(derivePhase({ status: "awaiting_review", total: 5, pending: 0 })).toBe("reviewed");
  });
  it("failed vira DLQ quando as tentativas se esgotam (>=3)", () => {
    expect(derivePhase({ status: "failed", retryCount: 0 })).toBe("failed");
    expect(derivePhase({ status: "failed", retryCount: 3 })).toBe("dlq");
  });
});

describe("PHASE_META / INSTITUTIONAL_COPY", () => {
  it("toda fase tem metadados (label/description/tone)", () => {
    const phases: IngestionPhase[] = [
      "idle", "preparing", "uploading", "uploaded", "queued", "processing",
      "awaiting_review", "partially_reviewed", "reviewed", "approved", "rejected", "failed", "dlq", "archived",
    ];
    for (const p of phases) {
      expect(PHASE_META[p]?.label, `fase ${p}`).toBeTruthy();
      expect(PHASE_META[p]?.description).toBeTruthy();
    }
  });
  it("aprovação NÃO é apresentada como documento oficial (linguagem institucional)", () => {
    expect(PHASE_META.approved.description).toMatch(/etapa posterior/i);
    expect(INSTITUTIONAL_COPY.notOfficialYet).toMatch(/NÃO transforma o conteúdo em documento oficial/i);
    // Não usa linguagem imprópria.
    const allCopy = Object.values(INSTITUTIONAL_COPY).join(" ") + Object.values(PHASE_META).map(m => m.description).join(" ");
    expect(allCopy).not.toMatch(/IA decidiu|aprovado automaticamente|validado juridicamente/i);
  });
});
