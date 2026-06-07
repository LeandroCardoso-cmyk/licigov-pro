import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PromptTemplate {
  id: string;
  organizationId: number;
  templateKey: string;
  name: string;
  content: string;
  variables: string[];
  version: string;
  legalBasis: string | null;
  role: string | null;
  isApproved: boolean;
  approvedBy: number | null;
  approvedAt: string | null;
  lineage: string[];
  replayKey: string;
  createdBy: number;
  createdAt: string;
}

export interface TemplateRenderResult {
  templateId: string;
  renderedContent: string;
  variablesUsed: string[];
  missingVariables: string[];
  tokenEstimate: number;
  replayKey: string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _templateStore = new Map<number, PromptTemplate[]>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function genId(input: string): string {
  return sha256(input).slice(0, 20);
}

function extractVariables(content: string): string[] {
  const regex = /\{\{(\w+)\}\}/g;
  const vars = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    vars.add(match[1]);
  }
  return Array.from(vars);
}

function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const parts = version.split(".");
  return {
    major: parseInt(parts[0] ?? "1", 10),
    minor: parseInt(parts[1] ?? "0", 10),
    patch: parseInt(parts[2] ?? "0", 10),
  };
}

function sortedVariablesJson(variables: Record<string, string>): string {
  const sorted = Object.keys(variables)
    .sort()
    .reduce<Record<string, string>>((acc, key) => {
      acc[key] = variables[key];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

// ─── Service functions ────────────────────────────────────────────────────────

export function createTemplate(params: {
  organizationId: number;
  templateKey: string;
  name: string;
  content: string;
  legalBasis?: string | null;
  role?: string | null;
  createdBy: number;
}): PromptTemplate {
  const now = new Date().toISOString();
  const replayKey = sha256(`${params.templateKey}${params.content}${params.organizationId}`);
  const variables = extractVariables(params.content);

  const template: PromptTemplate = {
    id:             genId(replayKey),
    organizationId: params.organizationId,
    templateKey:    params.templateKey,
    name:           params.name,
    content:        params.content,
    variables,
    version:        "1.0.0",
    legalBasis:     params.legalBasis ?? null,
    role:           params.role ?? null,
    isApproved:     false,
    approvedBy:     null,
    approvedAt:     null,
    lineage:        [],
    replayKey,
    createdBy:      params.createdBy,
    createdAt:      now,
  };

  const existing = _templateStore.get(params.organizationId) ?? [];
  _templateStore.set(params.organizationId, [...existing, template]);

  return template;
}

export function renderTemplate(
  template: PromptTemplate,
  variables: Record<string, string>,
): TemplateRenderResult {
  let renderedContent = template.content;
  const variablesUsed: string[] = [];
  const missingVariables: string[] = [];

  for (const varName of template.variables) {
    if (varName in variables) {
      renderedContent = renderedContent.replace(
        new RegExp(`\\{\\{${varName}\\}\\}`, "g"),
        variables[varName],
      );
      variablesUsed.push(varName);
    } else {
      missingVariables.push(varName);
    }
  }

  const tokenEstimate = Math.ceil(renderedContent.length / 4);
  const replayKey = sha256(`${template.id}${sortedVariablesJson(variables)}`);

  return {
    templateId:      template.id,
    renderedContent,
    variablesUsed,
    missingVariables,
    tokenEstimate,
    replayKey,
  };
}

export function versionTemplate(
  original: PromptTemplate,
  newContent: string,
  createdBy: number,
): PromptTemplate {
  const now = new Date().toISOString();
  const parsed = parseVersion(original.version);
  const newVersion = `${parsed.major}.${parsed.minor + 1}.0`;
  const replayKey = sha256(`${original.templateKey}${newContent}${original.organizationId}`);
  const variables = extractVariables(newContent);

  return {
    ...original,
    id:         genId(replayKey),
    content:    newContent,
    variables,
    version:    newVersion,
    lineage:    [...original.lineage, original.id],
    replayKey,
    isApproved: false,
    approvedBy: null,
    approvedAt: null,
    createdBy,
    createdAt:  now,
  };
}

export function rollbackTemplate(
  template: PromptTemplate,
  targetVersion: string,
  createdBy: number,
): PromptTemplate {
  const now = new Date().toISOString();
  const parsed = parseVersion(template.version);
  const newVersion = `${parsed.major + 1}.0.0`;
  const replayKey = sha256(
    `rollback:${template.templateKey}:${targetVersion}:${template.content}:${template.organizationId}`,
  );
  const variables = extractVariables(template.content);

  return {
    ...template,
    id:         genId(replayKey),
    content:    template.content,
    variables,
    version:    newVersion,
    lineage:    [...template.lineage, template.id],
    replayKey,
    isApproved: false,
    approvedBy: null,
    approvedAt: null,
    createdBy,
    createdAt:  now,
  };
}

export function approveTemplate(
  template: PromptTemplate,
  approvedBy: number,
): PromptTemplate {
  return {
    ...template,
    isApproved: true,
    approvedBy,
    approvedAt: new Date().toISOString(),
  };
}

export function getTemplatesByKey(
  organizationId: number,
  templateKey: string,
): PromptTemplate[] {
  const all = _templateStore.get(organizationId) ?? [];
  return all.filter(t => t.templateKey === templateKey);
}
