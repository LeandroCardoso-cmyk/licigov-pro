/**
 * Piloto Edital — DOMÍNIO PURO de governança: aplicabilidade explícita, evidência jurídica (metadados opcionais, nada inventado),
 * procedência, inventário e MATRIZ DE PRONTIDÃO (PASS/BLOCKED/NOT_APPLICABLE, sem bloqueio escondido).
 */
import { describe, it, expect } from "vitest";
import type { InstitutionalDecision } from "../../domain/institutionalDecision";
import { createDraftRevision, resolveTemplateBinding, type BindingScope, type TemplateBinding, type TemplateIdentity, type TemplateRevision, transitionRevision } from "../../domain/institutionalTemplates";
import { decodeKv, encodeKv } from "../../domain/institutionalTemplates/governance/kv";
import { analyzeAst } from "../../domain/institutionalTemplates/governance/astFacts";
import { BASELINE_CAPABILITIES_D4BB209 } from "../../domain/institutionalTemplates/governance/capabilities";
import {
  decodeLegalEvidence, encodeLegalEvidence, evidenceCoversSource, LEGAL_EVIDENCE_DECISION_TYPE, LEGAL_EVIDENCE_OUTCOME, LEGAL_EVIDENCE_SUBJECT, validateLegalEvidenceInput,
} from "../../domain/institutionalTemplates/governance/legalEvidence";
import {
  decodeImportProvenance, encodeImportProvenance, IMPORT_PROVENANCE_DECISION_TYPE, IMPORT_PROVENANCE_OUTCOME, IMPORT_PROVENANCE_SUBJECT, validateImportProvenanceInput,
} from "../../domain/institutionalTemplates/governance/importProvenance";
import { evaluateReadiness, READINESS_CHECK_IDS, type ReadinessInput } from "../../domain/institutionalTemplates/governance/readinessMatrix";
import {
  scopeHeadline, unsupportedScopeDimensions, validateExplicitScope, sameScopeView, PERSISTED_SCOPE_DIMENSIONS_V0316,
} from "../../domain/institutionalTemplates/governance/scopeDimensions";
import { inventoryCounts, inventoryHash, parseSourceInventory } from "../../domain/institutionalTemplates/governance/sourceInventory";
import {
  ALL_CAPABILITIES, buildPilotAst, buildPilotCatalog, buildPilotInventory, PILOT_CONDITION_TYPES, PILOT_CONTROL_ONLY, PILOT_INPUTS_TOTAL, PILOT_SOURCE_LOGICAL_VERSION, pilotSourceSha256,
} from "../../services/institutionalTemplates/pilot/editalPilotFixture";

const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);

describe("aplicabilidade EXPLÍCITA do Edital (nada inferido)", () => {
  const full: BindingScope = { modality: "PREGAO", form: "ELETRONICA", platform: "BLL", regime: "EMPREITADA_PRECO_UNITARIO", criterion: "MENOR_PRECO" };

  it("Edital exige modalidade, forma, regime e critério; forma eletrônica exige plataforma", () => {
    expect(validateExplicitScope("edital", full)).toEqual([]);
    const missing = validateExplicitScope("edital", {});
    expect(missing.map((i) => i.dimension).sort()).toEqual(["criterion", "form", "modality", "regime"]);
    const noPlatform = validateExplicitScope("edital", { ...full, platform: undefined });
    expect(noPlatform.map((i) => i.code)).toEqual(["PLATFORM_REQUIRED_FOR_ELECTRONIC"]);
    // presencial: plataforma não é exigida (e "Eletrônico"/"eletronica" com acento também contam como eletrônica)
    expect(validateExplicitScope("edital", { ...full, form: "PRESENCIAL", platform: undefined })).toEqual([]);
    expect(validateExplicitScope("edital", { ...full, form: "Eletrônica", platform: undefined }).map((i) => i.code)).toEqual(["INVALID_TOKEN", "PLATFORM_REQUIRED_FOR_ELECTRONIC"]);
  });

  it("outros tipos documentais mantêm escopo livre (só o token é validado)", () => {
    expect(validateExplicitScope("tr", {})).toEqual([]);
    expect(validateExplicitScope("tr", { modality: "tem espaço" }).map((i) => i.code)).toEqual(["INVALID_TOKEN"]);
    expect(validateExplicitScope("tr", { modality: "a|b" }).map((i) => i.code)).toEqual(["INVALID_TOKEN"]);
  });

  it("cabeçalho legível: 'Pregão | Eletrônica | BLL' (+ regime/critério); sem escopo ⇒ texto explícito", () => {
    expect(scopeHeadline({ modality: "PREGAO", form: "ELETRONICA", platform: "BLL" })).toBe("Pregão | Eletrônica | BLL");
    expect(scopeHeadline(full)).toBe("Pregão | Eletrônica | BLL | Empreitada por preço unitário | Menor preço");
    expect(scopeHeadline({ modality: "OUTRA" })).toBe("OUTRA");
    expect(scopeHeadline({})).toBe("sem escopo declarado");
  });

  it("dimensões não suportadas pela persistência são detectadas (para recusar, nunca descartar)", () => {
    expect(unsupportedScopeDimensions(full, PERSISTED_SCOPE_DIMENSIONS_V0316)).toEqual(["form", "platform"]);
    expect(unsupportedScopeDimensions({ modality: "PREGAO" }, PERSISTED_SCOPE_DIMENSIONS_V0316)).toEqual([]);
    expect(sameScopeView({ modality: "A" }, { modality: "A", form: undefined })).toBe(true);
    expect(sameScopeView({ modality: "A", form: "X" }, { modality: "A" })).toBe(false);
  });

  it("a resolução do domínio compara forma e plataforma (mesma modalidade, plataforma/forma diferente ⇒ NOT_BOUND, nunca o modelo errado)", () => {
    const identity: TemplateIdentity = { id: "ti1", organizationId: 1, documentKind: "edital", slug: "e", createdAt: "2026-10-01T00:00:00Z", createdByUserId: 1 };
    const cat = buildPilotCatalog();
    const ast = buildPilotAst();
    const draft = createDraftRevision({ id: "tr1", identity, revision: 1, ast, catalog: cat, sourceFormat: "NATIVE" });
    if (!draft.ok) throw new Error(JSON.stringify(draft.issues));
    const a = transitionRevision(draft.value, { to: "APPROVED", approvalDecisionId: "d1" }, identity, cat);
    if (!a.ok) throw new Error("x");
    const p = transitionRevision(a.value, { to: "PUBLISHED", publishDecisionId: "d2" }, identity, cat);
    if (!p.ok) throw new Error("y");
    const rev: TemplateRevision = p.value;
    const binding = (id: string, scope: BindingScope): TemplateBinding => ({ id, organizationId: 1, documentKind: "edital", scope, identityId: "ti1", pinnedRevisionId: "tr1", active: true, effectiveFrom: "2026-10-01T00:00:00Z" });
    const bll = binding("b1", { modality: "PREGAO", form: "ELETRONICA", platform: "BLL" });
    const req = (scope: BindingScope) => ({ organizationId: 1, documentKind: "edital" as const, scope, asOf: "2026-10-07T00:00:00Z" });
    expect(resolveTemplateBinding(req({ modality: "PREGAO", form: "ELETRONICA", platform: "BLL" }), [bll], [rev]).status).toBe("RESOLVED");
    expect(resolveTemplateBinding(req({ modality: "PREGAO", form: "ELETRONICA", platform: "COMPRASGOV" }), [bll], [rev]).status).toBe("NOT_BOUND");
    expect(resolveTemplateBinding(req({ modality: "PREGAO", form: "PRESENCIAL" }), [bll], [rev]).status).toBe("NOT_BOUND");
    expect(resolveTemplateBinding(req({ modality: "PREGAO" }), [bll], [rev]).status).toBe("NOT_BOUND");
    // dois bindings ativos para o MESMO escopo completo ⇒ AMBÍGUO (fail-closed)
    const dup = binding("b2", { modality: "PREGAO", form: "ELETRONICA", platform: "BLL" });
    expect(resolveTemplateBinding(req({ modality: "PREGAO", form: "ELETRONICA", platform: "BLL" }), [bll, dup], [rev]).status).toBe("AMBIGUOUS");
    // mesma modalidade, plataformas diferentes ⇒ cada um resolve só o seu
    const other = binding("b3", { modality: "PREGAO", form: "ELETRONICA", platform: "COMPRASGOV" });
    const r2 = resolveTemplateBinding(req({ modality: "PREGAO", form: "ELETRONICA", platform: "COMPRASGOV" }), [bll, other], [rev]);
    expect(r2.status === "RESOLVED" && r2.binding.id).toBe("b3");
  });
});

describe("codec kv das evidências", () => {
  it("round-trip; chave fora da allowlist ignorada; valor com quebra de linha recusado", () => {
    const line = encodeKv("sourceSha256", SHA);
    expect(decodeKv([line, "outra=coisa", "sem-igual"], ["sourceSha256"])).toEqual({ values: { sourceSha256: SHA }, others: ["outra=coisa", "sem-igual"] });
    expect(() => encodeKv("k", "a\nb")).toThrow();
    expect(() => encodeKv("k", " ")).toThrow();
    expect(() => encodeKv("1x", "v")).toThrow();
  });
});

const decision = (over: Partial<InstitutionalDecision>): InstitutionalDecision => ({
  id: "idc_x", organizationId: 1, subjectType: LEGAL_EVIDENCE_SUBJECT, subjectId: "tr1", decisionType: LEGAL_EVIDENCE_DECISION_TYPE, outcome: LEGAL_EVIDENCE_OUTCOME,
  revision: 1, supersedesDecisionId: null, decidedByName: "Procuradoria Jurídica", decidedByRole: "Órgão de assessoramento", decidedByUserId: null, decidedAt: "2026-10-05",
  basisReference: "Documento informado pelo gestor", reason: "Aprovação externa informada.", evidence: [], recordedByUserId: 7, authorityValidation: "NOT_VALIDATED_POLICY_PENDING",
  correlationId: "c", idempotencyKey: "idem-key-1", requestHash: "h", ...over,
});

describe("evidência de aprovação jurídica — metadados OPCIONAIS, nada inventado", () => {
  it("sem número/data/protocolo/procurador informados, nenhuma linha é gravada e a leitura devolve null (nunca texto padrão)", () => {
    const lines = encodeLegalEvidence({ sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA }, { revisionSemanticHash: SHA2, recordedAt: "2026-10-07T10:00:00.000Z" });
    expect(lines.map((l) => l.split("=")[0])).toEqual(["sourceLogicalVersion", "sourceSha256", "revisionSemanticHash", "recordedAt"]);
    const ev = decodeLegalEvidence(decision({ evidence: lines }))!;
    expect(ev).toMatchObject({ parecerNumber: null, parecerDate: null, protocol: null, procurador: null, evidenceRefs: [], sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA, revisionSemanticHash: SHA2, recordedByUserId: 7, authorityValidation: "NOT_VALIDATED_POLICY_PENDING" });
    expect(ev.recordedAt).toBe("2026-10-07T10:00:00.000Z");
  });

  it("com metadados informados, preserva exatamente o que foi dito (incluindo referências)", () => {
    const lines = encodeLegalEvidence({
      sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA, parecerNumber: "123/2026", parecerDate: "2026-10-01", protocol: "P-9", procurador: "Fulano", evidenceRefs: ["proc 1", "anexo 2"],
    }, { revisionSemanticHash: SHA2, recordedAt: "2026-10-07T10:00:00.000Z" });
    const ev = decodeLegalEvidence(decision({ evidence: lines }))!;
    expect(ev).toMatchObject({ parecerNumber: "123/2026", parecerDate: "2026-10-01", protocol: "P-9", procurador: "Fulano", evidenceRefs: ["proc 1", "anexo 2"] });
  });

  it("validação: SHA-256 e versão obrigatórios; opcional vazio/inválido é recusado em vez de virar texto; data só AAAA-MM-DD", () => {
    expect(validateLegalEvidenceInput({ sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA })).toEqual([]);
    expect(validateLegalEvidenceInput({ sourceLogicalVersion: "", sourceSha256: "xyz" }).map((i) => i.field)).toEqual(["sourceLogicalVersion", "sourceSha256"]);
    expect(validateLegalEvidenceInput({ sourceLogicalVersion: "v", sourceSha256: SHA, parecerNumber: "  " }).map((i) => i.field)).toEqual(["parecerNumber"]);
    expect(validateLegalEvidenceInput({ sourceLogicalVersion: "v", sourceSha256: SHA, parecerDate: "01/10/2026" }).map((i) => i.field)).toEqual(["parecerDate"]);
  });

  it("registro malformado ou de outro tipo ⇒ null (nunca 'meio válido'); cobertura exige MESMA versão lógica e MESMO SHA-256", () => {
    expect(decodeLegalEvidence(decision({ evidence: ["sourceLogicalVersion=1"] }))).toBeNull();
    expect(decodeLegalEvidence(decision({ subjectType: "institutional_template.approval", decisionType: "template_approval", outcome: "aprovado" }))).toBeNull();
    const ev = decodeLegalEvidence(decision({ evidence: encodeLegalEvidence({ sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA }, { revisionSemanticHash: SHA2, recordedAt: "t" }) }))!;
    expect(evidenceCoversSource(ev, { sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA })).toBe(true);
    expect(evidenceCoversSource(ev, { sourceLogicalVersion: "1.0.2", sourceSha256: SHA })).toBe(false);
    expect(evidenceCoversSource(ev, { sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA2 })).toBe(false);
  });
});

describe("procedência da importação", () => {
  const input = {
    templateKey: "EDITAL_PREGAO_ELETRONICO_BLL", displayName: "Edital — Pregão Eletrônico — BLL", sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA, sourceFormat: "NATIVE",
    inventory: { sha256: SHA2, inputsTotal: 160, controlOnlyInputs: 3, conditionTypes: 48 }, scope: { modality: "PREGAO", form: "ELETRONICA", platform: "BLL" },
  };
  it("round-trip preservando templateKey, displayName, versão lógica, SHA-256, inventário e escopo declarado", () => {
    const lines = encodeImportProvenance(input, { revisionSemanticHash: SHA, recordedAt: "2026-10-07T10:00:00.000Z" });
    const p = decodeImportProvenance(decision({ subjectType: IMPORT_PROVENANCE_SUBJECT, decisionType: IMPORT_PROVENANCE_DECISION_TYPE, outcome: IMPORT_PROVENANCE_OUTCOME, evidence: lines }))!;
    expect(p).toMatchObject({ templateKey: input.templateKey, displayName: input.displayName, sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA, inventory: input.inventory, scope: input.scope, recordedByUserId: 7 });
  });
  it("validação: templateKey MAIÚSCULAS_COM_UNDERSCORE, displayName obrigatório, SHA-256 válido", () => {
    expect(validateImportProvenanceInput(input)).toEqual([]);
    expect(validateImportProvenanceInput({ ...input, templateKey: "edital-bll", displayName: " ", sourceSha256: "no" }).map((i) => i.field)).toEqual(["templateKey", "displayName", "sourceSha256"]);
  });
});

describe("inventário da fonte", () => {
  const ast = buildPilotAst();
  it("o inventário sintético tem 160 entradas, 3 control-only e 48 tipos de condição; hash estável", () => {
    const inv = buildPilotInventory(ast);
    expect(inventoryCounts(inv)).toEqual({ inputsTotal: PILOT_INPUTS_TOTAL, controlOnlyInputs: PILOT_CONTROL_ONLY, conditionTypes: PILOT_CONDITION_TYPES });
    expect(inventoryHash(inv)).toBe(inventoryHash(JSON.parse(JSON.stringify(inv))));
    expect(inventoryHash({ ...inv, declared: { ...inv.declared, inputsTotal: 161 } })).not.toBe(inventoryHash(inv));
  });
  it("forma inválida é recusada com motivos; limites protegem contra abuso", () => {
    expect(parseSourceInventory(buildPilotInventory(ast)).ok).toBe(true);
    const bad = parseSourceInventory({ schema: "x", inputs: "no" });
    expect(bad.ok).toBe(false);
    expect(parseSourceInventory(null).ok).toBe(false);
    const big = { ...buildPilotInventory(ast), inputs: Array.from({ length: 2001 }, (_, i) => ({ key: `k${i}`, disposition: "VARIABLE", variable: "v" })) };
    expect(parseSourceInventory(big).ok).toBe(false);
  });
});

// ─── matriz de prontidão ───────────────────────────────────────────────────────────────────────────────────────────
const identity: TemplateIdentity = { id: "ti1", organizationId: 1, documentKind: "edital", slug: "edital-pregao-eletronico-bll", createdAt: "2026-10-01T00:00:00Z", createdByUserId: 1 };
function readinessInput(opts: { withItems?: boolean; withCertame?: boolean; caps?: ReadinessInput["capabilities"]; mutate?: (i: ReadinessInput) => ReadinessInput } = {}): ReadinessInput {
  const catalog = buildPilotCatalog({ withItemsTable: opts.withItems });
  const ast = buildPilotAst({ withItemsTable: opts.withItems });
  const created = createDraftRevision({ id: "tr1", identity, revision: 1, ast, catalog, sourceFormat: "NATIVE" });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  const revision = created.value;
  const inv = buildPilotInventory(ast, { withItemsTable: opts.withItems, withCertameConfig: opts.withCertame });
  const provenance = decodeImportProvenance(decision({
    subjectType: IMPORT_PROVENANCE_SUBJECT, decisionType: IMPORT_PROVENANCE_DECISION_TYPE, outcome: IMPORT_PROVENANCE_OUTCOME,
    evidence: encodeImportProvenance({
      templateKey: "EDITAL_PREGAO_ELETRONICO_BLL", displayName: "x", sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: pilotSourceSha256(ast), sourceFormat: "NATIVE",
      inventory: { sha256: inventoryHash(inv), ...inventoryCounts(inv) }, scope: {},
    }, { revisionSemanticHash: revision.semanticHash, recordedAt: "t" }),
  }))!;
  const legalEvidence = decodeLegalEvidence(decision({ evidence: encodeLegalEvidence({ sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: pilotSourceSha256(ast) }, { revisionSemanticHash: revision.semanticHash, recordedAt: "t" }) }))!;
  const base: ReadinessInput = { revision, catalog, provenance, legalEvidence, inventory: inv, capabilities: opts.caps ?? BASELINE_CAPABILITIES_D4BB209 };
  return opts.mutate ? opts.mutate(base) : base;
}
const status = (m: ReturnType<typeof evaluateReadiness>, id: string) => m.checks.find((c) => c.id === id)!.status;

describe("matriz de prontidão — todas as 11 verificações, nunca omitidas", () => {
  it("modelo sintético completo (sem ITEMS/CERTAME): PASS/NOT_APPLICABLE e READY; as 11 verificações sempre presentes e em ordem", () => {
    const m = evaluateReadiness(readinessInput());
    expect(m.checks.map((c) => c.id)).toEqual([...READINESS_CHECK_IDS]);
    expect(m.overall).toBe("READY");
    expect(m.summary).toEqual({ pass: 9, blocked: 0, notApplicable: 2 });
    for (const id of ["SOURCE_PROVENANCE", "INPUTS_ACCOUNTED", "CONTROL_ONLY_INPUTS", "CONDITION_TYPES", "TR_EXACT_PIN", "ANNEX_MAPPING", "XREF_INTEGRITY", "AI_SLOTS", "LEGAL_APPROVAL_EVIDENCE"]) expect(status(m, id)).toBe("PASS");
    expect(status(m, "ITEMS_BACKING")).toBe("NOT_APPLICABLE");
    expect(status(m, "CERTAME_CONFIG")).toBe("NOT_APPLICABLE");
    expect(m.notices.join(" ")).toMatch(/qualquer BLOCKED impede a publicação/);
  });

  it("160 entradas / 3 control-only / 48 condições: contagens conferidas contra a procedência e o AST real", () => {
    const m = evaluateReadiness(readinessInput());
    expect(m.checks.find((c) => c.id === "INPUTS_ACCOUNTED")!.detail).toMatch(/160 entradas/);
    expect(m.checks.find((c) => c.id === "CONTROL_ONLY_INPUTS")!.detail).toMatch(/3 entradas control-only/);
    expect(m.checks.find((c) => c.id === "CONDITION_TYPES")!.detail).toMatch(/48 tipos/);
    const facts = analyzeAst(readinessInput().revision.ast, buildPilotCatalog());
    expect(facts.conditionalCount).toBe(48);
    expect(facts.conditionVariables).toHaveLength(48);
  });

  it("ITEMS sem backing e CERTAME_CONFIG sem fonte ⇒ BLOCKED (estado real de main@d4bb209); com capacidades ⇒ PASS", () => {
    const blocked = evaluateReadiness(readinessInput({ withItems: true, withCertame: true }));
    expect(status(blocked, "ITEMS_BACKING")).toBe("BLOCKED");
    expect(status(blocked, "CERTAME_CONFIG")).toBe("BLOCKED");
    expect(blocked.overall).toBe("BLOCKED");
    expect(blocked.checks.find((c) => c.id === "ITEMS_BACKING")!.findings.join(" ")).toMatch(/tabela dinâmica/);
    const ready = evaluateReadiness(readinessInput({ withItems: true, withCertame: true, caps: ALL_CAPABILITIES }));
    expect(status(ready, "ITEMS_BACKING")).toBe("PASS");
    expect(status(ready, "CERTAME_CONFIG")).toBe("PASS");
    expect(ready.overall).toBe("READY");
  });

  it("sem inventário: tudo que depende dele é BLOCKED com o motivo (não 'passa' por omissão); o que o AST decide sozinho continua avaliado", () => {
    const m = evaluateReadiness(readinessInput({ mutate: (i) => ({ ...i, inventory: null }) }));
    for (const id of ["INPUTS_ACCOUNTED", "CONTROL_ONLY_INPUTS", "CONDITION_TYPES", "CERTAME_CONFIG", "ANNEX_MAPPING", "XREF_INTEGRITY"]) expect(status(m, id)).toBe("BLOCKED");
    expect(m.checks.find((c) => c.id === "INPUTS_ACCOUNTED")!.detail).toMatch(/inventário da fonte não fornecido/);
    expect(status(m, "TR_EXACT_PIN")).toBe("PASS");
    expect(status(m, "SOURCE_PROVENANCE")).toBe("PASS");
  });

  it("inventário adulterado (hash ≠ procedência) ou de outra fonte ⇒ BLOCKED", () => {
    const tampered = evaluateReadiness(readinessInput({ mutate: (i) => ({ ...i, inventory: { ...i.inventory!, declared: { ...i.inventory!.declared, inputsTotal: 159 } } }) }));
    expect(status(tampered, "INPUTS_ACCOUNTED")).toBe("BLOCKED");
    expect(tampered.checks.find((c) => c.id === "INPUTS_ACCOUNTED")!.detail).toMatch(/SHA-256 diferente/);
    const otherSource = evaluateReadiness(readinessInput({ mutate: (i) => ({ ...i, provenance: { ...i.provenance!, sourceSha256: SHA2 } }) }));
    expect(status(otherSource, "INPUTS_ACCOUNTED")).toBe("BLOCKED");
  });

  it("control-only que aparece no texto, ou que não controla condição, é BLOCKED; condição do AST sem tipo declarado é BLOCKED", () => {
    const m = evaluateReadiness(readinessInput({
      mutate: (i) => {
        const inv = { ...i.inventory!, inputs: i.inventory!.inputs.map((x, n) => (n === 49 ? { ...x, disposition: "CONTROL_ONLY" as const } : x)) };
        return { ...i, inventory: inv, provenance: { ...i.provenance!, inventory: { ...i.provenance!.inventory!, sha256: inventoryHash(inv) } } };
      },
    }));
    // a entrada 50 (ent.i050) aparece no texto e não controla condição ⇒ duas pendências + contagem
    const co = m.checks.find((c) => c.id === "CONTROL_ONLY_INPUTS")!;
    expect(co.status).toBe("BLOCKED");
    expect(co.findings.join(" ")).toMatch(/aparece no TEXTO/);
    const undeclared = evaluateReadiness(readinessInput({
      mutate: (i) => {
        const inv = { ...i.inventory!, conditionTypes: i.inventory!.conditionTypes.slice(0, 47), declared: { ...i.inventory!.declared, conditionTypes: 47 } };
        return { ...i, inventory: inv, provenance: { ...i.provenance!, inventory: { sha256: inventoryHash(inv), ...inventoryCounts(inv) } } };
      },
    }));
    expect(undeclared.checks.find((c) => c.id === "CONDITION_TYPES")!.findings.join(" ")).toMatch(/sem tipo declarado/);
  });

  it("anexos: mapeamento um-a-um com o AST; anexo do AST sem mapeamento ou mapeado para inexistente ⇒ BLOCKED; referência cruzada para destino inexistente ⇒ BLOCKED", () => {
    const badAnnex = evaluateReadiness(readinessInput({
      mutate: (i) => { const inv = { ...i.inventory!, annexes: [...i.inventory!.annexes.slice(1), { sourceId: "X", annexId: "anexo-inexistente" }] }; return { ...i, inventory: inv, provenance: { ...i.provenance!, inventory: { sha256: inventoryHash(inv), ...inventoryCounts(inv) } } }; },
    }));
    const a = badAnnex.checks.find((c) => c.id === "ANNEX_MAPPING")!;
    expect(a.status).toBe("BLOCKED");
    expect(a.findings.join(" ")).toMatch(/sem mapeamento/);
    expect(a.findings.join(" ")).toMatch(/não existe no AST/);
    const badXref = evaluateReadiness(readinessInput({
      mutate: (i) => { const inv = { ...i.inventory!, crossReferences: [{ fromSection: "s001", to: { kind: "SECTION" as const, id: "s999" } }] }; return { ...i, inventory: inv, provenance: { ...i.provenance!, inventory: { sha256: inventoryHash(inv), ...inventoryCounts(inv) } } }; },
    }));
    expect(badXref.checks.find((c) => c.id === "XREF_INTEGRITY")!.findings.join(" ")).toMatch(/destino inexistente/);
  });

  it("procedência ausente ou divergente do conteúdo ⇒ BLOCKED; evidência ausente/divergente/stale ⇒ BLOCKED", () => {
    expect(status(evaluateReadiness(readinessInput({ mutate: (i) => ({ ...i, provenance: null }) })), "SOURCE_PROVENANCE")).toBe("BLOCKED");
    expect(status(evaluateReadiness(readinessInput({ mutate: (i) => ({ ...i, provenance: { ...i.provenance!, revisionSemanticHash: SHA2 } }) })), "SOURCE_PROVENANCE")).toBe("BLOCKED");
    expect(status(evaluateReadiness(readinessInput({ mutate: (i) => ({ ...i, legalEvidence: null }) })), "LEGAL_APPROVAL_EVIDENCE")).toBe("BLOCKED");
    expect(status(evaluateReadiness(readinessInput({ mutate: (i) => ({ ...i, legalEvidence: { ...i.legalEvidence!, sourceSha256: SHA2 } }) })), "LEGAL_APPROVAL_EVIDENCE")).toBe("BLOCKED");
    expect(status(evaluateReadiness(readinessInput({ mutate: (i) => ({ ...i, legalEvidence: { ...i.legalEvidence!, revisionSemanticHash: SHA2 } }) })), "LEGAL_APPROVAL_EVIDENCE")).toBe("BLOCKED");
    const noParecer = evaluateReadiness(readinessInput());
    expect(noParecer.checks.find((c) => c.id === "LEGAL_APPROVAL_EVIDENCE")!.detail).toMatch(/sem número de parecer informado/);
  });

  it("a matriz é determinística (mesma entrada ⇒ mesmo hash) e o hash muda quando o resultado muda", () => {
    const a = evaluateReadiness(readinessInput());
    const b = evaluateReadiness(readinessInput());
    expect(a.matrixHash).toBe(b.matrixHash);
    expect(evaluateReadiness(readinessInput({ withItems: true })).matrixHash).not.toBe(a.matrixHash);
  });

  it("AI slots: sem slots ⇒ NOT_APPLICABLE; slot sem declaração no inventário ou acima do limite ⇒ BLOCKED", () => {
    const none = evaluateReadiness(readinessInput({ mutate: (i) => ({ ...i, revision: { ...i.revision, ast: { schema: "tpl-ast/1", root: i.revision.ast.root.filter((n) => n.t !== "aiSlot") } }, inventory: null }) }));
    expect(status(none, "AI_SLOTS")).toBe("NOT_APPLICABLE");
    const undeclared = evaluateReadiness(readinessInput({
      mutate: (i) => { const inv = { ...i.inventory!, aiSlots: [] }; return { ...i, inventory: inv, provenance: { ...i.provenance!, inventory: { sha256: inventoryHash(inv), ...inventoryCounts(inv) } } }; },
    }));
    expect(undeclared.checks.find((c) => c.id === "AI_SLOTS")!.findings.join(" ")).toMatch(/não declarado no inventário/);
    const huge = evaluateReadiness(readinessInput({ mutate: (i) => ({ ...i, revision: { ...i.revision, ast: { schema: "tpl-ast/1", root: i.revision.ast.root.map((n) => (n.t === "aiSlot" ? { ...n, maxTokens: 9000 } : n)) } } }) }));
    expect(status(huge, "AI_SLOTS")).toBe("BLOCKED");
  });
});

describe("catálogo de decisões e persistência — extensões aditivas do piloto", () => {
  it("procedência e evidência jurídica são decisões do ledger EXISTENTE (outcome 'registrado'), com assunto = revisão; os tipos do lifecycle ficam intactos", async () => {
    const d = await import("../../domain/institutionalDecision");
    expect(d.DECISION_OUTCOMES.template_import_provenance).toEqual(["registrado"]);
    expect(d.DECISION_OUTCOMES.template_legal_approval_evidence).toEqual(["registrado"]);
    expect(d.DECISION_SUBJECT_TYPES).toEqual(expect.arrayContaining(["institutional_template.import_provenance", "institutional_template.legal_evidence"]));
    // cabem no varchar existente (48) — nenhuma coluna nova
    for (const t of [...d.DECISION_SUBJECT_TYPES, ...Object.keys(d.DECISION_OUTCOMES)]) expect(t.length).toBeLessThanOrEqual(48);
    expect(d.DECISION_OUTCOMES.template_approval).toEqual(["aprovado"]);
    expect(d.DECISION_OUTCOMES.template_publication).toEqual(["publicado"]);
  });

  it("o repositório de bindings recusa forma/plataforma ANTES de qualquer acesso ao banco (sem coluna ⇒ nunca descartar em silêncio)", async () => {
    const { insertBinding } = await import("../../db/institutionalTemplates/bindings");
    const binding = { id: "tb1", organizationId: 1, documentKind: "edital" as const, scope: { modality: "PREGAO", form: "ELETRONICA" }, identityId: "ti1", pinnedRevisionId: "tr1", active: true, effectiveFrom: "2026-10-01T00:00:00Z" };
    const ctx = { organizationId: 1, actorUserId: 1, correlationId: "c" };
    const untouched = new Proxy({}, { get() { throw new Error("o banco não deveria ser acessado"); } });
    await expect(insertBinding(untouched as never, ctx, binding)).rejects.toThrow(/SCOPE_DIMENSION_UNSUPPORTED/);
    await expect(insertBinding(untouched as never, ctx, { ...binding, scope: { modality: "PREGAO", platform: "BLL" } })).rejects.toThrow(/SCOPE_DIMENSION_UNSUPPORTED/);
  });
});
