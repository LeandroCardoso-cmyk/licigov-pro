/**
 * Adapter REAL do `CompositionPort.previewComposition`: o composer PURO da Lane B em modo PREVIEW (qualquer estado de
 * revisão; nada é persistido; nenhuma IA). Os valores de exemplo viram snapshots sintéticos por fonte via catálogo
 * (`source` + `path`), de modo que a prévia passe pelo MESMO caminho de resolução da geração real.
 */
import { referencedVariables } from "../../../domain/institutionalTemplates/ast";
import { composeTemplate, templateRequirements, type AiNarrativeOutput, type CanonicalSourceSnapshot, type OfficialDocumentPin } from "../../../domain/institutionalTemplates/composer";
import type { ComposeInput, ComposeOutcome, TemplateIdentity } from "../../../domain/institutionalTemplates";
import { findVariable, type VariableSource } from "../../../domain/institutionalTemplates/variableCatalog";
import { sha256Hex } from "../../../domain/canonicalJson";
import type { DocRefKind } from "../../../domain/institutionalTemplates/ast";
import type { CompositionPort } from "../ports";

const PREVIEW_AT = "1970-01-01T00:00:00.000Z";

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split(".");
  let cur = root;
  segs.slice(0, -1).forEach((seg) => {
    const next = cur[seg];
    cur[seg] = typeof next === "object" && next !== null && !Array.isArray(next) ? next : {};
    cur = cur[seg] as Record<string, unknown>;
  });
  cur[segs[segs.length - 1]] = value;
}

export function previewComposeOutcome(input: ComposeInput & { identity?: TemplateIdentity }): ComposeOutcome {
  const { revision, catalog } = input;
  const identity: TemplateIdentity = input.identity ?? {
    id: revision.identityId, organizationId: revision.organizationId, documentKind: "edital", slug: "preview", createdAt: PREVIEW_AT, createdByUserId: 1,
  };
  const data: Partial<Record<VariableSource, Record<string, unknown>>> = {};
  for (const name of referencedVariables(revision.ast)) {
    const def = findVariable(catalog, name);
    if (!def || input.values[name] === undefined) continue;
    const bucket = (data[def.source] ??= {});
    setPath(bucket, def.path, input.values[name]);
  }
  const sources: Partial<Record<VariableSource, CanonicalSourceSnapshot>> = {};
  for (const [k, v] of Object.entries(data)) sources[k as VariableSource] = { organizationId: revision.organizationId, data: v };

  const needs = templateRequirements(revision.ast.root);
  const officialDocuments: Partial<Record<DocRefKind, OfficialDocumentPin>> = {};
  for (const kind of needs.docRefKinds) {
    officialDocuments[kind] = {
      organizationId: revision.organizationId, documentId: `preview-${kind}`, lineageId: `preview-${kind}`, version: 1,
      contentHash: sha256Hex(`preview:${kind}`), title: `[pré-visualização] ${kind}`,
    };
  }
  const aiNarratives: AiNarrativeOutput[] = needs.aiSlots.filter((k) => (input.aiNarratives[k] ?? "").trim() !== "").map((slotKey) => ({
    organizationId: revision.organizationId, slotKey, executionId: "preview", text: input.aiNarratives[slotKey],
  }));

  const result = composeTemplate({
    organizationId: revision.organizationId, identity, revision, catalog,
    pin: { identityId: revision.identityId, revisionId: revision.id, semanticHash: revision.semanticHash },
    sources, officialDocuments, aiNarratives, identityFingerprint: "preview", generatedDocumentId: "preview", createdAt: PREVIEW_AT, purpose: "PREVIEW",
  });
  if (!result.ok) {
    const codes = new Set(result.issues.map((i) => i.code));
    if (codes.has("UNKNOWN_VARIABLE")) return { error: "UNKNOWN_VARIABLE" };
    if (codes.has("MISSING_REQUIRED")) return { error: "MISSING_REQUIRED" };
    if (codes.has("CONDITION_INVALID")) return { error: "CONDITION_INVALID" };
    return { error: "AST_INVALID" };
  }
  const { id: _id, createdAt: _createdAt, ...manifestDraft } = result.value.manifest;
  return { content: { text: result.value.content.text }, manifestDraft };
}

export function createPreviewCompositionPort(): CompositionPort {
  return { previewComposition: (input) => previewComposeOutcome(input) };
}
