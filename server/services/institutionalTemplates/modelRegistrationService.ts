/**
 * REGISTRO / IMPORTAÇÃO de um modelo (piloto Edital): cria (ou reutiliza) a identidade, cria uma revisão SEMPRE em DRAFT e
 * grava a PROCEDÊNCIA (templateKey, displayName, versão lógica + SHA-256 da fonte, inventário, escopo declarado).
 *
 *  - NUNCA importa para APPROVED/PUBLISHED, nem mesmo com aprovação jurídica externa: depois do DRAFT ainda são necessárias a
 *    aprovação humana no sistema e a decisão humana (distinta) de publicar.
 *  - Não cria binding, não gera documento, não chama IA, não toca processo algum.
 *  - Fonte: AST nativo validado pela whitelist T1, ou Markdown/DOCX pelo pipeline seguro de importação.
 *  - A procedência é um registro separado (ledger): se ela falhar após o DRAFT criado, o resultado informa
 *    `provenance.status = "FAILED"` (a matriz de prontidão a mostra BLOCKED) e o registro pode ser repetido pela mesma rota.
 */
import { validateTemplateAst, type TemplateDocumentKind, type TemplateIdentity, type TemplateRevision } from "../../domain/institutionalTemplates";
import { isSha256 } from "../../domain/institutionalTemplates/types";
import type { ImportProvenance } from "../../domain/institutionalTemplates/governance/importProvenance";
import { readScope, validateExplicitScope, type ScopeView } from "../../domain/institutionalTemplates/governance/scopeDimensions";
import { inventoryCounts, inventoryHash, parseSourceInventory } from "../../domain/institutionalTemplates/governance/sourceInventory";
import { serviceLogger } from "../observabilityService";
import { assertHumanActor } from "./authority";
import { TemplateWorkflowError } from "./errors";
import { TemplateGovernanceService, type DeclaredAuthority } from "./governanceService";
import { runImportPipeline } from "./importPipeline";
import type { TemplateWorkflowPorts, WorkflowContext } from "./ports";
import { InstitutionalTemplatesWorkflow } from "./workflowService";

const log = serviceLogger("templateRegistration");

/** Presets de registro (apenas rótulos e escopo declarado; nenhum conteúdo jurídico). O primeiro modelo do piloto é o BLL. */
export const MODEL_REGISTRATION_PRESETS = Object.freeze([
  Object.freeze({
    presetId: "EDITAL_PREGAO_ELETRONICO_BLL", templateKey: "EDITAL_PREGAO_ELETRONICO_BLL", documentKind: "edital" as TemplateDocumentKind,
    slug: "edital-pregao-eletronico-bll", displayName: "Edital — Pregão Eletrônico — BLL",
    scope: Object.freeze({ modality: "PREGAO", form: "ELETRONICA", platform: "BLL" }) as ScopeView,
  }),
]);

export type RegistrationSource =
  | { readonly kind: "AST"; readonly ast: unknown }
  | { readonly kind: "MARKDOWN"; readonly markdown: string; readonly filename?: string }
  | { readonly kind: "DOCX"; readonly docx: Buffer; readonly filename?: string };

export interface RegisterModelInput {
  readonly target: { readonly kind: "NEW_IDENTITY"; readonly documentKind: TemplateDocumentKind; readonly slug: string } | { readonly kind: "EXISTING_IDENTITY"; readonly identityId: string };
  readonly templateKey: string;
  readonly displayName: string;
  /** Aplicabilidade DECLARADA do modelo (informativa; a autoridade é o binding exato criado depois, por decisão humana). */
  readonly declaredScope: ScopeView;
  readonly source: RegistrationSource;
  readonly sourceLogicalVersion: string;
  readonly sourceSha256: string;
  /** Pacote de proveniência (inventário) — opcional; só seu hash e contagens são gravados (o conteúdo é reenviado na prontidão). */
  readonly inventory?: unknown;
  readonly confirm: boolean;
  readonly idempotencyKey: string;
  readonly decision: DeclaredAuthority;
}

export interface RegisterModelResult {
  readonly identity: TemplateIdentity;
  readonly revision: TemplateRevision;
  readonly provenance: { readonly status: "RECORDED"; readonly value: ImportProvenance } | { readonly status: "FAILED"; readonly message: string };
  readonly notices: readonly string[];
}

export class ModelRegistrationService {
  constructor(private readonly ports: TemplateWorkflowPorts) {}

  async register(ctx: WorkflowContext, input: RegisterModelInput): Promise<RegisterModelResult> {
    assertHumanActor(ctx.actor);
    if (input.confirm !== true) throw new TemplateWorkflowError("CONFIRMATION_REQUIRED", "confirmação humana explícita obrigatória para registrar o modelo (nada foi criado)");
    if (!isSha256(input.sourceSha256)) throw new TemplateWorkflowError("VALIDATION_FAILED", "SHA-256 da fonte inválido (64 hex minúsculos)");

    // 1) validações que NÃO escrevem nada
    const kind: TemplateDocumentKind = input.target.kind === "NEW_IDENTITY" ? input.target.documentKind : (await this.requireIdentity(ctx, input.target.identityId)).documentKind;
    const scopeIssues = validateExplicitScope(kind, input.declaredScope);
    if (scopeIssues.length) throw new TemplateWorkflowError("SCOPE_INVALID", "aplicabilidade declarada incompleta ou inválida", scopeIssues.map((i) => ({ code: i.code, path: i.dimension, message: i.message })));
    let inventorySummary: { sha256: string; inputsTotal: number; controlOnlyInputs: number; conditionTypes: number } | undefined;
    if (input.inventory !== undefined) {
      const parsed = parseSourceInventory(input.inventory);
      if (!parsed.ok) throw new TemplateWorkflowError("VALIDATION_FAILED", "inventário da fonte inválido", parsed.issues.map((m) => ({ code: "INVENTORY_INVALID", path: "inventory", message: m })));
      if (parsed.value.sourceSha256 !== input.sourceSha256 || parsed.value.sourceLogicalVersion !== input.sourceLogicalVersion) {
        throw new TemplateWorkflowError("VALIDATION_FAILED", "o inventário não corresponde à versão lógica/SHA-256 da fonte informada");
      }
      inventorySummary = { sha256: inventoryHash(parsed.value), ...inventoryCounts(parsed.value) };
    }
    const { ast, sourceFormat } = await this.resolveSource(input.source);

    // 2) escritas: identidade (se nova) → revisão DRAFT → procedência
    const wf = new InstitutionalTemplatesWorkflow(this.ports);
    const identity = input.target.kind === "NEW_IDENTITY"
      ? await wf.createIdentity(ctx, { documentKind: input.target.documentKind, slug: input.target.slug })
      : await this.requireIdentity(ctx, input.target.identityId);
    const revision = await wf.createDraft(ctx, { identityId: identity.id, ast, sourceFormat });
    if (revision.status !== "DRAFT") throw new TemplateWorkflowError("TRANSITION_INVALID", "invariante violada: a revisão importada deve nascer DRAFT");

    let provenance: RegisterModelResult["provenance"];
    try {
      const rec = await new TemplateGovernanceService(this.ports).recordImportProvenance(ctx, {
        revisionId: revision.id, expectedVersion: 0, confirm: true, idempotencyKey: input.idempotencyKey, decision: input.decision,
        provenance: {
          templateKey: input.templateKey, displayName: input.displayName, sourceLogicalVersion: input.sourceLogicalVersion, sourceSha256: input.sourceSha256,
          sourceFormat, scope: readScope(input.declaredScope), ...(inventorySummary ? { inventory: inventorySummary } : {}),
        },
      });
      provenance = { status: "RECORDED", value: rec.provenance };
    } catch (err) {
      const message = err instanceof Error ? err.message : "falha desconhecida";
      log.warn("template_registration_provenance_failed", { organizationId: ctx.organizationId, revisionId: revision.id, correlationId: ctx.correlationId, message });
      provenance = { status: "FAILED", message };
    }
    return {
      identity, revision, provenance,
      notices: [
        "A revisão nasceu DRAFT. Mesmo com aprovação jurídica externa, ela ainda exige aprovação humana no sistema e, depois, decisão humana de publicação (decisões distintas).",
        "Nenhum vínculo (binding), documento, IA ou processo foi tocado por este registro.",
      ],
    };
  }

  private async requireIdentity(ctx: WorkflowContext, identityId: string): Promise<TemplateIdentity> {
    const identity = await this.ports.repository.getIdentity(ctx.organizationId, identityId);
    if (!identity || identity.organizationId !== ctx.organizationId) throw new TemplateWorkflowError("NOT_FOUND", "modelo não encontrado nesta organização");
    return identity;
  }

  private async resolveSource(source: RegistrationSource): Promise<{ ast: unknown; sourceFormat: "NATIVE" | "MARKDOWN_IMPORT" | "DOCX_IMPORT" }> {
    const catalog = this.ports.catalog.current();
    if (source.kind === "AST") {
      const check = validateTemplateAst(source.ast, catalog);
      if (!check.ok) throw new TemplateWorkflowError("VALIDATION_FAILED", "a estrutura do modelo é inválida", check.issues.map((i) => ({ code: i.code, path: i.path, message: i.message })));
      return { ast: check.value, sourceFormat: "NATIVE" };
    }
    const res = source.kind === "MARKDOWN"
      ? await runImportPipeline({ format: "markdown", markdown: source.markdown, filename: source.filename }, catalog)
      : await runImportPipeline({ format: "docx", docx: source.docx, filename: source.filename }, catalog);
    if (!res.ok) throw new TemplateWorkflowError("IMPORT_REJECTED", "a importação foi recusada; nada foi criado", res.issues);
    return { ast: res.ast, sourceFormat: res.sourceFormat };
  }
}
