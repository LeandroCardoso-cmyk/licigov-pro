/**
 * Verificação PURA de um pacote de modelo CANDIDATO contra a linha de base publicada (Domain Layer, sem IO).
 *
 * Um candidato só pode ser registrado como DRAFT se provar, ponto a ponto, que:
 *  - é candidato (nunca um pacote vigente) e tem a versão lógica / SHA-256 de fonte / hash semântico ESPERADOS pelo operador;
 *  - tem a MESMA AST, o MESMO mapeamento e o MESMO pacote jurídico aprovado (fonte congelada) da linha de base;
 *  - difere da linha de base SOMENTE na política de completude (`required`/`completionPolicy`/`absentText`) das variáveis aprovadas;
 *  - as regras do modelo só diferem na versão do catálogo;
 *  - a linha de base conserva o hash semântico esperado.
 * Nada aqui lê banco, relógio ou rede.
 */
import { canonicalJson, sha256Hex } from "../canonicalJson";
import { revisionSemanticHash } from "./semanticHash";
import { validateVariableCatalog2, type VariableCatalog2, type VariableDef2 } from "./variableCatalog2";
import type { TemplateAST2 } from "./ast2";

export interface CandidatePackageLike {
  readonly modelKey: string;
  readonly ast: unknown;
  readonly catalog: VariableCatalog2;
  readonly mapping: unknown;
  readonly provenance: { readonly sourceLogicalVersion: string; readonly sourceSha256: string; readonly catalogVersion: string };
  readonly rules: { readonly catalogVersion?: string };
  readonly approvedPackage: unknown;
  readonly candidate?: boolean;
}

export interface CandidateExpectations {
  readonly modelKey: string;
  readonly sourceLogicalVersion: string;
  readonly sourceSha256: string;
  /** Hash semântico da revisão candidata (AST + versão do catálogo). */
  readonly semanticHash: string;
  /** Hash semântico da linha de base publicada (Revisão 1). */
  readonly baselineSemanticHash: string;
  /** Variáveis que devem ser as ÚNICAS com `DEFERRED_PUBLICATION` (conjunto exato). */
  readonly deferredVariables: readonly string[];
}

export interface PackageCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

/** Chaves de variável que o candidato pode alterar em relação à base (política de completude). */
export const COMPLETION_POLICY_KEYS: readonly string[] = Object.freeze(["required", "completionPolicy", "absentText"]);

const same = (a: unknown, b: unknown): boolean => sha256Hex(canonicalJson(a as never)) === sha256Hex(canonicalJson(b as never));
const check = (id: string, ok: boolean, detail: string): PackageCheck => ({ id, ok, detail });

export function verifyCandidatePackage(candidate: CandidatePackageLike, baseline: CandidatePackageLike, exp: CandidateExpectations): readonly PackageCheck[] {
  const out: PackageCheck[] = [];
  out.push(check("CANDIDATE_FLAG", candidate.candidate === true && baseline.candidate !== true, "o pacote é candidato e a linha de base é o pacote vigente"));
  out.push(check("MODEL_KEY", candidate.modelKey === exp.modelKey && baseline.modelKey === exp.modelKey, `modelKey ${candidate.modelKey}`));
  out.push(check("LOGICAL_VERSION", candidate.provenance.sourceLogicalVersion === exp.sourceLogicalVersion, `versão lógica ${candidate.provenance.sourceLogicalVersion}`));
  out.push(check("SOURCE_SHA256", candidate.provenance.sourceSha256 === exp.sourceSha256 && baseline.provenance.sourceSha256 === exp.sourceSha256, "SHA-256 da fonte jurídica congelada igual ao esperado e ao da Revisão 1"));

  const candHash = revisionSemanticHash({ ast: candidate.ast as TemplateAST2, variableCatalogVersion: candidate.catalog.version });
  const baseHash = revisionSemanticHash({ ast: baseline.ast as TemplateAST2, variableCatalogVersion: baseline.catalog.version });
  out.push(check("CANDIDATE_SEMANTIC_HASH", candHash === exp.semanticHash, `hash semântico recalculado ${candHash.slice(0, 12)}…`));
  out.push(check("BASELINE_SEMANTIC_HASH", baseHash === exp.baselineSemanticHash, `hash semântico da base recalculado ${baseHash.slice(0, 12)}…`));
  out.push(check("DISTINCT_CATALOG_VERSION", candidate.catalog.version !== baseline.catalog.version && candidate.provenance.catalogVersion === candidate.catalog.version, `catálogo ${candidate.catalog.version}`));

  out.push(check("SAME_AST", same(candidate.ast, baseline.ast), "mesma AST da Revisão 1"));
  out.push(check("SAME_MAPPING", same(candidate.mapping, baseline.mapping), "mesmo mapeamento da Revisão 1"));
  out.push(check("SAME_APPROVED_PACKAGE", same(candidate.approvedPackage, baseline.approvedPackage), "mesmo pacote jurídico aprovado (fonte congelada) da Revisão 1"));

  const catalogOk = validateVariableCatalog2(candidate.catalog);
  out.push(check("CATALOG_VALID", catalogOk.ok, catalogOk.ok ? "catálogo tpl-catalog/2 válido" : `catálogo inválido: ${catalogOk.issues.length} problema(s)`));

  const baseByName = new Map<string, VariableDef2>(baseline.catalog.vars.map((v) => [v.name, v]));
  const candNames = new Set(candidate.catalog.vars.map((v) => v.name));
  const structural: string[] = [];
  if (candidate.catalog.vars.length !== baseline.catalog.vars.length || [...baseByName.keys()].some((n) => !candNames.has(n))) structural.push("conjunto de variáveis difere");
  const changed: string[] = [];
  for (const v of candidate.catalog.vars) {
    const b = baseByName.get(v.name);
    if (!b) continue;
    const keys = new Set([...Object.keys(v), ...Object.keys(b)]);
    const diff = [...keys].filter((k) => !same((v as unknown as Record<string, unknown>)[k] ?? null, (b as unknown as Record<string, unknown>)[k] ?? null));
    if (diff.length === 0) continue;
    changed.push(v.name);
    const outside = diff.filter((k) => !COMPLETION_POLICY_KEYS.includes(k));
    if (outside.length) structural.push(`${v.name}: altera ${outside.join(", ")}`);
  }
  out.push(check("CATALOG_ONLY_COMPLETION_POLICY", structural.length === 0, structural.length ? structural.join("; ") : `${changed.length} variável(is) alteradas, só na política de completude`));

  const deferred = candidate.catalog.vars.filter((v) => v.completionPolicy === "DEFERRED_PUBLICATION").map((v) => v.name).sort();
  const wanted = [...exp.deferredVariables].sort();
  out.push(check("DEFERRED_SET_EXACT", deferred.length === wanted.length && deferred.every((n, i) => n === wanted[i]), `DEFERRED_PUBLICATION em ${deferred.length} variável(is)`));
  out.push(check("CHANGED_EQUALS_DEFERRED", changed.length === wanted.length && changed.slice().sort().every((n, i) => n === wanted[i]), "as variáveis alteradas são exatamente as aprovadas"));

  const { catalogVersion: _cv, ...candRules } = candidate.rules as Record<string, unknown>;
  const { catalogVersion: _bv, ...baseRules } = baseline.rules as Record<string, unknown>;
  out.push(check("RULES_ONLY_CATALOG_VERSION", same(candRules, baseRules) && candidate.rules.catalogVersion === candidate.catalog.version, "regras do modelo idênticas (só a versão do catálogo muda)"));
  return out;
}

export const allChecksPass = (checks: readonly PackageCheck[]): boolean => checks.every((c) => c.ok);
