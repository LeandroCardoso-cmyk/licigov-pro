/**
 * Registro HUMANO dos campos governados das fontes canônicas (por processo e por órgão) e da divulgação do orçamento.
 * Ledger EXISTENTE (`institutional_decisions`); validação fail-closed contra o catálogo; ator humano + confirmação explícita;
 * CAS por revisão; idempotência. NÃO existe default de resultado, de autoridade, de data nem de número: tudo é informado por pessoa.
 *
 * `authorityValidation` permanece NOT_VALIDATED_POLICY_PENDING — o sistema registra o ato e a referência; não valida
 * competência e nenhuma IA decide. A evidência de aprovação jurídica do MODELO vive em `governanceService` (uma só).
 */
import type { TemplateIssue } from "../../domain/institutionalTemplates";
import {
  BUDGET_DISCLOSURES, GOVERNED_FIELDS_SCHEMA, allowedSources, declaredPaths, encodeGovernedPayload, validateDefaults, validateGovernedPayload, validateGovernedSection, validateParticipation,
  type BudgetDisclosure, type GovernedPayload, type GovernedScope,
} from "../../domain/institutionalTemplates/governedSources";
import { validateRoleAssignments } from "../../domain/institutionalTemplates/editalAuthorityMatrix";
import type { VariableSource2 } from "../../domain/institutionalTemplates/variableCatalog2";
import { canonicalProjectedPaths } from "../../domain/institutionalTemplates/canonicalProjectionPolicy";
import { isCatalogV2 } from "../../domain/institutionalTemplates/astVersions";
import { serviceLogger } from "../observabilityService";
import { assertHumanActor } from "./authority";
import { recordHumanDecision, type DecisionActInput, type RecordedDecision } from "./decisionRecorder";
import { TemplateWorkflowError } from "./errors";
import {
  GOVERNED_DECISION_TYPE, GOVERNED_ORG_SUBJECT, GOVERNED_OUTCOME, GOVERNED_SUBJECT_TYPE, readGovernedRecord,
} from "./governedFieldsStore";
import type { VariableCatalogPort, WorkflowContext } from "./ports";

const log = serviceLogger("GovernedSourceService");
const toIssues = (issues: readonly TemplateIssue[]) => issues.map((i) => ({ code: i.code, path: i.path, message: i.message }));

function requireConfirmed(act: DecisionActInput, what: string): void {
  if (act.confirm !== true) throw new TemplateWorkflowError("CONFIRMATION_REQUIRED", `confirmação humana explícita obrigatória para ${what} (nada foi alterado)`);
}

export interface RecordFieldsInput extends DecisionActInput {
  /** Versão do catálogo v2 da revisão que consumirá os campos (define caminhos e tipos válidos). */
  readonly catalogVersion: string;
  readonly source: VariableSource2;
  /** Campos da seção ({ caminho do catálogo → valor }); SUBSTITUI a seção inteira (as demais seções são preservadas). */
  readonly fields: unknown;
  readonly expectedRevision: number;
  /** Regime de participação por item/lote (apenas escopo do processo, apenas junto da seção ITEMS). */
  readonly participation?: unknown;
}

export class GovernedSourceService {
  constructor(private readonly catalogs: VariableCatalogPort) {}

  private catalog(version: string) {
    const c = this.catalogs.byVersion(version);
    if (!c || !isCatalogV2(c)) throw new TemplateWorkflowError("VALIDATION_FAILED", `catálogo ${version} indisponível ou não é um catálogo tpl-catalog/2`);
    return c;
  }

  private async record(ctx: WorkflowContext, scope: GovernedScope, subjectId: string, input: RecordFieldsInput, what: string): Promise<RecordedDecision> {
    assertHumanActor(ctx.actor);
    requireConfirmed(input, what);
    const catalog = this.catalog(input.catalogVersion);
    if (!(allowedSources(scope) as readonly string[]).includes(input.source)) {
      throw new TemplateWorkflowError("VALIDATION_FAILED", `a fonte ${input.source} não aceita campos governados neste escopo`);
    }
    const section = validateGovernedSection(catalog, scope, input.source, input.fields, "write");
    if (!section.ok) throw new TemplateWorkflowError("VALIDATION_FAILED", "campos governados inválidos", toIssues(section.issues));
    if (input.participation !== undefined) {
      if (scope !== "PROCESS" || input.source !== "ITEMS") throw new TemplateWorkflowError("VALIDATION_FAILED", "a participação por item/lote só é registrada na seção ITEMS do processo");
      const p = validateParticipation(input.participation);
      if (!p.ok) throw new TemplateWorkflowError("VALIDATION_FAILED", "participação inválida", toIssues(p.issues));
    }
    // Lê o registro corrente (a leitura é revalidada: registro corrompido bloqueia, nunca é mesclado em silêncio).
    const current = await readGovernedRecord(ctx.organizationId, scope, subjectId, catalog).catch((e: unknown) => {
      throw new TemplateWorkflowError("VALIDATION_FAILED", e instanceof Error ? e.message : "registro corrente ilegível");
    });
    // Substitui APENAS os campos que este catálogo declara para a fonte; campos de outros modelos permanecem intactos.
    // Caminhos de projeção CANONICAL ficam FORA da substituição: um valor legado no ledger é preservado como história (não é apagado
    // nem migrado), mas nunca entra na composição/preparação.
    const canonicalPaths = canonicalProjectedPaths(catalog.vars, input.source);
    const declared = new Set([...declaredPaths(catalog, input.source)].filter((p) => !canonicalPaths.has(p)));
    const foreign = Object.fromEntries(Object.entries(current?.raw.sections?.[input.source] ?? {}).filter(([p]) => !declared.has(p)));
    const merged: GovernedPayload = {
      sections: { ...((current?.raw.sections ?? {}) as GovernedPayload["sections"]), [input.source]: { ...foreign, ...(section.ok ? section.value : {}) } },
      ...(input.participation !== undefined ? { participation: input.participation as GovernedPayload["participation"] } : current?.payload.participation ? { participation: current.payload.participation } : {}),
      // Papéis e padrões do Perfil de Licitações são preservados INTEGRALMENTE (inclusive nomes de outros modelos) ao gravar campos.
      ...(current?.raw.roles ? { roles: current.raw.roles as GovernedPayload["roles"] } : {}),
      ...(current?.raw.defaults ? { defaults: current.raw.defaults as GovernedPayload["defaults"] } : {}),
    };
    const whole = validateGovernedPayload(catalog, scope, merged);
    if (!whole.ok) throw new TemplateWorkflowError("VALIDATION_FAILED", "o registro resultante é inválido", toIssues(whole.issues));
    const { evidence } = encodeGovernedPayload(GOVERNED_FIELDS_SCHEMA, merged);
    const out = await recordHumanDecision(ctx, {
      subjectType: GOVERNED_SUBJECT_TYPE[scope], decisionType: GOVERNED_DECISION_TYPE[scope], outcome: GOVERNED_OUTCOME[scope], mode: "revision",
      subjectId, evidence, act: input, expectedRevision: input.expectedRevision,
    });
    log.info("governed_fields_recorded", { organizationId: ctx.organizationId, scope, source: input.source, subjectId, decisionId: out.decision.id, revision: out.decision.revision, replayed: out.replayed, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
    return out;
  }

  /** Campos governados de uma fonte da CONTRATAÇÃO (assunto = id do processo): PROCESS, TR, ITEMS, CERTAME_CONFIG, NORMATIVE, BUDGET, LIFECYCLE. */
  recordProcessFields(ctx: WorkflowContext, input: RecordFieldsInput & { processId: string }): Promise<RecordedDecision> {
    return this.record(ctx, "PROCESS", input.processId, input, "registrar os campos governados do processo");
  }

  /** Campos governados do ÓRGÃO: POLICY (política institucional) e IDENTITY (extensão da identidade). */
  recordOrganizationFields(ctx: WorkflowContext, input: RecordFieldsInput): Promise<RecordedDecision> {
    return this.record(ctx, "ORG", GOVERNED_ORG_SUBJECT, input, "registrar os campos governados do órgão");
  }

  /**
   * PERFIL INSTITUCIONAL DE LICITAÇÕES (escopo ÓRGÃO): papéis (nome/cargo/ato/vigência) e PADRÕES institucionais explícitos.
   * Mesmo ledger e mesma revisão do registro do órgão (CAS por registro inteiro); cada gravação cria uma NOVA revisão — a anterior
   * continua no histórico e os manifests antigos mantêm seu fingerprint. `roles` e `defaults`, quando informados, SUBSTITUEM por
   * inteiro o respectivo bloco (para os nomes deste catálogo); o que não for informado é preservado.
   * Padrão só para variável elegível (Authority Matrix) e valor válido pelo tipo; nada é copiado de "último processo".
   */
  async recordOrganizationProfile(ctx: WorkflowContext, input: DecisionActInput & { catalogVersion: string; expectedRevision: number; roles?: unknown; defaults?: unknown }): Promise<RecordedDecision> {
    assertHumanActor(ctx.actor);
    requireConfirmed(input, "registrar o Perfil institucional de Licitações");
    if (input.roles === undefined && input.defaults === undefined) throw new TemplateWorkflowError("VALIDATION_FAILED", "informe papéis e/ou padrões institucionais");
    const catalog = this.catalog(input.catalogVersion);
    if (input.roles !== undefined) {
      const r = validateRoleAssignments(input.roles);
      if (!r.ok) throw new TemplateWorkflowError("VALIDATION_FAILED", "papéis institucionais inválidos", r.issues.map((m) => ({ code: "SOURCE_PAYLOAD_INVALID", path: "roles", message: m })));
    }
    let nextDefaults: Record<string, unknown> | undefined;
    const current = await readGovernedRecord(ctx.organizationId, "ORG", GOVERNED_ORG_SUBJECT, catalog).catch((e: unknown) => {
      throw new TemplateWorkflowError("VALIDATION_FAILED", e instanceof Error ? e.message : "registro corrente ilegível");
    });
    if (input.defaults !== undefined) {
      const d = validateDefaults(catalog, input.defaults, "write");
      if (!d.ok) throw new TemplateWorkflowError("VALIDATION_FAILED", "padrões institucionais inválidos", toIssues(d.issues));
      // Substitui só os nomes DESTE catálogo; padrões de outros modelos permanecem.
      const declaredNames = new Set(catalog.vars.map((v) => v.name));
      const foreign = Object.fromEntries(Object.entries((current?.raw.defaults ?? {}) as Record<string, unknown>).filter(([n]) => !declaredNames.has(n)));
      nextDefaults = { ...foreign, ...d.value };
    }
    const merged: GovernedPayload = {
      sections: { ...((current?.raw.sections ?? {}) as GovernedPayload["sections"]) },
      ...(input.roles !== undefined ? { roles: input.roles as GovernedPayload["roles"] } : current?.raw.roles ? { roles: current.raw.roles as GovernedPayload["roles"] } : {}),
      ...(nextDefaults !== undefined ? { defaults: nextDefaults } : current?.raw.defaults ? { defaults: current.raw.defaults as GovernedPayload["defaults"] } : {}),
    };
    const whole = validateGovernedPayload(catalog, "ORG", merged);
    if (!whole.ok) throw new TemplateWorkflowError("VALIDATION_FAILED", "o registro resultante é inválido", toIssues(whole.issues));
    const { evidence } = encodeGovernedPayload(GOVERNED_FIELDS_SCHEMA, merged);
    const out = await recordHumanDecision(ctx, {
      subjectType: GOVERNED_SUBJECT_TYPE.ORG, decisionType: GOVERNED_DECISION_TYPE.ORG, outcome: GOVERNED_OUTCOME.ORG, mode: "revision",
      subjectId: GOVERNED_ORG_SUBJECT, evidence, act: input, expectedRevision: input.expectedRevision,
    });
    log.info("licitacoes_profile_recorded", {
      organizationId: ctx.organizationId, decisionId: out.decision.id, revision: out.decision.revision, replayed: out.replayed, actorUserId: ctx.actor.userId,
      roles: input.roles !== undefined ? Object.keys(input.roles as object).length : undefined, defaults: nextDefaults ? Object.keys(nextDefaults).length : undefined, correlationId: ctx.correlationId,
    });
    return out;
  }

  /** Divulgação do orçamento do processo: o resultado (público | sigiloso) é a decisão — sem padrão. */
  async recordBudgetDisclosure(ctx: WorkflowContext, input: DecisionActInput & { processId: string; disclosure: BudgetDisclosure; expectedRevision: number }): Promise<RecordedDecision> {
    assertHumanActor(ctx.actor);
    requireConfirmed(input, "registrar a divulgação do orçamento");
    if (!(BUDGET_DISCLOSURES as readonly string[]).includes(input.disclosure)) throw new TemplateWorkflowError("VALIDATION_FAILED", "divulgação do orçamento deve ser publico ou sigiloso");
    const out = await recordHumanDecision(ctx, {
      subjectType: "procurement.budget_disclosure", decisionType: "budget_disclosure", outcome: input.disclosure, mode: "revision",
      subjectId: input.processId, evidence: [`disclosure:${input.disclosure}`], act: input, expectedRevision: input.expectedRevision,
    });
    log.info("budget_disclosure_recorded", { organizationId: ctx.organizationId, processId: input.processId, disclosure: input.disclosure, decisionId: out.decision.id, revision: out.decision.revision, replayed: out.replayed, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
    return out;
  }
}
