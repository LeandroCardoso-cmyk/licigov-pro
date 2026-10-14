/**
 * Modelos Institucionais — view-model PURO (sem React/DOM/trpc): rótulos, tons, regras de apresentação e validação de
 * formulário. A UI nunca decide autoridade: o servidor autoriza cada ação (piso de papel, flag, tenant); aqui só se
 * decide O QUE MOSTRAR e COMO EXPLICAR. "Latest" nunca é exibido como autoridade — a revisão é sempre a EXATA.
 */
import type { StatusTone } from "@/components/ui/statusStyles";

export type RevisionStatus = "DRAFT" | "APPROVED" | "PUBLISHED" | "DEPRECATED";
export const STATUS_ORDER: readonly RevisionStatus[] = ["DRAFT", "APPROVED", "PUBLISHED", "DEPRECATED"];

export const STATUS_LABEL: Record<RevisionStatus, string> = {
  DRAFT: "Rascunho (DRAFT)", APPROVED: "Aprovada (APPROVED)", PUBLISHED: "Publicada (PUBLISHED)", DEPRECATED: "Depreciada (DEPRECATED)",
};
export const STATUS_TONE: Record<RevisionStatus, StatusTone> = { DRAFT: "neutral", APPROVED: "info", PUBLISHED: "success", DEPRECATED: "warning" };
export const STATUS_EXPLANATION: Record<RevisionStatus, string> = {
  DRAFT: "Em elaboração. Pode ser editada. Ainda não pode ser vinculada nem usada em geração.",
  APPROVED: "Aprovada por decisão humana, mas NÃO publicada: ainda não pode ser vinculada nem usada em geração. A publicação é uma decisão distinta.",
  PUBLISHED: "Publicada: conteúdo imutável. Só uma revisão publicada pode ser vinculada. Para alterar, crie uma nova revisão (rascunho).",
  DEPRECATED: "Depreciada: continua válida para reproduzir documentos já gerados, mas não deve ser usada em novas gerações.",
};

export const DOCUMENT_KIND_LABEL: Record<string, string> = {
  dfd: "DFD", etp: "ETP", tr: "Termo de Referência", edital: "Edital", parecer: "Parecer", contrato: "Contrato", aditivo: "Aditivo",
};

export function revisionLabel(r: { revision: number; semanticHash: string }): string {
  return `Revisão ${r.revision} · ${r.semanticHash.slice(0, 8)}`;
}

const ROLE_RANK: Record<string, number> = { viewer: 1, operator: 2, manager: 3, admin: 4, owner: 5 };
/** Apenas para HABILITAR/DESABILITAR botões. O servidor reautoriza toda ação (nunca confia no frontend). */
export function hasRoleAtLeast(role: string | null | undefined, floor: string | undefined): boolean {
  if (!role || !floor) return false;
  return (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[floor] ?? Infinity);
}

export type LifecycleAction = "APPROVE" | "PUBLISH" | "DEPRECATE";
export interface ActionState { readonly action: LifecycleAction; readonly label: string; readonly enabled: boolean; readonly disabledReason?: string }

const NEXT: Record<RevisionStatus, { action: LifecycleAction; floorKey: string; label: string } | null> = {
  DRAFT: { action: "APPROVE", floorKey: "approve", label: "Aprovar" },
  APPROVED: { action: "PUBLISH", floorKey: "publish", label: "Publicar" },
  PUBLISHED: { action: "DEPRECATE", floorKey: "deprecate", label: "Depreciar" },
  DEPRECATED: null,
};

/** A única ação de ciclo de vida disponível para o estado (não há atalhos). */
export function nextLifecycleAction(status: RevisionStatus, role: string | null | undefined, floors: Record<string, string> | undefined): ActionState | null {
  const n = NEXT[status];
  if (!n) return null;
  const ok = hasRoleAtLeast(role, floors?.[n.floorKey]);
  return { action: n.action, label: n.label, enabled: ok, ...(ok ? {} : { disabledReason: `Exige papel mínimo "${floors?.[n.floorKey] ?? "manager"}" na organização.` }) };
}

export const ACTION_COPY: Record<LifecycleAction, { title: string; confirmLabel: string; consequence: string }> = {
  APPROVE: {
    title: "Aprovar revisão",
    confirmLabel: "Confirmo a APROVAÇÃO desta revisão",
    consequence: "Registra uma decisão institucional de aprovação. A revisão passa a APPROVED e deixa de aceitar edição. Aprovar NÃO publica.",
  },
  PUBLISH: {
    title: "Publicar revisão",
    confirmLabel: "Confirmo a PUBLICAÇÃO desta revisão",
    consequence: "Registra uma decisão institucional de publicação, distinta da aprovação. A revisão passa a PUBLISHED, fica imutável e poderá ser vinculada a tipos de documento.",
  },
  DEPRECATE: {
    title: "Depreciar revisão",
    confirmLabel: "Confirmo a DEPRECIAÇÃO desta revisão",
    consequence: "Registra uma decisão institucional de depreciação. A revisão deixa de poder ser vinculada; documentos já gerados continuam reproduzíveis. Não é possível depreciar uma revisão ainda fixada por um vínculo ativo.",
  },
};

// ─── formulário de decisão (autoridade DECLARADA no ato) ────────────────────────────

export interface DecisionFormState {
  decidedByName: string; decidedByRole: string; decidedAt: string; basisReference: string; reason: string; confirmed: boolean;
}
export const emptyDecisionForm = (today: string): DecisionFormState => ({ decidedByName: "", decidedByRole: "", decidedAt: today, basisReference: "", reason: "", confirmed: false });

export type DecisionField = keyof DecisionFormState;
export interface DecisionValidation { readonly valid: boolean; readonly errors: Partial<Record<DecisionField, string>> }

/** Espelha as regras do ledger (nome, cargo, data AAAA-MM-DD, referência do ato, justificativa ≥ 10) + confirmação explícita. */
export function validateDecisionForm(s: DecisionFormState): DecisionValidation {
  const errors: Partial<Record<DecisionField, string>> = {};
  if (!s.decidedByName.trim()) errors.decidedByName = "Informe o nome da autoridade que decidiu.";
  if (!s.decidedByRole.trim()) errors.decidedByRole = "Informe o cargo/função da autoridade.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.decidedAt) || Number.isNaN(Date.parse(`${s.decidedAt}T00:00:00Z`))) errors.decidedAt = "Informe a data do ato (AAAA-MM-DD).";
  if (!s.basisReference.trim()) errors.basisReference = "Informe a referência do ato (portaria, ata, processo).";
  if (s.reason.trim().length < 10) errors.reason = "Informe a justificativa (mínimo de 10 caracteres).";
  if (!s.confirmed) errors.confirmed = "É necessária a confirmação humana explícita.";
  return { valid: Object.keys(errors).length === 0, errors };
}

export function makeIdempotencyKey(random: () => string = () => globalThis.crypto.randomUUID()): string {
  return `tpl-${random()}`;
}

// ─── binding / resolução ────────────────────────────────────────────────────────

export interface ScopeLike { modality?: string; form?: string; platform?: string; regime?: string; criterion?: string }
export function scopeLabel(scope: ScopeLike): string {
  const parts = [
    scope.modality && `modalidade: ${scope.modality}`, scope.form && `forma: ${scope.form}`, scope.platform && `plataforma: ${scope.platform}`,
    scope.regime && `regime: ${scope.regime}`, scope.criterion && `critério: ${scope.criterion}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "escopo não declarado (só casa com pedido que também não declara escopo)";
}

export type ResolutionView =
  | { status: "RESOLVED"; bindingId: string; identityId: string; revisionId: string; revision: number; semanticHash: string; effectiveFrom: string }
  | { status: "NOT_BOUND" }
  | { status: "AMBIGUOUS"; bindingIds: readonly string[] }
  | { status: "INVALID"; issues: readonly { code: string; path: string; message: string }[] };

export function describeResolutionView(r: ResolutionView): { tone: StatusTone; title: string; detail: string } {
  switch (r.status) {
    case "RESOLVED": return { tone: "success", title: `Será aplicada a Revisão ${r.revision} (${r.semanticHash.slice(0, 8)})`, detail: `Vínculo ${r.bindingId} fixa esta revisão exata (vigente desde ${r.effectiveFrom}). Revisões publicadas depois não substituem esta automaticamente.` };
    case "NOT_BOUND": return { tone: "neutral", title: "Nenhum modelo vinculado", detail: "Sem vínculo ativo para este tipo e escopo: a geração segue o caminho governado atual (sem modelo institucional)." };
    case "AMBIGUOUS": return { tone: "danger", title: "Vínculo ambíguo — geração bloqueada", detail: `Há ${r.bindingIds.length} vínculos ativos para o mesmo tipo e escopo (${r.bindingIds.join(", ")}). Desative ou substitua um deles; o sistema não escolhe por você.` };
    default: return { tone: "danger", title: "Vínculo inválido — geração bloqueada", detail: r.issues.map((i) => i.message).join(" ") || "O vínculo não aponta para uma revisão publicada exata." };
  }
}

export function formatIssues(issues: readonly { code: string; path: string; message: string }[]): string[] {
  return issues.map((i) => `${i.path ? `${i.path}: ` : ""}${i.message} (${i.code})`);
}

export const AI_NARRATIVE_LABEL: Record<string, string> = {
  PLACEHOLDER_ONLY: "Apenas marcador (a IA não foi chamada)",
  PRESENT_PENDING_HUMAN_ACCEPTANCE: "Narrativa de IA presente — aguardando aceite humano",
  PRESENT_HUMAN_ACCEPTED: "Narrativa de IA presente — aceita por pessoa",
  ABSENT: "Sem narrativa de IA",
};

// ─── AST: contorno e edição assistida ───────────────────────────────────────────────

export interface OutlineItem { readonly depth: number; readonly kind: string; readonly label: string }

type AstNodeLike = { t?: string; [k: string]: unknown };
const inlineText = (v: unknown): string => (Array.isArray(v) ? v.map((i: AstNodeLike) => (i.t === "text" ? String(i.v ?? "") : i.t === "var" ? `{{${String(i.name)}}}` : inlineText(i.v))).join("") : "");
const excerpt = (s: string): string => (s.length > 80 ? `${s.slice(0, 77)}…` : s);

export function outlineOf(ast: unknown): OutlineItem[] {
  const out: OutlineItem[] = [];
  const walk = (nodes: unknown, depth: number): void => {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes as AstNodeLike[]) {
      switch (n.t) {
        case "heading": out.push({ depth, kind: "Título", label: excerpt(inlineText(n.text)) }); break;
        case "paragraph": out.push({ depth, kind: "Parágrafo", label: excerpt(inlineText(n.inline)) }); break;
        case "list": out.push({ depth, kind: n.ordered ? "Lista numerada" : "Lista", label: `${(n.items as unknown[] | undefined)?.length ?? 0} item(ns)` }); (n.items as unknown[] | undefined)?.forEach((it) => walk(it, depth + 1)); break;
        case "table": out.push({ depth, kind: "Tabela", label: `${(n.header as unknown[] | undefined)?.length ?? 0} coluna(s), ${(n.rows as unknown[] | undefined)?.length ?? 0} linha(s)` }); break;
        case "section": out.push({ depth, kind: "Seção", label: String(n.key ?? "") }); walk(n.children, depth + 1); break;
        case "conditional": out.push({ depth, kind: "Condicional", label: "conteúdo condicional (DSL fechada)" }); walk(n.then, depth + 1); if (n.else) walk(n.else, depth + 1); break;
        case "docRef": out.push({ depth, kind: "Referência", label: `${String(n.kind)} (pin exato)` }); break;
        case "annex": out.push({ depth, kind: "Anexo", label: String(n.id ?? "") }); walk(n.children, depth + 1); break;
        case "aiSlot": out.push({ depth, kind: "Slot de IA", label: `${String(n.slotKey)} — narrativa explícita, sempre revisada por pessoa` }); break;
        default: out.push({ depth, kind: "Desconhecido", label: String(n.t) });
      }
    }
  };
  const root = (ast as { root?: unknown } | null)?.root;
  walk(root, 0);
  return out;
}

export const AST_SNIPPETS: Record<string, { label: string; node: unknown }> = {
  heading: { label: "Título", node: { t: "heading", level: 2, text: [{ t: "text", v: "Novo título" }] } },
  paragraph: { label: "Parágrafo", node: { t: "paragraph", inline: [{ t: "text", v: "Novo parágrafo." }] } },
  section: { label: "Seção", node: { t: "section", key: "nova_secao", children: [{ t: "paragraph", inline: [{ t: "text", v: "Conteúdo da seção." }] }] } },
  aiSlot: { label: "Slot de IA (narrativa explícita)", node: { t: "aiSlot", slotKey: "narrativa_1", maxTokens: 600, instructionsKey: "instrucoes_narrativa_1" } },
};

/** Acrescenta um nó (da whitelist) ao final do AST em edição. Devolve o JSON original se ele não for JSON válido. */
export function appendSnippet(astJson: string, snippetKey: string): string {
  const snippet = AST_SNIPPETS[snippetKey];
  if (!snippet) return astJson;
  try {
    const ast = JSON.parse(astJson) as { schema?: string; root?: unknown[] };
    const root = Array.isArray(ast.root) ? ast.root : [];
    // chaves únicas (slotKey/section key) para não duplicar identificadores ao inserir mais de um
    const node = JSON.parse(JSON.stringify(snippet.node)) as AstNodeLike;
    const n = root.length + 1;
    if (node.t === "aiSlot") { node.slotKey = `${String(node.slotKey).replace(/_\d+$/, "")}_${n}`; node.instructionsKey = `${String(node.instructionsKey).replace(/_\d+$/, "")}_${n}`; }
    if (node.t === "section") node.key = `${String(node.key).replace(/_\d+$/, "")}_${n}`;
    return JSON.stringify({ ...ast, root: [...root, node] }, null, 2);
  } catch {
    return astJson;
  }
}

export function sampleValuesFromText(text: string): { values: Record<string, string>; errors: string[] } {
  const values: Record<string, string> = {};
  const errors: string[] = [];
  text.split("\n").map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    const eq = line.indexOf("=");
    if (eq < 1) { errors.push(`Linha ${i + 1}: use o formato nome=valor.`); return; }
    values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  });
  return { values, errors };
}

/** Rótulo de apresentação do modelo: `displayName` quando existe; senão o slug (nunca vazio). */
export function identityLabel(identity: { slug: string; displayName?: string | null }): string {
  return identity.displayName && identity.displayName.trim() ? identity.displayName : identity.slug;
}

// ─── aplicabilidade explícita (piloto Edital multi-modelo) ──────────────────────────────

export const SCOPE_DIMENSION_ORDER = ["modality", "form", "platform", "regime", "criterion"] as const;
export type ScopeDimensionKey = (typeof SCOPE_DIMENSION_ORDER)[number];
export const SCOPE_DIMENSION_COPY: Record<ScopeDimensionKey, string> = {
  modality: "Modalidade", form: "Forma", platform: "Plataforma", regime: "Regime de contratação", criterion: "Critério de julgamento",
};
export type ScopeFormState = Record<ScopeDimensionKey, string>;
export const emptyScopeForm = (): ScopeFormState => ({ modality: "", form: "", platform: "", regime: "", criterion: "" });

/** Escopo do formulário → objeto da API (dimensão vazia = não declarada; nada é preenchido por inferência). */
export function scopeFromForm(f: ScopeFormState): Partial<Record<ScopeDimensionKey, string>> {
  const out: Partial<Record<ScopeDimensionKey, string>> = {};
  for (const k of SCOPE_DIMENSION_ORDER) if (f[k].trim()) out[k] = f[k].trim();
  return out;
}

const norm = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** Espelha (só para habilitar o botão e explicar) a regra do servidor: Edital exige modalidade e forma; forma eletrônica exige plataforma. Valores são SLUGS (a-z, 0-9, hífen). */
export function scopeFormProblems(documentKind: string, f: ScopeFormState): Partial<Record<ScopeDimensionKey, string>> {
  const out: Partial<Record<ScopeDimensionKey, string>> = {};
  const v = scopeFromForm(f);
  for (const k of SCOPE_DIMENSION_ORDER) if (v[k] && (v[k]!.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v[k]!))) out[k] = "Use um slug estável (minúsculas, números e hífens; sem espaços).";
  if (documentKind === "edital") {
    for (const k of ["modality", "form"] as const) if (!v[k]) out[k] = `${SCOPE_DIMENSION_COPY[k]}: declare explicitamente (sem seleção automática).`;
    if (v.form && /^eletronic[ao]$/.test(norm(v.form)) && !v.platform) out.platform = "Forma eletrônica exige a plataforma do certame.";
  }
  return out;
}

export type DisplayNameSource = "IDENTITY" | "REGISTRATION_PROVENANCE" | "SLUG";
export const DISPLAY_NAME_SOURCE_LABEL: Record<DisplayNameSource, string> = {
  IDENTITY: "nome do modelo", REGISTRATION_PROVENANCE: "nome do registro de procedência", SLUG: "slug (sem nome de exibição registrado)",
};
export type BindingHealth = "OK" | "REVISION_NOT_PUBLISHED" | "REVISION_MISSING" | "SCOPE_CONFLICT";
export const BINDING_HEALTH_LABEL: Record<BindingHealth, { label: string; tone: StatusTone }> = {
  OK: { label: "Vínculo íntegro (revisão exata publicada)", tone: "success" },
  REVISION_NOT_PUBLISHED: { label: "Revisão fixada não está publicada — geração bloqueada", tone: "danger" },
  REVISION_MISSING: { label: "Revisão fixada inexistente — geração bloqueada", tone: "danger" },
  SCOPE_CONFLICT: { label: "Conflito: mais de um vínculo ativo para o mesmo escopo — falha fechada", tone: "danger" },
};
export const BINDING_STATUS_LABEL: Record<"BOUND" | "NOT_BOUND" | "CONFLICT", { label: string; tone: StatusTone }> = {
  BOUND: { label: "Vinculado", tone: "success" }, NOT_BOUND: { label: "Sem vínculo ativo", tone: "neutral" }, CONFLICT: { label: "Conflito de vínculo", tone: "danger" },
};

export interface CatalogRowView {
  readonly identityId: string; readonly documentKind: string; readonly slug: string; readonly displayName: string; readonly displayNameSource: DisplayNameSource;
  readonly templateKey: string | null; readonly declaredScope: ScopeLike; readonly headline: string; readonly bindingStatus: "BOUND" | "NOT_BOUND" | "CONFLICT";
  readonly revisions: readonly { id: string; revision: number; status: RevisionStatus; semanticHash: string }[];
  readonly bindings: readonly { bindingId: string; active: boolean; scope: ScopeLike; scopeHeadline: string; pinnedRevisionId: string | null; pinnedRevision: number | null; pinnedRevisionStatus: RevisionStatus | null; pinnedSemanticHash: string | null; health: BindingHealth; effectiveFrom: string }[];
  /** Template Governance V2: origem registrada (ausente em servidores anteriores ⇒ sem procedência). */
  readonly origin?: OriginView | null; readonly originState?: OriginStateKey;
}
export interface CatalogFilterState { documentKind: string; modality: string; form: string; platform: string; status: string }
export const EMPTY_CATALOG_FILTER: CatalogFilterState = { documentKind: "", modality: "", form: "", platform: "", status: "" };

/** Opções dos filtros = o que existe nos modelos listados (mais as sugestões do vocabulário), sem inventar valores. */
export function catalogFilterOptions(rows: readonly CatalogRowView[], suggestions?: Partial<Record<"modality" | "form" | "platform", Record<string, string>>>) {
  const collect = (d: "modality" | "form" | "platform"): string[] => {
    const set = new Set<string>(Object.keys(suggestions?.[d] ?? {}));
    for (const r of rows) { if (r.declaredScope[d]) set.add(r.declaredScope[d]!); r.bindings.forEach((b) => { if (b.scope[d]) set.add(b.scope[d]!); }); }
    return [...set].sort();
  };
  return { modality: collect("modality"), form: collect("form"), platform: collect("platform") };
}

/** Rótulo curto da revisão exata mostrada no catálogo: "PUBLISHED revisão 2 (ab12cd34)". */
export function pinnedRevisionLabel(b: CatalogRowView["bindings"][number]): string {
  return b.pinnedRevision == null ? "revisão fixada indisponível" : `${b.pinnedRevisionStatus} revisão ${b.pinnedRevision} (${(b.pinnedSemanticHash ?? "").slice(0, 8)})`;
}

// ─── prontidão antes de publicar ───────────────────────────────────────────────────────

export type ReadinessStatusKey = "PASS" | "BLOCKED" | "NOT_APPLICABLE";
export const READINESS_STATUS_LABEL: Record<ReadinessStatusKey, { label: string; tone: StatusTone }> = {
  PASS: { label: "PASS", tone: "success" }, BLOCKED: { label: "BLOCKED", tone: "danger" }, NOT_APPLICABLE: { label: "NOT_APPLICABLE", tone: "neutral" },
};
export interface ReadinessMatrixView {
  readonly revisionId: string; readonly revisionSemanticHash: string; readonly overall: "READY" | "BLOCKED"; readonly matrixHash: string;
  readonly summary: { pass: number; blocked: number; notApplicable: number }; readonly notices: readonly string[];
  readonly checks: readonly { id: string; label: string; status: ReadinessStatusKey; detail: string; findings: readonly string[]; findingsTotal: number; layer?: ReadinessLayerKey }[];
  /** Política efetiva do órgão aplicada a esta matriz (Template Governance V2). Ausente em servidores anteriores ⇒ tratado como padrão da plataforma. */
  readonly policy?: { kind: PolicyKindKey; legalEvidence: LegalEvidenceRequirementKey; decisionId: string | null; malformed: boolean };
}
export function readinessHeadline(m: ReadinessMatrixView): string {
  return m.overall === "READY"
    ? `Sem bloqueios (${m.summary.pass} PASS · ${m.summary.notApplicable} NOT_APPLICABLE). A publicação continua sendo uma decisão humana distinta.`
    : `${m.summary.blocked} verificação(ões) BLOCKED · ${m.summary.pass} PASS · ${m.summary.notApplicable} NOT_APPLICABLE. Os bloqueios não são ocultados e impedem a publicação.`;
}

// ─── evidência de aprovação jurídica ───────────────────────────────────────────────────

export interface LegalEvidenceFormState {
  sourceLogicalVersion: string; sourceSha256: string; parecerNumber: string; parecerDate: string; protocol: string; procurador: string; refs: string;
  decidedByName: string; decidedByRole: string; decidedAt: string; basisReference: string; reason: string; confirmed: boolean;
}
export const emptyLegalEvidenceForm = (today: string): LegalEvidenceFormState => ({
  sourceLogicalVersion: "", sourceSha256: "", parecerNumber: "", parecerDate: "", protocol: "", procurador: "", refs: "",
  decidedByName: "", decidedByRole: "", decidedAt: today, basisReference: "", reason: "", confirmed: false,
});
export function validateLegalEvidenceForm(f: LegalEvidenceFormState): { valid: boolean; errors: Partial<Record<keyof LegalEvidenceFormState, string>> } {
  const errors: Partial<Record<keyof LegalEvidenceFormState, string>> = {};
  if (!f.sourceLogicalVersion.trim()) errors.sourceLogicalVersion = "Informe a versão lógica do conteúdo-fonte aprovado (ex.: 1.0.1-draft).";
  if (!/^[0-9a-f]{64}$/.test(f.sourceSha256.trim())) errors.sourceSha256 = "Informe o SHA-256 (64 caracteres hexadecimais minúsculos) do conteúdo-fonte.";
  if (f.parecerDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(f.parecerDate.trim())) errors.parecerDate = "Data do parecer: AAAA-MM-DD (ou deixe em branco).";
  if (!f.decidedByName.trim()) errors.decidedByName = "Informe a autoridade/órgão que aprovou (como declarado por você).";
  if (!f.decidedByRole.trim()) errors.decidedByRole = "Informe o cargo/função.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.decidedAt) || Number.isNaN(Date.parse(`${f.decidedAt}T00:00:00Z`))) errors.decidedAt = "Informe a data do ato (AAAA-MM-DD).";
  if (!f.basisReference.trim()) errors.basisReference = "Informe a base/referência da aprovação.";
  if (f.reason.trim().length < 10) errors.reason = "Informe a justificativa (mínimo de 10 caracteres).";
  if (!f.confirmed) errors.confirmed = "É necessária a confirmação humana explícita.";
  return { valid: Object.keys(errors).length === 0, errors };
}
/** Só envia o que foi informado: campos opcionais vazios NUNCA viram texto inventado. */
export function legalEvidencePayload(f: LegalEvidenceFormState) {
  const opt = (v: string): string | undefined => (v.trim() ? v.trim() : undefined);
  const refs = f.refs.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    sourceLogicalVersion: f.sourceLogicalVersion.trim(), sourceSha256: f.sourceSha256.trim(),
    ...(opt(f.parecerNumber) ? { parecerNumber: opt(f.parecerNumber) } : {}), ...(opt(f.parecerDate) ? { parecerDate: opt(f.parecerDate) } : {}),
    ...(opt(f.protocol) ? { protocol: opt(f.protocol) } : {}), ...(opt(f.procurador) ? { procurador: opt(f.procurador) } : {}),
    ...(refs.length ? { evidenceRefs: refs } : {}),
  };
}

// ─── registro / importação de modelo (nasce DRAFT) ─────────────────────────────────────

export interface RegistrationPresetView {
  presetId: string; templateKey: string; documentKind: string; slug: string; displayName: string; scope: ScopeLike;
  /** Pacote aprovado versionado NO SERVIDOR: versão lógica e SHA-256 vêm do servidor (nunca digitados). */
  sourceKind?: "MODEL_PACKAGE"; sourceLogicalVersion?: string; sourceSha256?: string;
}
export interface RegisterFormState {
  targetKind: "NEW_IDENTITY" | "EXISTING_IDENTITY";
  existingIdentityId: string;
  documentKind: string; slug: string; templateKey: string; displayName: string; scope: ScopeFormState;
  sourceKind: "AST" | "MARKDOWN" | "DOCX" | "MODEL_PACKAGE"; sourceText: string;
  sourceLogicalVersion: string; sourceSha256: string; inventoryText: string;
  decidedByName: string; decidedByRole: string; decidedAt: string; basisReference: string; reason: string; confirmed: boolean;
}

export const emptyRegisterForm = (today: string, preset?: RegistrationPresetView): RegisterFormState => ({
  targetKind: "NEW_IDENTITY", existingIdentityId: "",
  documentKind: preset?.documentKind ?? "edital", slug: preset?.slug ?? "", templateKey: preset?.templateKey ?? "", displayName: preset?.displayName ?? "",
  scope: { ...emptyScopeForm(), ...(preset?.scope ?? {}) } as ScopeFormState,
  ...(preset?.sourceKind === "MODEL_PACKAGE"
    ? { sourceKind: "MODEL_PACKAGE" as const, sourceText: "", sourceLogicalVersion: preset.sourceLogicalVersion ?? "", sourceSha256: preset.sourceSha256 ?? "", inventoryText: "" }
    : { sourceKind: "AST" as const, sourceText: "", sourceLogicalVersion: "", sourceSha256: "", inventoryText: "" }),
  decidedByName: "", decidedByRole: "", decidedAt: today, basisReference: "", reason: "", confirmed: false,
});

export function validateRegisterForm(f: RegisterFormState, hasDocx: boolean): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (f.targetKind === "NEW_IDENTITY") {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(f.slug)) errors.slug = "Slug: minúsculas, números e hífens.";
  } else if (!f.existingIdentityId.trim()) errors.existingIdentityId = "Informe o modelo existente.";
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(f.templateKey)) errors.templateKey = "templateKey: MAIÚSCULAS, dígitos e _ (ex.: EDITAL_PREGAO_ELETRONICO_BLL).";
  if (!f.displayName.trim()) errors.displayName = "Informe o nome de exibição.";
  Object.assign(errors, Object.fromEntries(Object.entries(scopeFormProblems(f.documentKind, f.scope)).map(([k, v]) => [`scope.${k}`, v as string])));
  const isPackage = f.sourceKind === "MODEL_PACKAGE";   // pacote do servidor: sem AST/Markdown/DOCX/inventário no cliente
  if (!isPackage && (f.sourceKind === "DOCX" ? !hasDocx : !f.sourceText.trim())) errors.source = "Informe o conteúdo-fonte.";
  if (f.sourceKind === "AST") { try { JSON.parse(f.sourceText); } catch { if (f.sourceText.trim()) errors.source = "AST: JSON inválido."; } }
  if (!f.sourceLogicalVersion.trim()) errors.sourceLogicalVersion = "Informe a versão lógica da fonte.";
  if (!/^[0-9a-f]{64}$/.test(f.sourceSha256.trim())) errors.sourceSha256 = "SHA-256 da fonte: 64 hexadecimais minúsculos.";
  if (!isPackage && f.inventoryText.trim()) { try { JSON.parse(f.inventoryText); } catch { errors.inventoryText = "Inventário: JSON inválido."; } }
  if (!f.decidedByName.trim()) errors.decidedByName = "Informe quem registra (nome).";
  if (!f.decidedByRole.trim()) errors.decidedByRole = "Informe o cargo/função.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.decidedAt)) errors.decidedAt = "Data AAAA-MM-DD.";
  if (!f.basisReference.trim()) errors.basisReference = "Informe a referência da fonte/ato.";
  if (f.reason.trim().length < 10) errors.reason = "Justificativa (mín. 10 caracteres).";
  if (!f.confirmed) errors.confirmed = "É necessária a confirmação humana explícita.";
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Payload de `source` do registro: pacote do servidor envia SÓ o `modelKey` (nenhum conteúdo jurídico trafega no browser). */
export const packageSourceOf = (f: Pick<RegisterFormState, "templateKey">) => ({ kind: "MODEL_PACKAGE" as const, modelKey: f.templateKey });

/**
 * Vínculo ATIVO que o novo vínculo substituiria: mesmo tipo documental e escopo EXATAMENTE igual (5 dimensões; ausente ≡ vazio).
 * A troca de revisão num escopo já vinculado deve ser ATÔMICA (`replacesBindingId`): desativar e criar em dois passos deixaria o escopo sem
 * vínculo (e a geração voltaria ao legado). `null` = nenhum vínculo ativo para substituir.
 */
export interface BindingLike { readonly id: string; readonly active: boolean; readonly documentKind: string; readonly pinnedRevisionId?: string | null; readonly scope: ScopeLike }
export function replaceableBinding<B extends BindingLike>(bindings: readonly B[], documentKind: string, scope: ScopeLike): B | null {
  const dims = ["modality", "form", "platform", "regime", "criterion"] as const;
  const norm = (s: ScopeLike, k: (typeof dims)[number]) => (s as Record<string, string | null | undefined>)[k] ?? "";
  const hits = bindings.filter((b) => b.active && b.documentKind === documentKind && dims.every((k) => norm(b.scope, k) === norm(scope, k)));
  return hits.length === 1 ? hits[0] : null;
}


// ─── Template Governance V2: origem, política do órgão, camadas de prontidão, derivação ────────────────────────────────

export type ReadinessLayerKey = "TECHNICAL_TEMPLATE_READINESS" | "TENANT_TEMPLATE_POLICY" | "DOCUMENT_LEGAL_REVIEW";
export type LegalEvidenceRequirementKey = "REQUIRED" | "OPTIONAL";
export type PolicyKindKey = "PLATFORM_DEFAULT" | "TENANT_DEFINED" | "LEGACY_COMPAT" | "UNRESOLVED_STRICT";

export const READINESS_LAYER_LABEL: Record<ReadinessLayerKey, { title: string; hint: string }> = {
  TECHNICAL_TEMPLATE_READINESS: { title: "Prontidão técnica do modelo", hint: "Estrutura, variáveis, procedência e inventário do modelo. Sempre exigida para disponibilizar o modelo." },
  TENANT_TEMPLATE_POLICY: { title: "Política do órgão sobre seus modelos", hint: "O que a sua organização decidiu exigir antes de disponibilizar um modelo no catálogo interno." },
  DOCUMENT_LEGAL_REVIEW: { title: "Análise jurídica do documento elaborado", hint: "Etapa própria da Procuradoria, na fase institucional adequada. Não é verificada aqui." },
};
const LAYER_ORDER: readonly ReadinessLayerKey[] = ["TECHNICAL_TEMPLATE_READINESS", "TENANT_TEMPLATE_POLICY", "DOCUMENT_LEGAL_REVIEW"];

/** Agrupa as verificações por camada (ordem fixa; camada sem verificações é omitida). Servidor sem `layer` ⇒ tudo na camada técnica. */
export function groupChecksByLayer(m: ReadinessMatrixView): { layer: ReadinessLayerKey; title: string; hint: string; checks: ReadinessMatrixView["checks"] }[] {
  return LAYER_ORDER
    .map((layer) => ({ layer, ...READINESS_LAYER_LABEL[layer], checks: m.checks.filter((c) => (c.layer ?? "TECHNICAL_TEMPLATE_READINESS") === layer) }))
    .filter((g) => g.checks.length > 0);
}

/** Explica, em linguagem simples, por que a evidência jurídica pode (ou não) bloquear — nunca presume aprovação. */
export function legalPolicyExplanation(policy: ReadinessMatrixView["policy"] | undefined): string {
  const kind: PolicyKindKey = policy?.kind ?? "UNRESOLVED_STRICT";
  if (policy?.malformed || kind === "UNRESOLVED_STRICT") return "A política do órgão não pôde ser resolvida/lida: aplica-se o padrão ESTRITO (evidência jurídica prévia exigida) até que seja restabelecida.";
  if (policy && policy.legalEvidence === "OPTIONAL") {
    return kind === "TENANT_DEFINED"
      ? "Sua organização definiu a evidência jurídica como OPCIONAL: sem ela o modelo pode ser disponibilizado no catálogo interno. Se houver evidência registrada e válida, ela continua auditável. A análise jurídica do documento elaborado permanece com a Procuradoria."
      : "Padrão da plataforma: a evidência jurídica prévia do modelo é OPCIONAL — sem ela o modelo pode ser disponibilizado no catálogo interno (se houver evidência válida, ela continua auditável). Sua organização pode estabelecer a exigência. A análise jurídica do documento elaborado permanece com a Procuradoria.";
  }
  return kind === "LEGACY_COMPAT"
    ? "Compatibilidade com o regime anterior: sua organização já tinha modelos antes da transição do padrão e não registrou política, então a evidência de análise jurídica prévia continua exigida. Nada foi alterado em silêncio; um gerente pode registrar a política do órgão."
    : "Sua organização exige evidência de análise jurídica prévia para disponibilizar o modelo.";
}

export type OwnershipKey = "PLATFORM" | "TENANT" | "DERIVED";
export interface OriginView {
  readonly ownership: OwnershipKey; readonly source: "PLATFORM_CATALOG" | "TENANT_UPLOAD" | "TENANT_AUTHORED";
  readonly lineage: ({ kind: "PLATFORM_PACKAGE"; packageKey: string; packageVersion: string; sourceSha256: string } | { kind: "TENANT_REVISION"; identityId: string; revisionId: string; semanticHash: string }) | null;
  readonly original: { sha256: string; sizeBytes: number; filename: string | null; contentType: string | null; storageKey: string; preservation: "READBACK_SHA256" } | null; readonly declaredAuthor: string | null;
}
export type OriginStateKey = "RECORDED" | "LEGACY_UNCLASSIFIED" | "MALFORMED" | "NO_PROVENANCE";

export const OWNERSHIP_LABEL: Record<OwnershipKey, string> = { PLATFORM: "Modelo da plataforma", TENANT: "Modelo próprio", DERIVED: "Modelo derivado" };
export const SOURCE_LABEL: Record<OriginView["source"], string> = { PLATFORM_CATALOG: "catálogo da plataforma", TENANT_UPLOAD: "arquivo enviado pela organização", TENANT_AUTHORED: "elaborado pela organização" };

export interface OriginBadgeView { readonly label: string; readonly tone: StatusTone; readonly detail: string }
/** Selo de origem do card/detalhe. Estados sem origem registrada são ditos como são (nunca "plataforma" por padrão). */
export function originBadge(row: { origin?: OriginView | null; originState?: OriginStateKey }): OriginBadgeView {
  const state = row.originState ?? "NO_PROVENANCE";
  if (state === "RECORDED" && row.origin) {
    const o = row.origin;
    const lineage = o.lineage ? (o.lineage.kind === "PLATFORM_PACKAGE" ? ` · derivado de ${o.lineage.packageKey} v${o.lineage.packageVersion}` : ` · derivado da revisão ${o.lineage.revisionId.slice(0, 10)} (${o.lineage.semanticHash.slice(0, 8)})`) : "";
    return { label: OWNERSHIP_LABEL[o.ownership], tone: o.ownership === "PLATFORM" ? "info" : o.ownership === "DERIVED" ? "warning" : "success", detail: `Origem: ${SOURCE_LABEL[o.source]}${lineage}` };
  }
  if (state === "LEGACY_UNCLASSIFIED") return { label: "Origem não classificada", tone: "neutral", detail: "Registrado antes da classificação de origem; pode ser classificado uma única vez." };
  if (state === "MALFORMED") return { label: "Origem ilegível", tone: "danger", detail: "O registro de origem não passa na verificação de integridade; trate o modelo com cautela." };
  return { label: "Sem procedência", tone: "neutral", detail: "Nenhuma procedência registrada para este modelo." };
}

export type OwnershipFilter = "ALL" | OwnershipKey | "UNCLASSIFIED";
export const OWNERSHIP_FILTER_LABEL: Record<OwnershipFilter, string> = { ALL: "Todos", PLATFORM: "Da plataforma", TENANT: "Da minha prefeitura", DERIVED: "Derivados", UNCLASSIFIED: "Sem classificação" };
const ownershipOf = (r: { origin?: OriginView | null; originState?: OriginStateKey }): OwnershipFilter => (r.originState === "RECORDED" && r.origin ? r.origin.ownership : "UNCLASSIFIED");
export function filterByOwnership<T extends { origin?: OriginView | null; originState?: OriginStateKey }>(rows: readonly T[], f: OwnershipFilter): T[] {
  return f === "ALL" ? [...rows] : rows.filter((r) => ownershipOf(r) === f);
}
export function ownershipCounts(rows: readonly { origin?: OriginView | null; originState?: OriginStateKey }[]): Record<OwnershipFilter, number> {
  const out: Record<OwnershipFilter, number> = { ALL: rows.length, PLATFORM: 0, TENANT: 0, DERIVED: 0, UNCLASSIFIED: 0 };
  for (const r of rows) out[ownershipOf(r)] += 1;
  return out;
}

// política do órgão (somente gerente+; o servidor reautoriza)
export interface PolicyView {
  readonly kind: PolicyKindKey; readonly version: number; readonly malformed: boolean;
  /** Compatibilidade/transição explícitas (marco, órgão legado?, explicação). Ausente em servidores anteriores. */
  readonly transition?: { cutoverAt: string; legacyOrganization: boolean; explanation: string };
  readonly policy: { legalEvidence: LegalEvidenceRequirementKey; approveMinRole: "manager" | "owner"; publishMinRole: "manager" | "owner" };
  readonly note?: string;
  readonly history: readonly { version: number; policy: PolicyView["policy"] | null; declaredBy: { name: string; role: string }; actDate: string; reason: string }[];
}
export interface PolicyFormState { legalEvidence: LegalEvidenceRequirementKey; approveMinRole: "manager" | "owner"; publishMinRole: "manager" | "owner"; decision: DecisionFormState }
export const emptyPolicyForm = (current: PolicyView["policy"], today: string): PolicyFormState => ({ ...current, decision: emptyDecisionForm(today) });
export function validatePolicyForm(f: PolicyFormState, current: PolicyView): { valid: boolean; errors: Partial<Record<DecisionField | "unchanged", string>> } {
  const { errors } = validateDecisionForm(f.decision);
  const out: Partial<Record<DecisionField | "unchanged", string>> = { ...errors };
  const c = current.policy;
  // Só é "sem alteração" quando já há decisão PRÓPRIA do órgão; confirmar explicitamente o padrão/regime anterior é uma decisão legítima (encerra a compatibilidade).
  if (current.kind === "TENANT_DEFINED" && f.legalEvidence === c.legalEvidence && f.approveMinRole === c.approveMinRole && f.publishMinRole === c.publishMinRole && !current.malformed) out.unchanged = "Nenhuma alteração em relação à política vigente.";
  return { valid: Object.keys(out).length === 0, errors: out };
}
export const POLICY_KIND_LABEL: Record<PolicyKindKey, { label: string; tone: StatusTone }> = {
  TENANT_DEFINED: { label: "Definida pelo órgão", tone: "success" }, PLATFORM_DEFAULT: { label: "Padrão da plataforma", tone: "neutral" },
  LEGACY_COMPAT: { label: "Compatibilidade (regime anterior)", tone: "warning" }, UNRESOLVED_STRICT: { label: "Estrita (não resolvida)", tone: "danger" },
};
export function policyHeadline(p: Pick<PolicyView, "kind" | "malformed" | "policy" | "version">): string {
  const origin = p.kind === "TENANT_DEFINED" ? `Política do órgão (versão ${p.version})` : p.kind === "LEGACY_COMPAT" ? "Regime anterior preservado (sem política registrada)" : p.kind === "UNRESOLVED_STRICT" ? "Política não resolvida" : "Padrão da plataforma";
  const legal = p.policy.legalEvidence === "REQUIRED" ? "evidência jurídica OBRIGATÓRIA" : "evidência jurídica OPCIONAL";
  const roles = `aprovar: ${p.policy.approveMinRole} · publicar: ${p.policy.publishMinRole}`;
  return `${origin}: ${legal}; ${roles}${p.malformed ? " — registro ilegível, aplicado o padrão estrito" : ""}.`;
}

// derivação (a partir de modelo da plataforma ou próprio já decidido)
export interface DeriveFormState { slug: string; displayName: string; declaredAuthor: string; decision: DecisionFormState }
export const emptyDeriveForm = (today: string, suggestedName = ""): DeriveFormState => ({ slug: "", displayName: suggestedName ? `${suggestedName} (adaptado)` : "", declaredAuthor: "", decision: emptyDecisionForm(today) });
export function validateDeriveForm(f: DeriveFormState): { valid: boolean; errors: Partial<Record<"slug" | "displayName" | "declaredAuthor" | DecisionField, string>> } {
  const { errors } = validateDecisionForm(f.decision);
  const out: Partial<Record<"slug" | "displayName" | "declaredAuthor" | DecisionField, string>> = { ...errors };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(f.slug) || f.slug.length > 120) out.slug = "Slug: minúsculas, números e hífens.";
  if (!f.displayName.trim() || f.displayName.length > 200) out.displayName = "Informe o nome do modelo (até 200 caracteres).";
  if (f.declaredAuthor.trim() && (f.declaredAuthor.length > 160 || /[\r\n]/.test(f.declaredAuthor))) out.declaredAuthor = "Autor: uma linha, até 160 caracteres.";
  return { valid: Object.keys(out).length === 0, errors: out };
}
/** Fontes de derivação mostradas na UI: só revisões JÁ decididas (nunca rascunho) e pacotes da plataforma. */
export const DERIVABLE_STATUSES: readonly RevisionStatus[] = ["APPROVED", "PUBLISHED", "DEPRECATED"];
export const canDeriveFrom = (status: RevisionStatus): boolean => DERIVABLE_STATUSES.includes(status);
/** Revisão EXATA oferecida como origem de derivação de um modelo do catálogo: a mais recente já decidida (nunca rascunho). `null` = não há o que derivar. */
export function derivableRevision(row: Pick<CatalogRowView, "revisions">): CatalogRowView["revisions"][number] | null {
  const ok = row.revisions.filter((r) => canDeriveFrom(r.status)).sort((a, b) => b.revision - a.revision);
  return ok[0] ?? null;
}

// ─── integridade da fonte: declarado × calculado × semântico × lineage ─────────────────────────────────────────────────

export type HashAssuranceKey = "CLIENT_DECLARED_UNVERIFIED" | "SERVER_COMPUTED" | "SERVER_DERIVED" | "PLATFORM_VERSIONED";
export interface IntegrityView {
  readonly items: readonly { id: string; label: string; value: string | null; assurance: HashAssuranceKey; explanation: string }[];
  readonly relations: readonly { id: string; status: "MATCH" | "DIFFERENT" | "NOT_APPLICABLE" | "UNKNOWN"; message: string }[];
  readonly serverAssured: readonly string[]; readonly notices: readonly string[];
}
export const ASSURANCE_LABEL: Record<HashAssuranceKey, { label: string; tone: StatusTone }> = {
  CLIENT_DECLARED_UNVERIFIED: { label: "Declarado — não verificado", tone: "warning" },
  SERVER_COMPUTED: { label: "Calculado pelo servidor", tone: "success" },
  SERVER_DERIVED: { label: "Derivado pelo servidor", tone: "success" },
  PLATFORM_VERSIONED: { label: "Versionado pela plataforma", tone: "info" },
};
export const RELATION_LABEL: Record<IntegrityView["relations"][number]["status"], { label: string; tone: StatusTone }> = {
  MATCH: { label: "Confere", tone: "success" }, DIFFERENT: { label: "Diferente", tone: "warning" }, NOT_APPLICABLE: { label: "Não se aplica", tone: "neutral" }, UNKNOWN: { label: "Não verificável agora", tone: "neutral" },
};
/** Verificação sob demanda do original preservado (somente leitura). */
export type OriginalVerificationStatusKey = "VERIFIED" | "MISMATCH" | "MISSING" | "UNAVAILABLE" | "FORBIDDEN_KEY";
export const ORIGINAL_VERIFICATION_LABEL: Record<OriginalVerificationStatusKey, { label: string; tone: StatusTone }> = {
  VERIFIED: { label: "Original conferido", tone: "success" }, MISMATCH: { label: "Original NÃO confere", tone: "danger" }, MISSING: { label: "Original não encontrado", tone: "danger" },
  UNAVAILABLE: { label: "Armazenamento indisponível", tone: "warning" }, FORBIDDEN_KEY: { label: "Chave recusada", tone: "danger" },
};
