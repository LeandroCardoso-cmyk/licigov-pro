/**
 * Hardening P0 — "Responsável pela demanda" (DFD): proveniência e reconciliação explicáveis.
 *
 * Incidente (piloto): o painel "Origem das informações" mostrava "Diverge da informação de origem (Processo)"
 * com "Usar informação de origem", sem exibir o valor que seria aplicado. A "origem" era o `responsibleUser`
 * do Processo — quem CRIOU/opera o processo no LiciGov (operador), não o responsável da unidade demandante.
 *
 * Correção no DOMÍNIO (não só na UI): o Processo deixa de ser fonte autorizada de `demand.responsibleParty`;
 * marcadores de prefill gravados a partir de fonte hoje não autorizada deixam de valer como linhagem
 * (regra genérica pela POLÍTICA, sem `if campo === ...`); a UI mostra valor atual × valor de origem × origem.
 */
import { describe, it, expect } from "vitest";
import {
  resolveCanonicalContext, resolveField, isSourceAllowed, factValueHash, canonicalItemKey, itemPath, AUTHORITY_POLICY,
  type ContextInputs, type FactAssertion, type ContextPath, type ContextSourceType, type FactValue,
} from "../../domain/canonicalProcurementContext";
import {
  buildDFDPrefill, renderDFDContent, prefillMarkers, writeMarkers, readMarkers, computeDFDFieldStates, reconcileDFDField,
  extractDFDAssertions, parseDFD, fieldHash, isPrefillOriginAuthorized, DFD_FIELD_FACT, type DFDFieldView,
} from "../../domain/dfdPrefill";
import { fieldIndicator } from "../../../client/src/components/procurement/dfdFieldSources";

const OPERATOR = "Operador LiciGov"; // quem criou o Processo (responsibleUser) — NÃO é fonte
const HUMAN = "Aristides Fernandes Junior"; // valor escrito pelo servidor no DFD (piloto)
const RESP = "identificacao.responsavel";
const ITEMS = ["Concentrado ativado", "Esfregão Master 30 cm", "Concentrado alcalino R-15", "Pano costurado tipo retalho", "Detergente automotivo"];
const IDS = ITEMS.map((_, i) => `${String(i + 1).repeat(24)}`.slice(0, 24));
const QTY = [4, 20, 12, 35, 6];

let seq = 0;
const fact = (path: ContextPath, value: FactValue, sourceType: ContextSourceType, extra: Partial<FactAssertion> = {}): FactAssertion => ({
  id: ++seq, path, value, valueHash: factValueHash(value), sourceType, sourceId: `${sourceType}-1`, sourceVersion: "v1",
  status: "confirmed", actorUserId: 3, basisValueHash: null, createdAt: "2026-02-01T10:00:00.000Z", ...extra,
});

function inputs(assertions: FactAssertion[] = []): ContextInputs {
  return {
    organizationId: 7, processId: "proc-253",
    process: { number: "2026/253", object: "Material de limpeza", responsibleUserId: 42, createdAt: "2026-01-01T00:00:00.000Z" },
    organization: { name: "Prefeitura de Teste", municipio: "Teste", uf: "PR" },
    assertions: [
      fact("demand.requestingUnit", "Secretaria de Obras", "process", { sourceId: "proc-253" }),
      ...IDS.map((id, i) => fact(itemPath(id, "plannedQuantity"), QTY[i], "user")),
      ...assertions,
    ],
    intelligentItems: [],
    procurementItems: IDS.map((id, i) => ({
      id, description: ITEMS[i], unit: "UN", lotId: null, ordinal: i + 1, status: "active", revision: 1, fingerprint: canonicalItemKey(ITEMS[i], "UN"),
    })),
  };
}

/**
 * DFD LEGADO como no piloto: gerado quando o Processo ainda "pré-preenchia" o operador (marcador @process).
 * `extra` = fatos que surgiram DEPOIS da geração; `ctx`/`prefill` = contexto ATUAL.
 */
function legacyDFD(value: string, extra: FactAssertion[] = []) {
  const generated = buildDFDPrefill(resolveCanonicalContext(inputs()));
  const content = renderDFDContent(generated).replace("Responsável pela demanda: [preencher]", `Responsável pela demanda: ${value}`);
  const ctx = resolveCanonicalContext(inputs(extra));
  const prefill = buildDFDPrefill(ctx);
  const mk = prefillMarkers(generated);
  mk.prefill[RESP] = { hash: fieldHash(OPERATOR), origin: "process" };
  return { ctx, prefill, content, sources: writeMarkers(["estrutura:art_12_par_1_lei_14133"], mk) };
}
const view = (v: DFDFieldView[], key = RESP) => v.find((x) => x.key === key)!;

describe("Semântica — o operador do Processo não é fonte do Responsável pela demanda", () => {
  it("1) política: Processo NÃO autoriza responsibleParty (continua autorizando a unidade informada na abertura)", () => {
    expect(isSourceAllowed("demand.responsibleParty", "process")).toBe(false);
    expect(isSourceAllowed("demand.requestingUnit", "process")).toBe(true);
    for (const s of ["user", "dfd", "etp", "tr", "approved_document"] as const) expect(isSourceAllowed("demand.responsibleParty", s)).toBe(true);
    expect(AUTHORITY_POLICY["demand.responsibleParty"]).not.toContain("ai_draft");
    // resolver: sem projeção do operador; mesmo um fato legado "process" no ledger é ignorado (defesa em profundidade)
    expect(resolveCanonicalContext(inputs()).demand.responsibleParty).toMatchObject({ value: null, status: "unknown" });
    expect(resolveField("demand.responsibleParty", [fact("demand.responsibleParty", OPERATOR, "process")]).status).toBe("unknown");
    // marcador de linhagem: a validade é da POLÍTICA do fato, genérica para todo campo
    expect(isPrefillOriginAuthorized(RESP, "process")).toBe(false);
    expect(isPrefillOriginAuthorized("identificacao.unidade", "process")).toBe(true);
    expect(isPrefillOriginAuthorized("identificacao.objeto", "process")).toBe(true);
    expect(isPrefillOriginAuthorized("orcamento", "derived")).toBe(true);
    expect(isPrefillOriginAuthorized(`item:${IDS[0]}`, "user")).toBe(true);
    expect(isPrefillOriginAuthorized(`item:${IDS[0]}`, "intelligent_item")).toBe(false);
    for (const [k, p] of Object.entries(DFD_FIELD_FACT)) if (p) expect(isPrefillOriginAuthorized(k, "ai_draft")).toBe(false);
  });

  it("2) PILOTO: valor humano + marcador legado do operador ⇒ SEM divergência falsa e SEM botão", () => {
    const { content, sources, prefill } = legacyDFD(HUMAN);
    const v = view(computeDFDFieldStates(content, sources, prefill));
    expect(v).toMatchObject({ state: "user_modified", documentValue: HUMAN, contextValue: null, reconcilable: false });
    const ind = fieldIndicator(v);
    expect(ind).toMatchObject({ text: "Alterado por você", action: null, confirmAction: false, details: null });
    expect(reconcileDFDField(content, sources, RESP, prefill)).toBeNull();
    // nenhum outro campo vira conflito por causa do marcador legado
    expect(computeDFDFieldStates(content, sources, prefill).filter((x) => x.state === "conflict")).toEqual([]);
  });

  it("2b) valor do operador ainda INTOCADO (legado) ⇒ sem origem válida, sem ação, e não vira fato humano ao salvar", () => {
    const { content, sources, prefill, ctx } = legacyDFD(OPERATOR);
    const v = view(computeDFDFieldStates(content, sources, prefill));
    expect(v).toMatchObject({ state: "user_modified", origin: null, reconcilable: false });
    expect(fieldIndicator(v)).toMatchObject({ text: expect.stringMatching(/sem informação de origem válida/), action: null });
    expect(extractDFDAssertions(content, sources, ctx).map((d) => d.path)).not.toContain("demand.responsibleParty");
  });

  it("3) fonte VÁLIDA divergente (ETP) ⇒ divergência real com valor atual, valor de origem e origem visíveis", () => {
    const { content, sources, prefill } = legacyDFD(HUMAN, [fact("demand.responsibleParty", "Maria Souza", "etp")]);
    const v = view(computeDFDFieldStates(content, sources, prefill));
    expect(v).toMatchObject({ state: "conflict", documentValue: HUMAN, contextValue: "Maria Souza", contextOrigin: "etp", reconcilable: true });
    const ind = fieldIndicator(v);
    expect(ind.action).toBe("Usar informação de origem");
    expect(ind.details).toEqual([
      { label: "Valor atual no DFD", value: HUMAN }, { label: "Valor de origem", value: "Maria Souza" }, { label: "Origem", value: "ETP" },
    ]);
    expect(ind.confirmAction).toBe(true);
    expect(ind.confirmMessage).toContain(`Valor atual no DFD: ${HUMAN}`);
    expect(ind.confirmMessage).toContain("Valor de origem: Maria Souza");
    expect(ind.actionAriaLabel).toContain(HUMAN);
    expect(ind.actionAriaLabel).toContain("Maria Souza");
  });

  it("4) MANTER: salvar o DFD preserva o valor humano (afirmado como DFD, superando conscientemente a origem)", () => {
    const etp = fact("demand.responsibleParty", "Maria Souza", "etp");
    const { content, sources, ctx } = legacyDFD(HUMAN, [etp]);
    const drafts = extractDFDAssertions(content, sources, ctx).filter((d) => d.path === "demand.responsibleParty");
    expect(drafts).toEqual([{ path: "demand.responsibleParty", value: HUMAN, basisValueHash: etp.valueHash, fieldKey: RESP }]);
    const saved = resolveCanonicalContext(inputs([etp, fact("demand.responsibleParty", HUMAN, "dfd", { basisValueHash: drafts[0].basisValueHash })]));
    expect(saved.demand.responsibleParty).toMatchObject({ value: HUMAN, source: { type: "dfd" } });
    const v = view(computeDFDFieldStates(content, sources, buildDFDPrefill(saved)));
    expect(v).toMatchObject({ state: "user_modified", reconcilable: false });
    expect(parseDFD(content).values[RESP]).toBe(HUMAN);
  });

  it("5) USAR: substituição EXPLÍCITA só do campo pedido; linhagem passa a apontar a origem válida", () => {
    const { content, sources, prefill } = legacyDFD(HUMAN, [fact("demand.responsibleParty", "Maria Souza", "etp")]);
    const r = reconcileDFDField(content, sources, RESP, prefill)!;
    expect(parseDFD(r.content).values[RESP]).toBe("Maria Souza");
    const before = parseDFD(content).values;
    const after = parseDFD(r.content).values;
    for (const k of Object.keys(before)) if (k !== RESP) expect(after[k]).toBe(before[k]);
    expect(readMarkers(r.sources).prefill[RESP]).toEqual({ hash: fieldHash("Maria Souza"), origin: "etp" });
    expect(view(computeDFDFieldStates(r.content, r.sources, prefill))).toMatchObject({ state: "prefilled", origin: "etp" });
  });

  it("6) RELOAD: mesmo conteúdo + marcadores + contexto ⇒ mesmo estado (nada é persistido pela leitura)", () => {
    const { content, sources, prefill } = legacyDFD(HUMAN);
    const a = computeDFDFieldStates(content, sources, prefill);
    const b = computeDFDFieldStates(content, [...sources], buildDFDPrefill(resolveCanonicalContext(inputs())));
    expect(b).toEqual(a);
    expect(view(b).documentValue).toBe(HUMAN);
  });
});

describe("Regressão — as 5 quantidades previstas reconciliadas no DFD não são afetadas", () => {
  it("itens seguem 'prefilled' (origem user), sem ação, com o marcador legado do responsável presente", () => {
    const { content, sources, prefill } = legacyDFD(HUMAN);
    const views = computeDFDFieldStates(content, sources, prefill);
    IDS.forEach((id, i) => {
      expect(view(views, `item:${id}`)).toMatchObject({ state: "prefilled", origin: "user", contextValue: String(QTY[i]), reconcilable: false });
    });
    expect(content).toContain("| 2 | Esfregão Master 30 cm | UN | 20 |");
    // extração de fatos ao salvar não re-afirma quantidades que já batem com o contexto
    expect(extractDFDAssertions(content, sources, resolveCanonicalContext(inputs())).filter((d) => d.path.startsWith("items."))).toEqual([]);
  });
});
