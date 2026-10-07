/**
 * DOSSIÊ de pré-visualização com CONTEXTO DE TESTE selecionável (piloto Edital). Mostra, para uma revisão EXATA (ou a que o
 * binding exato fixaria): identidade, revisão, modalidade/forma/plataforma do contexto, decisões das condições, pins de fonte,
 * tabelas dinâmicas, anexos, referências cruzadas, slots de IA e a prévia do manifest.
 *
 * SEM EFEITOS COLATERAIS (provado em teste por contagem de escritas): nada é persistido; nenhum documento oficial é criado,
 * emitido ou publicado; nenhuma IA é chamada (slots viram marcadores); nenhum processo é lido. É a pré-visualização do composer
 * puro em modo PREVIEW. Binding ambíguo/inexistente ⇒ SEM prévia (fail-closed).
 */
import type { TemplateDocumentKind, TemplateRevision } from "../../domain/institutionalTemplates";
import { analyzeAst, type AstFacts } from "../../domain/institutionalTemplates/governance/astFacts";
import { readScope, scopeHeadline, type ScopeView } from "../../domain/institutionalTemplates/governance/scopeDimensions";
import { findVariable } from "../../domain/institutionalTemplates/variableCatalog";
import { TemplateCatalogService, type DisplayNameSource } from "./catalogService";
import type { CompositionExplanation } from "./explainability";
import type { TemplateWorkflowPorts, WorkflowContext } from "./ports";
import { describeResolution, InstitutionalTemplatesWorkflow } from "./workflowService";

/** Variáveis de parâmetros do edital que o contexto de teste (modalidade/forma/plataforma/critério/regime) preenche. */
export const SCOPE_PARAM_VARIABLES: Readonly<Record<keyof ScopeView, string>> = Object.freeze({
  modality: "edital.modalidade", form: "edital.forma", platform: "edital.plataforma", criterion: "edital.criterioJulgamento", regime: "edital.regimeExecucao",
});

export interface PreviewContext {
  readonly scope: ScopeView;
  readonly sampleValues: Readonly<Record<string, unknown>>;
}

export type PreviewTarget =
  | { readonly kind: "REVISION"; readonly revisionId: string }
  | { readonly kind: "BOUND"; readonly documentKind: TemplateDocumentKind; readonly asOf?: string };

export const PREVIEW_NO_SIDE_EFFECTS = Object.freeze({
  persisted: false, aiCalled: false, officialDocumentCreated: false, issued: false, published: false, processTouched: false,
} as const);

export interface PreviewDossier {
  readonly status: "COMPOSED" | "COMPOSE_ERROR" | "NOT_RESOLVED";
  readonly resolution: ReturnType<typeof describeResolution> | null;
  readonly template: { readonly identityId: string; readonly slug: string; readonly displayName: string; readonly displayNameSource: DisplayNameSource; readonly documentKind: string } | null;
  readonly revision: { readonly id: string; readonly revision: number; readonly status: string; readonly semanticHash: string; readonly hashVersion: string; readonly catalogVersion: string } | null;
  readonly context: { readonly scope: ScopeView; readonly scopeHeadline: string; readonly appliedScopeVariables: readonly { readonly name: string; readonly value: string }[]; readonly sampleValueCount: number };
  readonly composeError: string | null;
  readonly contentText: string | null;
  readonly conditionDecisions: CompositionExplanation["conditionalDecisions"];
  readonly sourcePins: CompositionExplanation["sourcePins"];
  readonly dynamicTables: AstFacts["dynamicTables"];
  readonly annexes: readonly { readonly id: string }[];
  readonly crossReferences: { readonly sectionKeys: readonly string[]; readonly annexIds: readonly string[]; readonly docRefs: AstFacts["docRefs"] };
  readonly aiSlots: readonly { readonly slotKey: string; readonly maxTokens: number; readonly status: "PLACEHOLDER_ONLY" }[];
  readonly manifestPreview: { readonly stage: string; readonly persisted: false; readonly manifestHash: string; readonly composedOutputHash: string } | null;
  readonly sideEffects: typeof PREVIEW_NO_SIDE_EFFECTS;
  readonly notices: readonly string[];
}

export interface PreviewVariableHint {
  readonly name: string; readonly type: string; readonly source: string; readonly required: boolean;
  readonly usedIn: "TEXT" | "CONDITION" | "TEXT_AND_CONDITION"; readonly filledByScope: boolean; readonly suggested: string | number;
}

export class TemplatePreviewDossierService {
  private readonly wf: InstitutionalTemplatesWorkflow;
  constructor(private readonly ports: TemplateWorkflowPorts) { this.wf = new InstitutionalTemplatesWorkflow(ports); }

  /** Variáveis que o contexto de teste pode preencher (para a UX montar o formulário) + valores sugeridos determinísticos. */
  async variableHints(ctx: WorkflowContext, revisionId: string): Promise<{ readonly variables: readonly PreviewVariableHint[]; readonly scopeParamVariables: typeof SCOPE_PARAM_VARIABLES }> {
    const { revision } = await this.wf.getRevision(ctx, revisionId);
    const catalog = this.ports.catalog.byVersion(revision.variableCatalogVersion);
    const facts = analyzeAst(revision.ast, catalog);
    const names = [...new Set([...facts.textVariables, ...facts.conditionVariables])].sort();
    const scopeVars = new Set(Object.values(SCOPE_PARAM_VARIABLES));
    const variables = names.map((name): PreviewVariableHint => {
      const def = catalog ? findVariable(catalog, name) : undefined;
      const inText = facts.textVariables.includes(name); const inCond = facts.conditionVariables.includes(name);
      const type = def?.type ?? "string";
      return {
        name, type, source: def?.source ?? "?", required: def?.required ?? false,
        usedIn: inText && inCond ? "TEXT_AND_CONDITION" : inCond ? "CONDITION" : "TEXT", filledByScope: scopeVars.has(name),
        suggested: type === "number" || type === "money" ? 1 : type === "date" ? "2026-01-01" : `[exemplo ${name}]`,
      };
    });
    return { variables, scopeParamVariables: SCOPE_PARAM_VARIABLES };
  }

  async dossier(ctx: WorkflowContext, target: PreviewTarget, context: PreviewContext): Promise<PreviewDossier> {
    const scope = readScope(context.scope);
    const empty = (resolution: PreviewDossier["resolution"], notice: string): PreviewDossier => ({
      status: "NOT_RESOLVED", resolution, template: null, revision: null,
      context: { scope, scopeHeadline: scopeHeadline(scope), appliedScopeVariables: [], sampleValueCount: Object.keys(context.sampleValues).length },
      composeError: null, contentText: null, conditionDecisions: [], sourcePins: [], dynamicTables: [], annexes: [],
      crossReferences: { sectionKeys: [], annexIds: [], docRefs: [] }, aiSlots: [], manifestPreview: null, sideEffects: PREVIEW_NO_SIDE_EFFECTS,
      notices: [notice],
    });

    let revisionId: string;
    let resolution: PreviewDossier["resolution"] = null;
    if (target.kind === "REVISION") revisionId = target.revisionId;
    else {
      const res = await this.wf.resolveBinding(ctx, { documentKind: target.documentKind, scope, asOf: target.asOf });
      resolution = describeResolution(res);
      if (res.status !== "RESOLVED") return empty(resolution, "O binding exato não resolveu (ausente, ambíguo ou inválido): nenhuma prévia foi gerada e nenhum modelo foi escolhido automaticamente.");
      revisionId = res.revision.id;
    }

    const { identity, revision } = await this.wf.getRevision(ctx, revisionId);
    const catalog = this.ports.catalog.byVersion(revision.variableCatalogVersion);
    const applied: { name: string; value: string }[] = [];
    const sampleValues: Record<string, unknown> = { ...context.sampleValues };
    for (const dim of Object.keys(SCOPE_PARAM_VARIABLES) as (keyof ScopeView)[]) {
      const name = SCOPE_PARAM_VARIABLES[dim];
      const value = scope[dim];
      if (value !== undefined && catalog && findVariable(catalog, name) && sampleValues[name] === undefined) { sampleValues[name] = value; applied.push({ name, value }); }
    }
    const preview = await this.wf.preview(ctx, { revisionId, sampleValues });
    const facts = analyzeAst(revision.ast, catalog);
    const names = await new TemplateCatalogService(this.ports).list(ctx, { documentKind: identity.documentKind as TemplateDocumentKind });
    const row = names.find((r) => r.identityId === identity.id);
    const base = {
      resolution,
      template: { identityId: identity.id, slug: identity.slug, displayName: row?.displayName ?? identity.slug, displayNameSource: row?.displayNameSource ?? ("SLUG" as DisplayNameSource), documentKind: identity.documentKind },
      revision: describeRevision(revision),
      context: { scope, scopeHeadline: scopeHeadline(scope), appliedScopeVariables: applied, sampleValueCount: Object.keys(sampleValues).length },
      dynamicTables: facts.dynamicTables,
      crossReferences: { sectionKeys: facts.sectionKeys, annexIds: facts.annexIds, docRefs: facts.docRefs },
      aiSlots: facts.aiSlots.map((s) => ({ slotKey: s.slotKey, maxTokens: s.maxTokens, status: "PLACEHOLDER_ONLY" as const })),
      sideEffects: PREVIEW_NO_SIDE_EFFECTS,
    };
    if (preview.status === "COMPOSE_ERROR") {
      return { ...base, status: "COMPOSE_ERROR", composeError: preview.error, contentText: null, conditionDecisions: [], sourcePins: [], annexes: [], manifestPreview: null,
        notices: ["A composição falhou fechada (ex.: variável obrigatória ausente no contexto de teste). Nada foi persistido nem chamado."] };
    }
    const x = preview.explanation;
    return {
      ...base, status: "COMPOSED", composeError: null, contentText: preview.content.text, conditionDecisions: x.conditionalDecisions, sourcePins: x.sourcePins,
      annexes: x.annexes, manifestPreview: { stage: x.manifest.stage, persisted: false, manifestHash: x.manifest.manifestHash, composedOutputHash: x.manifest.composedOutputHash },
      notices: [...x.notices, "Contexto de teste: valores de exemplo; nenhum dado de processo real foi lido nem alterado."],
    };
  }
}

function describeRevision(r: TemplateRevision) {
  return { id: r.id, revision: r.revision, status: r.status, semanticHash: r.semanticHash, hashVersion: r.hashVersion, catalogVersion: r.variableCatalogVersion };
}
