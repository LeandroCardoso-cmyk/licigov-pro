/**
 * Institutional Templates — serviço de COMPOSIÇÃO e EMISSÃO governadas (Lane B).
 *
 * Fluxo (o Template Composer é uma ETAPA governada da geração; o domínio continua sendo a verdade):
 *   dados canônicos do domínio → revisão EXATA do template (binding com pin) → composição determinística
 *   → narrativas de IA supervisionadas (só em aiSlot, já produzidas) → M1 → revisão/edição humana
 *   → revalidação canônica → M2 → promoção/emissão oficial.
 *
 *  - O `documentEngineService` continua o ÚNICO ponto de geração oficial: a versão `gerado` do texto composto é
 *    criada por `generateOfficialDocument`, na MESMA transação que grava o rascunho e o M1.
 *  - Toda leitura (binding, revisão, fontes canônicas, referências oficiais, IA) acontece FORA da transação; a
 *    transação (com o retry de deadlock do SEM-084, que a repete INTEIRA) só escreve. Ids determinísticos ⇒ repetir
 *    a transação ou o comando não duplica efeito semântico.
 *  - A emissão usa `promoteOfficialDocument` (C.4B.1): este módulo fornece o hook que revalida antes da transação e
 *    grava o M2 dentro dela. `SOURCE_CHANGED` bloqueia a emissão; nada é regenerado nem mutado automaticamente.
 *  - Fail-closed: organização não habilitada, ports sem backing ou qualquer inconsistência ⇒ erro, sem fallback.
 * Sem publicação externa (PNCP/BLL/Diário), sem router e sem feature flag.
 */
import { TRPCError } from "@trpc/server";
import { getDb } from "../../db/connection";
import type { DocumentBusinessDomain, OfficialDocumentType } from "../../domain/officialDocument";
import { referencedVariables } from "../../domain/institutionalTemplates/ast";
import { resolveTemplateBinding, type BindingScope } from "../../domain/institutionalTemplates/binding";
import {
  composeTemplate, templateRequirements,
  type AiNarrativeOutput, type ComposedDocument, type ComposeResult, type TemplateComposeRequest,
} from "../../domain/institutionalTemplates/composer";
import { manifestRevisionIssues, validateManifest, type GenerationManifest, type IssuanceManifest } from "../../domain/institutionalTemplates/manifest";
import { buildIssuanceManifest, revalidateForIssuance } from "../../domain/institutionalTemplates/revalidation";
import type { TemplateIdentity, TemplateRevision } from "../../domain/institutionalTemplates/revision";
import type { OrgId, TemplateDocumentKind } from "../../domain/institutionalTemplates/types";
import { findVariable, type VariableCatalog, type VariableSource } from "../../domain/institutionalTemplates/variableCatalog";
import { sha256Hex } from "../../domain/canonicalJson";
import { generateOfficialDocument } from "../documentEngineService";
import { serviceLogger } from "../observabilityService";
import { runTransactionWithDeadlockRetry } from "../transactionDeadlockRetry";
import { TemplatePersistenceUnavailableError, type TemplatePorts, type TemplateTransactionPort, type TemplateTxExecutor } from "./ports";

const log = serviceLogger("TemplateCompositionService");

export const TEMPLATE_COMPOSITION_DISABLED = "TEMPLATE_COMPOSITION_DISABLED";
export const TEMPLATE_NOT_BOUND = "TEMPLATE_NOT_BOUND";
export const TEMPLATE_BINDING_AMBIGUOUS = "TEMPLATE_BINDING_AMBIGUOUS";
export const TEMPLATE_BINDING_INVALID = "TEMPLATE_BINDING_INVALID";
export const TEMPLATE_COMPOSITION_FAILED = "TEMPLATE_COMPOSITION_FAILED";
export const TEMPLATE_ISSUANCE_BLOCKED = "TEMPLATE_ISSUANCE_BLOCKED";

/** Aviso obrigatório: todo texto composto (e toda narrativa de IA) é revisado e aceito por humano antes da emissão. */
export const TEMPLATE_REVIEW_NOTICE = "Documento composto a partir de modelo institucional: revisão humana obrigatória antes da emissão; narrativas de IA exigem aceite humano explícito.";

/** Tipo documental do template → domínio/tipo do documento oficial (o tipo oficial é informado explicitamente). */
const KIND_TARGETS: Readonly<Record<TemplateDocumentKind, { readonly businessDomain: DocumentBusinessDomain; readonly documentTypes: readonly OfficialDocumentType[] }>> = {
  dfd: { businessDomain: "processo_licitatorio", documentTypes: ["dfd"] },
  etp: { businessDomain: "processo_licitatorio", documentTypes: ["etp"] },
  tr: { businessDomain: "processo_licitatorio", documentTypes: ["tr"] },
  edital: { businessDomain: "processo_licitatorio", documentTypes: ["edital"] },
  parecer: { businessDomain: "parecer_juridico", documentTypes: ["parecer_inicial", "parecer_final"] },
  contrato: { businessDomain: "contratos", documentTypes: ["contrato"] },
  aditivo: { businessDomain: "contratos", documentTypes: ["aditivo"] },
};

function codesOf(issues: readonly { code: string }[]): string {
  return [...new Set(issues.map((i) => i.code))].join(", ");
}

function preconditionFailed(code: string, detail: string): TRPCError {
  return new TRPCError({ code: "PRECONDITION_FAILED", message: `${code}: ${detail}` });
}

/** Transação DONA da escrita com o retry do SEM-084 (repete a transação inteira; só deadlock). */
export function createTemplateTransactionPort(): TemplateTransactionPort {
  return {
    async run(label, organizationId, correlationId, fn) {
      const db = await getDb();
      if (!db) throw new TemplatePersistenceUnavailableError("transactions");
      return runTransactionWithDeadlockRetry({ label, organizationId, correlationId }, () => db.transaction(async (tx) => fn(tx)));
    },
  };
}

async function assertEnabled(ports: TemplatePorts, organizationId: OrgId): Promise<void> {
  if (!(await ports.enablement.isEnabled(organizationId))) {
    throw preconditionFailed(TEMPLATE_COMPOSITION_DISABLED, "modelos institucionais não estão habilitados para esta organização (nenhuma composição/emissão por template)");
  }
}

/** Fontes canônicas consultadas pelas variáveis do AST (via catálogo). */
function requiredSources(revision: TemplateRevision, catalog: VariableCatalog): VariableSource[] {
  const out = new Set<VariableSource>();
  for (const name of referencedVariables(revision.ast)) {
    const def = findVariable(catalog, name);
    if (def) out.add(def.source);
  }
  return [...out].sort();
}

interface LoadedTemplate {
  readonly identity: TemplateIdentity;
  readonly revision: TemplateRevision;
  readonly catalog: VariableCatalog;
}

/** Carrega identidade + revisão EXATA + catálogo da revisão (tenant-scoped; ausente ⇒ falha fechada). */
async function loadExactTemplate(ports: TemplatePorts, organizationId: OrgId, identityId: string, revisionId: string): Promise<LoadedTemplate> {
  const [identity, revision] = await Promise.all([
    ports.repository.getIdentity(organizationId, identityId),
    ports.repository.getRevision(organizationId, revisionId),
  ]);
  if (!identity || !revision || identity.organizationId !== organizationId || revision.organizationId !== organizationId
      || revision.identityId !== identityId || revision.id !== revisionId) {
    throw preconditionFailed(TEMPLATE_BINDING_INVALID, "revisão fixada não encontrada para a organização");
  }
  const catalog = ports.catalog.byVersion(revision.variableCatalogVersion);
  if (!catalog || catalog.version !== revision.variableCatalogVersion) {
    throw preconditionFailed(TEMPLATE_COMPOSITION_FAILED, `catálogo de variáveis ${revision.variableCatalogVersion} indisponível (CATALOG_VERSION_MISMATCH)`);
  }
  return { identity, revision, catalog };
}

/** Lê do domínio institucional tudo de que a revisão precisa (fora da transação). */
async function loadCanonicalInputs(ports: TemplatePorts, organizationId: OrgId, subjectId: string, t: LoadedTemplate) {
  const needs = templateRequirements(t.revision.ast.root);
  const [sources, officialDocuments, identityFingerprint] = await Promise.all([
    ports.canonical.resolveSources(organizationId, subjectId, requiredSources(t.revision, t.catalog)),
    ports.canonical.resolveOfficialDocuments(organizationId, subjectId, needs.docRefKinds),
    ports.canonical.identityFingerprint(organizationId),
  ]);
  return { sources, officialDocuments, identityFingerprint };
}

// ─── Geração (composição → M1 → versão `gerado` pelo Document Engine) ─────────────────────────────────────────────

export interface GenerateTemplatedDocumentParams {
  readonly organizationId: OrgId;
  /** Sujeito institucional (processo/contrato/solicitação) — `origin` do documento oficial. */
  readonly subjectId: string;
  readonly documentKind: TemplateDocumentKind;
  readonly documentType: OfficialDocumentType;
  readonly scope: BindingScope;
  /** Instante de referência EXPLÍCITO para a vigência do binding (ISO-8601 UTC). */
  readonly asOf: string;
  readonly title: string;
  readonly actorUserId: number;
  readonly correlationId: string;
  /** Narrativas de IA já produzidas para os `aiSlot` da revisão (opcional; nunca aceitas por padrão). */
  readonly aiNarratives?: readonly AiNarrativeOutput[];
}

export interface GenerateTemplatedDocumentResult {
  readonly generationManifest: GenerationManifest;
  readonly content: string;
  readonly composedOutputHash: string;
  readonly generatedDocumentId: string;
  readonly officialDocument: { readonly id: string; readonly version: number; readonly lineageId: string } | null;
  /** true ⇒ o mesmo M1 já existia (mesmas entradas canônicas): nada foi escrito de novo. */
  readonly replayed: boolean;
  readonly reviewNotice: string;
}

export async function generateTemplatedDocument(params: GenerateTemplatedDocumentParams, ports: TemplatePorts): Promise<GenerateTemplatedDocumentResult> {
  if (!Number.isSafeInteger(params.actorUserId) || params.actorUserId <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Geração por template exige o usuário que a solicita." });
  }
  await assertEnabled(ports, params.organizationId);
  const target = KIND_TARGETS[params.documentKind];
  if (!target || !target.documentTypes.includes(params.documentType)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Tipo oficial ${params.documentType} incompatível com o modelo ${params.documentKind}.` });
  }

  // 1. Binding determinístico (regra pura do T1): ambíguo/sem pin/não publicado ⇒ falha fechada.
  const bindings = await ports.repository.listBindings(params.organizationId, { documentKind: params.documentKind, activeOnly: true });
  const revisions: TemplateRevision[] = [];
  for (const identityId of [...new Set(bindings.map((b) => b.identityId))].sort()) {
    revisions.push(...(await ports.repository.listRevisions(params.organizationId, identityId)));
  }
  const resolution = resolveTemplateBinding(
    { organizationId: params.organizationId, documentKind: params.documentKind, scope: params.scope, asOf: params.asOf },
    bindings, revisions,
  );
  if (resolution.status === "NOT_BOUND") throw preconditionFailed(TEMPLATE_NOT_BOUND, "nenhum modelo vigente vinculado a este tipo/escopo");
  if (resolution.status === "AMBIGUOUS") {
    throw new TRPCError({ code: "CONFLICT", message: `${TEMPLATE_BINDING_AMBIGUOUS}: mais de um vínculo vigente (${resolution.bindingIds.join(", ")}) — nenhum é escolhido automaticamente` });
  }
  if (resolution.status === "INVALID") throw preconditionFailed(TEMPLATE_BINDING_INVALID, codesOf(resolution.issues));

  // 2. Revisão EXATA (relida pelo id fixado) + catálogo da revisão.
  const t = await loadExactTemplate(ports, params.organizationId, resolution.binding.identityId, resolution.binding.pinnedRevisionId!);
  if (t.revision.semanticHash !== resolution.revision.semanticHash) throw preconditionFailed(TEMPLATE_BINDING_INVALID, "revisão fixada divergente entre leituras");

  // 3. Fontes canônicas + rascunho de destino (fora da transação).
  const [canonical, generatedDocumentId] = await Promise.all([
    loadCanonicalInputs(ports, params.organizationId, params.subjectId, t),
    ports.drafts.reserveDraftId(params.organizationId, params.subjectId, params.documentType),
  ]);

  // 4. Composição pura + M1 selado.
  const request: TemplateComposeRequest = {
    organizationId: params.organizationId, identity: t.identity, revision: t.revision, catalog: t.catalog,
    pin: { identityId: t.identity.id, revisionId: t.revision.id, semanticHash: t.revision.semanticHash },
    sources: canonical.sources, officialDocuments: canonical.officialDocuments, aiNarratives: params.aiNarratives ?? [],
    identityFingerprint: canonical.identityFingerprint, generatedDocumentId, createdAt: ports.clock.now(), purpose: "GENERATION",
  };
  const composed = composeTemplate(request);
  if (!composed.ok) throw preconditionFailed(TEMPLATE_COMPOSITION_FAILED, codesOf(composed.issues));
  const m1 = composed.value.manifest;

  // 5. Escrita atômica (rascunho + versão `gerado` + M1), repetida inteira em deadlock.
  const written = await ports.transactions.run("template.compose", params.organizationId, params.correlationId, async (tx: TemplateTxExecutor) => {
    const existing = await ports.manifests.getManifest(params.organizationId, m1.id, tx);
    if (existing) {
      if (existing.stage !== "GENERATION" || existing.manifestHash !== m1.manifestHash || existing.organizationId !== params.organizationId) {
        throw new TRPCError({ code: "CONFLICT", message: `${TEMPLATE_COMPOSITION_FAILED}: manifest ${m1.id} já existe com outro conteúdo (MANIFEST_HASH_MISMATCH)` });
      }
      return { official: null, replayed: true, manifest: existing as GenerationManifest };
    }
    await ports.drafts.writeDraft({
      id: generatedDocumentId, organizationId: params.organizationId, subjectId: params.subjectId, documentType: params.documentType,
      title: params.title, content: composed.value.content.text, actorUserId: params.actorUserId, correlationId: params.correlationId,
      generationManifestId: m1.id,
    }, tx);
    // M1 ANTES da versão `gerado`: o INSERT é convergente (o mesmo M1 concorrente/repetido ⇒ `created = false`) e só quem o
    // criou gera a versão oficial — repetir ou competir nunca duplica a versão `gerado` (o rascunho/M1 já a representam).
    const stored = await ports.manifests.insertGenerationManifest(m1, { actorUserId: params.actorUserId, correlationId: params.correlationId }, tx);
    if (!stored.created) return { official: null, replayed: true, manifest: m1 };
    const official = await generateOfficialDocument({
      organizationId: params.organizationId, businessDomain: target.businessDomain, documentType: params.documentType,
      origin: params.subjectId, title: params.title, content: composed.value.content.text, author: String(params.actorUserId),
      status: "gerado", correlationId: params.correlationId,
      metadata: {
        templateGenerationManifestId: m1.id, templateManifestHash: m1.manifestHash, templateRevisionId: m1.templateRevisionId,
        templateSemanticHash: m1.templateSemanticHash, composedOutputHash: m1.composedOutputHash,
        aiNarrativesPendingAcceptance: m1.aiNarratives.length, reviewNotice: TEMPLATE_REVIEW_NOTICE,
      },
    }, tx);
    return { official: { id: official.id, version: official.version, lineageId: official.lineageId }, replayed: false, manifest: m1 };
  });

  log.info("template_composed", {
    organizationId: params.organizationId, generationManifestId: m1.id, templateRevisionId: m1.templateRevisionId,
    composedOutputHash: m1.composedOutputHash, replayed: written.replayed, correlationId: params.correlationId,
  });
  return {
    generationManifest: written.manifest, content: composed.value.content.text, composedOutputHash: m1.composedOutputHash,
    generatedDocumentId, officialDocument: written.official, replayed: written.replayed, reviewNotice: TEMPLATE_REVIEW_NOTICE,
  };
}

// ─── Emissão (revalidação canônica → M2 na transação da promoção) ────────────────────────────────────────────────

export interface TemplateIssuancePreparation {
  readonly issuanceManifest: IssuanceManifest;
  /** Grava o M2 na transação da promoção (repetida inteira pelo retry do SEM-084; o id do M2 é determinístico). */
  persist(link: { readonly officialDocumentId: string; readonly officialVersion: number }, tx: TemplateTxExecutor): Promise<void>;
}

/** Hook consumido por `promoteOfficialDocument`. `null` ⇒ o rascunho não foi composto por template. */
export interface PromotionTemplateIssuanceHook {
  prepare(input: {
    readonly organizationId: OrgId; readonly processId: string; readonly draftId: string;
    readonly content: string; readonly contentHash: string; readonly actorUserId: number; readonly correlationId: string;
  }): Promise<TemplateIssuancePreparation | null>;
}

/** Recompõe com as fontes ATUAIS a mesma revisão/rascunho/narrativas do M1 (para a revalidação). */
async function recompose(ports: TemplatePorts, organizationId: OrgId, subjectId: string, m1: GenerationManifest, t: LoadedTemplate, narratives: readonly AiNarrativeOutput[]): Promise<ComposeResult<ComposedDocument>> {
  const canonical = await loadCanonicalInputs(ports, organizationId, subjectId, t);
  return composeTemplate({
    organizationId, identity: t.identity, revision: t.revision, catalog: t.catalog,
    pin: { identityId: m1.templateIdentityId, revisionId: m1.templateRevisionId, semanticHash: m1.templateSemanticHash },
    sources: canonical.sources, officialDocuments: canonical.officialDocuments, aiNarratives: narratives,
    identityFingerprint: canonical.identityFingerprint, generatedDocumentId: m1.generatedDocumentId, createdAt: m1.createdAt,
    purpose: "REVALIDATION",
  });
}

export function createTemplateIssuanceHook(ports: TemplatePorts): PromotionTemplateIssuanceHook {
  return {
    async prepare(input) {
      const m1 = await ports.manifests.findGenerationManifestForDraft(input.organizationId, input.draftId);
      if (!m1) return null; // rascunho não composto por template: a promoção segue o caminho existente, sem M2.
      // Rascunho COMPOSTO por modelo: com o módulo desabilitado ele NÃO é emitido (sem M2/revalidação não há emissão templated).
      await assertEnabled(ports, input.organizationId);

      const blocked = (codes: string, detail: string): TRPCError => {
        log.warn("template_issuance_blocked", { organizationId: input.organizationId, generationManifestId: m1.id, codes, correlationId: input.correlationId });
        return preconditionFailed(TEMPLATE_ISSUANCE_BLOCKED, `${codes} — ${detail}`);
      };
      const m1Check = validateManifest(m1);
      if (!m1Check.ok || m1.stage !== "GENERATION" || m1.organizationId !== input.organizationId || m1.generatedDocumentId !== input.draftId) {
        throw blocked(m1Check.ok ? "MANIFEST_INVALID" : codesOf(m1Check.issues), "M1 inválido para este rascunho");
      }
      if (sha256Hex(input.content) !== input.contentHash) throw blocked("MANIFEST_HASH_MISMATCH", "hash do conteúdo a emitir não confere");

      const t = await loadExactTemplate(ports, input.organizationId, m1.templateIdentityId, m1.templateRevisionId);
      const consistency = manifestRevisionIssues(m1, t.revision);
      if (consistency.length) throw blocked(codesOf(consistency), "M1 não corresponde à revisão exata");

      // Narrativas de IA auditáveis: o texto recarregado precisa ser EXATAMENTE o registrado no M1.
      const outputs = m1.aiNarratives.length
        ? await ports.review.loadAiOutputs(input.organizationId, m1.aiNarratives.map((n) => n.executionId))
        : [];
      for (const n of m1.aiNarratives) {
        const o = outputs.find((x) => x.executionId === n.executionId && x.slotKey === n.slotKey && x.organizationId === input.organizationId);
        if (!o || sha256Hex(o.text) !== n.outputHash) throw blocked("AI_NARRATIVE_NOT_ACCEPTED", `saída de IA do slot ${n.slotKey} ausente ou divergente do registrado`);
      }

      const [recomposition, humanEdits, aiAcceptances, acknowledgments] = await Promise.all([
        recompose(ports, input.organizationId, input.processId, m1, t, outputs),
        ports.review.listHumanEdits(input.organizationId, m1.generatedDocumentId, m1.composedOutputHash),
        ports.review.listAiAcceptances(input.organizationId, m1.id),
        ports.review.listDeviationAcknowledgments(input.organizationId, m1.id),
      ]);
      const outcome = revalidateForIssuance({
        organizationId: input.organizationId, generation: m1, recomposition, issuedContent: input.content,
        humanEdits, aiAcceptances, acknowledgments, checkedAt: ports.clock.now(),
      });
      if (!outcome.ok) throw blocked(codesOf(outcome.issues), outcome.issues.map((i) => i.message).join(" "));

      const m2 = buildIssuanceManifest(m1, outcome.value, ports.clock.now());
      if (!m2.ok) throw blocked(codesOf(m2.issues), "M2 inválido");
      const issuanceManifest = m2.value;
      log.info("template_issuance_revalidated", {
        organizationId: input.organizationId, generationManifestId: m1.id, issuanceManifestId: issuanceManifest.id,
        status: issuanceManifest.canonicalRevalidation.status, correlationId: input.correlationId,
      });
      return {
        issuanceManifest,
        persist: (link, tx) => ports.manifests.insertIssuanceManifest(issuanceManifest, link, { actorUserId: input.actorUserId, correlationId: input.correlationId }, tx),
      };
    },
  };
}
