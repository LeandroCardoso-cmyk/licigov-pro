/**
 * DSL condicional FECHADA — versão 2 (acompanha `tpl-ast/2` / `tpl-catalog/2`).
 *
 * Evolui a DSL do T1 sem alterá-la (a v1 e o seu replay ficam intactos): mantém `eq/ne/in/present/absent/and/or/not` e a
 * profundidade ≤ 4 e acrescenta só o necessário para o catálogo v2:
 *  - operandos booleanos (`boolean`);
 *  - comparadores numéricos `gt/gte/lt/lte` (só tipos numéricos);
 *  - `eq/ne/in` sobre `enum` validam o operando contra o conjunto fechado do catálogo;
 *  - `present/absent` valem para qualquer tipo (inclusive lista, tabela, duração e referência a documento).
 * Sem expressões livres, funções, regex, eval, relógio ou IA. A avaliação é pura sobre valores canônicos JÁ resolvidos e
 * devolve a trilha de explicação (mesma entrada ⇒ mesma trilha ⇒ mesmo hash no manifest).
 */
import { MAX_CONDITION_DEPTH, isAbsentFact } from "./conditionalDsl";
import { issue, type TemplateIssue } from "./types";
import type { VariableCatalog2, VariableDef2 } from "./variableCatalog2";

export type Cond2 =
  | { readonly op: "eq" | "ne"; readonly var: string; readonly value: string | number | boolean }
  | { readonly op: "in"; readonly var: string; readonly values: readonly (string | number)[] }
  | { readonly op: "gt" | "gte" | "lt" | "lte"; readonly var: string; readonly value: number }
  | { readonly op: "present" | "absent"; readonly var: string }
  | { readonly op: "and" | "or"; readonly of: readonly Cond2[] }
  | { readonly op: "not"; readonly of: Cond2 };

export const COND2_OPS: readonly Cond2["op"][] = ["eq", "ne", "in", "gt", "gte", "lt", "lte", "present", "absent", "and", "or", "not"];

const CLOSED_KEYS: Readonly<Record<string, readonly string[]>> = {
  eq: ["op", "var", "value"], ne: ["op", "var", "value"], in: ["op", "var", "values"],
  gt: ["op", "var", "value"], gte: ["op", "var", "value"], lt: ["op", "var", "value"], lte: ["op", "var", "value"],
  present: ["op", "var"], absent: ["op", "var"],
  and: ["op", "of"], or: ["op", "of"], not: ["op", "of"],
};

type OperandKind = "string" | "number" | "boolean";

/** Tipo JS aceito como operando de igualdade para cada tipo do catálogo (`null` = só `present/absent`). */
function operandKind(def: VariableDef2): OperandKind | null {
  switch (def.type) {
    case "boolean": return "boolean";
    case "integer": case "number": case "money": case "percent": return "number";
    case "string": case "text": case "enum": case "date": case "time": case "datetime": case "url": case "cnpj": return "string";
    default: return null; // duration · list · table · document_ref
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const CNPJ_DIGITS_RE = /^\d{14}$/;

function operandIssue(def: VariableDef2, v: unknown, kind: OperandKind): string | null {
  if (typeof v !== kind) return `operando deve ser do tipo ${kind}`;
  if (kind === "number" && !Number.isFinite(v as number)) return "operando numérico deve ser finito";
  if (def.type === "enum" && !(def.enumValues ?? []).includes(v as string)) return `valor fora do conjunto fechado do enum ${def.name}`;
  if (def.type === "cnpj" && !CNPJ_DIGITS_RE.test(v as string)) return "CNPJ comparável é a forma normalizada de 14 dígitos";
  return null;
}

export function validateCondition2(cond: unknown, catalog: VariableCatalog2, path = "when", depth = 1): TemplateIssue[] {
  if (depth > MAX_CONDITION_DEPTH) {
    return [issue("CONDITION_DEPTH_EXCEEDED", path, `profundidade máxima da condição é ${MAX_CONDITION_DEPTH}`)];
  }
  if (!isPlainObject(cond) || typeof cond.op !== "string" || !Object.prototype.hasOwnProperty.call(CLOSED_KEYS, cond.op)) {
    return [issue("CONDITION_INVALID", path, "operador fora da DSL fechada")];
  }
  const extra = Object.keys(cond).filter((k) => !CLOSED_KEYS[cond.op as string].includes(k));
  if (extra.length) return [issue("CONDITION_INVALID", path, `propriedade não permitida: ${extra.join(", ")}`)];

  const op = cond.op as Cond2["op"];
  if (op === "and" || op === "or") {
    if (!Array.isArray(cond.of) || cond.of.length === 0) return [issue("CONDITION_INVALID", `${path}.of`, `${op} exige ao menos um operando`)];
    return cond.of.flatMap((c, i) => validateCondition2(c, catalog, `${path}.of[${i}]`, depth + 1));
  }
  if (op === "not") return validateCondition2(cond.of, catalog, `${path}.of`, depth + 1);

  if (typeof cond.var !== "string") return [issue("CONDITION_INVALID", `${path}.var`, "var obrigatório")];
  const def = catalog.vars.find((v) => v.name === cond.var);
  if (!def) return [issue("UNKNOWN_VARIABLE", `${path}.var`, `variável fora do catálogo ${catalog.version}: ${cond.var}`)];
  if (op === "present" || op === "absent") return [];

  const kind = operandKind(def);
  if (!kind) return [issue("CONDITION_INVALID", path, `variável do tipo ${def.type} só admite present/absent`)];
  if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
    if (kind !== "number") return [issue("CONDITION_INVALID", path, `${op} só vale para tipos numéricos (variável ${def.type})`)];
    return typeof cond.value === "number" && Number.isFinite(cond.value)
      ? []
      : [issue("CONDITION_INVALID", `${path}.value`, "operando deve ser número finito")];
  }
  if (op === "in") {
    const values = cond.values;
    if (kind === "boolean") return [issue("CONDITION_INVALID", `${path}.values`, "in não se aplica a booleano (use eq/ne)")];
    if (!Array.isArray(values) || values.length === 0) return [issue("CONDITION_INVALID", `${path}.values`, "in exige lista não vazia")];
    const bad = values.map((v) => operandIssue(def, v, kind)).find((m) => m !== null);
    return bad ? [issue("CONDITION_INVALID", `${path}.values`, bad)] : [];
  }
  const bad = operandIssue(def, cond.value, kind);
  return bad ? [issue("CONDITION_INVALID", `${path}.value`, bad)] : [];
}

/** Nomes de variáveis referenciados por uma condição (sem repetição, ordenados). */
export function conditionVariables(cond: Cond2): string[] {
  const names = new Set<string>();
  const walk = (c: Cond2): void => {
    if (c.op === "and" || c.op === "or") c.of.forEach(walk);
    else if (c.op === "not") walk(c.of);
    else if ("var" in c) names.add(c.var);
  };
  walk(cond);
  return [...names].sort();
}

export interface ConditionTraceStep2 {
  readonly path: string;
  readonly op: Cond2["op"];
  readonly var?: string;
  readonly observed?: unknown;
  readonly result: boolean;
}

export interface ConditionEvaluation2 {
  readonly result: boolean;
  /** Um passo por nó avaliado, em ordem de avaliação (sem curto-circuito): mesma entrada ⇒ mesma trilha. */
  readonly trace: readonly ConditionTraceStep2[];
}

/** Avalia uma condição JÁ VALIDADA. Pura: não lê relógio, não chama IA, não altera `facts`. */
export function evaluateCondition2(cond: Cond2, facts: Readonly<Record<string, unknown>>, path = "when"): ConditionEvaluation2 {
  const trace: ConditionTraceStep2[] = [];
  const result = evalNode(cond, facts, path, trace);
  return { result, trace };
}

function evalNode(cond: Cond2, facts: Readonly<Record<string, unknown>>, path: string, trace: ConditionTraceStep2[]): boolean {
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
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const observed = facts[cond.var];
      let r = false;
      if (typeof observed === "number" && Number.isFinite(observed)) {
        r = cond.op === "gt" ? observed > cond.value : cond.op === "gte" ? observed >= cond.value : cond.op === "lt" ? observed < cond.value : observed <= cond.value;
      }
      trace.push({ path, op: cond.op, var: cond.var, observed: observed ?? null, result: r });
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
