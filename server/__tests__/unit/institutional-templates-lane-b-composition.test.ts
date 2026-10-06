/**
 * Institutional Templates — Lane B (domínio puro): composer determinístico, M1, revalidação canônica e M2.
 * Sem DB, sem rede, sem IA. Fixture SINTÉTICA.
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../domain/canonicalJson";
import {
  computeManifestHash, resolveTemplateBinding, transitionRevision, validateManifest,
  type GenerationManifest, type TemplateBinding,
} from "../../domain/institutionalTemplates";
import {
  composeTemplate, formatNumberPtBr, neutralizeNarrative, readCatalogPath, resolveTemplateVariables,
  MISSING_VALUE_MARK, PENDING_AI_SLOT_MARK, type ComposedDocument, type TemplateComposeRequest,
} from "../../domain/institutionalTemplates/composer";
import {
  buildIssuanceManifest, issuanceManifestId, revalidateForIssuance,
  type AiNarrativeAcceptance, type HumanEditLink, type RevalidationInput,
} from "../../domain/institutionalTemplates/revalidation";
import { UNVERIFIED_AMOUNT_MARK } from "../../domain/aiNumericAuthority";
import {
  ORG_A, ORG_B, H, canonicalSources, catalog, composeRequest, draftRevision, identity, narrative, publishedRevision, trPin,
} from "../helpers/institutionalTemplatesFixture";

const codes = (r: { ok: boolean; issues?: readonly { code: string }[] }): string[] => (r.ok ? [] : (r.issues ?? []).map((i) => i.code));

function compose(over: Partial<TemplateComposeRequest> = {}): ComposedDocument {
  const r = composeTemplate(composeRequest(over));
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

function acceptance(m1: GenerationManifest, over: Partial<AiNarrativeAcceptance> = {}): AiNarrativeAcceptance {
  const n = m1.aiNarratives[0];
  return { organizationId: ORG_A, manifestId: m1.id, slotKey: n.slotKey, executionId: n.executionId, outputHash: n.outputHash, acceptedByUserId: 9, ...over };
}

function revalidation(m1Doc: ComposedDocument, over: Partial<RevalidationInput> = {}): RevalidationInput {
  return {
    organizationId: ORG_A,
    generation: m1Doc.manifest,
    recomposition: composeTemplate(composeRequest({ purpose: "REVALIDATION" })),
    issuedContent: m1Doc.content.text,
    humanEdits: [],
    aiAcceptances: [acceptance(m1Doc.manifest)],
    acknowledgments: [],
    checkedAt: "2026-10-07T09:00:00.000Z",
    ...over,
  };
}

describe("Lane B — pin exato da revisão", () => {
  it("compõe só com a revisão EXATA: o M1 aponta para a revisão, identidade, hash semântico e catálogo fixados", () => {
    const rev = publishedRevision();
    const doc = compose({ revision: rev });
    expect(doc.manifest.templateRevisionId).toBe(rev.id);
    expect(doc.manifest.templateIdentityId).toBe(identity.id);
    expect(doc.manifest.templateSemanticHash).toBe(rev.semanticHash);
    expect(doc.manifest.catalogVersion).toBe(catalog.version);
    expect(validateManifest(doc.manifest).ok).toBe(true);
  });

  it("sem pin, pin vazio ou 'latest' ⇒ BINDING_REVISION_NOT_PINNED (nunca resolve a 'última')", () => {
    const rev = publishedRevision();
    for (const pin of [null, undefined, { identityId: rev.identityId, revisionId: "", semanticHash: rev.semanticHash }, { identityId: rev.identityId, revisionId: "latest", semanticHash: rev.semanticHash }, { identityId: rev.identityId, revisionId: "LATEST", semanticHash: rev.semanticHash }]) {
      expect(codes(composeTemplate(composeRequest({ revision: rev, pin })))).toEqual(["BINDING_REVISION_NOT_PINNED"]);
    }
  });

  it("pin de OUTRA revisão ou com hash divergente ⇒ recusado (sem composição)", () => {
    const rev = publishedRevision();
    expect(codes(composeTemplate(composeRequest({ revision: rev, pin: { identityId: rev.identityId, revisionId: "tplrev_other", semanticHash: rev.semanticHash } })))).toContain("REFERENCE_NOT_PINNED");
    expect(codes(composeTemplate(composeRequest({ revision: rev, pin: { identityId: rev.identityId, revisionId: rev.id, semanticHash: H("f") } })))).toContain("MANIFEST_HASH_MISMATCH");
  });

  it("revisão não publicada não compõe documento novo; DEPRECATED só recompõe (revalidação), nunca gera", () => {
    const d = draftRevision();
    expect(codes(composeTemplate(composeRequest({ revision: d, pin: { identityId: d.identityId, revisionId: d.id, semanticHash: d.semanticHash } })))).toEqual(["BINDING_REVISION_NOT_PUBLISHED"]);
    const dep = transitionRevision(publishedRevision(), { to: "DEPRECATED" }, identity, catalog);
    if (!dep.ok) throw new Error("deprecate");
    const pin = { identityId: dep.value.identityId, revisionId: dep.value.id, semanticHash: dep.value.semanticHash };
    expect(codes(composeTemplate(composeRequest({ revision: dep.value, pin })))).toEqual(["BINDING_REVISION_NOT_PUBLISHED"]);
    expect(composeTemplate(composeRequest({ revision: dep.value, pin, purpose: "REVALIDATION" })).ok).toBe(true);
  });

  it("revisão adulterada (hash semântico não recalcula) ⇒ HASH_INVALID", () => {
    const rev = publishedRevision();
    const tampered = { ...rev, ast: { ...rev.ast, root: rev.ast.root.slice(1) } };
    expect(codes(composeTemplate(composeRequest({ revision: tampered })))).toContain("HASH_INVALID");
  });
});

describe("Lane B — binding (regra do T1 consumida pela composição)", () => {
  const rev = publishedRevision();
  const binding = (over: Partial<TemplateBinding> = {}): TemplateBinding => ({
    id: "tplb_1", organizationId: ORG_A, documentKind: "edital", scope: { modality: "pregao" }, identityId: identity.id,
    pinnedRevisionId: rev.id, active: true, effectiveFrom: "2026-10-01T00:00:00Z", ...over,
  });
  const req = { organizationId: ORG_A, documentKind: "edital" as const, scope: { modality: "pregao" }, asOf: "2026-10-06T00:00:00Z" };

  it("binding ambíguo falha fechado; sem pin falha fechado; com pin exato resolve a revisão exata", () => {
    expect(resolveTemplateBinding(req, [binding(), binding({ id: "tplb_2" })], [rev]).status).toBe("AMBIGUOUS");
    const unpinned = resolveTemplateBinding(req, [binding({ pinnedRevisionId: undefined })], [rev]);
    expect(unpinned.status === "INVALID" && unpinned.issues.map((i) => i.code)).toEqual(["BINDING_REVISION_NOT_PINNED"]);
    const ok = resolveTemplateBinding(req, [binding()], [rev]);
    expect(ok.status === "RESOLVED" && ok.revision.id).toBe(rev.id);
  });
});

describe("Lane B — template = forma, domínio = verdade", () => {
  it("valores vêm só das fontes canônicas pelo catálogo, com formatação determinística", () => {
    const doc = compose();
    const text = doc.content.text;
    expect(text).toContain("# Edital nº 2026/0001");
    expect(text).toContain("Órgão: Órgão Sintético");
    expect(text).toContain("**Objeto: **Aquisição sintética de material");
    expect(text).toContain("| 1.200 | R$ 1.234,56 |");
    expect(text).toContain("1. Abertura: 05/11/2026");
    expect(text).toContain("2. Lotes: Lote 1; Lote 2");
    expect(doc.values).toEqual({
      "processo.numero": "2026/0001", objeto: "Aquisição sintética de material", srp: "SIM", valorEstimado: 123456,
      quantidade: 1200, dataAbertura: "2026-11-05", lotes: ["Lote 1", "Lote 2"], orgao: "Órgão Sintético",
    });
  });

  it("obrigatório ausente ⇒ MISSING_REQUIRED; tipo divergente ⇒ VALUE_TYPE_INVALID; opcional ausente ⇒ marca [REVISAR]", () => {
    expect(codes(composeTemplate(composeRequest({ sources: canonicalSources(ORG_A, { TR: {} }) })))).toEqual(["MISSING_REQUIRED"]);
    expect(codes(composeTemplate(composeRequest({ sources: canonicalSources(ORG_A, { ITEMS: { plannedQuantity: "1200" } }) })))).toEqual(["VALUE_TYPE_INVALID"]);
    expect(codes(composeTemplate(composeRequest({ sources: canonicalSources(ORG_A, { ITEMS: { plannedQuantity: 3, estimatedTotalCents: 10.5 } }) })))).toEqual(["VALUE_TYPE_INVALID"]);
    const doc = compose({ sources: canonicalSources(ORG_A, { ITEMS: { plannedQuantity: 3 } }) });
    expect(doc.content.text).toContain(MISSING_VALUE_MARK("valorEstimado"));
  });

  it("caminho do catálogo só lê propriedades próprias (sem protótipo, sem expressão)", () => {
    expect(readCatalogPath({ a: { b: 1 } }, "a.b")).toBe(1);
    expect(readCatalogPath({}, "__proto__.polluted")).toBeUndefined();
    expect(readCatalogPath({}, "constructor")).toBeUndefined();
    expect(readCatalogPath({ a: [1] }, "a.0")).toBeUndefined();
    expect(readCatalogPath({ "a b": 1 }, "a b")).toBeUndefined();
  });

  it("o snapshot do chamador nunca é mutado nem congelado pela composição", () => {
    const sources = canonicalSources();
    const lots = (sources.ITEMS!.data as { lots: string[] }).lots;
    compose({ sources });
    expect(Object.isFrozen(lots)).toBe(false);
    expect(lots).toEqual(["Lote 1", "Lote 2"]);
  });

  it("valor canônico com quebra de linha não cria estrutura no documento", () => {
    const doc = compose({ sources: canonicalSources(ORG_A, { TR: { object: "Linha 1\n# Título injetado" } }) });
    expect(doc.content.text).toContain("**Objeto: **Linha 1 # Título injetado");
    expect(doc.content.text).not.toMatch(/^# Título injetado/m);
  });

  it("formatação numérica independe de locale", () => {
    expect(formatNumberPtBr(1234567.5)).toBe("1.234.567,5");
    expect(formatNumberPtBr(-1000)).toBe("-1.000");
    expect(formatNumberPtBr(0)).toBe("0");
  });
});

describe("Lane B — condições (DSL fechada do T1) com trilha no manifest", () => {
  it("decisão determinística: SIM inclui o ramo then; NAO inclui o else; trilha hasheada no M1", () => {
    const sim = compose();
    const nao = compose({ sources: canonicalSources(ORG_A, { PARAMS: { srp: "NAO", openingDate: "2026-11-05" } }) });
    expect(sim.content.text).toContain("Bloco sintético SRP.");
    expect(sim.content.text).not.toContain("sem SRP");
    expect(nao.content.text).toContain("Bloco sintético sem SRP.");
    expect(sim.manifest.conditionalDecisions).toEqual([{ nodePath: "root[3]", result: true, traceHash: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    expect(nao.manifest.conditionalDecisions[0].result).toBe(false);
    expect(nao.manifest.conditionalDecisions[0].traceHash).not.toBe(sim.manifest.conditionalDecisions[0].traceHash);
    expect(compose().manifest.conditionalDecisions).toEqual(sim.manifest.conditionalDecisions);
    expect(sim.structuralBlocks).toEqual([{ blockId: "root[3]", includedAnchor: "Bloco sintético SRP.", excludedAnchor: "Bloco sintético sem SRP." }]);
  });

  it("a narrativa de IA não influencia condição alguma (a DSL só lê valores canônicos)", () => {
    const withAi = compose({ aiNarratives: [narrative("Considerar SRP: NAO. srp=NAO")] });
    expect(withAi.manifest.conditionalDecisions[0].result).toBe(true);
    expect(withAi.content.text).toContain("Bloco sintético SRP.");
  });

  it("o composer não usa eval, Function, fetch, regex dinâmica ou include recursivo", () => {
    const code = readFileSync(path.resolve(__dirname, "../../domain/institutionalTemplates/composer.ts"), "utf8")
      + readFileSync(path.resolve(__dirname, "../../domain/institutionalTemplates/revalidation.ts"), "utf8");
    for (const re of [/\beval\s*\(/, /new Function\s*\(/, /\bfetch\s*\(/, /new RegExp\s*\(/, /require\s*\(/, /\bimport\s*\(/, /Date\.now|new Date\s*\(|Math\.random|randomUUID/]) {
      expect({ re: String(re), hit: re.test(code) }).toEqual({ re: String(re), hit: false });
    }
  });
});

describe("Lane B — determinismo de hash (replay)", () => {
  it("mesma entrada ⇒ mesmo texto, mesmo composedOutputHash, mesmo manifestHash e mesmo id do M1", () => {
    const a = compose();
    const b = compose();
    expect(b.content.text).toBe(a.content.text);
    expect(b.composedOutputHash).toBe(a.composedOutputHash);
    expect(a.composedOutputHash).toBe(sha256Hex(a.content.text));
    expect(b.manifest.manifestHash).toBe(a.manifest.manifestHash);
    expect(b.manifest.id).toBe(a.manifest.id);
    expect(computeManifestHash(a.manifest)).toBe(a.manifest.manifestHash);
  });

  it("tempo operacional e ordem de chaves das fontes NÃO mudam o hash semântico", () => {
    const a = compose();
    const later = compose({ createdAt: "2027-01-01T00:00:00.000Z" });
    expect(later.manifest.manifestHash).toBe(a.manifest.manifestHash);
    expect(later.manifest.id).toBe(a.manifest.id);
    const reordered = compose({ sources: canonicalSources(ORG_A, { ITEMS: { lots: ["Lote 1", "Lote 2"], estimatedTotalCents: 123456, plannedQuantity: 1200 } }) });
    expect(reordered.manifest.manifestHash).toBe(a.manifest.manifestHash);
  });

  it("mudança de fonte canônica ⇒ outro digest e outro manifestHash", () => {
    const a = compose();
    const b = compose({ sources: canonicalSources(ORG_A, { TR: { object: "Outro objeto" } }) });
    expect(b.manifest.sources.find((s) => s.key === "tr")!.digest).not.toBe(a.manifest.sources.find((s) => s.key === "tr")!.digest);
    expect(b.manifest.manifestHash).not.toBe(a.manifest.manifestHash);
    expect(a.manifest.sources.map((s) => s.key)).toEqual(["processo", "tr", "itens", "parametros"]);
    expect(a.manifest.sources.every((s) => s.digest.startsWith("srcd:"))).toBe(true);
  });
});

describe("Lane B — slot de IA (único ponto de IA, supervisionado)", () => {
  it("narrativa entra só no aiSlot, com referência auditável e SEM aceite humano no M1", () => {
    const doc = compose();
    expect(doc.content.text).toContain("Justificativa sintética redigida para revisão humana.");
    expect(doc.manifest.aiNarratives).toEqual([{ slotKey: "justificativa", executionId: "aiexec_1", outputHash: sha256Hex(narrative().text), humanAccepted: false }]);
  });

  it("sem narrativa ⇒ marca de pendência [REVISAR] (bloqueia a emissão); nada é inventado", () => {
    const doc = compose({ aiNarratives: [] });
    expect(doc.content.text).toContain(PENDING_AI_SLOT_MARK("justificativa"));
    expect(doc.manifest.aiNarratives).toEqual([]);
  });

  it("slot inexistente, narrativa de outro tenant, duplicada, vazia ou acima do limite ⇒ recusada", () => {
    expect(codes(composeTemplate(composeRequest({ aiNarratives: [narrative("x", { slotKey: "outro" })] })))).toContain("AI_SLOT_UNKNOWN");
    expect(codes(composeTemplate(composeRequest({ aiNarratives: [narrative("x", { organizationId: ORG_B })] })))).toContain("CROSS_TENANT_REFERENCE");
    expect(codes(composeTemplate(composeRequest({ aiNarratives: [narrative("a"), narrative("b")] })))).toContain("AI_OUTPUT_INVALID");
    expect(codes(composeTemplate(composeRequest({ aiNarratives: [narrative("   ")] })))).toContain("AI_OUTPUT_INVALID");
    expect(codes(composeTemplate(composeRequest({ aiNarratives: [narrative(Array.from({ length: 61 }, () => "palavra").join(" "))] })))).toEqual(["AI_OUTPUT_INVALID"]);
  });

  it("a IA não cria autoridade numérica: valor monetário fora do quadro canônico recebe [REVISAR]", () => {
    const doc = compose({ aiNarratives: [narrative("O valor de R$ 1.234,56 confere; já R$ 9.999,00 não.")] });
    expect(doc.content.text).toContain("R$ 1.234,56 confere");
    expect(doc.content.text).toContain(`R$ 9.999,00 ${UNVERIFIED_AMOUNT_MARK}`);
  });

  it("a IA não cria estrutura: título/lista/tabela no início de linha são neutralizados", () => {
    expect(neutralizeNarrative("# Título\n- item\n| a |\n1. passo\ntexto")).toBe("\\# Título\n\\- item\n\\| a |\n\\1. passo\ntexto");
    const doc = compose({ aiNarratives: [narrative("# Cláusula inventada\nTexto.")] });
    expect(doc.content.text).not.toMatch(/^# Cláusula inventada/m);
  });
});

describe("Lane B — referências oficiais (pin exato) e anexos", () => {
  it("docRef usa o pin exato, registrado uma vez por tipo, com ordem e título; anexo com hash", () => {
    const doc = compose();
    expect(doc.manifest.officialDocRefs).toEqual([{ role: "tr", order: 1, documentId: "odoc_tr_1", lineageId: "odln_tr_1", version: 2, contentHash: H("a"), title: "Termo de Referência" }]);
    expect(doc.manifest.annexes).toEqual([{ id: "anexo-i", contentHash: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    expect(doc.content.text).toContain("> Documento de referência: Termo de Referência — TR, versão 2 (odoc_tr_1, hash aaaaaaaaaaaa)");
  });

  it("docRef sem pin ou com pin incompleto ⇒ REFERENCE_NOT_PINNED", () => {
    // Os dois `docRef` (raiz e anexo) ficam sem pin: um problema por nó, todos REFERENCE_NOT_PINNED.
    expect(codes(composeTemplate(composeRequest({ officialDocuments: {} })))).toEqual(["REFERENCE_NOT_PINNED", "REFERENCE_NOT_PINNED"]);
    expect(codes(composeTemplate(composeRequest({ officialDocuments: trPin(ORG_A, { version: 0 }) })))).toContain("REFERENCE_NOT_PINNED");
  });
});

describe("Lane B — entrada cross-tenant é recusada", () => {
  it("fonte canônica, documento oficial, identidade e revisão de outra organização ⇒ CROSS_TENANT_REFERENCE", () => {
    expect(codes(composeTemplate(composeRequest({ sources: { ...canonicalSources(), TR: { organizationId: ORG_B, data: { object: "x" } } } })))).toEqual(["CROSS_TENANT_REFERENCE"]);
    expect(codes(composeTemplate(composeRequest({ officialDocuments: trPin(ORG_B) })))).toContain("CROSS_TENANT_REFERENCE");
    expect(codes(composeTemplate(composeRequest({ organizationId: ORG_B })))).toContain("CROSS_TENANT_REFERENCE");
    const idB = { ...identity, organizationId: ORG_B };
    expect(codes(composeTemplate(composeRequest({ identity: idB })))).toContain("CROSS_TENANT_REFERENCE");
  });

  it("resolução de variáveis rejeita snapshot sem tenant", () => {
    const r = resolveTemplateVariables(ORG_A, catalog, ["objeto"], { TR: { organizationId: 0, data: { object: "x" } } });
    expect(codes(r)).toEqual(["ORGANIZATION_REQUIRED"]);
  });
});

describe("Lane B — M1 imutável e M2 derivado", () => {
  it("o resultado da composição (texto + M1) é profundamente imutável", () => {
    const doc = compose();
    expect(Object.isFrozen(doc)).toBe(true);
    expect(Object.isFrozen(doc.manifest)).toBe(true);
    expect(Object.isFrozen(doc.manifest.aiNarratives[0])).toBe(true);
    expect(() => { (doc.manifest as { composedOutputHash: string }).composedOutputHash = H("0"); }).toThrow();
  });

  it("M2 deriva do M1 sem reescrevê-lo: derivedFromManifestId, conteúdo emitido, revalidação; id determinístico", () => {
    const doc = compose();
    const before = JSON.stringify(doc.manifest);
    const r = revalidateForIssuance(revalidation(doc));
    expect(codes(r)).toEqual([]);
    if (!r.ok) return;
    const m2 = buildIssuanceManifest(doc.manifest, r.value, "2026-10-07T09:00:01.000Z");
    expect(codes(m2)).toEqual([]);
    if (!m2.ok) return;
    expect(JSON.stringify(doc.manifest)).toBe(before);
    expect(m2.value.stage).toBe("ISSUANCE");
    expect(m2.value.derivedFromManifestId).toBe(doc.manifest.id);
    expect(m2.value.id).not.toBe(doc.manifest.id);
    expect(m2.value.id).toBe(issuanceManifestId(doc.manifest.id, doc.composedOutputHash));
    expect(m2.value.documentContentHash).toBe(doc.composedOutputHash);
    expect(m2.value.aiNarratives.every((n) => n.humanAccepted)).toBe(true);
    expect(doc.manifest.aiNarratives.every((n) => !n.humanAccepted)).toBe(true);
    expect(m2.value.canonicalRevalidation.status).toBe("PASSED");
    expect(validateManifest(m2.value).ok).toBe(true);
    // Tempo operacional fora do hash: outro checkedAt/createdAt ⇒ mesmo manifestHash.
    const r2 = revalidateForIssuance(revalidation(doc, { checkedAt: "2030-01-01T00:00:00.000Z" }));
    const m2b = r2.ok ? buildIssuanceManifest(doc.manifest, r2.value, "2030-01-01T00:00:01.000Z") : null;
    expect(m2b?.ok && m2b.value.manifestHash).toBe(m2.value.manifestHash);
  });
});

describe("Lane B — revalidação canônica antes da emissão", () => {
  it("fonte canônica mudou ⇒ SOURCE_CHANGED (bloqueia; nada é regenerado)", () => {
    const doc = compose();
    const changed = composeTemplate(composeRequest({ purpose: "REVALIDATION", sources: canonicalSources(ORG_A, { TR: { object: "Objeto alterado depois" } }) }));
    const r = revalidateForIssuance(revalidation(doc, { recomposition: changed }));
    expect(codes(r)).toEqual(["SOURCE_CHANGED"]);
    expect(!r.ok && r.issues[0].message).toContain("source:tr");
  });

  it("documento oficial referenciado ou identidade institucional mudou ⇒ SOURCE_CHANGED", () => {
    const doc = compose();
    const refChanged = composeTemplate(composeRequest({ purpose: "REVALIDATION", officialDocuments: trPin(ORG_A, { version: 3, contentHash: H("b") }) }));
    expect(!revalidateForIssuance(revalidation(doc, { recomposition: refChanged })).ok).toBe(true);
    const r1 = revalidateForIssuance(revalidation(doc, { recomposition: refChanged }));
    expect(!r1.ok && r1.issues[0].message).toContain("official:tr");
    const idChanged = composeTemplate(composeRequest({ purpose: "REVALIDATION", identityFingerprint: "fp-identity-2" }));
    const r2 = revalidateForIssuance(revalidation(doc, { recomposition: idChanged }));
    expect(codes(r2)).toEqual(["SOURCE_CHANGED"]);
    expect(!r2.ok && r2.issues[0].message).toContain("identity");
  });

  it("fonte obrigatória sumiu ⇒ SOURCE_CHANGED (a recomposição falha; não há fallback)", () => {
    const doc = compose();
    const gone = composeTemplate(composeRequest({ purpose: "REVALIDATION", sources: canonicalSources(ORG_A, { TR: {} }) }));
    expect(codes(revalidateForIssuance(revalidation(doc, { recomposition: gone })))[0]).toBe("SOURCE_CHANGED");
  });

  it("mesmas fontes que não reproduzem o texto composto ⇒ COMPOSITION_DRIFT", () => {
    const doc = compose();
    const drift = composeTemplate(composeRequest({ purpose: "REVALIDATION", aiNarratives: [narrative("Outra narrativa.")] }));
    expect(codes(revalidateForIssuance(revalidation(doc, { recomposition: drift })))).toEqual(["COMPOSITION_DRIFT"]);
  });

  it("edição humana com cadeia explícita ⇒ PASSED e humanEditRefs no M2", () => {
    const doc = compose();
    const edited = doc.content.text.replace("Justificativa sintética", "Justificativa sintética revisada");
    const edits: HumanEditLink[] = [{ editRef: "edit_1", previousContentHash: doc.composedOutputHash, resultingContentHash: sha256Hex(edited), editorUserId: 11 }];
    const r = revalidateForIssuance(revalidation(doc, { issuedContent: edited, humanEdits: edits }));
    expect(codes(r)).toEqual([]);
    if (!r.ok) return;
    const m2 = buildIssuanceManifest(doc.manifest, r.value, "2026-10-07T09:00:01.000Z");
    expect(m2.ok && m2.value.humanEditRefs).toEqual([{ editRef: "edit_1", resultingContentHash: sha256Hex(edited) }]);
    expect(m2.ok && m2.value.documentContentHash).toBe(sha256Hex(edited));
  });

  it("conteúdo divergente sem edição registrada, ou cadeia quebrada ⇒ HUMAN_EDIT_LINEAGE_INVALID", () => {
    const doc = compose();
    const edited = doc.content.text.replace("Justificativa sintética", "Texto alterado");
    expect(codes(revalidateForIssuance(revalidation(doc, { issuedContent: edited })))).toEqual(["HUMAN_EDIT_LINEAGE_INVALID"]);
    const broken: HumanEditLink[] = [{ editRef: "edit_1", previousContentHash: H("9"), resultingContentHash: sha256Hex(edited), editorUserId: 11 }];
    expect(codes(revalidateForIssuance(revalidation(doc, { issuedContent: edited, humanEdits: broken })))).toEqual(["HUMAN_EDIT_LINEAGE_INVALID"]);
    const notEnding: HumanEditLink[] = [{ editRef: "edit_1", previousContentHash: doc.composedOutputHash, resultingContentHash: H("8"), editorUserId: 11 }];
    expect(codes(revalidateForIssuance(revalidation(doc, { issuedContent: edited, humanEdits: notEnding })))).toEqual(["HUMAN_EDIT_LINEAGE_INVALID"]);
  });

  it("edição que remove valor canônico ⇒ PROTECTED_NODE_MISSING", () => {
    const doc = compose();
    const edited = doc.content.text.replace("R$ 1.234,56", "R$ 2.000,00");
    const edits: HumanEditLink[] = [{ editRef: "edit_1", previousContentHash: doc.composedOutputHash, resultingContentHash: sha256Hex(edited), editorUserId: 11 }];
    expect(codes(revalidateForIssuance(revalidation(doc, { issuedContent: edited, humanEdits: edits })))).toEqual(["PROTECTED_NODE_MISSING"]);
  });

  it("bloco condicional incluído removido exige reconhecimento; com reconhecimento ⇒ PASSED_WITH_ACKNOWLEDGED_STRUCTURAL_DEVIATIONS", () => {
    const doc = compose();
    const edited = doc.content.text.replace("Bloco sintético SRP.\n\n", "");
    const edits: HumanEditLink[] = [{ editRef: "edit_1", previousContentHash: doc.composedOutputHash, resultingContentHash: sha256Hex(edited), editorUserId: 11 }];
    expect(codes(revalidateForIssuance(revalidation(doc, { issuedContent: edited, humanEdits: edits })))).toEqual(["STRUCTURAL_DEVIATION_UNACKNOWLEDGED"]);
    const r = revalidateForIssuance(revalidation(doc, {
      issuedContent: edited, humanEdits: edits,
      acknowledgments: [{ blockId: "root[3]", kind: "INCLUDED_BLOCK_REMOVED", acknowledgmentRef: "dec_ack_1" }],
    }));
    expect(r.ok && r.value.record.status).toBe("PASSED_WITH_ACKNOWLEDGED_STRUCTURAL_DEVIATIONS");
    expect(r.ok && r.value.record.structuralDeviations).toEqual([{ blockId: "root[3]", kind: "INCLUDED_BLOCK_REMOVED", acknowledgmentRef: "dec_ack_1" }]);
    const inserted = `${doc.content.text}\nBloco sintético sem SRP.\n`;
    const e2: HumanEditLink[] = [{ editRef: "edit_2", previousContentHash: doc.composedOutputHash, resultingContentHash: sha256Hex(inserted), editorUserId: 11 }];
    expect(codes(revalidateForIssuance(revalidation(doc, { issuedContent: inserted, humanEdits: e2 })))).toEqual(["STRUCTURAL_DEVIATION_UNACKNOWLEDGED"]);
  });

  it("narrativa de IA sem aceite humano EXATO ⇒ AI_NARRATIVE_NOT_ACCEPTED (bloqueada na emissão)", () => {
    const doc = compose();
    expect(codes(revalidateForIssuance(revalidation(doc, { aiAcceptances: [] })))).toEqual(["AI_NARRATIVE_NOT_ACCEPTED"]);
    for (const wrong of [{ outputHash: H("c") }, { executionId: "aiexec_other" }, { acceptedByUserId: 0 }, { organizationId: ORG_B }, { manifestId: "tplm1_other" }]) {
      expect(codes(revalidateForIssuance(revalidation(doc, { aiAcceptances: [acceptance(doc.manifest, wrong)] })))).toEqual(["AI_NARRATIVE_NOT_ACCEPTED"]);
    }
  });

  it("M1 de outro tenant ou adulterado ⇒ recusado", () => {
    const doc = compose();
    expect(codes(revalidateForIssuance(revalidation(doc, { organizationId: ORG_B })))).toEqual(["CROSS_TENANT_REFERENCE"]);
    const tampered = { ...doc.manifest, composedOutputHash: H("d") };
    expect(codes(revalidateForIssuance(revalidation(doc, { generation: tampered })))).toContain("MANIFEST_HASH_MISMATCH");
  });

  it("o registro de revalidação lista as autoridades conferidas com hash e é selado sem checkedAt", () => {
    const doc = compose();
    const r = revalidateForIssuance(revalidation(doc));
    expect(r.ok && r.value.record.checkedAuthorities.map((a) => a.authority)).toEqual([
      "identity", "official:tr", "source:itens", "source:parametros", "source:processo", "source:tr", "template",
    ]);
    const other = revalidateForIssuance(revalidation(doc, { checkedAt: "2031-01-01T00:00:00.000Z" }));
    expect(other.ok && r.ok && other.value.record.resultHash).toBe(r.ok && r.value.record.resultHash);
  });
});
