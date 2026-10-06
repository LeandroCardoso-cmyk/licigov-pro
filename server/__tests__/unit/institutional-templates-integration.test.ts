/**
 * Institutional Templates — integração A+B+C (unitário, sem DB): contratos reconciliados, catálogo, tradução de erros,
 * pré-visualização pelo composer real e regras estruturais dos adapters. A prova com ports reais é o smoke MySQL.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createDraftRevision, validateVariableCatalog, type TemplateAST, type TemplateIdentity } from "../../domain/institutionalTemplates";
import { TemplatePersistenceError, type TemplatePersistenceErrorCode } from "../../db/institutionalTemplates";
import { translatePersistenceError } from "../../services/institutionalTemplates/adapters/errors";
import { previewComposeOutcome } from "../../services/institutionalTemplates/adapters/previewAdapter";
import { TEMPLATE_CATALOG_V1, createVariableCatalogPort, CURRENT_TEMPLATE_CATALOG_VERSION } from "../../services/institutionalTemplates/catalogRegistry";
import { TemplateWorkflowError } from "../../services/institutionalTemplates/errors";
import { createUnavailableTemplatePorts } from "../../services/institutionalTemplates/ports";
import { aiAcceptanceSubjectId, deviationAckSubjectId } from "../../services/institutionalTemplates/reviewService";
import { DECISION_OUTCOMES, DECISION_SUBJECT_TYPES } from "../../domain/institutionalDecision";

const read = (rel: string) => readFileSync(path.resolve(rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const identity: TemplateIdentity = { id: "tplid_int1", organizationId: 971900, documentKind: "tr", slug: "tr-int", createdAt: "2026-10-01T00:00:00Z", createdByUserId: 1 };
const ast: TemplateAST = {
  schema: "tpl-ast/1",
  root: [
    { t: "heading", level: 1, text: [{ t: "text", v: "TR nº " }, { t: "var", name: "processo.numero" }] },
    { t: "paragraph", inline: [{ t: "text", v: "Objeto: " }, { t: "var", name: "processo.objeto" }] },
    { t: "docRef", kind: "ETP", mode: "EXACT_PINNED" },
    { t: "aiSlot", slotKey: "justificativa", maxTokens: 80, instructionsKey: "tr.justificativa" },
  ],
};
const draft = () => {
  const r = createDraftRevision({ id: "tplrev_int1", identity, revision: 1, ast, catalog: TEMPLATE_CATALOG_V1, sourceFormat: "NATIVE" });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
};

describe("catálogo de código versionado (tpl-catalog/1)", () => {
  it("é válido, congelado e resolvível por versão; versão desconhecida ⇒ null (nunca 'latest')", () => {
    expect(validateVariableCatalog(TEMPLATE_CATALOG_V1).ok).toBe(true);
    const port = createVariableCatalogPort();
    expect(port.current().version).toBe(CURRENT_TEMPLATE_CATALOG_VERSION);
    expect(port.byVersion("tpl-catalog/1")).toBe(TEMPLATE_CATALOG_V1);
    expect(port.byVersion("tpl-catalog/999")).toBeNull();
    expect(port.byVersion("latest")).toBeNull();
    expect(Object.isFrozen(TEMPLATE_CATALOG_V1)).toBe(true);
  });

  it("só referencia fontes que o adapter canônico real resolve (nada de ITEMS sem backing)", () => {
    const sources = new Set(TEMPLATE_CATALOG_V1.vars.map((v) => v.source));
    expect([...sources].sort()).toEqual(["IDENTITY", "PARAMS", "PROCESS"]);
  });
});

describe("tradução de erros da persistência → workflow (mensagens neutras)", () => {
  const code = (c: TemplatePersistenceErrorCode) => {
    try { translatePersistenceError(new TemplatePersistenceError(c, "x")); } catch (e) { return e instanceof TemplateWorkflowError ? e.code : `RAW:${(e as Error).message}`; }
    return "NO_THROW";
  };
  it("mapeia cada código com semântica de negócio", () => {
    expect(code("NOT_FOUND")).toBe("NOT_FOUND");
    expect(code("REFERENCE_NOT_FOUND")).toBe("NOT_FOUND");
    expect(code("CROSS_TENANT_REFERENCE")).toBe("NOT_FOUND");   // sem oráculo de existência entre tenants
    expect(code("BINDING_ACTIVE_SCOPE_TAKEN")).toBe("BINDING_AMBIGUOUS");
    expect(code("BINDING_REVISION_NOT_PUBLISHED")).toBe("BINDING_NOT_PUBLISHED");
    expect(code("BINDING_REVISION_NOT_PINNED")).toBe("BINDING_NOT_PINNED");
    expect(code("REVISION_IMMUTABLE")).toBe("REVISION_IMMUTABLE");
    expect(code("REVISION_TRANSITION_INVALID")).toBe("TRANSITION_INVALID");
    expect(code("INVALID_INPUT")).toBe("VALIDATION_FAILED");
    expect(code("CONFLICT")).toBe("CONFLICT");
  });
  it("indisponibilidade e corrupção NÃO são traduzidas (falha fechada, sem mensagem enganosa); erro alheio é relançado", () => {
    expect(code("DB_UNAVAILABLE")).toMatch(/^RAW:DB_UNAVAILABLE/);
    expect(code("PERSISTED_RECORD_CORRUPT")).toMatch(/^RAW:PERSISTED_RECORD_CORRUPT/);
    expect(() => translatePersistenceError(new Error("boom"))).toThrow("boom");
  });
});

describe("pré-visualização pelo composer REAL (modo PREVIEW; nada persistido; sem IA)", () => {
  const values = { "processo.numero": "2026/0001", "processo.objeto": "Objeto sintético" };
  it("compõe uma revisão DRAFT com valores de exemplo, pins sintéticos e marcador de IA; é determinística", () => {
    const rev = draft();
    const a = previewComposeOutcome({ revision: rev, catalog: TEMPLATE_CATALOG_V1, values, aiNarratives: {}, identity });
    const b = previewComposeOutcome({ revision: rev, catalog: TEMPLATE_CATALOG_V1, values, aiNarratives: {}, identity });
    expect(a).toEqual(b);
    if (!("content" in a)) throw new Error(JSON.stringify(a));
    expect(a.content.text).toContain("TR nº 2026/0001");
    expect(a.content.text).toContain("Objeto sintético");
    expect(a.content.text).toContain("[pré-visualização] ETP");
    expect(a.content.text).toContain("[REVISAR: narrativa \"justificativa\" pendente");
    expect(a.manifestDraft.stage).toBe("GENERATION");
    expect(a.manifestDraft.aiNarratives).toEqual([]);   // sem IA na prévia
  });
  it("obrigatório ausente ⇒ MISSING_REQUIRED; revisão adulterada ⇒ erro de composição (nunca conteúdo parcial)", () => {
    const rev = draft();
    expect(previewComposeOutcome({ revision: rev, catalog: TEMPLATE_CATALOG_V1, values: { "processo.numero": "1" }, aiNarratives: {}, identity })).toEqual({ error: "MISSING_REQUIRED" });
    const tampered = { ...rev, semanticHash: "0".repeat(64) };
    expect(previewComposeOutcome({ revision: tampered, catalog: TEMPLATE_CATALOG_V1, values, aiNarratives: {}, identity })).toHaveProperty("error");
  });
});

describe("contratos reconciliados e fail-closed", () => {
  it("ports sem backing: desabilitado e qualquer leitura/escrita falha fechada", async () => {
    const p = createUnavailableTemplatePorts();
    expect(await p.enablement.isEnabled(1)).toBe(false);
    await expect(p.repository.getRevision(1, "x")).rejects.toThrow(/TEMPLATE_PERSISTENCE_UNAVAILABLE/);
    await expect(p.manifests.getManifest(1, "x")).rejects.toThrow(/TEMPLATE_PERSISTENCE_UNAVAILABLE/);
    expect(() => p.clock.now()).toThrow(/TEMPLATE_PERSISTENCE_UNAVAILABLE/);
  });

  it("um ÚNICO contrato por responsabilidade: ports.ts define repositório, manifest, catálogo, relógio e habilitação uma vez", () => {
    const src = strip(read("server/services/institutionalTemplates/ports.ts"));
    for (const dup of ["interface TemplateRevisionPort", "interface TemplateBindingPort", "interface TemplatesFlagPort", "interface ManifestReadPort", "interface TemplateClockPort"]) {
      expect(src, dup).not.toContain(dup);
    }
    for (const once of ["interface TemplateRepositoryPort", "interface TemplateManifestPort", "interface VariableCatalogPort", "interface ClockPort", "interface TemplateEnablementPort"]) {
      expect(src.split(once).length - 1, once).toBe(1);
    }
  });

  it("assuntos de decisão dos Modelos têm resultado EXPLÍCITO e cada tipo distinto (APPROVED ≠ PUBLISHED; depreciação própria)", () => {
    for (const t of ["institutional_template.approval", "institutional_template.publication", "institutional_template.deprecation", "institutional_template.ai_acceptance", "institutional_template.deviation_acknowledgment"]) {
      expect(DECISION_SUBJECT_TYPES).toContain(t);
    }
    expect(DECISION_OUTCOMES.template_approval).toEqual(["aprovado"]);
    expect(DECISION_OUTCOMES.template_publication).toEqual(["publicado"]);
    expect(DECISION_OUTCOMES.template_deprecation).toEqual(["depreciado"]);
    expect(DECISION_OUTCOMES.template_ai_acceptance).toEqual(["aceito"]);
    expect(DECISION_OUTCOMES.template_deviation_acknowledgment).toEqual(["reconhecido"]);
  });

  it("assuntos de revisão humana são determinísticos, limitados a 64 caracteres e distintos por slot/bloco", () => {
    const m = "tplm1_0123456789abcdef01";
    expect(aiAcceptanceSubjectId(m, "justificativa")).toBe(aiAcceptanceSubjectId(m, "justificativa"));
    expect(aiAcceptanceSubjectId(m, "a")).not.toBe(aiAcceptanceSubjectId(m, "b"));
    expect(aiAcceptanceSubjectId(m, "x".repeat(80)).length).toBeLessThanOrEqual(64);
    expect(deviationAckSubjectId(m, "b1", "INCLUDED_BLOCK_REMOVED")).not.toBe(deviationAckSubjectId(m, "b1", "EXCLUDED_BLOCK_INSERTED"));
    expect(aiAcceptanceSubjectId(m, "justificativa").startsWith(`${m}:`)).toBe(true);
  });
});

describe("regras estruturais dos adapters e do lifecycle atômico", () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []));

  it("adapters: sem process.env, sem 'latest', sem SQL cru, sem fallback em memória, sem IA/rede", () => {
    for (const f of walk(path.resolve("server/services/institutionalTemplates/adapters"))) {
      const src = strip(readFileSync(f, "utf8"));
      expect(src, f).not.toMatch(/process\.env/);
      expect(src, f).not.toMatch(/["'`]latest["'`]/i);
      expect(src, f).not.toMatch(/\bsql`|\.execute\(|\bnew Map\(|\bfetch\s*\(|invokeLLM|_core\/llm/);
    }
  });

  it("lifecycle: decisão + transição + evento na MESMA transação, com lock do assunto, replay por chave e CAS", () => {
    const src = strip(read("server/services/institutionalTemplates/adapters/repositoryAdapter.ts"));
    const fn = src.slice(src.indexOf("async function commitLifecycle"));
    expect(fn.indexOf("withTemplatesTransaction(")).toBeGreaterThan(-1);
    const order = ["lockDecisionSubject(", "getDecisionByIdempotencyKey(", "STALE_STATUS", "insertDecision(", "transitionRevisionStatus("].map((t) => fn.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);   // lock → replay → CAS → INSERT decisão → transição (+ evento)
    expect(src).not.toMatch(/db\.transaction|getDb\(\)\.transaction/);
  });

  it("lockDecisionSubject reconhece TODOS os assuntos de Modelos (revisão e manifest) por tenant — sem segundo mecanismo", () => {
    const src = strip(read("server/db/institutionalDecisions.ts"));
    for (const t of ["institutional_template.approval", "institutional_template.publication", "institutional_template.deprecation", "institutional_template.ai_acceptance", "institutional_template.deviation_acknowledgment"]) {
      expect(src, t).toContain(t);
    }
    expect(src).toContain("institutionalTemplateRevisionsTable.organizationId, organizationId");
    expect(src).toContain("documentCompositionManifestsTable.organizationId, organizationId");
  });

  it("promoção oficial: o hook de Modelos entra pelo parâmetro opcional e o M2 é gravado DENTRO da transação da emissão", () => {
    const src = strip(read("server/services/documentPromotionService.ts"));
    expect(src).toContain("templateIssuance?: PromotionTemplateIssuanceHook");
    expect(src.indexOf("templated.persist(")).toBeGreaterThan(src.indexOf("insertOfficialPromotion("));
    expect(src.indexOf("templated.persist(")).toBeLessThan(src.indexOf("saveIdempotencyResult("));
  });
});
