/**
 * Institutional Templates (Lane B) — fixture SINTÉTICA para composição/emissão (sem texto jurídico real, sem DB).
 */
import {
  createDraftRevision, transitionRevision,
  type TemplateAST, type TemplateIdentity, type TemplateRevision, type VariableCatalog,
} from "../../domain/institutionalTemplates";
import type {
  AiNarrativeOutput, CanonicalSourceSnapshot, OfficialDocumentPin, TemplateComposeRequest,
} from "../../domain/institutionalTemplates/composer";
import type { DocRefKind } from "../../domain/institutionalTemplates/ast";
import type { VariableSource } from "../../domain/institutionalTemplates/variableCatalog";

export const ORG_A = 971001;
export const ORG_B = 971002;
export const H = (c: string): string => c.repeat(64).slice(0, 64);

export const catalog: VariableCatalog = {
  version: "cat-lane-b/1",
  vars: [
    { name: "processo.numero", type: "string", source: "PROCESS", path: "number", required: true },
    { name: "objeto", type: "string", source: "TR", path: "object", required: true },
    { name: "srp", type: "enum", source: "PARAMS", path: "srp", required: true },
    { name: "valorEstimado", type: "money", source: "ITEMS", path: "estimatedTotalCents", required: false },
    { name: "quantidade", type: "number", source: "ITEMS", path: "plannedQuantity", required: true },
    { name: "dataAbertura", type: "date", source: "PARAMS", path: "openingDate", required: false },
    { name: "lotes", type: "list", source: "ITEMS", path: "lots", required: false },
    { name: "orgao", type: "string", source: "IDENTITY", path: "organizationName", required: true },
  ],
};

export const ast: TemplateAST = {
  schema: "tpl-ast/1",
  root: [
    { t: "heading", level: 1, text: [{ t: "text", v: "Edital nº " }, { t: "var", name: "processo.numero" }] },
    { t: "paragraph", inline: [{ t: "text", v: "Órgão: " }, { t: "var", name: "orgao" }] },
    { t: "section", key: "objeto", legalRef: "sintetico", children: [
      { t: "paragraph", inline: [{ t: "strong", v: [{ t: "text", v: "Objeto: " }] }, { t: "var", name: "objeto" }] },
    ] },
    { t: "conditional", when: { op: "eq", var: "srp", value: "SIM" },
      then: [{ t: "paragraph", inline: [{ t: "text", v: "Bloco sintético SRP." }] }],
      else: [{ t: "paragraph", inline: [{ t: "text", v: "Bloco sintético sem SRP." }] }] },
    { t: "table", header: [[{ t: "text", v: "Quantidade" }], [{ t: "text", v: "Valor estimado" }]],
      rows: [[[{ t: "var", name: "quantidade" }], [{ t: "var", name: "valorEstimado" }]]] },
    { t: "list", ordered: true, items: [
      [{ t: "paragraph", inline: [{ t: "text", v: "Abertura: " }, { t: "var", name: "dataAbertura" }] }],
      [{ t: "paragraph", inline: [{ t: "text", v: "Lotes: " }, { t: "var", name: "lotes" }] }],
    ] },
    { t: "docRef", kind: "TR", mode: "EXACT_PINNED" },
    { t: "aiSlot", slotKey: "justificativa", maxTokens: 60, instructionsKey: "edital.justificativa" },
    { t: "annex", id: "anexo-i", title: [{ t: "text", v: "Anexo I — Termo de Referência" }], children: [{ t: "docRef", kind: "TR", mode: "EXACT_PINNED" }] },
  ],
};

export const identity: TemplateIdentity = {
  id: "tplid_lb1", organizationId: ORG_A, documentKind: "edital", slug: "edital-lane-b", createdAt: "2026-10-01T00:00:00Z", createdByUserId: 7,
};

export function draftRevision(over: Partial<{ id: string; ast: TemplateAST; identity: TemplateIdentity }> = {}): TemplateRevision {
  const r = createDraftRevision({ id: over.id ?? "tplrev_lb1", identity: over.identity ?? identity, revision: 1, ast: over.ast ?? ast, catalog, sourceFormat: "NATIVE" });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

export function publishedRevision(over: Partial<{ id: string; ast: TemplateAST; identity: TemplateIdentity }> = {}): TemplateRevision {
  const id = over.identity ?? identity;
  const a = transitionRevision(draftRevision(over), { to: "APPROVED", approvalDecisionId: "dec_approve_lb" }, id, catalog);
  if (!a.ok) throw new Error(JSON.stringify(a.issues));
  const p = transitionRevision(a.value, { to: "PUBLISHED", publishDecisionId: "dec_publish_lb" }, id, catalog);
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  return p.value;
}

export function canonicalSources(org = ORG_A, over: Partial<Record<VariableSource, unknown>> = {}): Partial<Record<VariableSource, CanonicalSourceSnapshot>> {
  const data: Partial<Record<VariableSource, unknown>> = {
    PROCESS: { number: "2026/0001", object: "Objeto do processo" },
    TR: { object: "Aquisição sintética de material" },
    PARAMS: { srp: "SIM", openingDate: "2026-11-05" },
    ITEMS: { plannedQuantity: 1200, estimatedTotalCents: 123456, lots: ["Lote 1", "Lote 2"] },
    IDENTITY: { organizationName: "Órgão Sintético" },
    ...over,
  };
  const out: Partial<Record<VariableSource, CanonicalSourceSnapshot>> = {};
  for (const [k, v] of Object.entries(data)) out[k as VariableSource] = { organizationId: org, data: v };
  return out;
}

export function trPin(org = ORG_A, over: Partial<OfficialDocumentPin> = {}): Partial<Record<DocRefKind, OfficialDocumentPin>> {
  return { TR: { organizationId: org, documentId: "odoc_tr_1", lineageId: "odln_tr_1", version: 2, contentHash: H("a"), title: "Termo de Referência", ...over } };
}

export function narrative(text = "Justificativa sintética redigida para revisão humana.", over: Partial<AiNarrativeOutput> = {}): AiNarrativeOutput {
  return { organizationId: ORG_A, slotKey: "justificativa", executionId: "aiexec_1", text, ...over };
}

export function composeRequest(over: Partial<TemplateComposeRequest> = {}): TemplateComposeRequest {
  const revision = over.revision ?? publishedRevision();
  return {
    organizationId: ORG_A,
    identity,
    revision,
    catalog,
    pin: { identityId: revision.identityId, revisionId: revision.id, semanticHash: revision.semanticHash },
    sources: canonicalSources(),
    officialDocuments: trPin(),
    aiNarratives: [narrative()],
    identityFingerprint: "fp-identity-1",
    generatedDocumentId: "gdoc_lb_1",
    createdAt: "2026-10-06T12:00:00.000Z",
    ...over,
  };
}
