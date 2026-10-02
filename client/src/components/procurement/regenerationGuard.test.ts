/**
 * PR-09 — R5.1: guarda de HIDRATAÇÃO do formulário do Edital + regras de confirmação de regeneração.
 *
 * Prova (puro + varredura de fonte, padrão do projeto sem testing-library):
 *   - o valor exibido de cada parâmetro é a escolha explícita do usuário OU o PERSISTIDO — nunca um padrão;
 *   - após reload (sem escolha), o formulário mostra EXATAMENTE os parâmetros persistidos;
 *   - troca de parâmetro é detectada (atual × proposto) e a geração só habilita com parâmetros completos;
 *   - ETP/TR/Edital pedem confirmação antes de regenerar conteúdo humano e reagem à recusa governada.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  describeHumanEdit, editalParamsComplete, editalParamsDiffer, isEditalParametersChangedRefusal, isHumanEditRefusal,
  needsReplaceConfirmation, resolveEditalFormValues,
} from "./regenerationGuard";

type M = "pregao" | "concorrencia";
type F = "eletronico" | "presencial";
type P = "compras_gov" | "bll";
const none = { modality: null, form: null, platform: null } as const;
const persisted = { modality: "concorrencia", form: "presencial", platform: null } as { modality: M; form: F; platform: P | null };

describe("R5.1 — hidratação dos parâmetros do Edital", () => {
  it("reload sem escolha explícita ⇒ exibe os parâmetros PERSISTIDOS (não pregão/eletrônico)", () => {
    expect(resolveEditalFormValues<M, F, P>(none, persisted)).toEqual({ modality: "concorrencia", form: "presencial", platform: null });
  });

  it("sem persistidos e sem escolha ⇒ campos VAZIOS (nenhum padrão) e geração bloqueada", () => {
    const v = resolveEditalFormValues<M, F, P>(none, null);
    expect(v).toEqual({ modality: null, form: null, platform: null });
    expect(editalParamsComplete(v)).toBe(false);
  });

  it("escolha explícita sobrepõe o persistido e é detectada como troca (atual × proposto)", () => {
    const v = resolveEditalFormValues<M, F, P>({ modality: "pregao", form: null, platform: null }, persisted);
    expect(v).toEqual({ modality: "pregao", form: "presencial", platform: null });
    expect(editalParamsDiffer(v, persisted)).toBe(true);
    expect(editalParamsDiffer(resolveEditalFormValues<M, F, P>(none, persisted), persisted)).toBe(false);
  });

  it("plataforma só na forma eletrônica; eletrônico sem plataforma não habilita a geração", () => {
    const e = resolveEditalFormValues<M, F, P>({ modality: "pregao", form: "eletronico", platform: null }, null);
    expect(editalParamsComplete(e)).toBe(false);
    const eWithPersistedPlatform = resolveEditalFormValues<M, F, P>(none, { modality: "pregao", form: "eletronico", platform: "bll" });
    expect(eWithPersistedPlatform.platform).toBe("bll");
    expect(resolveEditalFormValues<M, F, P>({ modality: null, form: "presencial", platform: "bll" }, null).platform).toBeNull();
  });
});

describe("confirmação de regeneração (SEM-014)", () => {
  it("rascunho com humanEdit ⇒ pede confirmação; só IA/ausente ⇒ não pede", () => {
    expect(needsReplaceConfirmation({ humanEdit: { reason: "human_edit", operation: "human_edit", actorUserId: 9, at: null } })).toBe(true);
    expect(needsReplaceConfirmation({ humanEdit: null })).toBe(false);
    expect(needsReplaceConfirmation(null)).toBe(false);
  });

  it("reconhece as recusas governadas pelo token estável", () => {
    expect(isHumanEditRefusal("HUMAN_EDIT_WOULD_BE_OVERWRITTEN: o rascunho do TR contém edição humana")).toBe(true);
    expect(isHumanEditRefusal("O rascunho mudou desde o carregamento")).toBe(false);
    expect(isEditalParametersChangedRefusal("EDITAL_PARAMETERS_CHANGED: os parâmetros propostos…")).toBe(true);
    expect(isEditalParametersChangedRefusal(undefined)).toBe(false);
  });

  it("resumo do que será substituído inclui origem e autor", () => {
    expect(describeHumanEdit({ reason: "import", operation: "import_promote", actorUserId: 3, at: null })).toBe("documento importado por usuário #3");
  });
});

const read = (f: string) => readFileSync(path.join(process.cwd(), "client/src/components/procurement", f), "utf8");

describe("guarda de fonte — workspaces", () => {
  const edital = read("EditalWorkspace.tsx");

  it("EditalWorkspace NÃO inicializa parâmetros com padrões e hidrata do rascunho persistido", () => {
    expect(edital).not.toMatch(/useState<Modality>\("pregao"\)/);
    expect(edital).not.toMatch(/useState<Form>\("eletronico"\)/);
    expect(edital).not.toMatch(/useState<Platform>\("compras_gov"\)/);
    expect(edital).toContain("resolveEditalFormValues");
    expect(edital).toContain("draft?.parameters");
    expect(edital).toContain("confirmParameterChange");
  });

  it.each(["ETPWorkspace.tsx", "TRWorkspace.tsx", "EditalWorkspace.tsx"])("%s confirma antes de regenerar conteúdo humano", (f) => {
    const src = read(f);
    expect(src).toContain("RegenerationConfirmDialog");
    expect(src).toContain("needsReplaceConfirmation(draft)");
    expect(src).toContain("isHumanEditRefusal");
    expect(src).toMatch(/confirmReplace/);
    expect(src).toContain("expectedContentHash: draft?.contentHash");
  });
});
