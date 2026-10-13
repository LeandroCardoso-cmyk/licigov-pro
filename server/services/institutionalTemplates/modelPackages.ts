/**
 * Pacotes de MODELO versionados (dados governados compilados do Markdown aprovado; ver o README de cada pasta).
 * Um pacote NÃO cadastra o modelo, NÃO cria binding e NÃO publica: é o conteúdo-fonte que o fluxo de registro
 * (DRAFT → evidência → APPROVED → PUBLISHED, decisões humanas distintas) usa. O Markdown congelado NÃO está no repositório;
 * a procedência registra a versão lógica e o SHA-256 da fonte aprovada.
 */
import type { TemplateAST2, VariableCatalog2 } from "../../domain/institutionalTemplates";
import type { MasterMapping } from "../../domain/institutionalTemplates/masterCompiler";
import bllAst from "../../domain/institutionalTemplates/models/edital-pregao-eletronico-bll/ast.json";
import bllCatalog from "../../domain/institutionalTemplates/models/edital-pregao-eletronico-bll/catalog.v2.json";
import bllMapping from "../../domain/institutionalTemplates/models/edital-pregao-eletronico-bll/mapping.json";
import bllProvenance from "../../domain/institutionalTemplates/models/edital-pregao-eletronico-bll/provenance.json";
import bllReport from "../../domain/institutionalTemplates/models/edital-pregao-eletronico-bll/report.json";
import bllRules from "../../domain/institutionalTemplates/models/edital-pregao-eletronico-bll/rules.json";
import bllApproval from "../../domain/institutionalTemplates/models/edital-pregao-eletronico-bll/approvedPackage.json";
import type { ModelRules } from "../../domain/institutionalTemplates/modelRules";
// Revisão 2 CANDIDATA (política de completude: dados de publicação diferidos). Mesma AST/mapeamento/fonte jurídica da Revisão 1; só o catálogo muda.
import bllR2Catalog from "../../domain/institutionalTemplates/models/edital-pregao-eletronico-bll-1.0.2/catalog.v2.json";
import bllR2Provenance from "../../domain/institutionalTemplates/models/edital-pregao-eletronico-bll-1.0.2/provenance.json";
import bllR2Report from "../../domain/institutionalTemplates/models/edital-pregao-eletronico-bll-1.0.2/report.json";
import bllR2Rules from "../../domain/institutionalTemplates/models/edital-pregao-eletronico-bll-1.0.2/rules.json";

export interface ModelPackage {
  readonly modelKey: string;
  readonly documentKind: "edital";
  readonly slug: string;
  readonly displayName: string;
  /** Aplicabilidade DECLARADA (slugs exatos); a autoridade continua sendo o binding exato criado por decisão humana. */
  readonly declaredScope: Readonly<{ modality: string; form: string; platform?: string }>;
  readonly ast: TemplateAST2;
  readonly catalog: VariableCatalog2;
  readonly mapping: MasterMapping;
  readonly provenance: Readonly<{
    compiler: string; modelKey: string; sourceLogicalVersion: string; sourceSha256: string; sourceBytes: number; mappingSha256: string; catalogVersion: string;
  }>;
  readonly report: Readonly<{ astSemanticHash: string }> & Record<string, unknown>;
  /** Regras GOVERNADAS do modelo (validações determinísticas; nunca lidas de notas do sistema). */
  readonly rules: ModelRules;
  /**
   * CANDIDATO: pacote preparado para uma revisão futura, NÃO publicado, NÃO oferecido nos presets de registro e NÃO registrável pela API
   * (só com autorização explícita do Owner). Nunca substitui a revisão publicada; não cria binding.
   */
  readonly candidate?: boolean;
  /** Pacote JURIDICAMENTE aprovado (hashes do MD, DOCX e relatório de controle) — evidência/proveniência, nunca runtime. */
  readonly approvedPackage: Readonly<Record<string, unknown>>;
}

export const BLL_MODEL_KEY = "EDITAL_PREGAO_ELETRONICO_BLL";

export const MODEL_PACKAGES: readonly ModelPackage[] = Object.freeze([
  Object.freeze({
    modelKey: BLL_MODEL_KEY, documentKind: "edital" as const, slug: "edital-pregao-eletronico-bll", displayName: "Edital — Pregão Eletrônico — BLL",
    declaredScope: Object.freeze({ modality: "pregao", form: "eletronica", platform: "bll" }),
    ast: bllAst as unknown as TemplateAST2, catalog: bllCatalog as unknown as VariableCatalog2, mapping: bllMapping as unknown as MasterMapping,
    provenance: bllProvenance, report: bllReport as unknown as ModelPackage["report"],
    rules: bllRules as unknown as ModelRules, approvedPackage: bllApproval as Record<string, unknown>,
  }),
  // Revisão 2 CANDIDATA — 1.0.2-draft: dados de publicação diferidos (número do pregão e cronograma não bloqueiam a composição).
  Object.freeze({
    modelKey: BLL_MODEL_KEY, documentKind: "edital" as const, slug: "edital-pregao-eletronico-bll", displayName: "Edital — Pregão Eletrônico — BLL",
    declaredScope: Object.freeze({ modality: "pregao", form: "eletronica", platform: "bll" }),
    ast: bllAst as unknown as TemplateAST2, catalog: bllR2Catalog as unknown as VariableCatalog2, mapping: bllMapping as unknown as MasterMapping,
    provenance: bllR2Provenance, report: bllR2Report as unknown as ModelPackage["report"],
    rules: bllR2Rules as unknown as ModelRules, approvedPackage: bllApproval as Record<string, unknown>, candidate: true,
  }),
]);

/** Regras governadas do modelo cujo catálogo tem a versão informada (`null` = catálogo sem regras, ex.: v1). */
export function getModelRulesForCatalog(catalogVersion: string): ModelRules | null {
  return MODEL_PACKAGES.find((p) => p.catalog.version === catalogVersion)?.rules ?? null;
}

/** Pacote PUBLICÁVEL/registrável do modelo (a revisão vigente). Candidatos NUNCA são devolvidos aqui. */
export function getModelPackage(modelKey: string): ModelPackage | null {
  return MODEL_PACKAGES.find((p) => p.modelKey === modelKey && !p.candidate) ?? null;
}

/** Pacote por versão lógica da fonte, inclusive CANDIDATOS (uso interno/testes; o registro de candidato exige autorização explícita). */
export function getModelPackageVersion(modelKey: string, sourceLogicalVersion: string): ModelPackage | null {
  return MODEL_PACKAGES.find((p) => p.modelKey === modelKey && p.provenance.sourceLogicalVersion === sourceLogicalVersion) ?? null;
}
