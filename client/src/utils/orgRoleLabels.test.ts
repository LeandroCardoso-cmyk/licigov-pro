/**
 * PR A.1 (refinamento) — utils/orgRoleLabels.ts. Garante a nomenclatura institucional exibida na
 * UI e que `owner` NUNCA aparece como "Proprietário(a)".
 */

import { describe, it, expect } from "vitest";
import { ORG_ROLE_LABELS, orgRoleLabel } from "./orgRoleLabels";

describe("orgRoleLabels", () => {
  it("owner é 'Administrador da Organização' — nunca 'Proprietário(a)'", () => {
    expect(ORG_ROLE_LABELS.owner).toBe("Administrador da Organização");
    expect(ORG_ROLE_LABELS.owner).not.toMatch(/propriet/i);
  });

  it("nomenclatura institucional sem sufixo gendrado '(a)'", () => {
    for (const label of Object.values(ORG_ROLE_LABELS)) {
      expect(label).not.toContain("(a)");
    }
  });

  it("mapa completo dos 5 papéis", () => {
    expect(ORG_ROLE_LABELS).toEqual({
      owner: "Administrador da Organização",
      admin: "Administrador",
      manager: "Gestor",
      operator: "Operador",
      viewer: "Visualizador",
    });
  });

  it("orgRoleLabel: papel conhecido → rótulo; desconhecido → o próprio valor (defensivo)", () => {
    expect(orgRoleLabel("operator")).toBe("Operador");
    expect(orgRoleLabel("desconhecido")).toBe("desconhecido");
  });
});
