import { describe, it, expect } from "vitest";
import {
  buildRoles, buildTrValues, changedRoles, defaultConsentText, profileAsPrepView, roleToForm, trConfirmedFields, trFormValue, trOptionalFields,
  trParamToPrepField, trPendingFields, trProposals, withDefault, withoutDefault,
  type DefaultViewModel, type TrParamViewModel,
} from "./contextReuse";
import { buildSavePlan, type PrepField } from "./editalPreparation";

const tr = (over: Partial<TrParamViewModel>): TrParamViewModel => ({
  name: "contratacao.prazoExecucao", path: "prazoExecucao", type: "duration", description: "Prazo de execução", required: true, conditional: false,
  requiredWhenVariables: [], active: true, status: "UNSET", defaultEligible: false, ...over,
});

describe("Parâmetros estruturados do TR (UI)", () => {
  it("separa pendentes, opcionais, confirmados e propostas de padrão institucional", () => {
    const fields = [
      tr({ name: "a", status: "UNSET" }),
      tr({ name: "b", status: "SET", value: { amount: 3, unit: "day" } }),
      tr({ name: "c", required: false, status: "UNSET" }),
      tr({ name: "d", conditional: true, required: false, active: false, status: "UNSET" }),
      tr({ name: "e", conditional: true, required: false, active: true, status: "UNSET" }),
      tr({ name: "f", status: "UNSET", proposal: { value: { amount: 30, unit: "day" }, orgProfileRevision: 4 } }),
    ];
    expect(trPendingFields(fields).map((f) => f.name)).toEqual(["a", "e", "f"]);
    expect(trOptionalFields(fields).map((f) => f.name)).toEqual(["c"]);
    expect(trConfirmedFields(fields).map((f) => f.name)).toEqual(["b"]);
    expect(trProposals(fields).map((f) => f.name)).toEqual(["f"]);
  });

  it("converte a edição digitada no valor canônico tipado; erro por campo; vazio é ignorado (limpar é ação própria)", () => {
    const fields = [tr({ name: "dur" }), tr({ name: "txt", type: "text", description: "Local" }), tr({ name: "flag", type: "boolean", description: "Exige amostra" })];
    const out = buildTrValues(fields, { dur: { amount: "30", unit: "day" }, txt: "Almoxarifado", flag: "true" });
    expect(out.errors).toEqual({});
    expect(out.values).toEqual({ dur: { amount: 30, unit: "day" }, txt: "Almoxarifado", flag: true });
    expect(buildTrValues(fields, { dur: { amount: "x", unit: "day" } }).errors.dur).toBeTruthy();
    expect(buildTrValues(fields, { dur: { amount: "", unit: "day" } })).toEqual({ values: {}, errors: {} });
    expect(trFormValue(tr({ status: "SET", value: { amount: 5, unit: "month" } }))).toEqual({ amount: "5", unit: "month" });
  });

  it("o descritor do TR alimenta o MESMO controle tipado da preparação", () => {
    const f = trParamToPrepField(tr({ status: "SET", value: { amount: 1, unit: "day" } }));
    expect(f).toMatchObject({ source: "TR", rule: "TR_PARAM", status: "UPSTREAM", hasValue: true, editable: true });
    expect(trParamToPrepField(tr({})).status).toBe("PENDING");
  });
});

describe("Papéis do Perfil de Licitações (UI)", () => {
  it("monta o mapa canônico; papel sem nome é omitido; campos sem nome é erro; datas inválidas são recusadas", () => {
    const forms = {
      PREGOEIRO: { name: " Beltrano ", cargo: "Pregoeiro", ato: "Portaria 1/2026", dataReferencia: "2026-01-02", vigenciaAte: "" },
      EQUIPE_DE_APOIO: { name: "", cargo: "", ato: "", dataReferencia: "", vigenciaAte: "" },
      AUTORIDADE_COMPETENTE: { name: "", cargo: "Secretário", ato: "", dataReferencia: "", vigenciaAte: "" },
      ASSINANTE_DO_EDITAL: { name: "X", cargo: "", ato: "", dataReferencia: "02/01/2026", vigenciaAte: "" },
    };
    const out = buildRoles(forms);
    expect(out.roles).toEqual({ PREGOEIRO: { name: "Beltrano", cargo: "Pregoeiro", ato: "Portaria 1/2026", dataReferencia: "2026-01-02" } });
    expect(Object.keys(out.errors).sort()).toEqual(["ASSINANTE_DO_EDITAL", "AUTORIDADE_COMPETENTE"]);
  });
  it("detecta só os papéis realmente alterados (nova revisão apenas quando muda)", () => {
    const cur = { PREGOEIRO: { name: "A", cargo: "P" }, EQUIPE_DE_APOIO: null };
    expect(changedRoles(cur, { PREGOEIRO: { name: "A", cargo: "P" } })).toEqual([]);
    expect(changedRoles(cur, { PREGOEIRO: { name: "B", cargo: "P" } })).toEqual(["PREGOEIRO"]);
    expect(changedRoles(cur, {})).toEqual(["PREGOEIRO"]);                          // remover também é alteração
    expect(roleToForm(null)).toEqual({ name: "", cargo: "", ato: "", dataReferencia: "", vigenciaAte: "" });
  });
});

describe("Perfil → plano de salvar da preparação; padrões institucionais", () => {
  const field = (over: Partial<PrepField>): PrepField => ({
    name: "sancoes.multaMoraPercentual", source: "POLICY", path: "multaMoraPercentual", type: "percent", description: "Multa de mora", required: true, conditional: false,
    requiredWhenVariables: [], hasValue: false, class: "ORG_PROFILE", rule: "ORG_SOURCE", status: "PENDING", editable: true, ...over,
  });
  it("reutiliza buildSavePlan: escrita ORG com CAS do órgão; nada de processo", () => {
    const view = profileAsPrepView({ catalogVersion: "tpl-catalog/2@x", revision: 4, sections: [{ source: "POLICY", scope: "ORG", fields: [field({})], pendingRequired: 1 }] });
    expect(view.revisions).toEqual({ process: 0, organization: 4, budget: 0 });
    const plan = buildSavePlan(view, { edits: { POLICY: { multaMoraPercentual: "0,7" } }, disclosure: "", participationDefault: null });
    expect(plan.errors).toEqual({});
    expect(plan.writes.map((w) => [w.id, w.kind, w.fields])).toEqual([["ORG-POLICY", "ORG", { multaMoraPercentual: 0.7 }]]);
  });
  const d = (name: string, value: unknown, over: Partial<DefaultViewModel> = {}): DefaultViewModel => ({ name, description: name, type: "string", value, hasValue: true, ...over });
  it("adicionar/remover UM padrão preserva os demais; incompatível nunca é reenviado", () => {
    const cur = [d("a", 1), d("b", 2), d("c", 3, { incompatibleReason: "x" }), d("d", null, { hasValue: false })];
    expect(withDefault(cur, "e", 5)).toEqual({ a: 1, b: 2, e: 5 });
    expect(withDefault(cur, "a", 9)).toEqual({ a: 9, b: 2 });
    expect(withoutDefault(cur, "a")).toEqual({ b: 2 });
  });
  it("o consentimento mostra a política criada/atualizada ANTES de confirmar", () => {
    expect(defaultConsentText("Modo de disputa", "aberto", false)).toMatch(/^Criar o padrão institucional "Modo de disputa" = aberto\./);
    expect(defaultConsentText("Modo de disputa", "aberto", true)).toMatch(/^Atualizar /);
    expect(defaultConsentText("x", "y", false)).toContain("PRÓXIMOS processos");
  });
});
