/**
 * LICIGOV-FAST PR-2 — "Uma informação, um preenchimento": dotação orçamentária e fonte de recursos do PROCESSO, pendências INFORMATIVAS.
 *
 * Regra do Owner (05/11/2026): a ausência de dotação/fonte NÃO bloqueia, por si só, a geração nem a emissão institucional do documento;
 * o sistema indica a pendência, orienta e reaproveita o dado quando registrado. Controles de autoridade/integridade permanecem.
 *
 *  A  composição do Edital BLL (composer v2): ausente ⇒ segue, marcador governado (nunca [REVISAR]), manifesto no formato ANTERIOR
 *     (gate R1: nenhum campo novo persistido — contrato com o leitor da staging 9226e4b); presente ⇒
 *     valor declarado; determinismo/replay; SRP; outras variáveis obrigatórias CONTINUAM bloqueando (nenhum afrouxamento geral).
 *  B  autoridade única: derivada do processo; escrita genérica/CertameConfig recusada (sem segunda fonte de verdade).
 *  C  reuso no Edital: valor declarado (inclusive o gravado antes pela CertameConfig, mesmo caminho) × pendência informativa.
 *  D  bloco do TR: declarado × pendente × não aplicável (SRP), sem [REVISAR], digest determinístico.
 *  E  emissão: o marcador governado não é marcador de revisão (não bloqueia); [REVISAR] continua bloqueando.
 *  F  autoria: dotação declarada usada literalmente; pendente não vira [REVISAR]; nunca "verificada".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { composeTemplate } from "../../domain/institutionalTemplates/composer";
import type { TemplateAST2 } from "../../domain/institutionalTemplates";
import { BASE_SCENARIO, BLL_MODEL_DIR, bllCatalog, bllComposeRequest } from "../helpers/institutionalTemplatesBllHarness";
import { CONTENT_PENDING_VARIABLES, CONTENT_PENDING_TEXTS, isContentPendingVariable } from "../../domain/institutionalTemplates/contentPending";
import { computeManifestHash, validateManifest } from "../../domain/institutionalTemplates/manifest";
import { ALWAYS_DERIVED, DERIVED_VARIABLES } from "../../domain/institutionalTemplates/certameAuthority";
import { authorityEntryOf } from "../../domain/institutionalTemplates/editalAuthorityMatrix";
import { classifyVariable } from "../../domain/institutionalTemplates/editalPreparationModel";
import { DERIVED_AUTHORITY_OWNED, validateGovernedSection } from "../../domain/institutionalTemplates/governedSources";
import { budgetAllocationView, renderBudgetAllocationBlock } from "../../domain/institutionalTemplates/budgetAllocation";
import { buildContextReuse } from "../../services/institutionalTemplates/editalContextReuse";
import type { GovernedRecord } from "../../services/institutionalTemplates/governedFieldsStore";
import { countReviewMarkers, emissionBlockers } from "../../domain/emissionPreconditions";
import { budgetAllocationPrompt } from "../../services/authoring/structuredAuthoringService";

const ast = JSON.parse(readFileSync(path.join(BLL_MODEL_DIR, "ast.json"), "utf8")) as TemplateAST2;
const AI_SLOTS = ["justificativa-art49-lc123", "justificativa-vedacao-consorcio", "justificativa-vedacao-subcontratacao", "obrigacoes-especificas-contratado", "obrigacoes-especificas-contratante", "finalidades-tratamento-dados"];
const NARR = AI_SLOTS.map((slotKey) => ({ organizationId: 975001, slotKey, executionId: `aiexec_${slotKey}`, text: `Texto proposto para ${slotKey}, sujeito a revisão humana.` }));
const DOT = "julgamento.dotacaoOrcamentaria";
const FON = "julgamento.fonteRecursos";
const DOT_TEXT = CONTENT_PENDING_VARIABLES[DOT]!.absentText;
const FON_TEXT = CONTENT_PENDING_VARIABLES[FON]!.absentText;

const compose = (scenario: Record<string, unknown>, omit: readonly string[] = []) =>
  composeTemplate(bllComposeRequest(ast, scenario, { aiNarratives: NARR }, omit));

describe("A — composição do Edital BLL: dotação/fonte ausentes são pendência INFORMATIVA, não bloqueio", () => {
  it("A1 sem SRP e sem dotação/fonte: compõe; texto com o marcador governado; nenhum [REVISAR]; nenhum campo novo no M1", () => {
    const r = compose(BASE_SCENARIO, [DOT, FON]);
    expect(r.ok, r.ok ? "" : JSON.stringify(r.issues).slice(0, 400)).toBe(true);
    if (!r.ok) return;
    const text = r.value.content.text;
    expect(text).toContain(`dotação orçamentária: ${DOT_TEXT} — Fonte de recursos: ${FON_TEXT}.`);
    expect(text).not.toMatch(/\[REVISAR: julgamento\.(dotacaoOrcamentaria|fonteRecursos)/);
    expect(countReviewMarkers(text)).toBe(0);
    // gate R1: a pendência NÃO é persistida no manifesto; o registro é o texto, selado pelo composedOutputHash do M1
    expect(Object.prototype.hasOwnProperty.call(r.value.manifest, "contentPending")).toBe(false);
    expect(r.value.manifest.composedOutputHash).toBe(r.value.composedOutputHash);
  });

  it("A2 dotação/fonte declaradas: valores literais no texto (corpo e minuta de contrato); M1 SEM a chave contentPending (hashes antigos intactos)", () => {
    const r = compose({ ...BASE_SCENARIO, [DOT]: "02.001.04.122.0002.2.003 — 3.3.90.30", [FON]: "Recursos livres (1.500)" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = r.value.content.text;
    expect(text.match(/02\.001\.04\.122\.0002\.2\.003 — 3\.3\.90\.30/g)?.length).toBeGreaterThanOrEqual(2);
    expect(text).toContain("Recursos livres (1.500)");
    for (const t of CONTENT_PENDING_TEXTS) expect(text).not.toContain(t);
    expect(Object.prototype.hasOwnProperty.call(r.value.manifest, "contentPending")).toBe(false);
  });

  it("A3 replay determinístico: a mesma entrada produz o mesmo texto, o mesmo hash e o mesmo M1", () => {
    const a = compose(BASE_SCENARIO, [DOT, FON]);
    const b = compose(BASE_SCENARIO, [DOT, FON]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.composedOutputHash).toBe(b.value.composedOutputHash);
    expect(a.value.manifest.manifestHash).toBe(b.value.manifest.manifestHash);
  });

  it("A4 registro de preços: o corpo usa a cláusula de SRP (indicação na contratação); a minuta de contrato traz o marcador, nunca [REVISAR]", () => {
    const r = compose({ ...BASE_SCENARIO, "controle.utilizaSrp": true }, [DOT, FON]);
    expect(r.ok, r.ok ? "" : JSON.stringify(r.issues).slice(0, 400)).toBe(true);
    if (!r.ok) return;
    const text = r.value.content.text;
    expect(text).toContain("Por se tratar de registro de preços, a dotação orçamentária será indicada no momento de cada contratação");
    expect(text).not.toMatch(/\[REVISAR: julgamento\.(dotacaoOrcamentaria|fonteRecursos)/);
    expect(text).toContain(DOT_TEXT);   // cláusula de recursos da minuta de contrato (anexo) — pendência indicada, nada inventado
  });

  it("A5 controle: OUTRA variável obrigatória ausente continua bloqueando (MISSING_REQUIRED) — nenhum afrouxamento geral", () => {
    const required = bllCatalog.vars.find((v) => v.required && v.source === "POLICY" && !isContentPendingVariable(v))!;
    expect(required).toBeTruthy();
    const r = compose(BASE_SCENARIO, [required.name, DOT, FON]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.map((i) => i.code)).toContain("MISSING_REQUIRED");
    expect(r.issues.some((i) => i.path === `vars.${required.name}`)).toBe(true);
    expect(r.issues.some((i) => i.path === `vars.${DOT}` || i.path === `vars.${FON}`)).toBe(false);
  });

  // Contrato com o LEITOR ANTERIOR (staging 9226e4b, `db/institutionalTemplates/manifests.ts#rowsToManifest`): ele reconstrói o manifest
  // SOMENTE com estas chaves e recalcula o hash; qualquer chave nova persistida ⇒ MANIFEST_HASH_MISMATCH num rollback (gate R1 do PR #342).
  const READER_9226E4B_KEYS = new Set([
    "stage", "id", "organizationId", "generatedDocumentId", "templateIdentityId", "templateRevisionId", "templateSemanticHash", "hashVersion",
    "catalogVersion", "sources", "officialDocRefs", "conditionalDecisions", "aiNarratives", "annexes", "lateBound", "deferredPublication",
    "identityFingerprint", "composedOutputHash", "manifestHash", "createdAt",
  ]);
  it("A6 contrato de rollback: M1 pendente, declarado e com SRP só usam chaves do leitor anterior; hash e validação íntegros", () => {
    for (const [scenario, omit] of [[BASE_SCENARIO, [DOT, FON]], [{ ...BASE_SCENARIO, [DOT]: "02.001", [FON]: "Livre" }, []], [{ ...BASE_SCENARIO, "controle.utilizaSrp": true }, [DOT, FON]]] as const) {
      const r = compose(scenario, omit);
      if (!r.ok) throw new Error("composição esperada");
      const m = r.value.manifest;
      expect(Object.keys(m).filter((k) => !READER_9226E4B_KEYS.has(k))).toEqual([]);
      // referências oficiais: o leitor anterior as reconstrói das COLUNAS com exatamente estes 7 campos
      for (const ref of m.officialDocRefs) expect(Object.keys(ref).sort()).toEqual(["contentHash", "documentId", "lineageId", "order", "role", "title", "version"]);
      expect(computeManifestHash(m)).toBe(m.manifestHash);
      expect(validateManifest(m).ok).toBe(true);
    }
  });
});

describe("B — autoridade ÚNICA: informação orçamentária do processo (sem segunda fonte de verdade)", () => {
  it("B1 derivada do processo, entrada nos Dados orçamentários; nunca padrão institucional; classificada como canônica (não digitada no Edital)", () => {
    for (const n of [DOT, FON]) {
      expect(DERIVED_VARIABLES[n]).toBe("BUDGET_ALLOCATION");
      expect(ALWAYS_DERIVED(n)).toBe(true);
      expect(authorityEntryOf(n)).toMatchObject({ cls: "UPSTREAM_PROCESS", entry: "PROCESS_BUDGET", defaultEligible: false });
      const def = bllCatalog.vars.find((v) => v.name === n)!;
      expect(classifyVariable(def)).toMatchObject({ class: "CANONICAL", rule: "DERIVED" });
    }
  });

  it("B2 a escrita genérica dos campos governados (e portanto a CertameConfig) recusa dotação/fonte: escritor único", () => {
    const r = validateGovernedSection(bllCatalog, "PROCESS", "PROCESS", { dotacaoOrcamentaria: "x", fonteRecursos: "y" }, "write");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.filter((i) => i.message.includes(DERIVED_AUTHORITY_OWNED))).toHaveLength(2);
    // leitura de registro ANTERIOR (gravado pela CertameConfig no MESMO caminho) continua válida: nada é apagado nem migrado
    expect(validateGovernedSection(bllCatalog, "PROCESS", "PROCESS", { dotacaoOrcamentaria: "x" }, "read").ok).toBe(true);
  });
});

const processRecord = (sections: Record<string, Record<string, unknown>>): GovernedRecord => ({
  payload: { sections } as GovernedRecord["payload"], raw: { sections }, hash: "f".repeat(64), revision: 7, decision: {} as GovernedRecord["decision"],
});

describe("C — reuso no Edital: declarado × pendência informativa", () => {
  it("C1 valor no registro do processo (inclusive o gravado antes pela CertameConfig) é REAPROVEITADO como declarado, nunca 'verificado'", () => {
    const reuse = buildContextReuse({
      catalog: bllCatalog, orgRecord: null, trAssertions: [], asOf: "2026-11-05",
      processRecord: processRecord({ PROCESS: { dotacaoOrcamentaria: "02.001 — 3.3.90.30", fonteRecursos: "Livre" } }),
    });
    for (const [n, v] of [[DOT, "02.001 — 3.3.90.30"], [FON, "Livre"]] as const) {
      expect(reuse.values.get(n)).toMatchObject({ kind: "BUDGET", value: v, origin: { label: "Dados orçamentários do processo (declarado)", ref: { revision: 7 } } });
      expect(reuse.values.get(n)!.origin.label).not.toMatch(/verific/i);
      expect(reuse.problems.has(n)).toBe(false);
    }
  });

  it("C2 ausente ⇒ pendência informativa apontando para os Dados orçamentários do processo (nada presumido)", () => {
    const reuse = buildContextReuse({ catalog: bllCatalog, orgRecord: null, trAssertions: [], asOf: "2026-11-05", processRecord: processRecord({ PROCESS: { dotacaoOrcamentaria: "   " } }) });
    for (const n of [DOT, FON]) {
      expect(reuse.values.has(n)).toBe(false);
      expect(reuse.problems.get(n)).toMatchObject({ kind: "BUDGET", code: "BUDGET_ALLOCATION_PENDING", fix: "PROCESS_BUDGET" });
      expect(reuse.problems.get(n)!.reason).toMatch(/não impede gerar nem emitir/);
    }
  });
});

describe("D — bloco determinístico do TR (o mesmo registro que o Edital consome)", () => {
  const view = (sections: Record<string, Record<string, unknown>>) => budgetAllocationView(bllCatalog, sections)!;

  it("D1 declarado: valores literais; sem pendência; declarado ≠ verificado", () => {
    const v = view({ PROCESS: { dotacaoOrcamentaria: "02.001 — 3.3.90.30", fonteRecursos: "Livre" }, CERTAME_CONFIG: {} });
    expect(v.dotacao).toEqual({ value: "02.001 — 3.3.90.30", status: "DECLARED" });
    const b = renderBudgetAllocationBlock(v);
    expect(b.block).toContain("- Dotação orçamentária: 02.001 — 3.3.90.30");
    expect(b.block).toContain("- Fonte de recursos: Livre");
    expect(b.pending).toEqual([]);
    expect(b.declared).toEqual([["Dotação orçamentária", "02.001 — 3.3.90.30"], ["Fonte de recursos", "Livre"]]);
    expect(b.block).not.toMatch(/verific/i);
  });

  it("D2 pendente: o marcador governado (o MESMO do Edital), nunca [REVISAR] nem valor inventado", () => {
    const b = renderBudgetAllocationBlock(view({}));
    expect(b.block).toContain(`- Dotação orçamentária: ${DOT_TEXT}`);
    expect(b.block).toContain(`- Fonte de recursos: ${FON_TEXT}`);
    expect(countReviewMarkers(b.block)).toBe(0);
    expect(b.pending).toEqual(["Dotação orçamentária", "Fonte de recursos"]);
  });

  it("D3 registro de preços declarado: NÃO APLICÁVEL (indicação na formalização), sem presumir o regulamento federal", () => {
    const srpVar = bllCatalog.vars.find((x) => x.name === "controle.utilizaSrp")!;
    const v = view({ [srpVar.source]: { [srpVar.path]: true } });
    expect(v.srp).toBe(true);
    expect(v.dotacao.status).toBe("NOT_APPLICABLE");
    const b = renderBudgetAllocationBlock(v);
    expect(b.pending).toEqual([]);
    expect(b.block).toMatch(/formalização de cada contratação, conforme o regulamento aplicável/);
    expect(b.block).not.toMatch(/Decreto|11\.462/);
  });

  it("D4 digest determinístico e sensível ao valor (entra no hash do pedido e na linhagem do rascunho)", () => {
    const a = renderBudgetAllocationBlock(view({ PROCESS: { dotacaoOrcamentaria: "A" } }));
    const a2 = renderBudgetAllocationBlock(view({ PROCESS: { dotacaoOrcamentaria: "A" } }));
    const b = renderBudgetAllocationBlock(view({ PROCESS: { dotacaoOrcamentaria: "B" } }));
    expect(a.digest).toBe(a2.digest);
    expect(a.digest).not.toBe(b.digest);
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("D5 modelo que não usa dotação/fonte ⇒ nenhum bloco (TR inalterado)", () => {
    const other = { ...bllCatalog, vars: bllCatalog.vars.filter((v) => v.name !== DOT && v.name !== FON) };
    expect(budgetAllocationView(other, {})).toBeNull();
  });
});

describe("E — emissão: pendência informativa não é marcador de revisão", () => {
  const base = { kind: "tr" as const, contentHash: "h", sourceState: "current" as const, changedSourceLabels: [], trEmitted: true, lastEmittedContentHash: null, lastEmittedVersion: null };
  it("E1 o texto governado da pendência não gera EMISSION_REVIEW_MARKERS; [REVISAR] continua bloqueando", () => {
    const ok = emissionBlockers({ ...base, content: `Dotação orçamentária: ${DOT_TEXT}\nFonte de recursos: ${FON_TEXT}` });
    expect(ok.map((b) => b.code)).not.toContain("EMISSION_REVIEW_MARKERS");
    const still = emissionBlockers({ ...base, content: "Dotação: [REVISAR: dotação]" });
    expect(still.map((b) => b.code)).toContain("EMISSION_REVIEW_MARKERS");
  });
});

describe("F — autoria do TR: fatos declarados × pendência informativa", () => {
  it("F1 declarado é usado literalmente e NÃO é afirmado como conferido pela contabilidade", () => {
    const lines = budgetAllocationPrompt({ declared: [["Dotação orçamentária", "02.001"]], pending: [] }).join("\n");
    expect(lines).toContain("- Dotação orçamentária: 02.001");
    expect(lines).toMatch(/LITERALMENTE/);
    expect(lines).toMatch(/nem afirme que foram conferidos pela contabilidade/);
    expect(lines).toMatch(/declarados, não verificados/);
  });
  it("F2 pendente: instrução explícita para NÃO usar [REVISAR] e NÃO inventar; nada a dizer quando não há dados", () => {
    const lines = budgetAllocationPrompt({ declared: [], pending: ["Dotação orçamentária"] }).join("\n");
    expect(lines).toMatch(/NÃO use '\[REVISAR\]' para eles e NÃO invente valores/);
    expect(budgetAllocationPrompt({ declared: [], pending: [] })).toEqual([]);
  });
});
