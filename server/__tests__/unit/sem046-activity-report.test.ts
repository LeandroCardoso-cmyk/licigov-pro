/**
 * SEM-046 — projeção do relatório de atividades: só campos reais de `activity_logs`, nunca "Sistema"/texto inventado.
 */
import { describe, it, expect } from "vitest";
import { describeActivityDetails, toActivityReportEntry } from "../../services/activityReport";

const base = {
  id: 1, organizationId: 7, processId: 3, userId: 9, action: "baixou pacote de publicação", details: null,
  actorName: null, entityType: null, entityId: null, createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("toActivityReportEntry (SEM-046)", () => {
  it("userName: snapshot actorName > users.name > null (nunca 'Sistema')", () => {
    expect(toActivityReportEntry({ ...base, actorName: "Snapshot", userDisplayName: "Atual" }).userName).toBe("Snapshot");
    expect(toActivityReportEntry({ ...base, userDisplayName: "Atual" }).userName).toBe("Atual");
    expect(toActivityReportEntry({ ...base, actorName: "  ", userDisplayName: null }).userName).toBeNull();
  });

  it("description: texto simples como está; JSON vira 'chave: valor'; vazio/ausente ⇒ null", () => {
    expect(describeActivityDetails("Contrato assinado")).toBe("Contrato assinado");
    expect(describeActivityDetails(JSON.stringify({ filename: "a.zip", n: 2, vazio: "", nulo: null, obj: { x: 1 } }))).toBe('filename: a.zip; n: 2; obj: {"x":1}');
    expect(describeActivityDetails("{ texto que só começa com chave")).toBe("{ texto que só começa com chave");
    expect(describeActivityDetails("   ")).toBeNull();
    expect(describeActivityDetails(null)).toBeNull();
  });

  it("description longa é truncada; campos de identidade/tenant são preservados", () => {
    const long = "x".repeat(900);
    expect(describeActivityDetails(long)!.length).toBe(501);
    const e = toActivityReportEntry({ ...base, details: "ok" });
    expect(e).toMatchObject({ id: 1, organizationId: 7, processId: 3, userId: 9, action: "baixou pacote de publicação", description: "ok" });
  });
});
