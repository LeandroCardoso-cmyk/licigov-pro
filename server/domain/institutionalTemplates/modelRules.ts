/**
 * REGRAS GOVERNADAS do modelo (`tpl-model-rules/1`) — validações determinísticas e machine-checkable que o modelo aprovado exige
 * e que NÃO podem depender de ler "notas do sistema" em tempo de execução (NOTA = documentação/evidência, nunca código).
 *
 * As regras são DADO versionado do pacote do modelo (nunca hardcoded no engine, nunca específicas de plataforma). O engine só
 * conhece quatro formas FECHADAS, avaliadas sobre os valores canônicos já resolvidos pelo composer:
 *   forbid       combinação de valores proibida (Cond2): violada quando a condição vale;
 *   range        valor numérico/percentual dentro de [min, max] — só os limites que o PRÓPRIO modelo parametriza;
 *   singleValue  valor textual que deve ser UM canal (sem alternativas "ou", ";", "/", "|");
 *   dateOrder    ordem estrutural entre duas datas (sem prazo mínimo legal inventado);
 *   unavailable  a validação depende de autoridade AINDA INDISPONÍVEL (ex.: justificativa não modelada, norma não parametrizada):
 *                se o cenário estiver ativo (`whenActive`), a composição FALHA FECHADA com RULE_VALIDATION_UNAVAILABLE.
 * Nenhuma norma ou percentual jurídico é inventado: o limite vem do modelo aprovado ou a regra é `unavailable`.
 * Puro, determinístico, sem I/O, sem eval.
 */
import { evaluateCondition2, validateCondition2, type Cond2 } from "./conditionalDsl2";
import { fail, issue, ok, type TemplateIssue, type TemplateResult } from "./types";
import { findVariable2, type VariableCatalog2 } from "./variableCatalog2";

export const MODEL_RULES_FORMAT = "tpl-model-rules/1" as const;

interface RuleBase { readonly id: string; readonly message: string }
export type ModelRule =
  | (RuleBase & { readonly kind: "forbid"; readonly when: Cond2 })
  | (RuleBase & { readonly kind: "range"; readonly var: string; readonly min?: number; readonly max?: number; readonly applyWhen?: Cond2 })
  | (RuleBase & { readonly kind: "singleValue"; readonly var: string })
  /** Coluna numérica/percentual de uma variável `table` dentro de [min, max] em TODAS as linhas. */
  | (RuleBase & { readonly kind: "tableRange"; readonly var: string; readonly column: string; readonly min?: number; readonly max?: number })
  /** Duração limitada por unidade: só unidades LISTADAS são comparadas (nenhuma conversão de calendário é inventada). */
  | (RuleBase & { readonly kind: "durationMax"; readonly var: string; readonly limits: Readonly<Partial<Record<"minute" | "hour" | "day" | "businessDay" | "month" | "year", number>>> })
  | (RuleBase & { readonly kind: "dateOrder"; readonly before: string; readonly after: string })
  | (RuleBase & { readonly kind: "unavailable"; readonly whenActive: Cond2; readonly reason: string });

export interface ModelRules {
  readonly format: typeof MODEL_RULES_FORMAT;
  readonly modelKey: string;
  readonly catalogVersion: string;
  readonly rules: readonly ModelRule[];
}

export interface RuleFinding {
  readonly id: string;
  readonly code: "MODEL_RULE_VIOLATED" | "RULE_VALIDATION_UNAVAILABLE";
  readonly message: string;
}

const ID_RE = /^[A-Z][A-Z0-9_]{2,63}$/;
const SEPARATORS = /\s(?:ou|e\/ou)\s|[;/|]/i;
const bad = (path: string, message: string): TemplateIssue => issue("CONDITION_INVALID", path, message);

/** Valida o conjunto contra o catálogo (variáveis existentes, condições válidas, ids únicos). */
export function validateModelRules(rules: ModelRules, catalog: VariableCatalog2): TemplateResult<ModelRules> {
  const issues: TemplateIssue[] = [];
  if (rules.format !== MODEL_RULES_FORMAT) issues.push(bad("format", `formato deve ser ${MODEL_RULES_FORMAT}`));
  if (rules.catalogVersion !== catalog.version) issues.push(bad("catalogVersion", `as regras são do catálogo ${rules.catalogVersion}, não de ${catalog.version}`));
  const ids = new Set<string>();
  rules.rules.forEach((r, i) => {
    const p = `rules[${i}]`;
    if (!ID_RE.test(r.id)) issues.push(bad(`${p}.id`, "id inválido (MAIÚSCULAS, dígitos e _)"));
    if (ids.has(r.id)) issues.push(bad(`${p}.id`, `regra duplicada: ${r.id}`));
    ids.add(r.id);
    if (typeof r.message !== "string" || r.message.trim() === "") issues.push(bad(`${p}.message`, "mensagem obrigatória"));
    const needVar = (name: string, path: string) => { if (!findVariable2(catalog, name)) issues.push(bad(path, `variável fora do catálogo: ${name}`)); };
    switch (r.kind) {
      case "forbid": issues.push(...validateCondition2(r.when, catalog, `${p}.when`)); break;
      case "unavailable":
        issues.push(...validateCondition2(r.whenActive, catalog, `${p}.whenActive`));
        if (!r.reason || r.reason.trim() === "") issues.push(bad(`${p}.reason`, "motivo obrigatório"));
        break;
      case "range":
        needVar(r.var, `${p}.var`);
        if (r.min === undefined && r.max === undefined) issues.push(bad(p, "range exige min e/ou max"));
        if ((r.min !== undefined && !Number.isFinite(r.min)) || (r.max !== undefined && !Number.isFinite(r.max)) || (r.min !== undefined && r.max !== undefined && r.min > r.max)) issues.push(bad(p, "limites inválidos"));
        if (r.applyWhen) issues.push(...validateCondition2(r.applyWhen, catalog, `${p}.applyWhen`));
        break;
      case "singleValue": needVar(r.var, `${p}.var`); break;
      case "tableRange": {
        const def = findVariable2(catalog, r.var);
        if (!def || def.type !== "table") issues.push(bad(`${p}.var`, `variável de tabela inexistente: ${r.var}`));
        else if (!(def.columns ?? []).some((c) => c.key === r.column)) issues.push(bad(`${p}.column`, `coluna inexistente: ${r.column}`));
        if (r.min === undefined && r.max === undefined) issues.push(bad(p, "tableRange exige min e/ou max"));
        break;
      }
      case "durationMax": {
        const def = findVariable2(catalog, r.var);
        if (!def || def.type !== "duration") issues.push(bad(`${p}.var`, `variável de duração inexistente: ${r.var}`));
        if (Object.keys(r.limits).length === 0) issues.push(bad(p, "durationMax exige ao menos um limite por unidade"));
        break;
      }
      case "dateOrder": needVar(r.before, `${p}.before`); needVar(r.after, `${p}.after`); break;
      default: issues.push(bad(p, `tipo de regra desconhecido: ${String((r as { kind?: unknown }).kind)}`));
    }
  });
  return issues.length ? fail(issues) : ok(rules);
}

/** Variáveis que as regras leem (para o composer garantir que sejam resolvidas). */
export function ruleVariables(rules: ModelRules): string[] {
  const out = new Set<string>();
  const cond = (c: Cond2) => JSON.stringify(c).replace(/"var":"([^"]+)"/g, (_m, v: string) => { out.add(v); return ""; });
  for (const r of rules.rules) {
    switch (r.kind) {
      case "forbid": cond(r.when); break;
      case "unavailable": cond(r.whenActive); break;
      case "range": out.add(r.var); if (r.applyWhen) cond(r.applyWhen); break;
      case "singleValue": case "tableRange": case "durationMax": out.add(r.var); break;
      case "dateOrder": out.add(r.before); out.add(r.after); break;
    }
  }
  return [...out].sort();
}

/** Avalia as regras sobre os valores canônicos resolvidos. Valor ausente ⇒ a regra não se aplica (a obrigatoriedade é do catálogo). */
export function evaluateModelRules(rules: ModelRules, values: Readonly<Record<string, unknown>>): RuleFinding[] {
  const out: RuleFinding[] = [];
  const violated = (r: ModelRule) => out.push({ id: r.id, code: "MODEL_RULE_VIOLATED", message: r.message });
  for (const r of rules.rules) {
    switch (r.kind) {
      case "forbid": if (evaluateCondition2(r.when, values).result) violated(r); break;
      case "unavailable": if (evaluateCondition2(r.whenActive, values).result) out.push({ id: r.id, code: "RULE_VALIDATION_UNAVAILABLE", message: `${r.message} — ${r.reason}` }); break;
      case "range": {
        const v = values[r.var];
        if (typeof v !== "number" || (r.applyWhen && !evaluateCondition2(r.applyWhen, values).result)) break;
        if ((r.min !== undefined && v < r.min) || (r.max !== undefined && v > r.max)) violated(r);
        break;
      }
      case "singleValue": {
        const v = values[r.var];
        if (typeof v === "string" && SEPARATORS.test(v)) violated(r);
        break;
      }
      case "tableRange": {
        const rows = values[r.var];
        if (!Array.isArray(rows)) break;
        const outOfRange = (rows as Record<string, unknown>[]).some((row) => {
          const c = row[r.column];
          return typeof c === "number" && ((r.min !== undefined && c < r.min) || (r.max !== undefined && c > r.max));
        });
        if (outOfRange) violated(r);
        break;
      }
      case "durationMax": {
        const d = values[r.var] as { amount?: unknown; unit?: unknown } | undefined;
        if (!d || typeof d.amount !== "number" || typeof d.unit !== "string") break;
        const limit = (r.limits as Record<string, number | undefined>)[d.unit];
        if (limit !== undefined && d.amount > limit) violated(r);
        break;
      }
      case "dateOrder": {
        const a = values[r.before], b = values[r.after];
        if (typeof a === "string" && typeof b === "string" && a.slice(0, 10) >= b.slice(0, 10)) violated(r);
        break;
      }
    }
  }
  return out;
}
