/**
 * LICIGOV-FAST PR-2 — correções A1–A4 da homologação funcional H1–H5 (staging, 05/11/2026). Lógica PURA (sem banco, sem IA paga: a
 * autoria usa o seam determinístico `invoke`). A1 e a parte contextual de A4 dependem do estado de preparação e ficam no smoke MySQL
 * (`fast-pr2-budget-allocation-mysql-smoke.test.ts`, F10/F11).
 *
 *  A2  aviso "TR desatualizado": decidir o SRP sem mudar o conteúdo orçamentário NÃO é alteração material; mudança real continua detectada;
 *      o digest gravado (hash do pedido + marcador `orcamento:`) mantém o formato v1 (replay e rascunhos existentes intactos).
 *  A3  autoria do TR com registro de preços DECLARADO: o contexto de não aplicabilidade chega ao prompt (antes: nada era dito e a IA criava
 *      `[REVISAR]` orçamentário); sem dado fictício, sem regulamento presumido, sem dispensa da exigência na formalização.
 *  A4  "exigido quando…" e resumo do Perfil sem falso "completo" quando faltam políticas condicionais.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { bllCatalog } from "../helpers/institutionalTemplatesBllHarness";
import {
  budgetAllocationDigest, budgetAllocationView, equivalentBudgetDigests, renderBudgetAllocationBlock, type BudgetAllocationView,
} from "../../domain/institutionalTemplates/budgetAllocation";
import { CONTENT_PENDING_VARIABLES } from "../../domain/institutionalTemplates/contentPending";
import { budgetOutdatedInDraft, type BudgetAllocationState } from "../../../client/src/lib/budgetAllocation";
import { budgetAllocationPrompt, buildMockProviderAuthoring, generateStructuredAuthoring } from "../../services/authoring/structuredAuthoringService";
import { buildDocumentAuthoringContext, type DocumentAuthoringInputs } from "../../services/authoring/authoringContext";
import { requiredWhenHint } from "../../services/institutionalTemplates/editalPreparationService";
import { profileCompletenessSummary } from "../../../client/src/lib/contextReuse";
import { profileIncompleteMessage } from "../../routers/procurementProcessRouter";

const srpVar = bllCatalog.vars.find((v) => v.name === "controle.utilizaSrp")!;
const view = (opts: { srp?: boolean; dot?: string; fon?: string } = {}): BudgetAllocationView => {
  const sections: Record<string, Record<string, unknown>> = { PROCESS: {} };
  if (opts.dot) sections.PROCESS.dotacaoOrcamentaria = opts.dot;
  if (opts.fon) sections.PROCESS.fonteRecursos = opts.fon;
  if (opts.srp !== undefined) (sections[srpVar.source] ??= {})[srpVar.path] = opts.srp;
  return budgetAllocationView(bllCatalog, sections)!;
};
/** O que a tela recebe (`budgetDisclosure.allocation`) para o estado atual. */
const screen = (v: BudgetAllocationView): BudgetAllocationState => ({ ...v, catalogVersion: bllCatalog.version, digest: renderBudgetAllocationBlock(v).digest, equivalentDigests: [...equivalentBudgetDigests(v)] });
/** Marcador `orcamento:` gravado na geração do TR com o estado `v`. */
const marker = (v: BudgetAllocationView) => renderBudgetAllocationBlock(v).digest;

describe("A2 — aviso 'TR desatualizado' só para alteração MATERIAL dos dados orçamentários", () => {
  it("formato do digest INALTERADO (v1): hash do pedido de geração e marcador `orcamento:` dos rascunhos existentes continuam válidos", () => {
    const v = view({ dot: "02.001", fon: "Livre" });
    const legacy = createHash("sha256").update(JSON.stringify({ v: 1, dotacao: v.dotacao, fonte: v.fonte, srp: v.srp })).digest("hex");
    expect(renderBudgetAllocationBlock(v).digest).toBe(legacy);
    expect(budgetAllocationDigest(v)).toBe(legacy);
    expect(equivalentBudgetDigests(v)[0]).toBe(legacy);   // o atual é sempre o primeiro
  });

  it("H1 (reproduzido): TR gerado com SRP indefinido; depois SRP = não, sem mudar dotação/fonte ⇒ SEM aviso (antes: aviso indevido)", () => {
    const atGeneration = view({});            // srp null ⇒ pendente
    const now = view({ srp: false });          // srp false ⇒ pendente (mesmo texto)
    expect(atGeneration.srp).toBeNull();
    expect(renderBudgetAllocationBlock(now).block).toBe(renderBudgetAllocationBlock(atGeneration).block);
    expect(marker(atGeneration)).not.toBe(screen(now).digest);                   // o digest bruto difere (srp entra nele)…
    expect(budgetOutdatedInDraft(screen(now), marker(atGeneration))).toBe(false); // …mas não é alteração material
  });

  it("declarado com SRP indefinido → SRP 'não' ou 'sim' com os MESMOS valores ⇒ mesmo texto ⇒ sem aviso", () => {
    const gen = view({ dot: "02.001", fon: "Livre" });
    for (const srp of [false, true]) {
      const now = view({ srp, dot: "02.001", fon: "Livre" });
      expect(renderBudgetAllocationBlock(now).block).toBe(renderBudgetAllocationBlock(gen).block);
      expect(budgetOutdatedInDraft(screen(now), marker(gen)), `srp=${srp}`).toBe(false);
    }
  });

  it("alteração REAL continua detectada: dotação, fonte, pendente → declarado e declarado → pendente", () => {
    const gen = view({ srp: false, dot: "02.001", fon: "Livre" });
    expect(budgetOutdatedInDraft(screen(view({ srp: false, dot: "02.002", fon: "Livre" })), marker(gen))).toBe(true);
    expect(budgetOutdatedInDraft(screen(view({ srp: false, dot: "02.001", fon: "Vinculada" })), marker(gen))).toBe(true);
    expect(budgetOutdatedInDraft(screen(view({ srp: false, dot: "02.001", fon: "Livre" })), marker(view({ srp: false })))).toBe(true);
    expect(budgetOutdatedInDraft(screen(view({ srp: false })), marker(gen))).toBe(true);
  });

  it("SRP que MUDA o conteúdo continua detectado: pendente (indefinido/não) ↔ não aplicável (sim, sem dotação)", () => {
    expect(budgetOutdatedInDraft(screen(view({ srp: true })), marker(view({})))).toBe(true);
    expect(budgetOutdatedInDraft(screen(view({ srp: true })), marker(view({ srp: false })))).toBe(true);
    expect(budgetOutdatedInDraft(screen(view({ srp: false })), marker(view({ srp: true })))).toBe(true);
    expect(renderBudgetAllocationBlock(view({ srp: true })).block).not.toBe(renderBudgetAllocationBlock(view({ srp: false })).block);
  });

  it("estado sem mudança: sem aviso; sem marcador no rascunho ou servidor anterior (sem equivalentDigests): regra anterior", () => {
    const v = view({ srp: false, dot: "02.001" });
    expect(budgetOutdatedInDraft(screen(v), marker(v))).toBe(false);
    expect(budgetOutdatedInDraft(screen(v), null)).toBe(false);
    const legacyServer: BudgetAllocationState = { ...v, catalogVersion: "x", digest: marker(v) };
    expect(budgetOutdatedInDraft(legacyServer, marker(v))).toBe(false);
    expect(budgetOutdatedInDraft(legacyServer, marker(view({ dot: "02.001" })))).toBe(true);   // sem a lista, cai na comparação exata
  });
});

describe("A3 — autoria do TR com registro de preços declarado: contexto correto, sem [REVISAR] pela ausência da dotação", () => {
  const ctxInput = (): DocumentAuthoringInputs => ({
    organizationId: 2, processId: "p-a3", kind: "tr", object: "[HOMOLOGAÇÃO SINTÉTICA] Registro de preços de material de expediente",
    processObject: "[HOMOLOGAÇÃO SINTÉTICA] Registro de preços de material de expediente", processNumber: "2167/2026",
    dfd: { present: true, status: "rascunho", contentHash: "dfd-h", content: "DFD sintético.", origin: "generated" },
    etp: { present: true, status: "rascunho", contentHash: "etp-h", content: "ETP sintético.", origin: "generated" },
    approvedItems: [{ id: "i1", description: "Papel sulfite A4", quantity: 120, unit: "RESMA", averagePriceCents: null, quoteCount: 0, confirmedCatalogCode: null, suggestedCatalogCode: null, sourceState: "current", quotes: [] }],
    pendingItemCount: 0,
  } as DocumentAuthoringInputs);
  const promptWith = async (block: ReturnType<typeof renderBudgetAllocationBlock>) => {
    let prompt = "";
    await generateStructuredAuthoring({
      organizationId: 2, kind: "tr", object: "[HOMOLOGAÇÃO SINTÉTICA] Registro de preços", correlationId: "a3", sourceContext: buildDocumentAuthoringContext(ctxInput()),
      budgetAllocation: block, invoke: async (p) => { prompt = p; return buildMockProviderAuthoring("tr"); },
    });
    return prompt;
  };

  it("o bloco determinístico expõe os rótulos NÃO APLICÁVEIS só com SRP declarado (indefinido/não ⇒ pendentes)", () => {
    expect(renderBudgetAllocationBlock(view({ srp: true })).notApplicable).toEqual(["Dotação orçamentária", "Fonte de recursos"]);
    expect(renderBudgetAllocationBlock(view({ srp: true })).pending).toEqual([]);
    expect(renderBudgetAllocationBlock(view({})).notApplicable).toEqual([]);
    expect(renderBudgetAllocationBlock(view({ srp: false })).notApplicable).toEqual([]);
    expect(renderBudgetAllocationBlock(view({ srp: true, dot: "02.001" })).notApplicable).toEqual(["Fonte de recursos"]);   // declarado vale
  });

  it("SRP declarado: o prompt EFETIVO da autoria traz o contexto (antes: nenhuma linha) e veda [REVISAR] só pela ausência da dotação", async () => {
    const before = budgetAllocationPrompt({ declared: [], pending: [] });
    expect(before).toEqual([]);   // regressão: estado anterior (sem `notApplicable`) não dizia nada
    const prompt = await promptWith(renderBudgetAllocationBlock(view({ srp: true })));
    expect(prompt).toContain("=== DADOS ORÇAMENTÁRIOS DO PROCESSO");
    expect(prompt).toContain("Registro de preços declarado neste processo: Dotação orçamentária; Fonte de recursos");
    expect(prompt).toContain("na formalização de cada contratação decorrente da ata, conforme o regulamento de registro de preços aplicável ao órgão");
    expect(prompt).toContain("A ausência desses dados NÃO é motivo para '[REVISAR]'");
    expect(prompt).toContain("mantenha '[REVISAR]' apenas para o que de fato exigir revisão humana");
  });

  it("sem dispensa jurídica automática, sem dado fictício, sem regulamento presumido, sem 'verificado'", () => {
    const lines = budgetAllocationPrompt(renderBudgetAllocationBlock(view({ srp: true }))).join("\n");
    expect(lines).toContain("Isso não dispensa a indicação dos créditos orçamentários na formalização de cada contratação.");
    expect(lines).toMatch(/sem inventar valores, sem afirmar que a dotação já foi indicada ou conferida/);
    expect(lines).not.toMatch(/Decreto|11\.462|7\.892/);
    expect(lines).not.toMatch(/\d{2}\.\d{3}\.\d{2}/);   // nenhum código de dotação aparece
    expect(lines).not.toMatch(/(?<!não )verificad/i);
    // auditoria P1: regulamento federal trazido ao contexto pelo roteador de fontes não é tratado como aplicável ao município
    expect(lines).toContain("sem tratar regulamento federal presente no contexto como aplicável ao órgão, salvo se o contexto indicar que o órgão o adotou");
  });

  it("SRP indefinido ou 'não': o prompt segue a regra de pendência informativa (nada de SRP presumido); declarado segue literal", () => {
    for (const v of [view({}), view({ srp: false })]) {
      const lines = budgetAllocationPrompt(renderBudgetAllocationBlock(v)).join("\n");
      expect(lines).not.toContain("Registro de preços declarado");
      expect(lines).toContain(CONTENT_PENDING_VARIABLES["julgamento.dotacaoOrcamentaria"]!.label);
      expect(lines).toMatch(/NÃO use '\[REVISAR\]' para eles e NÃO invente valores/);
    }
    const mixed = budgetAllocationPrompt(renderBudgetAllocationBlock(view({ srp: true, dot: "02.001" }))).join("\n");
    expect(mixed).toContain("- Dotação orçamentária: 02.001");
    expect(mixed).toContain("Registro de preços declarado neste processo: Fonte de recursos");
  });
});

describe("A4 — 'exigido quando…' e resumo do Perfil sem falso 'completo'", () => {
  const byName = (n: string) => bllCatalog.vars.find((v) => v.name === n)!;

  it("as três políticas de SRP são condicionais ao SRP e o motivo é dito em linguagem operacional (sem valor sugerido)", () => {
    for (const n of ["decisao.adesaoAta", "srp.marcoInicialVigenciaAta", "srp.prazoAssinaturaAta"]) {
      expect(byName(n).required, n).toBe(false);
      expect(requiredWhenHint(byName(n), bllCatalog), n).toBe("Sistema de Registro de Preços (SRP): Sim");
    }
    expect(requiredWhenHint(byName("controle.utilizaSrp"), bllCatalog)).toBeNull();
    expect(requiredWhenHint(byName("julgamento.dotacaoOrcamentaria"), bllCatalog)).toBe("Sistema de Registro de Preços (SRP): Não");
  });

  it("resumo: pendência geral > ressalva de políticas condicionais > completo (antes: 'Perfil completo' com SRP sem dados)", () => {
    const base = { revision: 5, summary: { policyTotal: 3, policyFilled: 3, policyPending: 0, rolesNeeded: 0, rolesOk: 0, rolesPending: 0, platformsPending: 0, pendingCount: 0 } };
    const cond = [{ name: "decisao.adesaoAta", description: "Adesão à ata", condition: "Sistema de Registro de Preços (SRP): Sim", requiredNow: false }];
    const partial = profileCompletenessSummary({ ...base, conditional: cond });
    expect(partial.tone).toBe("partial");
    expect(partial.text).toContain("Campos gerais completos (revisão 5)");
    expect(partial.text).toContain("só quando: Sistema de Registro de Preços (SRP): Sim");
    expect(partial.text).not.toMatch(/Perfil completo/);
    expect(profileCompletenessSummary({ ...base, conditional: [] })).toEqual({ tone: "complete", text: "Perfil completo (revisão 5)" });
    expect(profileCompletenessSummary(base).tone).toBe("complete");   // servidor anterior (sem `conditional`)
    expect(profileCompletenessSummary({ ...base, summary: { ...base.summary, pendingCount: 3 }, conditional: cond })).toEqual({ tone: "pending", text: "3 campos pendentes" });
  });

  it("preflight: o MESMO código, mas a mensagem nomeia os campos (até 5, depois 'e mais N') e onde informá-los", () => {
    const three = profileIncompleteMessage([{ name: "a", description: "Adesão à ata" }, { name: "b", description: "Marco inicial da vigência da ata" }, { name: "c", description: "" }]);
    expect(three).toBe("Perfil institucional de Licitações incompleto para este processo (3 campo(s): Adesão à ata; Marco inicial da vigência da ata; c): informe uma única vez em Configurações → Perfil de Licitações");
    const many = profileIncompleteMessage(Array.from({ length: 8 }, (_, i) => ({ name: `n${i}`, description: `Campo ${i}` })));
    expect(many).toContain("(8 campo(s): Campo 0; Campo 1; Campo 2; Campo 3; Campo 4; e mais 3)");
  });
});
