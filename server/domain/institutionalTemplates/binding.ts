/**
 * Binding determinístico (INV-TPL-03/04; T1_DESIGN_PACKAGE).
 *
 * Resolução pura: igualdade exata de organização, tipo documental e escopo; vigência por `asOf` explícito
 * (sem relógio). Nenhuma IA participa. Ambíguo ⇒ fail-closed; nenhum binding ⇒ NOT_BOUND.
 *
 * Reconciliação com o INV-TPL-03 congelado (nunca "latest"): o T1 descreve `pinnedRevisionId` ausente como
 * "última PUBLISHED". O domínio mantém o campo opcional no shape, mas a resolução sem pin FALHA FECHADA
 * (`BINDING_REVISION_NOT_PINNED`) — o binding sempre aponta para o id exato de uma revisão PUBLISHED.
 */
import { organizationIssues, sameOrganizationIssues } from "./tenant";
import type { TemplateRevision } from "./revision";
import { issue, type OrgId, type TemplateDocumentKind, type TemplateIssue } from "./types";

/**
 * Escopo EXATO de aplicabilidade de um binding (multi-modelo). Todas as chaves são opcionais e comparadas por IGUALDADE EXATA
 * (ausente só casa com ausente): sem curinga, sem fuzzy, sem "mais específico vence", sem IA.
 *  - `modality`  modalidade (ex.: pregao, concorrencia)
 *  - `form`      forma de realização (ex.: eletronico, presencial)
 *  - `platform`  plataforma como SLUG normalizado e EXTENSÍVEL (ex.: bll, licitanet, portal-compras-publicas) — nunca enum
 *                fechado: uma nova plataforma é só um novo binding, sem novo engine
 *  - `regime`    regime de execução; `criterion` critério de julgamento
 * A mesma revisão PUBLISHED pode ter vários bindings exatos (uma combinação cada).
 */
export interface BindingScope {
  readonly modality?: string;
  readonly form?: string;
  readonly platform?: string;
  readonly regime?: string;
  readonly criterion?: string;
}

export interface TemplateBinding {
  readonly id: string;
  readonly organizationId: OrgId;
  readonly documentKind: TemplateDocumentKind;
  readonly scope: BindingScope;
  readonly identityId: string;
  readonly pinnedRevisionId?: string;
  readonly active: boolean;
  readonly effectiveFrom: string;
}

export interface BindingRequest {
  readonly organizationId: OrgId;
  readonly documentKind: TemplateDocumentKind;
  readonly scope: BindingScope;
  /** Instante de referência explícito (ISO-8601 UTC); o domínio não lê relógio. */
  readonly asOf: string;
}

export type BindingResolution =
  | { readonly status: "RESOLVED"; readonly binding: TemplateBinding; readonly revision: TemplateRevision }
  | { readonly status: "NOT_BOUND" }
  | { readonly status: "AMBIGUOUS"; readonly bindingIds: readonly string[] }
  | { readonly status: "INVALID"; readonly issues: readonly TemplateIssue[] };

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
/** Ordem CANÔNICA das chaves do escopo (também a ordem da chave de unicidade persistida). */
export const BINDING_SCOPE_KEYS = ["modality", "form", "platform", "regime", "criterion"] as const;
export type BindingScopeKey = (typeof BINDING_SCOPE_KEYS)[number];
/** Chaves cujo valor é SLUG normalizado (minúsculas ASCII, dígitos e hífens). */
export const BINDING_SCOPE_SLUG_KEYS: readonly BindingScopeKey[] = ["form", "platform"];

export const SCOPE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCOPE_VALUE_MAX = 64;

/**
 * Normaliza um valor canônico (ex.: `compras_gov`) para slug de escopo: minúsculas, `_` → `-`. Determinística e SEM
 * aproximação: o que não for slug válido depois disso é RECUSADO (nunca "consertado").
 */
export function normalizeScopeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

/** Problemas do escopo (valor vazio, separador reservado `|`, slug inválido, chave desconhecida). Pura. */
export function scopeIssues(scope: BindingScope, path = "scope"): TemplateIssue[] {
  const out: TemplateIssue[] = [];
  const raw = scope as unknown as Record<string, unknown>;
  for (const k of Object.keys(raw)) {
    if (!(BINDING_SCOPE_KEYS as readonly string[]).includes(k)) out.push(issue("BINDING_INVALID", `${path}.${k}`, `chave de escopo desconhecida: ${k}`));
  }
  for (const k of BINDING_SCOPE_KEYS) {
    const v = raw[k];
    if (v === undefined) continue;
    if (typeof v !== "string" || v.trim() === "" || v !== v.trim() || v.length > SCOPE_VALUE_MAX || v.includes("|")) {
      out.push(issue("BINDING_INVALID", `${path}.${k}`, `escopo '${k}' inválido (texto não vazio, sem espaços nas pontas, sem '|', até ${SCOPE_VALUE_MAX} caracteres)`));
    } else if (BINDING_SCOPE_SLUG_KEYS.includes(k) && !SCOPE_SLUG_RE.test(v)) {
      out.push(issue("BINDING_INVALID", `${path}.${k}`, `escopo '${k}' deve ser slug normalizado (a-z, 0-9 e hífens)`));
    }
  }
  return out;
}

export function sameScope(a: BindingScope, b: BindingScope): boolean {
  return BINDING_SCOPE_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

/**
 * Resolve o binding vigente. `bindings`/`revisions` são o que a persistência leu para a organização do pedido;
 * qualquer item de outra organização é tratado como violação (nunca ignorado em silêncio).
 */
export function resolveTemplateBinding(
  request: BindingRequest,
  bindings: readonly TemplateBinding[],
  revisions: readonly TemplateRevision[],
): BindingResolution {
  const requestIssues = organizationIssues(request, "request.organizationId");
  if (!ISO_UTC_RE.test(request.asOf)) requestIssues.push(issue("BINDING_INVALID", "request.asOf", "asOf deve ser ISO-8601 UTC explícito"));
  requestIssues.push(...scopeIssues(request.scope, "request.scope"));
  if (requestIssues.length) return { status: "INVALID", issues: requestIssues };

  const foreign = [
    ...bindings.flatMap((b, i) => sameOrganizationIssues(request, b, `bindings[${i}]`)),
    ...revisions.flatMap((r, i) => sameOrganizationIssues(request, r, `revisions[${i}]`)),
  ];
  if (foreign.length) return { status: "INVALID", issues: foreign };

  const malformed = bindings.flatMap((b, i) => (ISO_UTC_RE.test(b.effectiveFrom) ? [] : [issue("BINDING_INVALID", `bindings[${i}].effectiveFrom`, "effectiveFrom deve ser ISO-8601 UTC")]));
  if (malformed.length) return { status: "INVALID", issues: malformed };

  const asOf = Date.parse(request.asOf);
  const candidates = bindings
    .filter((b) => b.active && b.documentKind === request.documentKind && sameScope(b.scope, request.scope) && Date.parse(b.effectiveFrom) <= asOf)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (candidates.length === 0) return { status: "NOT_BOUND" };
  if (candidates.length > 1) return { status: "AMBIGUOUS", bindingIds: candidates.map((b) => b.id) };

  const binding = candidates[0];
  if (!binding.pinnedRevisionId) {
    return { status: "INVALID", issues: [issue("BINDING_REVISION_NOT_PINNED", "pinnedRevisionId", "binding sem revisão exata; resolução por 'última' é proibida (INV-TPL-03)")] };
  }
  const revision = revisions.find((r) => r.id === binding.pinnedRevisionId);
  if (!revision || revision.identityId !== binding.identityId) {
    return { status: "INVALID", issues: [issue("BINDING_INVALID", "pinnedRevisionId", "revisão fixada não encontrada para a identidade do binding")] };
  }
  if (revision.status !== "PUBLISHED") {
    return { status: "INVALID", issues: [issue("BINDING_REVISION_NOT_PUBLISHED", "pinnedRevisionId", `revisão fixada está ${revision.status}`)] };
  }
  return { status: "RESOLVED", binding, revision };
}
