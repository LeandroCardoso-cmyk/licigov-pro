/**
 * DSL condicional FECHADA (INV-TPL-23/28; T1_DESIGN_PACKAGE).
 *
 * Só os operadores abaixo; sem expressões livres, funções, regex, eval ou IA; profundidade ≤ 4. Avaliação pura
 * sobre fatos já resolvidos por quem chama, com trilha de explicação determinística (mesma entrada ⇒ mesma trilha).
 */
import { findVariable, type VariableCatalog, type VariableDef } from "./variableCatalog";
import { issue, type TemplateIssue } from "./types";

export type Cond =
  | { readonly op: "eq" | "ne"; readonly var: string; readonly value: string | number | boolean }
  | { readonly op: "in"; readonly var: string; readonly values: readonly (string | number)[] }
  | { readonly op: "present" | "absent"; readonly var: string }
  | { readonly op: "and" | "or"; readonly of: readonly Cond[] }
  | { readonly op: "not"; readonly of: Cond };

export const MAX_CONDITION_DEPTH = 4;

const CLOSED_KEYS: Record<string, readonly string[]> = {
  eq: ["op", "var", "value"], ne: ["op", "var", "value"], in: ["op", "var", "values"],
  present: ["op", "var"], absent: ["op", "var"],
  and: ["op", "of"], or: ["op", "of"], not: ["op", "of"],
};

/** Tipo JS aceito como operando para cada tipo do catálogo (`list` não é comparável por igualdade). */
function operandType(def: VariableDef): "string" | "number" | null {
  if (def.type === "number" || def.type === "money") return "number";
  if (def.type === "string" || def.type === "date" || def.type === "enum") return "string";
  return null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateCondition(cond: unknown, catalog: VariableCatalog, path = "when", depth = 1): TemplateIssue[] {
  if (depth > MAX_CONDITION_DEPTH) {
    return [issue("CONDITION_DEPTH_EXCEEDED", path, `profundidade máxima da condição é ${MAX_CONDITION_DEPTH}`)];
  }
  if (!isPlainObject(cond) || typeof cond.op !== "string" || !Object.prototype.hasOwnProperty.call(CLOSED_KEYS, cond.op)) {
    return [issue("CONDITION_INVALID", path, "operador fora da DSL fechada")];
  }
  const extra = Object.keys(cond).filter((k) => !CLOSED_KEYS[cond.op as string].includes(k));
  if (extra.length) return [issue("CONDITION_INVALID", path, `propriedade não permitida: ${extra.join(", ")}`)];

  const op = cond.op;
  if (op === "and" || op === "or") {
    if (!Array.isArray(cond.of) || cond.of.length === 0) return [issue("CONDITION_INVALID", `${path}.of`, `${op} exige ao menos um operando`)];
    return cond.of.flatMap((c, i) => validateCondition(c, catalog, `${path}.of[${i}]`, depth + 1));
  }
  if (op === "not") return validateCondition(cond.of, catalog, `${path}.of`, depth + 1);

  if (typeof cond.var !== "string") return [issue("CONDITION_INVALID", `${path}.var`, "var obrigatório")];
  const def = findVariable(catalog, cond.var);
  if (!def) return [issue("UNKNOWN_VARIABLE", `${path}.var`, `variável fora do catálogo ${catalog.version}: ${cond.var}`)];
  if (op === "present" || op === "absent") return [];

  const expected = operandType(def);
  if (!expected) return [issue("CONDITION_INVALID", path, `variável do tipo ${def.type} não é comparável com ${op}`)];
  if (op === "in") {
    const values = cond.values;
    if (!Array.isArray(values) || values.length === 0) return [issue("CONDITION_INVALID", `${path}.values`, "in exige lista não vazia")];
    return values.every((v) => typeof v === expected)
      ? []
      : [issue("CONDITION_INVALID", `${path}.values`, `operandos devem ser do tipo ${expected}`)];
  }
  return typeof cond.value === expected
    ? []
    : [issue("CONDITION_INVALID", `${path}.value`, `operando deve ser do tipo ${expected}`)];
}

export interface ConditionTraceStep {
  readonly path: string;
  readonly op: Cond["op"];
  readonly var?: string;
  readonly observed?: unknown;
  readonly result: boolean;
}

export interface ConditionEvaluation {
  readonly result: boolean;
  /** Explicação determinística: um passo por nó avaliado, em ordem de avaliação (sem curto-circuito). */
  readonly trace: readonly ConditionTraceStep[];
}

/** Ausente = `undefined`, `null`, string vazia ou lista vazia. */
export function isAbsentFact(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

/**
 * Avalia uma condição JÁ VALIDADA. Pura: não lê relógio, não chama IA, não altera `facts`.
 * Todos os operandos de `and`/`or` são avaliados para a trilha ser completa e estável.
 */
export function evaluateCondition(cond: Cond, facts: Readonly<Record<string, unknown>>, path = "when"): ConditionEvaluation {
  const trace: ConditionTraceStep[] = [];
  const result = evalNode(cond, facts, path, trace);
  return { result, trace };
}

function evalNode(cond: Cond, facts: Readonly<Record<string, unknown>>, path: string, trace: ConditionTraceStep[]): boolean {
  switch (cond.op) {
    case "and":
    case "or": {
      const results = cond.of.map((c, i) => evalNode(c, facts, `${path}.of[${i}]`, trace));
      const r = cond.op === "and" ? results.every(Boolean) : results.some(Boolean);
      trace.push({ path, op: cond.op, result: r });
      return r;
    }
    case "not": {
      const r = !evalNode(cond.of, facts, `${path}.of`, trace);
      trace.push({ path, op: "not", result: r });
      return r;
    }
    case "present":
    case "absent": {
      const observed = facts[cond.var];
      const r = cond.op === "present" ? !isAbsentFact(observed) : isAbsentFact(observed);
      trace.push({ path, op: cond.op, var: cond.var, observed: observed ?? null, result: r });
      return r;
    }
    case "in": {
      const observed = facts[cond.var];
      const r = !isAbsentFact(observed) && cond.values.some((v) => v === observed);
      trace.push({ path, op: "in", var: cond.var, observed: observed ?? null, result: r });
      return r;
    }
    case "eq":
    case "ne": {
      const observed = facts[cond.var];
      const equal = !isAbsentFact(observed) && observed === cond.value;
      const r = cond.op === "eq" ? equal : !equal;
      trace.push({ path, op: cond.op, var: cond.var, observed: observed ?? null, result: r });
      return r;
    }
  }
}
