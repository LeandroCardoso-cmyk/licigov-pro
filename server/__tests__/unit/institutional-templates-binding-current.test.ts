/**
 * Resolução OPERACIONAL (estado corrente) × HISTÓRICA (asOf explícito) — domínio puro.
 * Contrato de linearização: o vínculo ATIVO lido de forma consistente é o vigente; `effectiveFrom` é carimbo informativo e só filtra com `asOf` explícito.
 */
import { describe, expect, it } from "vitest";
import { resolveCurrentTemplateBinding, resolveTemplateBinding, type TemplateBinding } from "../../domain/institutionalTemplates/binding";
import type { TemplateRevision } from "../../domain/institutionalTemplates/revision";

const ORG = 7;
const scope = { modality: "pregao", form: "eletronica", platform: "bll" };
const revision = (id: string, status: TemplateRevision["status"] = "PUBLISHED"): TemplateRevision => ({ id, identityId: "ti1", organizationId: ORG, revision: 1, status, semanticHash: "a".repeat(64) } as unknown as TemplateRevision);
const binding = (over: Partial<TemplateBinding> = {}): TemplateBinding => ({ id: "tb1", organizationId: ORG, documentKind: "edital", scope, identityId: "ti1", pinnedRevisionId: "tr1", active: true, effectiveFrom: "2026-10-13T12:00:00.001Z", ...over });
const req = { organizationId: ORG, documentKind: "edital" as const, scope };

describe("resolveCurrentTemplateBinding × resolveTemplateBinding", () => {
  it("o vínculo ativo com vigência 'no futuro' do relógio do leitor está em vigor no estado corrente (sem janela NOT_BOUND)", () => {
    const b = binding({ effectiveFrom: "2099-01-01T00:00:00.000Z" });
    expect(resolveCurrentTemplateBinding(req, [b], [revision("tr1")])).toMatchObject({ status: "RESOLVED" });
    // consulta histórica explícita antes da vigência NÃO retroage
    expect(resolveTemplateBinding({ ...req, asOf: "2026-10-13T12:00:00.000Z" }, [b], [revision("tr1")]).status).toBe("NOT_BOUND");
    expect(resolveTemplateBinding({ ...req, asOf: "2099-01-01T00:00:00.000Z" }, [b], [revision("tr1")]).status).toBe("RESOLVED");
  });
  it("demais regras idênticas: inativo ⇒ NOT_BOUND; escopo exato; dois ativos ⇒ AMBIGUOUS; pin obrigatório; revisão PUBLISHED; tenant exato", () => {
    expect(resolveCurrentTemplateBinding(req, [binding({ active: false })], [revision("tr1")]).status).toBe("NOT_BOUND");
    expect(resolveCurrentTemplateBinding({ ...req, scope: { ...scope, platform: "licitanet" } }, [binding()], [revision("tr1")]).status).toBe("NOT_BOUND");
    expect(resolveCurrentTemplateBinding(req, [binding(), binding({ id: "tb2" })], [revision("tr1")])).toMatchObject({ status: "AMBIGUOUS", bindingIds: ["tb1", "tb2"] });
    expect(resolveCurrentTemplateBinding(req, [binding({ pinnedRevisionId: undefined })], [revision("tr1")]).status).toBe("INVALID");
    expect(resolveCurrentTemplateBinding(req, [binding()], [revision("tr1", "DEPRECATED")]).status).toBe("INVALID");
    expect(resolveCurrentTemplateBinding(req, [binding({ organizationId: 8 })], [revision("tr1")]).status).toBe("INVALID");
    expect(resolveCurrentTemplateBinding({ ...req, organizationId: 8 }, [binding()], [revision("tr1")]).status).toBe("INVALID");
  });
  it("effectiveFrom malformado continua fail-closed", () => {
    expect(resolveCurrentTemplateBinding(req, [binding({ effectiveFrom: "ontem" })], [revision("tr1")]).status).toBe("INVALID");
  });
});
