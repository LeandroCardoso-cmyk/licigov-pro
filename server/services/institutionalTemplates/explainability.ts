/**
 * Explicabilidade operacional da composição (Lane C). Resume — sem expor conteúdo interno nem segredos — QUAL modelo,
 * QUAL revisão exata, quais pins de fonte, quais decisões condicionais, presença/aceite de narrativa de IA e a
 * identidade/hash do manifest. Puro; consome o `manifestDraft` do composer (Lane B) ou um manifest persistido.
 */
import type { CompositionManifest, GenerationManifest, TemplateIdentity, TemplateRevision } from "../../domain/institutionalTemplates";
import { summarizeAst } from "./astSummary";

export type AiNarrativeStatus = "PLACEHOLDER_ONLY" | "PRESENT_PENDING_HUMAN_ACCEPTANCE" | "PRESENT_HUMAN_ACCEPTED" | "ABSENT";

export interface CompositionExplanation {
  readonly template: { readonly identityId: string; readonly slug: string; readonly documentKind: string };
  readonly revision: { readonly id: string; readonly revision: number; readonly status: string; readonly semanticHash: string; readonly hashVersion: string; readonly catalogVersion: string };
  readonly sourcePins: readonly { readonly key: string; readonly digest: string }[];
  readonly conditionalDecisions: readonly { readonly nodePath: string; readonly result: boolean; readonly traceHash: string }[];
  readonly aiNarratives: readonly { readonly slotKey: string; readonly status: AiNarrativeStatus; readonly humanAccepted: boolean | null }[];
  readonly officialDocRefs: readonly { readonly role: string; readonly order: number; readonly documentId: string; readonly version: number; readonly title: string }[];
  readonly annexes: readonly { readonly id: string }[];
  readonly manifest: { readonly stage: string; readonly persisted: boolean; readonly id: string | null; readonly manifestHash: string; readonly composedOutputHash: string };
  readonly notices: readonly string[];
}

type ManifestLike = Omit<GenerationManifest, "id" | "createdAt"> | CompositionManifest;

function narratives(manifest: ManifestLike, revision: TemplateRevision, preview: boolean): CompositionExplanation["aiNarratives"] {
  const slots = summarizeAst(revision.ast).aiSlotKeys;
  const byKey = new Map(manifest.aiNarratives.map((n) => [n.slotKey, n]));
  const keys = [...new Set([...slots, ...byKey.keys()])].sort();
  return keys.map((slotKey) => {
    const ref = byKey.get(slotKey);
    if (preview) return { slotKey, status: "PLACEHOLDER_ONLY" as const, humanAccepted: null };
    if (!ref) return { slotKey, status: "ABSENT" as const, humanAccepted: null };
    return { slotKey, status: ref.humanAccepted ? ("PRESENT_HUMAN_ACCEPTED" as const) : ("PRESENT_PENDING_HUMAN_ACCEPTANCE" as const), humanAccepted: ref.humanAccepted };
  });
}

export function explainComposition(args: {
  readonly identity: TemplateIdentity;
  readonly revision: TemplateRevision;
  readonly manifest: ManifestLike;
  /** `true` = pré-visualização (nada persistido, nenhuma IA chamada). */
  readonly preview: boolean;
}): CompositionExplanation {
  const { identity, revision, manifest, preview } = args;
  const persistedId = "id" in manifest && typeof (manifest as { id?: unknown }).id === "string" ? (manifest as { id: string }).id : null;
  const notices: string[] = [];
  if (preview) notices.push("Pré-visualização: nenhuma IA foi chamada e nada foi persistido; slots de IA aparecem como marcadores.");
  if (revision.status !== "PUBLISHED") notices.push(`A revisão está ${revision.status}: só uma revisão PUBLISHED pode ser vinculada e usada em geração.`);
  return {
    template: { identityId: identity.id, slug: identity.slug, documentKind: identity.documentKind },
    revision: {
      id: revision.id, revision: revision.revision, status: revision.status, semanticHash: revision.semanticHash,
      hashVersion: revision.hashVersion, catalogVersion: revision.variableCatalogVersion,
    },
    sourcePins: manifest.sources.map((s) => ({ key: s.key, digest: s.digest })),
    conditionalDecisions: manifest.conditionalDecisions.map((c) => ({ nodePath: c.nodePath, result: c.result, traceHash: c.traceHash })),
    aiNarratives: narratives(manifest, revision, preview),
    officialDocRefs: manifest.officialDocRefs.map((r) => ({ role: r.role, order: r.order, documentId: r.documentId, version: r.version, title: r.title })),
    annexes: manifest.annexes.map((a) => ({ id: a.id })),
    manifest: { stage: manifest.stage, persisted: !preview && persistedId !== null, id: preview ? null : persistedId, manifestHash: manifest.manifestHash, composedOutputHash: manifest.composedOutputHash },
    notices,
  };
}
