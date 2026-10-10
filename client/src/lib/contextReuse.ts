/**
 * CONTEXT_REUSE 2.0 (UI) — lógica PURA, sem React/rede: Parâmetros estruturados do TR, papéis do Perfil de Licitações e padrões
 * institucionais. A validação final é sempre do servidor; aqui só se converte o que a pessoa digita para o valor canônico
 * (mesmas funções da preparação do Edital) e se decide o que mostrar por exceção.
 */
import { parseField, toFormValue, type FormValue, type PrepField, type PrepSection, type PreparationStateView } from "./editalPreparation";

// ─── Parâmetros estruturados do TR ──────────────────────────────────────────────

export interface TrParamViewModel {
  name: string; path: string; type: string; description: string; required: boolean; conditional: boolean;
  requiredWhen?: PrepField["requiredWhen"]; requiredWhenVariables: readonly string[]; enumValues?: readonly string[];
  active: boolean; status: "SET" | "UNSET" | "INVALID" | "CONFLICT"; value?: unknown; reason?: string;
  origin?: { sourceType: string; sourceId: string; sourceVersion: string; status: string; actorUserId: number | null; updatedAt: string | null };
  proposal?: { value: unknown; orgProfileRevision: number };
  defaultEligible: boolean;
}
export type TrStructuredView =
  | { status: "UNAVAILABLE"; reason: string }
  | { status: "READY"; catalogVersion: string; fields: TrParamViewModel[]; digest: string; orgProfileRevision: number | null; summary: { total: number; active: number; set: number; pending: number; proposals: number } };

/** O descritor do servidor na forma que o controle tipado (`PrepFieldControl`) e o parser consomem. */
export function trParamToPrepField(f: TrParamViewModel): PrepField {
  return {
    name: f.name, source: "TR", path: f.path, type: f.type, description: f.description, required: f.required, conditional: f.conditional,
    requiredWhenVariables: f.requiredWhenVariables, ...(f.requiredWhen ? { requiredWhen: f.requiredWhen } : {}), ...(f.enumValues ? { enumValues: f.enumValues } : {}),
    hasValue: f.status === "SET", ...(f.status === "SET" ? { currentValue: f.value } : {}), class: "TR_PROJECTION", rule: "TR_PARAM",
    status: f.status === "SET" ? "UPSTREAM" : "PENDING", editable: true, ...(f.status === "SET" ? { displayValue: f.value } : {}),
  };
}

/** Pendentes (ativos e sem valor): o que a pessoa precisa confirmar no TR. */
export const trPendingFields = (fields: readonly TrParamViewModel[]): TrParamViewModel[] =>
  fields.filter((f) => f.active && (f.required || f.conditional) && f.status !== "SET");
/** Opcionais ativos sem valor (decisões que ativam campos adicionais): recolhidos por padrão. */
export const trOptionalFields = (fields: readonly TrParamViewModel[]): TrParamViewModel[] =>
  fields.filter((f) => f.active && !f.required && !f.conditional && f.status === "UNSET");
export const trConfirmedFields = (fields: readonly TrParamViewModel[]): TrParamViewModel[] => fields.filter((f) => f.status === "SET");
export const trProposals = (fields: readonly TrParamViewModel[]): TrParamViewModel[] => fields.filter((f) => f.status === "UNSET" && !!f.proposal);

/** Edições digitadas → valores canônicos (só campos tocados). Erros por campo; vazio ⇒ ignorado (limpar é ação própria). */
export function buildTrValues(fields: readonly TrParamViewModel[], edits: Readonly<Record<string, FormValue>>): { values: Record<string, unknown>; errors: Record<string, string> } {
  const values: Record<string, unknown> = {}; const errors: Record<string, string> = {};
  for (const f of fields) {
    if (!Object.prototype.hasOwnProperty.call(edits, f.name)) continue;
    const r = parseField(trParamToPrepField(f), edits[f.name]);
    if (!r.ok) errors[f.name] = r.error;
    else if (r.value !== undefined) values[f.name] = r.value;
  }
  return { values, errors };
}

/** Valor inicial do controle: o digitado, senão o confirmado. */
export const trFormValue = (f: TrParamViewModel): FormValue => toFormValue(trParamToPrepField(f), f.status === "SET" ? f.value : undefined);

// ─── Papéis do Perfil de Licitações ─────────────────────────────────────────────

export interface RoleAssignmentView { name: string; cargo?: string; ato?: string; dataReferencia?: string; vigenciaAte?: string }
export interface RoleViewModel {
  role: string; label: string; assignment: RoleAssignmentView | null; state: "OK" | "MISSING" | "STALE"; reason?: string;
  usedBy: readonly { name: string; description: string }[];
}
export interface RoleForm { name: string; cargo: string; ato: string; dataReferencia: string; vigenciaAte: string }
export const emptyRoleForm = (): RoleForm => ({ name: "", cargo: "", ato: "", dataReferencia: "", vigenciaAte: "" });
export const roleToForm = (a: RoleAssignmentView | null): RoleForm => ({
  name: a?.name ?? "", cargo: a?.cargo ?? "", ato: a?.ato ?? "", dataReferencia: a?.dataReferencia ?? "", vigenciaAte: a?.vigenciaAte ?? "",
});

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Formulário de papéis → mapa canônico `{ PAPEL → designação }`. Papel sem nome é omitido; demais campos sem nome ⇒ erro. */
export function buildRoles(forms: Readonly<Record<string, RoleForm>>): { roles: Record<string, RoleAssignmentView>; errors: Record<string, string> } {
  const roles: Record<string, RoleAssignmentView> = {}; const errors: Record<string, string> = {};
  for (const [role, f] of Object.entries(forms)) {
    const name = f.name.trim();
    const others = [f.cargo, f.ato, f.dataReferencia, f.vigenciaAte].some((x) => x.trim() !== "");
    if (!name) { if (others) errors[role] = "Informe o nome (ou limpe os demais campos)."; continue; }
    if (f.dataReferencia.trim() && !ISO.test(f.dataReferencia.trim())) { errors[role] = "Data de referência inválida (AAAA-MM-DD)."; continue; }
    if (f.vigenciaAte.trim() && !ISO.test(f.vigenciaAte.trim())) { errors[role] = "Fim da vigência inválido (AAAA-MM-DD)."; continue; }
    roles[role] = {
      name, ...(f.cargo.trim() ? { cargo: f.cargo.trim() } : {}), ...(f.ato.trim() ? { ato: f.ato.trim() } : {}),
      ...(f.dataReferencia.trim() ? { dataReferencia: f.dataReferencia.trim() } : {}), ...(f.vigenciaAte.trim() ? { vigenciaAte: f.vigenciaAte.trim() } : {}),
    };
  }
  return { roles, errors };
}

/** Papéis realmente alterados (para o resumo "N decisões serão registradas"). */
export function changedRoles(current: Readonly<Record<string, RoleAssignmentView | null>>, next: Readonly<Record<string, RoleAssignmentView>>): string[] {
  const out: string[] = [];
  for (const role of new Set([...Object.keys(current), ...Object.keys(next)])) {
    if (JSON.stringify(current[role] ?? null) !== JSON.stringify(next[role] ?? null)) out.push(role);
  }
  return out.sort();
}

// ─── Perfil da PLATAFORMA (master data estável do órgão) ────────────────────────

export interface PlatformScheduleView { limitePropostas?: "ABERTURA_DA_SESSAO"; inicioPropostas?: "PUBLICACAO"; horarioInicioPropostas?: string }
export interface PlatformViewModel {
  slug: string; label: string; missing: number; cronograma: PlatformScheduleView | null;
  fields: readonly { field: "enderecoEletronico" | "regulamentoVersao"; name: string; description: string; type: string; value: string | null }[];
}
export interface PlatformForm { enderecoEletronico: string; regulamentoVersao: string; limitePropostas: "" | "ABERTURA_DA_SESSAO"; inicioPropostas: "" | "PUBLICACAO"; horarioInicioPropostas: string }
export const platformToForm = (p: PlatformViewModel): PlatformForm => ({
  enderecoEletronico: p.fields.find((f) => f.field === "enderecoEletronico")?.value ?? "", regulamentoVersao: p.fields.find((f) => f.field === "regulamentoVersao")?.value ?? "",
  limitePropostas: p.cronograma?.limitePropostas ?? "", inicioPropostas: p.cronograma?.inicioPropostas ?? "", horarioInicioPropostas: p.cronograma?.horarioInicioPropostas ?? "",
});
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Formulário → perfil canônico da plataforma. A regra de cronograma só existe se a pessoa a DECLARAR (nada é presumido da plataforma). */
export function buildPlatform(f: PlatformForm): { profile: { enderecoEletronico?: string; regulamentoVersao?: string; cronograma?: PlatformScheduleView }; error?: string } {
  const profile: { enderecoEletronico?: string; regulamentoVersao?: string; cronograma?: PlatformScheduleView } = {};
  const url = f.enderecoEletronico.trim();
  if (url) { if (!/^https?:\/\/[^\s<>"]+$/i.test(url)) return { profile, error: "Informe a URL oficial iniciada por http:// ou https://." }; profile.enderecoEletronico = url; }
  if (f.regulamentoVersao.trim()) profile.regulamentoVersao = f.regulamentoVersao.trim();
  const c: PlatformScheduleView = {};
  if (f.limitePropostas) c.limitePropostas = f.limitePropostas;
  if (f.inicioPropostas) {
    if (!HHMM.test(f.horarioInicioPropostas.trim())) return { profile, error: "Início do recebimento na publicação exige o horário (HH:MM)." };
    c.inicioPropostas = f.inicioPropostas; c.horarioInicioPropostas = f.horarioInicioPropostas.trim();
  }
  if (Object.keys(c).length) profile.cronograma = c;
  return { profile };
}
/** Plataformas alteradas (para o resumo "N alterações"). */
export function changedPlatforms(current: readonly PlatformViewModel[], next: Readonly<Record<string, ReturnType<typeof buildPlatform>["profile"]>>): string[] {
  return current.filter((p) => {
    const cur = { ...(platformToForm(p).enderecoEletronico ? { enderecoEletronico: platformToForm(p).enderecoEletronico } : {}), ...(platformToForm(p).regulamentoVersao ? { regulamentoVersao: platformToForm(p).regulamentoVersao } : {}), ...(p.cronograma ? { cronograma: p.cronograma } : {}) };
    return JSON.stringify(cur) !== JSON.stringify(next[p.slug] ?? {});
  }).map((p) => p.slug);
}

// ─── Padrões institucionais ─────────────────────────────────────────────────────

export interface DefaultViewModel { name: string; description: string; type: string; enumValues?: readonly string[]; value: unknown; hasValue: boolean; incompatibleReason?: string }

/** Mapa de padrões resultante de adicionar/atualizar UM padrão (ação explícita "Usar como padrão institucional"). */
export function withDefault(current: readonly DefaultViewModel[], name: string, value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = Object.fromEntries(current.filter((d) => d.hasValue && !d.incompatibleReason).map((d) => [d.name, d.value]));
  out[name] = value;
  return out;
}
/** Mapa de padrões resultante de REMOVER um padrão. */
export function withoutDefault(current: readonly DefaultViewModel[], name: string): Record<string, unknown> {
  return Object.fromEntries(current.filter((d) => d.hasValue && !d.incompatibleReason && d.name !== name).map((d) => [d.name, d.value]));
}

/** Texto do consentimento: a política criada/atualizada, mostrada ANTES da confirmação. */
export function defaultConsentText(description: string, valueText: string, existing: boolean): string {
  return `${existing ? "Atualizar" : "Criar"} o padrão institucional "${description}" = ${valueText}. Vale para os PRÓXIMOS processos; nada é copiado do processo atual além deste valor, e você pode removê-lo no Perfil de Licitações.`;
}

// ─── Perfil → plano de salvar da preparação ─────────────────────────────────────

export interface ProfileStateView {
  status: "READY"; catalogVersion: string; revision: number; hash: string | null; asOf: string; sections: PrepSection[];
  roles: RoleViewModel[]; defaults: DefaultViewModel[]; platforms: PlatformViewModel[];
  summary: { policyTotal: number; policyFilled: number; policyPending: number; rolesNeeded: number; rolesOk: number; rolesPending: number; platformsPending: number; pendingCount: number };
}

/** O estado do Perfil na forma que `buildSavePlan` consome (escopo ÓRGÃO, sem processo): reutiliza o MESMO plano/CAS da preparação. */
export function profileAsPrepView(p: Pick<ProfileStateView, "catalogVersion" | "revision" | "sections">): PreparationStateView {
  return {
    status: "READY_FOR_PREPARATION", revisionId: "profile", catalogVersion: p.catalogVersion,
    revisions: { process: 0, organization: p.revision, budget: 0 }, budgetDisclosure: null, participation: null, participationPending: false,
    trPin: { state: "NOT_SELECTED" }, sections: p.sections, facts: {}, canonicalFields: [], orgProfile: null,
    summary: { groups: [], reusedAutomatically: 0, pendingDecisions: 0 },
    metrics: {
      TOTAL_TEMPLATE_FIELDS: 0, AUTO_RESOLVED: 0, ORG_REUSED: 0, TR_PROJECTED: 0, DECIDED: 0, CONDITIONAL_HIDDEN: 0, POST_AWARD_HIDDEN: 0,
      OPTIONAL_HIDDEN: 0, MANUAL_DECISIONS_VISIBLE: 0, LEGACY_SHADOWED: 0,
    },
  };
}
