/**
 * E2 — resolução HUMANA dos trechos pendentes (slots de IA sem narrativa) do Edital composto pelo modelo BLL. Puro: sem DB, sem rede, sem IA.
 * Cobre a regra única (`evaluateSlotResolutions` / `planSlotResolution`), a revalidação canônica da emissão, o registro versionado no M2,
 * a compatibilidade com M2 anteriores e a política de `DECLARED_NONE`. Valores SINTÉTICOS.
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../domain/canonicalJson";
import { composeTemplate, PENDING_AI_SLOT_MARK, type ComposedDocument } from "../../domain/institutionalTemplates/composer";
import { computeManifestHash, validateManifest, type IssuanceManifest, type TemplateAST2 } from "../../domain/institutionalTemplates";
import { buildIssuanceManifest, deviationAnchor, revalidateForIssuance, type HumanEditLink, type RevalidationInput } from "../../domain/institutionalTemplates/revalidation";
import {
  SLOT_RESOLUTION_FORMAT_VERSION, SLOT_RESOLUTION_POLICY_VERSION, captureAnchors, evaluateSlotResolutions, locateSegment, pendingSlotKeys,
  pendingSlotMark, planSlotResolution, slotPolicy, slotTextIssue, type SlotResolutionRecord, type SlotResolutionType,
} from "../../domain/institutionalTemplates/slotResolution";
import { DECISION_OUTCOMES, DECISION_SUBJECT_TYPES, validateDecisionRequest } from "../../domain/institutionalDecision";
import { bodyOf } from "../../db/institutionalTemplates/manifests";
import { slotResolutionSubjectId } from "../../services/institutionalTemplates/slotResolutionSubject";
import { assertNoFictitiousReviewClaim } from "../../../scripts/homologation-e2e";
import { BASE_SCENARIO, BLL_MODEL_DIR, BLL_ORG, bllCatalog, bllComposeRequest } from "../helpers/institutionalTemplatesBllHarness";
import { bindLifecycleVariables } from "../../domain/institutionalTemplates/lifecycleLateBound";
import { issuanceDateOf } from "../../services/institutionalTemplates/compositionDate";
import { reviewReadiness, revalidationIssueMessage, type ReviewStateView } from "../../../client/src/lib/editalPreparation";

const ast = JSON.parse(readFileSync(path.join(BLL_MODEL_DIR, "ast.json"), "utf8")) as TemplateAST2;
const SCENARIO = { ...BASE_SCENARIO, "decisao.consorcio": "veda" };
const CONTRATADO = "obrigacoes-especificas-contratado";
const CONTRATANTE = "obrigacoes-especificas-contratante";
const SUBCONTRATACAO = "justificativa-vedacao-subcontratacao";
const CONSORCIO = "justificativa-vedacao-consorcio";

function compose(purpose: "GENERATION" | "REVALIDATION" = "GENERATION"): ComposedDocument {
  const r = composeTemplate(bllComposeRequest(ast, SCENARIO, { aiNarratives: [], purpose }));
  if (!r.ok) throw new Error(JSON.stringify(r.issues).slice(0, 400));
  return r.value;
}
const DOC = compose();
const M1 = DOC.manifest;
const SLOTS = pendingSlotKeys(DOC.content.text);

/** Simula o serviço: aplica a resolução de UMA pessoa ao conteúdo e devolve o registro do ledger correspondente. */
let seq = 0;
function resolve(content: string, slotKey: string, resolution: SlotResolutionType, text: string | undefined, previous: SlotResolutionRecord | null = null, userId = 77) {
  const plan = planSlotResolution({ content, slotKey, resolution, text, previous });
  if (!plan.ok) throw new Error(plan.reason);
  const record: SlotResolutionRecord = {
    organizationId: BLL_ORG, manifestId: M1.id, slotKey, resolution, textHash: plan.textHash, prefix: plan.prefix, suffix: plan.suffix,
    policyVersion: SLOT_RESOLUTION_POLICY_VERSION, decisionRef: `idc_${++seq}`, revision: (previous?.revision ?? 0) + 1, resolvedByUserId: userId,
  };
  return { content: plan.content, record };
}
const edit = (from: string, to: string, n = 1): HumanEditLink => ({ editRef: `edit:${n}`, previousContentHash: sha256Hex(from), resultingContentHash: sha256Hex(to), editorUserId: 55 });

function input(issuedContent: string, slotResolutions: readonly SlotResolutionRecord[], chain?: HumanEditLink[]): RevalidationInput {
  return {
    organizationId: BLL_ORG, generation: M1, recomposition: { ok: true, value: compose("REVALIDATION") }, issuedContent,
    humanEdits: chain ?? (issuedContent === DOC.content.text ? [] : [edit(DOC.content.text, issuedContent)]),
    aiAcceptances: [], acknowledgments: [], slotResolutions, checkedAt: "2026-11-09T10:00:00.000Z",
  };
}
/** M2 como a emissão faz: materializa os campos late-bound do M1 (data de emissão) no instante oficial. */
const OFFICIAL_AT = "2026-11-09T10:01:00.000Z";
function m2Of(passed: Extract<ReturnType<typeof revalidateForIssuance>, { ok: true }>["value"], content: string) {
  const bound = bindLifecycleVariables(content, bllCatalog, M1.lateBound ?? [], OFFICIAL_AT, issuanceDateOf(OFFICIAL_AT));
  if (!bound.ok) throw new Error(bound.reason);
  return buildIssuanceManifest(M1, passed, OFFICIAL_AT, bound.bindings);
}
const codes = (r: ReturnType<typeof revalidateForIssuance>) => (r.ok ? [] : r.issues.map((i) => i.code));

/** Resolve todos os slots pendentes (obrigações por redação; justificativas por redação). */
function resolveAll(start = DOC.content.text) {
  let content = start;
  const records: SlotResolutionRecord[] = [];
  for (const k of SLOTS) {
    const r = resolve(content, k, "HUMAN_TEXT", `Redação sintética do trecho ${k}, elaborada pela equipe de licitações`);
    content = r.content; records.push(r.record);
  }
  return { content, records };
}

describe("E2 — contrato do marcador, política e localização do trecho", () => {
  it("o marcador do domínio é o MESMO do composer; o Edital BLL tem os slots pendentes esperados", () => {
    for (const k of [CONTRATADO, SUBCONTRATACAO, "x-1"]) expect(pendingSlotMark(k)).toBe(PENDING_AI_SLOT_MARK(k));
    expect(SLOTS).toEqual(expect.arrayContaining([CONTRATADO, CONTRATANTE, SUBCONTRATACAO, CONSORCIO]));
    expect(M1.aiNarratives).toEqual([]);   // slot sem narrativa não entra no M1: o texto composto é a fonte dos pendentes
  });

  it("DECLARED_NONE só nas obrigações específicas; justificativas, finalidades e slots desconhecidos exigem redação", () => {
    expect(slotPolicy(CONTRATADO).declaredNoneText).toMatch(/^Não há obrigações específicas adicionais do CONTRATADO/);
    expect(slotPolicy(CONTRATANTE).declaredNoneText).toMatch(/CONTRATANTE/);
    for (const k of [SUBCONTRATACAO, CONSORCIO, "justificativa-art49-lc123", "finalidades-tratamento-dados", "slot-desconhecido"]) expect(slotPolicy(k).declaredNoneText).toBeNull();
    // A frase fixa é conteúdo do documento, não declaração pessoal de conferência (guarda P0 dos roteiros).
    for (const k of [CONTRATADO, CONTRATANTE]) expect(() => assertNoFictitiousReviewClaim(slotPolicy(k).declaredNoneText!, k)).not.toThrow();
  });

  it("âncoras cortam em outro marcador; prefixo ambíguo não localiza (falha fechada)", () => {
    const t = `aaa [REVISAR: x] bbb ${pendingSlotMark("s")} ccc [REVISAR: y] ddd`;
    const at = t.indexOf(pendingSlotMark("s"));
    const a = captureAnchors(t, at, at + pendingSlotMark("s").length);
    expect(a.prefix).toBe(" bbb ");
    expect(a.suffix).toBe(" ccc ");
    expect(locateSegment("P-X-S P-Y-S", "P-", "-S")).toBeNull();          // prefixo repetido
    expect(locateSegment("P-X-S", "P-", "-S")?.text).toBe("X");
    expect(locateSegment("P-X", "P-", "-S")).toBeNull();                   // sufixo ausente
  });

  it("âncora de desvio: corta no marcador; âncora que começa no marcador usa o texto seguinte; só marcador ⇒ sem âncora", () => {
    expect(deviationAnchor(`6.6. Não será admitida a participação, pelas razões: ${pendingSlotMark(CONSORCIO)}.`)).toBe("6.6. Não será admitida a participação, pelas razões:");
    expect(deviationAnchor("[REVISAR: x não informado] é o prazo de entrega")).toBe("é o prazo de entrega");
    expect(deviationAnchor(pendingSlotMark(CONTRATADO))).toBeNull();
    expect(deviationAnchor("Texto sem marcador")).toBe("Texto sem marcador");
  });

  it("texto: vazio, com marcador, longo demais e quebra de linha em trecho em linha são recusados", () => {
    expect(slotTextIssue("  ", true)).toBe("TEXT_TOO_SHORT");
    expect(slotTextIssue("ver [REVISAR: x]", true)).toBe("TEXT_HAS_MARKER");
    expect(slotTextIssue("x".repeat(8001), true)).toBe("TEXT_TOO_LONG");
    expect(slotTextIssue("linha 1\nlinha 2", false)).toBe("TEXT_INLINE_MULTILINE");
    expect(slotTextIssue("linha 1\nlinha 2", true)).toBeNull();
  });

  it("planSlotResolution: marcador duplicado, DECLARED_NONE com texto, slot em linha e slot sem âncora são recusados", () => {
    const base = DOC.content.text;
    const dup = base.replace(pendingSlotMark(CONTRATADO), `${pendingSlotMark(CONTRATADO)}\n\n${pendingSlotMark(CONTRATADO)}`);
    expect(planSlotResolution({ content: dup, slotKey: CONTRATADO, resolution: "HUMAN_TEXT", text: "abc def", previous: null }).ok).toBe(false);
    expect(planSlotResolution({ content: base, slotKey: CONTRATADO, resolution: "DECLARED_NONE", text: "texto livre", previous: null }).ok).toBe(false);
    const inline = planSlotResolution({ content: base, slotKey: SUBCONTRATACAO, resolution: "DECLARED_NONE", previous: null });
    expect(inline.ok).toBe(false);                                         // em linha: exige redação mesmo que a política fosse permissiva
    const noMarker = base.replace(pendingSlotMark(CONTRATADO), "texto qualquer");
    const lost = planSlotResolution({ content: noMarker, slotKey: CONTRATADO, resolution: "HUMAN_TEXT", text: "abc def", previous: null });
    expect(lost.ok).toBe(false);
    if (!lost.ok) expect(lost.reason).toContain(pendingSlotMark(CONTRATADO));   // orienta a reinserir o marcador
    expect(planSlotResolution({ content: base, slotKey: "Slot Inválido", resolution: "HUMAN_TEXT", text: "abc", previous: null }).ok).toBe(false);
  });
});

describe("E2 — revalidação canônica da emissão (regra única com a UI)", () => {
  it("[9] remover [REVISAR] sem resolução BLOQUEIA (AI_SLOT_UNRESOLVED), mesmo com a cadeia de edição humana íntegra", () => {
    const removed = DOC.content.text.replace(/\[REVISAR: narrativa "[^"]+" pendente de redação supervisionada\]/g, "Texto qualquer");
    const r = revalidateForIssuance(input(removed, []));
    expect(codes(r)).toEqual(SLOTS.map(() => "AI_SLOT_UNRESOLVED"));
    if (!r.ok) expect(r.issues[0].message).toMatch(/removido do texto sem resolução registrada/);
    // Revalidação sem o campo (chamador antigo) é fail-closed: o slot continua pendente.
    const { slotResolutions: _drop, ...legacy } = input(removed, []);
    expect(codes(revalidateForIssuance(legacy as RevalidationInput))).toContain("AI_SLOT_UNRESOLVED");
  });

  it("[4][5][6] resoluções válidas: a revalidação passa e o M2 registra as resoluções no formato versionado", () => {
    const { content, records } = resolveAll();
    const r = revalidateForIssuance(input(content, records));
    expect(codes(r)).toEqual([]);
    if (!r.ok) return;
    expect(r.value.slotResolutions.map((x) => x.slotKey)).toEqual([...SLOTS].sort());
    expect(r.value.slotResolutions.every((x) => x.resolution === "HUMAN_TEXT" && x.resolvedByUserId === 77 && x.policyVersion === SLOT_RESOLUTION_POLICY_VERSION)).toBe(true);
    const m2 = m2Of(r.value, content);
    if (!m2.ok) throw new Error(JSON.stringify(m2.issues));
    expect(m2.value.slotResolutions?.formatVersion).toBe(SLOT_RESOLUTION_FORMAT_VERSION);
    expect(m2.value.slotResolutions?.items).toHaveLength(SLOTS.length);
    expect(validateManifest(m2.value).ok).toBe(true);
    // adulterar a resolução no M2 quebra o hash (o campo está DENTRO do conteúdo semântico)
    const tampered: IssuanceManifest = { ...m2.value, slotResolutions: { ...m2.value.slotResolutions!, items: m2.value.slotResolutions!.items.map((i, n) => (n === 0 ? { ...i, resolution: "DECLARED_NONE" as const } : i)) } };
    expect(validateManifest(tampered).ok).toBe(false);
    // formato desconhecido / itens fora de ordem são inválidos mesmo com hash recalculado
    const badFormat = { ...m2.value, slotResolutions: { formatVersion: "tpl-slot-resolution/9", items: m2.value.slotResolutions!.items } } as unknown as IssuanceManifest;
    expect(validateManifest({ ...badFormat, manifestHash: computeManifestHash(badFormat) }).ok).toBe(false);
    const unordered = { ...m2.value, slotResolutions: { formatVersion: SLOT_RESOLUTION_FORMAT_VERSION, items: [...m2.value.slotResolutions!.items].reverse() } } as IssuanceManifest;
    expect(validateManifest({ ...unordered, manifestHash: computeManifestHash(unordered) }).ok).toBe(false);
  });

  it("[6] M2 sem resolução (formato anterior) mantém forma, hash e validação; persistência ida e volta com e sem o campo", () => {
    const { content, records } = resolveAll();
    const r = revalidateForIssuance(input(content, records));
    if (!r.ok) throw new Error("falhou");
    const m2 = m2Of(r.value, content);
    if (!m2.ok) throw new Error(JSON.stringify(m2.issues));
    // Mesmo M2 derivado SEM resoluções (como os M2 anteriores à E2): campo ausente, hash = hash do formato anterior (sem o campo).
    const legacy = m2Of({ ...r.value, slotResolutions: [] }, content);
    if (!legacy.ok) throw new Error(JSON.stringify(legacy.issues));
    expect("slotResolutions" in legacy.value).toBe(false);
    expect("slotResolutions" in bodyOf(legacy.value)).toBe(false);
    const { slotResolutions: _sr, manifestHash: _mh, ...withoutField } = m2.value;
    expect(legacy.value.manifestHash).toBe(computeManifestHash({ ...withoutField, id: legacy.value.id, manifestHash: "" } as IssuanceManifest));
    expect(legacy.value.manifestHash).not.toBe(m2.value.manifestHash);
    expect(validateManifest(legacy.value).ok).toBe(true);
    expect(JSON.parse(JSON.stringify(bodyOf(m2.value))).slotResolutions).toEqual(m2.value.slotResolutions);
    expect(bodyOf(M1)).not.toHaveProperty("slotResolutions");             // M1 nunca carrega o campo
  });

  it("[7] DECLARED_NONE em slot elegível passa; a frase fixa entra no documento", () => {
    let { content, records } = resolveAll();
    const prev = records.find((x) => x.slotKey === CONTRATANTE)!;
    const again = resolve(content, CONTRATANTE, "DECLARED_NONE", undefined, prev);
    content = again.content;
    records = [...records, again.record];
    const r = revalidateForIssuance(input(content, records));
    expect(codes(r)).toEqual([]);
    expect(content).toContain(slotPolicy(CONTRATANTE).declaredNoneText!);
    if (r.ok) expect(r.value.slotResolutions.find((x) => x.slotKey === CONTRATANTE)?.resolution).toBe("DECLARED_NONE");
  });

  it("[10] texto alterado depois da resolução ⇒ AI_SLOT_RESOLUTION_STALE; nova resolução (revisão maior) volta a valer", () => {
    const { content, records } = resolveAll();
    const k = SLOTS[0];
    const changed = content.replace(`Redação sintética do trecho ${k},`, `Redação ALTERADA do trecho ${k},`);
    expect(codes(revalidateForIssuance(input(changed, records)))).toEqual(["AI_SLOT_RESOLUTION_STALE"]);
    const prev = records.find((x) => x.slotKey === k)!;
    const re = resolve(changed, k, "HUMAN_TEXT", `Redação ALTERADA do trecho ${k}, elaborada pela equipe de licitações`, prev);
    expect(re.content).toBe(changed);                                      // mesma redação já no texto: só a decisão nova
    expect(codes(revalidateForIssuance(input(changed, [...records, re.record])))).toEqual([]);
  });

  it("[11] entorno do trecho alterado (âncora) ⇒ STALE; declaração de ausência forjada em slot que exige redação ⇒ STALE", () => {
    const { content, records } = resolveAll();
    const rec = records.find((x) => x.slotKey === CONTRATADO)!;
    const moved = content.replace(rec.prefix, `${rec.prefix.slice(0, -4)}XXXX`);
    expect(codes(revalidateForIssuance(input(moved, records)))).toEqual(["AI_SLOT_RESOLUTION_STALE"]);
    // registro forjado: DECLARED_NONE para justificativa (texto e hash coerentes) não vale — a política exige redação
    const sub = records.find((x) => x.slotKey === SUBCONTRATACAO)!;
    const seg = locateSegment(content, sub.prefix, sub.suffix)!;
    const forged: SlotResolutionRecord = { ...sub, resolution: "DECLARED_NONE", textHash: sha256Hex(seg.text), revision: sub.revision + 1, decisionRef: "idc_forged" };
    expect(codes(revalidateForIssuance(input(content, [...records, forged])))).toEqual(["AI_SLOT_RESOLUTION_STALE"]);
  });

  it("[12][16] resolução de outro órgão, de outro M1 ou sem autor humano é IGNORADA (slot segue pendente)", () => {
    const { content, records } = resolveAll();
    const k = SLOTS[0];
    const others = records.filter((x) => x.slotKey !== k);
    const mine = records.find((x) => x.slotKey === k)!;
    for (const bad of [{ ...mine, organizationId: BLL_ORG + 1 }, { ...mine, manifestId: "tplm_outro" }, { ...mine, resolvedByUserId: 0 }]) {
      expect(codes(revalidateForIssuance(input(content, [...others, bad])))).toEqual(["AI_SLOT_UNRESOLVED"]);
    }
  });

  it("[19] os demais gates continuam: resolução não dispensa linhagem de edição humana nem trava de fonte", () => {
    const { content, records } = resolveAll();
    expect(codes(revalidateForIssuance(input(content, records, [])))).toContain("HUMAN_EDIT_LINEAGE_INVALID");
    expect(codes(revalidateForIssuance({ ...input(content, records), recomposition: { ok: false, issues: [{ code: "MISSING_REQUIRED", path: "vars.x", message: "x" }] } as never }))).toContain("SOURCE_CHANGED");
  });

  it("marcador ainda presente: a revalidação não duplica a trava de marcadores (UNRESOLVED_MARKERS na emissão); a tela lista o trecho", () => {
    expect(codes(revalidateForIssuance(input(DOC.content.text, [])))).toEqual([]);
    // um trecho resolvido e os demais ainda com marcador: nenhum código de slot; o M2 só seria derivado sem marcadores (gate da emissão)
    const one = resolve(DOC.content.text, CONTRATADO, "HUMAN_TEXT", "Redação sintética das obrigações do contratado");
    expect(codes(revalidateForIssuance(input(one.content, [one.record])))).toEqual([]);
  });

  it("evaluateSlotResolutions informa a elegibilidade e o trecho atual (mesma regra da UI)", () => {
    const checks = evaluateSlotResolutions({ organizationId: BLL_ORG, manifestId: M1.id, composedText: DOC.content.text, issuedContent: DOC.content.text, resolutions: [] });
    expect(checks.find((c) => c.slotKey === CONTRATADO)).toMatchObject({ state: "PENDING", declaredNoneAllowed: true });
    expect(checks.find((c) => c.slotKey === SUBCONTRATACAO)).toMatchObject({ state: "PENDING", declaredNoneAllowed: false });
  });
});

describe("E2 — ledger e UI", () => {
  it("catálogo do ledger: tipo e assunto novos, resultado explícito, autoridade de outra conta recusada", () => {
    expect(DECISION_OUTCOMES.template_slot_resolution).toEqual(["HUMAN_TEXT", "DECLARED_NONE"]);
    expect(DECISION_SUBJECT_TYPES).toContain("institutional_template.slot_resolution");
    const subjectId = slotResolutionSubjectId("tplm_abc", CONTRATADO);
    expect(subjectId).toMatch(/^tplm_abc:[0-9a-f]{16}$/);
    expect(subjectId.length).toBeLessThanOrEqual(64);
    const req = {
      organizationId: 1, subjectType: "institutional_template.slot_resolution" as const, subjectId, decisionType: "template_slot_resolution" as const,
      outcome: "HUMAN_TEXT", decidedByName: "Servidor Sintético", decidedByRole: "operator", decidedByUserId: null, decidedAt: "2026-11-09",
      basisReference: "Registro eletrônico", reason: "Registro da redação de trecho pendente do Edital", evidence: [`slot:${CONTRATADO}`],
      recordedByUserId: 10, expectedRevision: 0, idempotencyKey: "idem-12345678", correlationId: "c",
    };
    expect(validateDecisionRequest(req)).toEqual({ ok: true });
    expect(validateDecisionRequest({ ...req, outcome: "aceito" }).ok).toBe(false);
    expect(validateDecisionRequest({ ...req, decidedByUserId: 11 })).toMatchObject({ ok: false, code: "DECISION_AUTHORITY_NOT_ACTOR" });
  });

  it("prontidão da UI: trechos abertos bloqueiam e não são confundidos com marcadores de dado; mensagens operacionais", () => {
    const slot = (state: "PENDING" | "RESOLVED" | "STALE", slotKey = CONTRATADO) => ({
      slotKey, label: "Obrigações", state, reason: null, inline: false, declaredNoneAllowed: true, declaredNoneText: "x", revision: 0, resolution: null,
      resolvedByName: null, resolvedAt: null, currentText: null,
    });
    const base: ReviewStateView = {
      composedByTemplate: true, generationManifestId: "m", unresolvedMarkers: { count: 2, slots: [CONTRATADO], samples: [] }, structuralDeviations: [],
      aiNarratives: [], slots: [slot("PENDING"), slot("RESOLVED", CONTRATANTE)],
      revalidation: { status: "BLOCKED", issues: [{ code: "AI_SLOT_UNRESOLVED", path: `aiSlots.${CONTRATADO}`, message: "m" }] },
    };
    const r = reviewReadiness(base);
    expect(r.ready).toBe(false);
    expect(r.blockers).toEqual(["1 trecho(s) do modelo aguardando redação ou declaração de pessoa responsável.", "1 marcador(es) [REVISAR] pendente(s) no texto."]);
    expect(r.technical[0]).toContain("AI_SLOT_UNRESOLVED");
    expect(reviewReadiness({ ...base, unresolvedMarkers: { count: 0, slots: [], samples: [] }, slots: [slot("RESOLVED")], revalidation: { status: "PASSED", issues: [] } }).ready).toBe(true);
    expect(revalidationIssueMessage({ code: "AI_SLOT_UNRESOLVED", path: "", message: "" })).toMatch(/apagar o marcador não basta/);
    expect(revalidationIssueMessage({ code: "AI_SLOT_RESOLUTION_STALE", path: "", message: "" })).toMatch(/registre novamente/);
  });
});
