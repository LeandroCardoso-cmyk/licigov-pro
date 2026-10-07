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

const norm = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
/** Espelha (só para habilitar o botão e explicar) a regra do servidor: Edital exige modalidade, forma, regime e critério; forma eletrônica exige plataforma. */
export function scopeFormProblems(documentKind: string, f: ScopeFormState): Partial<Record<ScopeDimensionKey, string>> {
  const out: Partial<Record<ScopeDimensionKey, string>> = {};
  const v = scopeFromForm(f);
  for (const k of SCOPE_DIMENSION_ORDER) if (v[k] && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(v[k]!)) out[k] = "Use um token estável (letras, números, _ - .; sem espaços).";
  if (documentKind === "edital") {
    for (const k of ["modality", "form", "regime", "criterion"] as const) if (!v[k]) out[k] = `${SCOPE_DIMENSION_COPY[k]}: declare explicitamente (sem seleção automática).`;
    if (v.form && /^ELETRONIC[AO]$/.test(norm(v.form)) && !v.platform) out.platform = "Forma eletrônica exige a plataforma do certame.";
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
  readonly checks: readonly { id: string; label: string; status: ReadinessStatusKey; detail: string; findings: readonly string[]; findingsTotal: number }[];
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

export interface RegistrationPresetView { presetId: string; templateKey: string; documentKind: string; slug: string; displayName: string; scope: ScopeLike }
export interface RegisterFormState {
  targetKind: "NEW_IDENTITY" | "EXISTING_IDENTITY";
  existingIdentityId: string;
  documentKind: string; slug: string; templateKey: string; displayName: string; scope: ScopeFormState;
  sourceKind: "AST" | "MARKDOWN" | "DOCX"; sourceText: string;
  sourceLogicalVersion: string; sourceSha256: string; inventoryText: string;
  decidedByName: string; decidedByRole: string; decidedAt: string; basisReference: string; reason: string; confirmed: boolean;
}

export const emptyRegisterForm = (today: string, preset?: RegistrationPresetView): RegisterFormState => ({
  targetKind: "NEW_IDENTITY", existingIdentityId: "",
  documentKind: preset?.documentKind ?? "edital", slug: preset?.slug ?? "", templateKey: preset?.templateKey ?? "", displayName: preset?.displayName ?? "",
  scope: { ...emptyScopeForm(), ...(preset?.scope ?? {}) } as ScopeFormState,
  sourceKind: "AST", sourceText: "", sourceLogicalVersion: "", sourceSha256: "", inventoryText: "",
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
  if (f.sourceKind === "DOCX" ? !hasDocx : !f.sourceText.trim()) errors.source = "Informe o conteúdo-fonte.";
  if (f.sourceKind === "AST") { try { JSON.parse(f.sourceText); } catch { if (f.sourceText.trim()) errors.source = "AST: JSON inválido."; } }
  if (!f.sourceLogicalVersion.trim()) errors.sourceLogicalVersion = "Informe a versão lógica da fonte.";
  if (!/^[0-9a-f]{64}$/.test(f.sourceSha256.trim())) errors.sourceSha256 = "SHA-256 da fonte: 64 hexadecimais minúsculos.";
  if (f.inventoryText.trim()) { try { JSON.parse(f.inventoryText); } catch { errors.inventoryText = "Inventário: JSON inválido."; } }
  if (!f.decidedByName.trim()) errors.decidedByName = "Informe quem registra (nome).";
  if (!f.decidedByRole.trim()) errors.decidedByRole = "Informe o cargo/função.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.decidedAt)) errors.decidedAt = "Data AAAA-MM-DD.";
  if (!f.basisReference.trim()) errors.basisReference = "Informe a referência da fonte/ato.";
  if (f.reason.trim().length < 10) errors.reason = "Justificativa (mín. 10 caracteres).";
  if (!f.confirmed) errors.confirmed = "É necessária a confirmação humana explícita.";
  return { valid: Object.keys(errors).length === 0, errors };
}
