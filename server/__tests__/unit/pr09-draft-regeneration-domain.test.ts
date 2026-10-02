/**
 * PR-09 (SEM-014 / SEM-009) — regras PURAS de preservação do estado humano e dos parâmetros do Edital.
 */
import { describe, it, expect } from "vitest";
import {
  classifyDraftHumanState, humanEditRefusalMessage, resolveEditalParameters, persistedEditalParameters,
  HUMAN_EDIT_WOULD_BE_OVERWRITTEN, EDITAL_PARAMETERS_REQUIRED, EDITAL_PARAMETERS_CHANGED,
} from "../../domain/draftRegeneration";
import { draftContentHash } from "../../domain/generatedDocument";

const content = "# ETP\nSeção 5 reescrita pelo jurista.";
const edit = (operation: string, c = content) => ({ operation, actorUserId: 9, newContentHash: draftContentHash(c), createdAt: "2026-09-01T10:00:00.000Z" });

describe("classifyDraftHumanState", () => {
  it("sem ledger e sem marcador humano ⇒ conteúdo de IA (criação por geração)", () => {
    expect(classifyDraftHumanState({ content, sources: ["grounding:grounded"] }, null)).toEqual({ human: false });
  });

  it("último ledger ai_regenerate com hash vigente ⇒ IA", () => {
    expect(classifyDraftHumanState({ content, sources: [] }, edit("ai_regenerate")).human).toBe(false);
  });

  it("último ledger human_edit ⇒ humano (ator + data do ledger)", () => {
    expect(classifyDraftHumanState({ content, sources: [] }, edit("human_edit"))).toEqual({
      human: true, reason: "human_edit", operation: "human_edit", actorUserId: 9, at: "2026-09-01T10:00:00.000Z",
    });
  });

  it("importação (ledger import_promote/import_replace ou marcador origem:import) ⇒ humano/import", () => {
    expect(classifyDraftHumanState({ content }, edit("import_promote"))).toMatchObject({ human: true, reason: "import" });
    expect(classifyDraftHumanState({ content }, edit("import_replace"))).toMatchObject({ human: true, reason: "import" });
    expect(classifyDraftHumanState({ content, sources: ["origem:import"] }, null)).toMatchObject({ human: true, reason: "import" });
  });

  it("marcador legado edicao_humana sem ledger ⇒ humano", () => {
    expect(classifyDraftHumanState({ content, sources: ["edicao_humana"] }, null)).toMatchObject({ human: true, reason: "human_edit" });
  });

  it("conteúdo diverge do último hash registrado (mudança fora do ledger) ⇒ humano conservador", () => {
    expect(classifyDraftHumanState({ content }, edit("ai_regenerate", "outro conteúdo"))).toMatchObject({ human: true, reason: "untracked_change" });
  });

  it("operação desconhecida ⇒ humano (fail-safe); conteúdo vazio ⇒ nada a perder", () => {
    expect(classifyDraftHumanState({ content }, edit("future_op")).human).toBe(true);
    expect(classifyDraftHumanState({ content: "   " }, edit("human_edit", "   ")).human).toBe(false);
  });
});

describe("humanEditRefusalMessage", () => {
  const human = classifyDraftHumanState({ content }, edit("human_edit"));
  it("humano sem confirmação ⇒ mensagem com token estável", () => {
    expect(humanEditRefusalMessage("tr", human, undefined)).toMatch(new RegExp(`^${HUMAN_EDIT_WOULD_BE_OVERWRITTEN}: o rascunho do TR`));
    expect(humanEditRefusalMessage("tr", human, false)).not.toBeNull();
  });
  it("confirmReplace: true ou conteúdo de IA ⇒ sem recusa", () => {
    expect(humanEditRefusalMessage("tr", human, true)).toBeNull();
    expect(humanEditRefusalMessage("etp", { human: false }, undefined)).toBeNull();
  });
});

describe("resolveEditalParameters (SEM-009)", () => {
  const persisted = persistedEditalParameters({ modality: "concorrencia", form: "presencial", platform: "bll" })!;

  it("persistidos normalizam plataforma (presencial ⇒ null) e exigem modalidade + forma", () => {
    // R5 (0311) — contrato ADITIVO: critério/regime sempre presentes (null = requer revisão).
    expect(persisted).toEqual({ modality: "concorrencia", form: "presencial", platform: null, judgmentCriterion: null, executionRegime: null });
    expect(persistedEditalParameters({ modality: null, form: "eletronico", platform: null })).toBeNull();
    expect(persistedEditalParameters(null)).toBeNull();
  });

  it("persistidos + sem proposta ⇒ usa os PERSISTIDOS (não os padrões da UI)", () => {
    expect(resolveEditalParameters({ persisted, proposed: {} })).toEqual({ ok: true, params: persisted, source: "persisted", previous: null });
  });

  it("persistidos + proposta idêntica ⇒ persistidos", () => {
    const r = resolveEditalParameters({ persisted, proposed: { modality: "concorrencia", form: "presencial", platform: "compras_gov" } });
    expect(r).toMatchObject({ ok: true, source: "persisted" });
  });

  it("persistidos + proposta divergente sem confirmação ⇒ CONFLICT (atual × proposto)", () => {
    const r = resolveEditalParameters({ persisted, proposed: { modality: "pregao", form: "eletronico", platform: "compras_gov" } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("CONFLICT");
      expect(r.message).toMatch(new RegExp(`^${EDITAL_PARAMETERS_CHANGED}:`));
      expect(r.message).toContain("pregao/eletronico/compras_gov");
      expect(r.message).toContain("concorrencia/presencial");
    }
  });

  it("troca explícita (confirmParameterChange) ⇒ proposta, com anterior registrado", () => {
    const r = resolveEditalParameters({ persisted, proposed: { modality: "pregao", form: "eletronico", platform: "bll" }, confirmParameterChange: true });
    expect(r).toEqual({ ok: true, params: { modality: "pregao", form: "eletronico", platform: "bll", judgmentCriterion: null, executionRegime: null }, source: "explicit_change", previous: persisted });
  });

  it("proposta incompleta ⇒ PRECONDITION_FAILED (com ou sem persistidos)", () => {
    const a = resolveEditalParameters({ persisted, proposed: { modality: "pregao" } });
    expect(a).toMatchObject({ ok: false, code: "PRECONDITION_FAILED" });
    const b = resolveEditalParameters({ persisted: null, proposed: { form: "eletronico" } });
    expect(b).toMatchObject({ ok: false, code: "PRECONDITION_FAILED" });
    if (!b.ok) expect(b.message).toMatch(new RegExp(`^${EDITAL_PARAMETERS_REQUIRED}:`));
  });

  it("sem persistidos e sem proposta ⇒ recusa clara, NUNCA padrão silencioso", () => {
    expect(resolveEditalParameters({ persisted: null, proposed: {} })).toMatchObject({ ok: false, code: "PRECONDITION_FAILED" });
  });

  it("sem persistidos + proposta completa ⇒ 1ª decisão humana", () => {
    expect(resolveEditalParameters({ persisted: null, proposed: { modality: "pregao", form: "presencial", platform: "bll" } }))
      .toEqual({ ok: true, params: { modality: "pregao", form: "presencial", platform: null, judgmentCriterion: null, executionRegime: null }, source: "first_decision", previous: null });
  });
});
