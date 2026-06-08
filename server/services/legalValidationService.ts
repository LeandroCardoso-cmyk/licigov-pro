import { createHash } from "crypto";
import {
  type ValidationReport,
  type ValidationRule,
  type ValidationResult,
  createValidationRule,
  createValidationReport,
  applyValidationRules,
  getValidationSummary,
} from "../domain/legalValidation";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ValidationServiceInput {
  organizationId: number;
  sessionId: string;
  targetType?: string;
  targetId?: string;
  content?: string;
  documentContent?: string;
  documentType?: string;
  context?: Record<string, string>;
  customRules?: Array<{ name: string; description: string; category: ValidationRule["category"]; severity: ValidationRule["severity"]; legalBasis: string; expression: string }>;
}

export interface ValidationServiceOutput {
  report: ValidationReport;
  summary: string;
  processingMs: number;
  replayKey: string;
}

// ─── Default rules ────────────────────────────────────────────────────────────

function buildDefaultRules(organizationId: number): ValidationRule[] {
  const defaults = [
    { name: "Objeto definido", desc: "Documento deve ter objeto claramente definido", cat: "completeness" as const, sev: "error" as const, basis: "Lei 14133/2021 art. 6º", expr: "objeto OR contratação OR aquisição" },
    { name: "Fundamento legal", desc: "Deve citar base legal", cat: "legal_basis" as const, sev: "error" as const, basis: "Lei 14133/2021", expr: "lei OR decreto OR instrução normativa" },
    { name: "Prazo de vigência", desc: "Deve especificar prazo", cat: "completeness" as const, sev: "warning" as const, basis: "Lei 14133/2021 art. 105", expr: "prazo OR vigência OR meses OR dias" },
    { name: "Identificação do órgão", desc: "Deve identificar órgão contratante", cat: "completeness" as const, sev: "warning" as const, basis: "Lei 14133/2021 art. 89", expr: "órgão OR entidade OR contratante" },
    { name: "Valor estimado", desc: "Deve indicar valor estimado", cat: "completeness" as const, sev: "warning" as const, basis: "Lei 14133/2021 art. 23", expr: "valor OR custo OR preço OR estimado" },
  ];
  return defaults.map(d => createValidationRule({
    organizationId,
    name: d.name,
    description: d.desc,
    category: d.cat,
    severity: d.sev,
    legalBasis: d.basis,
    expression: d.expr,
  }));
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _validationReports = new Map<number, ValidationServiceOutput[]>();

// ─── Service functions ────────────────────────────────────────────────────────

export function runLegalValidation(input: ValidationServiceInput): ValidationServiceOutput {
  const start = Date.now();
  const {
    organizationId, sessionId,
    targetType = input.documentType ?? "document",
    targetId = sessionId,
    content = input.documentContent ?? "",
    context = {},
    customRules = [],
  } = input;

  const defaultRules = buildDefaultRules(organizationId);
  const additionalRules = customRules.map(r => createValidationRule({
    organizationId,
    name: r.name,
    description: r.description,
    category: r.category,
    severity: r.severity,
    legalBasis: r.legalBasis,
    expression: r.expression,
  }));
  const allRules = [...defaultRules, ...additionalRules];
  const results = applyValidationRules(allRules, content, context);
  const report = createValidationReport({ organizationId, sessionId, targetType, targetId, rules: allRules, results });
  const summary = getValidationSummary(report);

  const sha256 = (x: string) => createHash("sha256").update(x, "utf8").digest("hex");
  const replayKey = sha256(JSON.stringify({
    organizationId, sessionId, targetId,
    contentHash: sha256(content),
    ruleIds: allRules.map(r => r.id).sort(),
  }));

  const output: ValidationServiceOutput = { report, summary, processingMs: Date.now() - start, replayKey };
  const existing = _validationReports.get(organizationId) ?? [];
  _validationReports.set(organizationId, [...existing, output]);
  return output;
}

export function getValidationHistory(organizationId: number): ValidationServiceOutput[] {
  return _validationReports.get(organizationId) ?? [];
}
