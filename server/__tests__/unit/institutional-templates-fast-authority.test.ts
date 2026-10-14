/**
 * LICIGOV-FAST — autoridade ELETRÔNICA (domínio puro): o usuário autenticado é a identidade da decisão; nenhum ato administrativo é inventado.
 */
import { describe, expect, it } from "vitest";
import { ELECTRONIC_BASIS, electronicAuthority, resolveAuthority } from "../../services/institutionalTemplates/electronicAuthority";
import { validateDecisionRequest, type DecisionRequest } from "../../domain/institutionalDecision";

const base = { userId: 42, userName: "Maria Souza", userEmail: "maria@pref.gov.br", orgRole: "manager", today: "2026-10-14", action: "Aprovação do modelo" };

describe("electronicAuthority", () => {
  it("nome do usuário autenticado + papel no órgão + data do servidor; referência diz explicitamente que NENHUM ato foi informado", () => {
    const a = electronicAuthority(base);
    expect(a).toMatchObject({ decidedByName: "Maria Souza", decidedByRole: "Gestor do órgão (manager)", decidedByUserId: 42, decidedAt: "2026-10-14", basisReference: ELECTRONIC_BASIS });
    expect(ELECTRONIC_BASIS).toMatch(/nenhum ato administrativo informado/);
    expect(a.reason).toBe("Aprovação do modelo — registrado eletronicamente pelo usuário autenticado.");
  });
  it("sem nome ⇒ e-mail ⇒ #id (nunca vazio); sem papel ⇒ 'Usuário autenticado'; a observação do usuário vira a justificativa", () => {
    expect(electronicAuthority({ ...base, userName: "  ", userEmail: "x@y.gov.br" }).decidedByName).toBe("x@y.gov.br");
    expect(electronicAuthority({ ...base, userName: null, userEmail: null }).decidedByName).toBe("Usuário #42");
    expect(electronicAuthority({ ...base, orgRole: null }).decidedByRole).toBe("Usuário autenticado");
    expect(electronicAuthority({ ...base, note: "  Conferido com a equipe.  " }).reason).toBe("Conferido com a equipe.");
    expect(electronicAuthority({ ...base, note: "x".repeat(6000) }).reason).toHaveLength(5000);
  });
  it("a autoridade eletrônica SATISFAZ o contrato do ledger (nada é relaxado no backend)", () => {
    const a = electronicAuthority(base);
    const req: DecisionRequest = {
      organizationId: 9, subjectType: "institutional_template.approval", subjectId: "tr1", decisionType: "template_approval", outcome: "aprovado",
      decidedByName: a.decidedByName, decidedByRole: a.decidedByRole, decidedByUserId: a.decidedByUserId ?? null, decidedAt: a.decidedAt, basisReference: a.basisReference, reason: a.reason,
      evidence: [], recordedByUserId: 42, expectedRevision: 0, idempotencyKey: "idem-key-1", correlationId: "c",
    };
    expect(validateDecisionRequest(req)).toEqual({ ok: true });
  });
  it("`decision` informada (fundamento institucional) PREVALECE e não é alterada; ausente ⇒ eletrônica", () => {
    const explicit = { decidedByName: "Ana", decidedByRole: "Secretária", decidedAt: "2026-10-01", basisReference: "Portaria 1/2026", reason: "Conforme portaria." };
    expect(resolveAuthority(explicit, base)).toBe(explicit);
    expect(resolveAuthority(undefined, base).basisReference).toBe(ELECTRONIC_BASIS);
  });
});
