/**
 * PR A.1 (refinamento) — utils/orgRoleLabels.ts. Garante a nomenclatura institucional exibida na
 * UI e que `owner` NUNCA aparece como "Proprietário(a)".
 */

import { describe, it, expect } from "vitest";
import { ORG_ROLE_LABELS, ORG_ROLE_LABELS_SHORT, orgRoleLabel, orgRoleLabelShort } from "./orgRoleLabels";

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

  it("SHORT (tabela): owner vira 'Administrador' (curto); descritivo mantém 'Administrador da Organização'", () => {
    expect(ORG_ROLE_LABELS_SHORT.owner).toBe("Administrador");
    expect(ORG_ROLE_LABELS.owner).toBe("Administrador da Organização");
    expect(orgRoleLabelShort("owner")).toBe("Administrador");
    // Demais papéis: curto == descritivo.
    for (const r of ["admin", "manager", "operator", "viewer"] as const) {
      expect(ORG_ROLE_LABELS_SHORT[r]).toBe(ORG_ROLE_LABELS[r]);
    }
  });
});
