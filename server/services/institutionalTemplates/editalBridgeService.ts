/**
 * Bridge OPERACIONAL do workspace de Edital (Processo Licitatório) → motor de Modelos Institucionais.
 *
 * A decisão entre o gerador LEGADO e o modelo INSTITUCIONAL é do SERVIDOR (o cliente só exibe a resolução):
 *   feature OFF ................................ LEGADO (comportamento inalterado)
 *   feature ON + NOT_BOUND ..................... LEGADO governado (fallback compatível)
 *   feature ON + binding EXATO resolvido ....... INSTITUCIONAL (nunca cai para o legado; falha ⇒ erro)
 *   feature ON + CONFLICT / INVALID ............ falha fechada, nenhum gerador executa
 *
 * Reuso, sem arquitetura paralela: resolução = `resolveBindingForGeneration` (a MESMA da geração); composição =
 * `generateTemplatedDocument`; legado = `generateNotice` (injetado, evitando ciclo). A normalização de vocabulário (eletronico →
 * eletronica…) é feita SÓ no adapter de fronteira, antes do resolvedor. Critério/regime NÃO entram no escopo do binding.
 * O TR oficial é um PIN EXATO (id + versão + hash) confirmado por pessoa — nunca "o último" implícito.
 */
import { TRPCError } from "@trpc/server";
import { listEmittedByOrigin } from "../../db/officialDocuments";
import type { BindingScope } from "../../domain/institutionalTemplates/binding";
import { adaptEditalParamsToBindingScope, type EditalBoundaryParams } from "../../domain/institutionalTemplates/editalBridgeScope";
import { readScope, type ScopeView } from "../../domain/institutionalTemplates/governance/scopeDimensions";
import type { OrgId } from "../../domain/institutionalTemplates/types";
import { serviceLogger } from "../observabilityService";
import { officialContentHash } from "./adapters/canonicalAdapter";
import type { RequestedOfficialPin, TemplatePorts } from "./ports";
import { resolveBindingForGeneration, type GenerateTemplatedDocumentParams, type GenerateTemplatedDocumentResult } from "./templateCompositionService";

const log = serviceLogger("EditalTemplateBridge");

export const TR_OFICIAL_EXATO_NECESSARIO = "TR_OFICIAL_EXATO_NECESSARIO";
const DOMAIN = "processo_licitatorio";

export type EditalGenerationMode = "LEGACY" | "INSTITUTIONAL_TEMPLATE";

export interface BoundTemplateView {
  readonly bindingId: string;
  readonly identityId: string;
  readonly displayName: string;
  readonly revisionId: string;
  readonly revision: number;
  readonly semanticHash: string;
  readonly scope: ScopeView;
}

export type EditalTemplateResolution =
  | { readonly status: "FEATURE_OFF" }
  | { readonly status: "NOT_BOUND"; readonly reason: "NO_BINDING" | "UNMAPPED_SCOPE" | "PARAMETERS_INCOMPLETE"; readonly detail?: string }
  | { readonly status: "BOUND"; readonly template: BoundTemplateView; readonly normalizedScope: ScopeView }
  | { readonly status: "CONFLICT"; readonly bindingIds: readonly string[] }
  | { readonly status: "INVALID"; readonly codes: readonly string[] };

export interface BridgeDeps {
  /** Ports da composição, ou `null` quando o módulo não está integrado nesta instalação (⇒ feature OFF). */
  readonly ports: TemplatePorts | null;
  readonly now: () => string;
}

/** Leitura autoritativa: qual modelo institucional (se houver) se aplica a estes parâmetros. Não escreve nada, não devolve AST. */
export async function resolveEditalTemplate(deps: BridgeDeps, organizationId: OrgId, params: EditalBoundaryParams): Promise<EditalTemplateResolution> {
  if (!deps.ports) return { status: "FEATURE_OFF" };
  if (!(await deps.ports.enablement.isEnabled(organizationId))) return { status: "FEATURE_OFF" };
  const adapted = adaptEditalParamsToBindingScope(params);
  if (!adapted.ok) {
    return { status: "NOT_BOUND", reason: adapted.reason === "PARAMETERS_INCOMPLETE" ? "PARAMETERS_INCOMPLETE" : "UNMAPPED_SCOPE", detail: adapted.detail };
  }
  const resolution = await resolveBindingForGeneration(deps.ports, organizationId, "edital", adapted.scope, deps.now());
  switch (resolution.status) {
    case "NOT_BOUND": return { status: "NOT_BOUND", reason: "NO_BINDING" };
    case "AMBIGUOUS": return { status: "CONFLICT", bindingIds: [...resolution.bindingIds] };
    case "INVALID": return { status: "INVALID", codes: [...new Set(resolution.issues.map((i) => i.code))] };
    default: {
      const identity = await deps.ports.repository.getIdentity(organizationId, resolution.binding.identityId);
      if (!identity || identity.organizationId !== organizationId) return { status: "INVALID", codes: ["IDENTITY_NOT_FOUND"] };
      return {
        status: "BOUND",
        template: {
          bindingId: resolution.binding.id, identityId: identity.id, displayName: identity.displayName || identity.slug,
          revisionId: resolution.revision.id, revision: resolution.revision.revision, semanticHash: resolution.revision.semanticHash,
          scope: readScope(resolution.binding.scope),
        },
        normalizedScope: readScope(adapted.scope),
      };
    }
  }
}

export interface EditalTrCandidate {
  readonly documentId: string;
  readonly title: string;
  readonly version: number;
  readonly contentHash: string;
  readonly status: string;
  readonly createdAt: string;
  /** Só a versão VIGENTE (a mais recente emitida) é aceita como pin; as anteriores aparecem como obsoletas. */
  readonly current: boolean;
}

/** TRs OFICIAIS emitidos do processo (mesmo tenant), com o hash calculado no servidor. Nada é escolhido pelo servidor. */
export async function listEditalTrCandidates(organizationId: OrgId, processId: string): Promise<EditalTrCandidate[]> {
  const docs = await listEmittedByOrigin(organizationId, DOMAIN, processId, "tr");
  return docs.map((d, i) => ({
    documentId: d.id, title: d.title, version: d.version, contentHash: officialContentHash(d.content), status: d.status, createdAt: d.createdAt, current: i === 0,
  }));
}

export interface RoutedGenerateParams<L> {
  readonly organizationId: OrgId;
  readonly processId: string;
  readonly object: string;
  readonly actorUserId: number;
  readonly correlationId: string;
  /** Parâmetros efetivos (proposta explícita OU os persistidos pelo fluxo legado), já resolvidos pelo chamador. */
  readonly params: EditalBoundaryParams;
  readonly officialPins?: { readonly TR?: RequestedOfficialPin };
  /** Gerador LEGADO (`generateNotice`), executado apenas em FEATURE_OFF / NOT_BOUND. */
  readonly legacy: () => Promise<L>;
  /** Gerador institucional (`generateTemplatedDocument`). */
  readonly institutional: (p: GenerateTemplatedDocumentParams) => Promise<GenerateTemplatedDocumentResult>;
}

export type RoutedGenerateResult<L> =
  | { readonly mode: "LEGACY"; readonly legacy: L; readonly resolution: EditalTemplateResolution }
  | { readonly mode: "INSTITUTIONAL_TEMPLATE"; readonly result: GenerateTemplatedDocumentResult; readonly template: BoundTemplateView };

export async function generateEditalRouted<L>(deps: BridgeDeps, p: RoutedGenerateParams<L>): Promise<RoutedGenerateResult<L>> {
  const resolution = await resolveEditalTemplate(deps, p.organizationId, p.params);
  switch (resolution.status) {
    case "FEATURE_OFF":
    case "NOT_BOUND": {
      log.info("edital_generation_mode", { organizationId: p.organizationId, processId: p.processId, generationMode: "LEGACY", resolution: resolution.status, correlationId: p.correlationId });
      return { mode: "LEGACY", legacy: await p.legacy(), resolution };
    }
    case "CONFLICT":
      throw new TRPCError({ code: "CONFLICT", message: `TEMPLATE_BINDING_AMBIGUOUS: mais de um vínculo vigente (${resolution.bindingIds.join(", ")}) — nenhum modelo é escolhido automaticamente` });
    case "INVALID":
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `TEMPLATE_BINDING_INVALID: ${resolution.codes.join(", ")}` });
    case "BOUND": {
      // TR oficial EXATO obrigatório ANTES de qualquer efeito (zero writes). Nunca "o último" implícito.
      const tr = p.officialPins?.TR;
      if (!tr) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${TR_OFICIAL_EXATO_NECESSARIO}: confirme o TR oficial emitido (id, versão e hash) para gerar o edital com o modelo institucional` });
      log.info("edital_generation_mode", {
        organizationId: p.organizationId, processId: p.processId, generationMode: "INSTITUTIONAL_TEMPLATE", bindingId: resolution.template.bindingId,
        templateIdentityId: resolution.template.identityId, templateRevisionId: resolution.template.revisionId,
        semanticHashPrefix: resolution.template.semanticHash.slice(0, 8), correlationId: p.correlationId,
      });
      // Sem try/catch de fallback: qualquer falha institucional é erro (NUNCA cai para o gerador legado).
      const result = await p.institutional({
        organizationId: p.organizationId, subjectId: p.processId, documentKind: "edital", documentType: "edital",
        scope: resolution.normalizedScope as BindingScope, asOf: deps.now(), title: `Edital — ${p.object}`,
        actorUserId: p.actorUserId, correlationId: p.correlationId, officialPins: { TR: tr },
      });
      return { mode: "INSTITUTIONAL_TEMPLATE", result, template: resolution.template };
    }
  }
}
