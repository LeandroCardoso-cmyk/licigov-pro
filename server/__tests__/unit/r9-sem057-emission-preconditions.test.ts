/**
 * R9 / SEM-057 — pré-condições semânticas da emissão oficial (regra pura) + guard da UI.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { emissionBlockers, lineDiffStats, countReviewMarkers } from "../../domain/emissionPreconditions";

const base = { kind: "tr" as const, content: "TR limpo", contentHash: "h2", sourceState: "current", changedSourceLabels: [], trEmitted: false, lastEmittedContentHash: null, lastEmittedVersion: null };

describe("SEM-057 — bloqueios da emissão", () => {
  it("rascunho limpo, fontes atuais, nunca emitido ⇒ sem bloqueio", () => {
    expect(emissionBlockers(base)).toEqual([]);
  });
  it("[REVISAR] no conteúdo bloqueia e conta os marcadores", () => {
    expect(countReviewMarkers("a [REVISAR: x] b [REVISAR: y]")).toBe(2);
    expect(emissionBlockers({ ...base, content: "x [REVISAR: preço]" }).map((b) => b.code)).toEqual(["EMISSION_REVIEW_MARKERS"]);
  });
  it("fontes alteradas bloqueiam e dizem o que mudou", () => {
    const b = emissionBlockers({ ...base, sourceState: "source_changed", changedSourceLabels: ["ETP"] });
    expect(b).toEqual([expect.objectContaining({ code: "EMISSION_SOURCES_CHANGED", message: expect.stringContaining(": ETP") })]);
  });
  it("Edital sem TR emitido bloqueia; com TR emitido libera", () => {
    expect(emissionBlockers({ ...base, kind: "edital" }).map((b) => b.code)).toEqual(["EMISSION_TR_NOT_EMITTED"]);
    expect(emissionBlockers({ ...base, kind: "edital", trEmitted: true })).toEqual([]);
  });
  it("conteúdo idêntico à última emitida bloqueia (nada a emitir)", () => {
    expect(emissionBlockers({ ...base, lastEmittedContentHash: "h2", lastEmittedVersion: 3 })).toEqual([expect.objectContaining({ code: "EMISSION_NO_CHANGES", message: expect.stringContaining("v3") })]);
  });
  it("diff por linhas contra a última emitida", () => {
    expect(lineDiffStats(null, "a")).toBeNull();
    expect(lineDiffStats("a\nb\nc", "a\nB\nc\nd")).toEqual({ added: 2, removed: 1 });
  });
  it("UI: edição não salva e bloqueios desabilitam o botão de emissão", () => {
    const ui = readFileSync(resolve(__dirname, "../../../client/src/components/procurement/OfficialPromotionSection.tsx"), "utf8");
    expect(ui).toContain("blockers.length === 0 && !hasUnsavedEdits");
    for (const ws of ["ETPWorkspace", "TRWorkspace", "EditalWorkspace"]) {
      const src = readFileSync(resolve(__dirname, `../../../client/src/components/procurement/${ws}.tsx`), "utf8");
      expect(src).toContain("onDirtyChange={setEditorDirty}");
      expect(src).toContain("hasUnsavedEdits={editorDirty}");
    }
  });
});
